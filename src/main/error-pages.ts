// Styled error pages (network failures) and the certificate interstitial.
//
// A failed main-frame navigation is replaced by a data: URL page. The tab keeps
// showing the failed URL (see getFailedUrlForErrorPage), and the history entry of
// the failed navigation is removed so Back / Forward behave as if the page never
// loaded. The pages have no preload bridge; their buttons talk to the main
// process through a nonce-protected console message (see parseErrorPageMessage).
// The pure rendering/classification lives in error-page-html.ts.
import { app, net } from "electron";
import type { Certificate, WebContents } from "electron";
import { hostOf, isCertErrorCode, parseErrorPageMessage, renderErrorPageHtml, shouldShowErrorPage } from "./error-page-html.js";
import type { CertInfo, ErrorLang } from "./error-page-html.js";

export * from "./error-page-html.js";

// ── Registry of error pages (data URL -> failed URL) ────────────────────────
const errorPageUrls = new Map<string, string>();
const ERROR_PAGE_REGISTRY_LIMIT = 64;

export const getFailedUrlForErrorPage = (currentUrl: string): string | null =>
  errorPageUrls.get(currentUrl) ?? null;

const registerErrorPage = (dataUrl: string, failedUrl: string): void => {
  errorPageUrls.set(dataUrl, failedUrl);
  if (errorPageUrls.size > ERROR_PAGE_REGISTRY_LIMIT) {
    const oldest = errorPageUrls.keys().next().value as string | undefined;
    if (oldest) errorPageUrls.delete(oldest);
  }
};

// ── Certificate exceptions (in memory, until the app is closed) ─────────────
const certExceptions = { default: new Set<string>(), private: new Set<string>() };
const recentCertErrors = new Map<string, CertInfo>();

const certScope = (isPrivate: boolean): Set<string> => (isPrivate ? certExceptions.private : certExceptions.default);
export const hasCertException = (isPrivate: boolean, host: string): boolean => certScope(isPrivate).has(host);
export const addCertException = (isPrivate: boolean, host: string): void => { certScope(isPrivate).add(host); };
export const clearPrivateCertExceptions = (): void => { certExceptions.private.clear(); };

const formatDate = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  return new Date(seconds * 1000).toISOString().slice(0, 10);
};

const describeCertificate = (certificate: Certificate, errorName: string): CertInfo => ({
  errorName,
  subject: certificate.subjectName || certificate.subject?.commonName || "",
  issuer: certificate.issuerName || certificate.issuer?.commonName || "",
  validFrom: formatDate(certificate.validStart),
  validTo: formatDate(certificate.validExpiry),
  fingerprint: (certificate.fingerprint || "").replace(/^sha\d+\//i, ""),
});

/**
 * Default: deny. Only hosts the user explicitly excepted from the interstitial are trusted,
 * and only until the app closes. isPrivateContents tells which exception set applies.
 */
export const registerCertificateErrorHandler = (isPrivateContents: (contents: WebContents) => boolean): void => {
  app.on("certificate-error", (event, contents, url, error, certificate, callback) => {
    event.preventDefault();
    let host = "";
    try { host = new URL(url).host; } catch { /* keep empty */ }
    if (host && contents && hasCertException(isPrivateContents(contents), host)) {
      callback(true);
      return;
    }
    if (host) {
      recentCertErrors.set(host, describeCertificate(certificate, error));
      if (recentCertErrors.size > 32) {
        const oldest = recentCertErrors.keys().next().value as string | undefined;
        if (oldest) recentCertErrors.delete(oldest);
      }
    }
    callback(false);
  });
};

// ── Wiring a tab's WebContents ──────────────────────────────────────────────
export type ErrorPageHost = {
  getLanguage: () => ErrorLang;
  isPrivate: () => boolean;
  /** Back to safety: goes back when possible, otherwise to the start page. */
  goBackOrHome: () => void;
  /** Called whenever the error page state changed (tab URL/title need a refresh). */
  onChanged: () => void;
  /** The error page of this tab was committed (the owner may move focus to the address bar so a fix can be typed at once). */
  onShown?: () => void;
};

type PendingRetry = { index: number; dataUrl: string };

const wiredErrorPages = new WeakMap<WebContents, { host: ErrorPageHost }>();

export const wireErrorPages = (contents: WebContents, initialHost: ErrorPageHost): void => {
  // Wiring twice (Glance expanded into a tab) only swaps the owner callbacks.
  const existing = wiredErrorPages.get(contents);
  if (existing) {
    existing.host = initialHost;
    return;
  }
  const holder = { host: initialHost };
  wiredErrorPages.set(contents, holder);
  let pendingRetry: PendingRetry | null = null;
  let handling = false;

  const history = () => contents.navigationHistory;
  const currentFailedUrl = (): string | null => getFailedUrlForErrorPage(contents.getURL());

  const removeEntry = (index: number, expectedUrl?: string): void => {
    try {
      if (index < 0 || index >= history().length()) return;
      if (expectedUrl !== undefined && history().getEntryAtIndex(index)?.url !== expectedUrl) return;
      history().removeEntryAtIndex(index);
    } catch {
      // The entry is gone or active; leaving it is harmless.
    }
  };

  const retry = (failedUrl: string): void => {
    const dataUrl = contents.getURL();
    pendingRetry = { index: history().getActiveIndex(), dataUrl };
    contents.loadURL(failedUrl).catch(() => undefined);
  };

  // Browser-initiated reloads (F5, toolbar, context menu) on an error page retry the real URL.
  const nativeReload = contents.reload.bind(contents);
  const nativeReloadIgnoringCache = contents.reloadIgnoringCache.bind(contents);
  contents.reload = () => {
    const failed = currentFailedUrl();
    if (failed) retry(failed); else nativeReload();
  };
  contents.reloadIgnoringCache = () => {
    const failed = currentFailedUrl();
    if (failed) retry(failed); else nativeReloadIgnoringCache();
  };

  contents.on("did-navigate", (_event, url) => {
    if (!pendingRetry || getFailedUrlForErrorPage(url)) return;
    // The retried page loaded: drop the error page entry that preceded it.
    const { index, dataUrl } = pendingRetry;
    pendingRetry = null;
    removeEntry(index, dataUrl);
    holder.host.onChanged();
  });

  contents.on("did-fail-load", (_event, code, _description, validatedUrl, isMainFrame) => {
    if (!shouldShowErrorPage(code, isMainFrame, validatedUrl) || handling) return;
    handling = true;
    const failedIndex = history().getActiveIndex();
    const retryEntry = pendingRetry;
    pendingRetry = null;
    const errorName = _description || "ERR_FAILED";
    const info = isCertErrorCode(code) ? recentCertErrors.get(hostOf(validatedUrl)) ?? null : null;
    const html = renderErrorPageHtml({
      lang: holder.host.getLanguage(),
      url: validatedUrl,
      code,
      errorName: info?.errorName || errorName,
      online: net.isOnline(),
      cert: info,
    });
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    registerErrorPage(dataUrl, validatedUrl);

    const onCommitted = (_e: unknown, url: string): void => {
      if (url !== dataUrl) return;
      contents.removeListener("did-navigate", onCommitted);
      // Order matters: drop the higher index first so the lower one stays valid.
      removeEntry(failedIndex);
      if (retryEntry) removeEntry(retryEntry.index, retryEntry.dataUrl);
      holder.host.onChanged();
      holder.host.onShown?.();
    };
    contents.on("did-navigate", onCommitted);

    // loadURL from inside the failure event races the error page commit.
    setTimeout(() => {
      handling = false;
      if (contents.isDestroyed()) return;
      contents.loadURL(dataUrl).catch(() => contents.removeListener("did-navigate", onCommitted));
    }, 0);
  });

  contents.on("console-message", (event) => {
    const action = parseErrorPageMessage((event as unknown as { message?: unknown }).message);
    if (!action) return;
    const failed = currentFailedUrl();
    if (!failed) return;
    if (action === "retry") {
      retry(failed);
    } else if (action === "back") {
      holder.host.goBackOrHome();
    } else if (action === "proceed") {
      const certHost = hostOf(failed);
      if (!/^https:/i.test(failed) || !certHost) return;
      addCertException(holder.host.isPrivate(), certHost);
      retry(failed);
    }
  });
};
