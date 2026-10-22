// Pure part of the error pages: classification of net errors, localized copy, HTML rendering
// and the nonce-protected message protocol. No Electron imports (unit-testable).
import crypto from "node:crypto";
import { displayUrl } from "./url-utils.js";
import { INTERACTION_VARS_MB_CSS } from "./interaction-css.js";

export type ErrorLang = "pl" | "en";

export type ErrorKind =
  | "offline" | "dns" | "refused" | "timeout" | "reset" | "unreachable" | "tls"
  | "cert" | "redirects" | "blocked" | "invalid-url" | "file" | "empty" | "generic";

export type ErrorAction = "retry" | "back" | "proceed";

export type CertInfo = {
  errorName: string;
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  fingerprint: string;
};

const NONCE = crypto.randomBytes(16).toString("hex");

/** Supplies the current theme's :root block (set by the main process; error pages have no preload). */
let themeCssProvider: () => string = () => "";
export const setErrorPageThemeCss = (provider: () => string): void => { themeCssProvider = provider; };

/** Supplies the display font (Bebas Neue) as a data: URL, the same face the start page and onboarding headings use. */
let fontDataUrlProvider: () => string = () => "";
export const setErrorPageFontDataUrl = (provider: () => string): void => { fontDataUrlProvider = provider; };

/** Net error codes that never produce an error page: ERR_ABORTED (user cancel, downloads) and "unknown scheme" (handled externally). */
const IGNORED_CODES = new Set([0, -3, -301, -302]);

export const shouldShowErrorPage = (code: number, isMainFrame: boolean, url: string): boolean =>
  isMainFrame && !IGNORED_CODES.has(code) && /^(?:https?|ftp|file):/i.test(url);

export const isCertErrorCode = (code: number): boolean => code <= -200 && code > -300;

export const classifyNetError = (code: number, online: boolean): ErrorKind => {
  if (isCertErrorCode(code)) return "cert";
  switch (code) {
    case -106: return "offline";
    case -21: return online ? "reset" : "offline";
    case -105: case -137: return online ? "dns" : "offline";
    case -102: return "refused";
    case -7: case -118: return "timeout";
    case -100: case -101: case -103: case -104: return "reset";
    case -109: case -111: case -130: return "unreachable";
    case -107: case -113: case -110: case -115: case -116: case -117: case -501: return "tls";
    case -310: return "redirects";
    case -20: case -10: case -27: return "blocked";
    case -300: return "invalid-url";
    case -6: return "file";
    case -320: case -321: case -324: case -330: return "empty";
    default: return "generic";
  }
};

type Copy = { title: string; hint: string };

const COPY: Record<ErrorLang, Record<ErrorKind, Copy>> = {
  pl: {
    offline: { title: "Brak połączenia", hint: "Nie masz połączenia z internetem. Sprawdź kabel, Wi‑Fi lub tryb samolotowy, a potem spróbuj ponownie. Strona załaduje się sama po przywróceniu sieci." },
    dns: { title: "Nie można znaleźć strony", hint: "Nie znaleziono serwera {host}. Sprawdź, czy adres nie zawiera literówki, oraz ustawienia DNS." },
    refused: { title: "Połączenie odrzucone", hint: "Serwer {host} odmówił połączenia. Usługa może być wyłączona albo blokowana przez zaporę sieciową." },
    timeout: { title: "Przekroczono czas oczekiwania", hint: "Serwer {host} zbyt długo nie odpowiadał. Może być przeciążony — spróbuj za chwilę." },
    reset: { title: "Połączenie zostało przerwane", hint: "Połączenie z {host} zostało zerwane w trakcie ładowania. Spróbuj ponownie." },
    unreachable: { title: "Serwer jest nieosiągalny", hint: "Nie można dotrzeć do {host}. Sprawdź swoją sieć lub ustawienia serwera proxy." },
    tls: { title: "Błąd bezpiecznego połączenia", hint: "Nie udało się nawiązać bezpiecznego połączenia z {host}. Serwer może używać nieobsługiwanej konfiguracji szyfrowania." },
    cert: { title: "Połączenie nie jest prywatne", hint: "Nie można potwierdzić, że {host} jest prawdziwą witryną. Osoby postronne mogą próbować przechwycić Twoje dane (hasła, wiadomości, karty płatnicze)." },
    redirects: { title: "Zbyt wiele przekierowań", hint: "Strona {host} przekierowuje w nieskończoność. Wyczyszczenie ciasteczek tej witryny często pomaga." },
    blocked: { title: "Dostęp zablokowany", hint: "Ładowanie {host} zostało zablokowane przez przeglądarkę, rozszerzenie lub serwer." },
    "invalid-url": { title: "Nieprawidłowy adres", hint: "Ten adres jest niepoprawny. Sprawdź go i spróbuj ponownie." },
    file: { title: "Nie znaleziono pliku", hint: "Plik nie istnieje albo został przeniesiony." },
    empty: { title: "Serwer nie zwrócił poprawnej odpowiedzi", hint: "{host} odpowiedział pustą lub nieprawidłową odpowiedzią. Spróbuj ponownie za chwilę." },
    generic: { title: "Nie można otworzyć strony", hint: "Podczas ładowania {host} wystąpił błąd. Spróbuj ponownie." },
  },
  en: {
    offline: { title: "No connection", hint: "You are not connected to the internet. Check your cable, Wi‑Fi or airplane mode, then try again. The page will reload by itself when the network is back." },
    dns: { title: "This site can't be found", hint: "The server {host} could not be found. Check the address for typos and your DNS settings." },
    refused: { title: "Connection refused", hint: "The server {host} refused the connection. The service may be down or blocked by a firewall." },
    timeout: { title: "Connection timed out", hint: "The server {host} took too long to respond. It may be overloaded — try again in a moment." },
    reset: { title: "Connection interrupted", hint: "The connection to {host} was dropped while loading. Try again." },
    unreachable: { title: "Server unreachable", hint: "Could not reach {host}. Check your network or proxy settings." },
    tls: { title: "Secure connection failed", hint: "A secure connection to {host} could not be established. The server may use an unsupported encryption setup." },
    cert: { title: "Your connection is not private", hint: "We can't confirm that {host} is the real site. Attackers might be trying to intercept your data (passwords, messages, payment cards)." },
    redirects: { title: "Too many redirects", hint: "{host} keeps redirecting in a loop. Clearing this site's cookies often helps." },
    blocked: { title: "Access blocked", hint: "Loading {host} was blocked by the browser, an extension or the server." },
    "invalid-url": { title: "Invalid address", hint: "This address is malformed. Check it and try again." },
    file: { title: "File not found", hint: "The file does not exist or was moved." },
    empty: { title: "The server sent no valid response", hint: "{host} returned an empty or invalid response. Try again in a moment." },
    generic: { title: "This page can't be opened", hint: "An error occurred while loading {host}. Try again." },
  },
};

const UI: Record<ErrorLang, Record<string, string>> = {
  pl: {
    retry: "Spróbuj ponownie",
    back: "Wróć do bezpieczeństwa",
    advanced: "Zaawansowane",
    proceed: "Przejdź mimo to (niebezpieczne)",
    proceedNote: "Wyjątek obowiązuje tylko dla tego hosta i tylko do zamknięcia aplikacji.",
    code: "Kod błędu",
    address: "Adres",
    subject: "Wystawiony dla",
    issuer: "Wystawca",
    validFrom: "Ważny od",
    validTo: "Ważny do",
    fingerprint: "Odcisk SHA‑256",
    tips: "Co możesz zrobić",
    tipOffline: "Sprawdź połączenie sieciowe",
    tipReload: "Odśwież stronę za chwilę",
    tipAddress: "Sprawdź, czy adres jest poprawny",
  },
  en: {
    retry: "Try again",
    back: "Back to safety",
    advanced: "Advanced",
    proceed: "Proceed anyway (unsafe)",
    proceedNote: "The exception applies to this host only and lasts until the app is closed.",
    code: "Error code",
    address: "Address",
    subject: "Issued to",
    issuer: "Issuer",
    validFrom: "Valid from",
    validTo: "Valid until",
    fingerprint: "SHA-256 fingerprint",
    tips: "What you can do",
    tipOffline: "Check your network connection",
    tipReload: "Reload the page in a moment",
    tipAddress: "Make sure the address is correct",
  },
};

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string));

export const hostOf = (url: string): string => {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

export type ErrorPageOptions = {
  lang: ErrorLang;
  url: string;
  code: number;
  errorName: string;
  online: boolean;
  cert?: CertInfo | null;
};

export const renderErrorPageHtml = (options: ErrorPageOptions): string => {
  const { lang, url, code, errorName, online, cert } = options;
  const kind = classifyNetError(code, online);
  const copy = COPY[lang][kind];
  const ui = UI[lang];
  const host = hostOf(url);
  const hint = copy.hint.replace("{host}", host);
  const isCert = kind === "cert";
  const showAutoRetry = kind === "offline" || kind === "dns";
  const tips = kind === "offline" || kind === "dns" || kind === "unreachable"
    ? [ui.tipOffline, ui.tipAddress, ui.tipReload]
    : [];

  const certRows = isCert && cert
    ? [
      [ui.subject, cert.subject], [ui.issuer, cert.issuer],
      [ui.validFrom, cert.validFrom], [ui.validTo, cert.validTo],
      [ui.fingerprint, cert.fingerprint],
    ].filter(([, value]) => value).map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("")
    : "";

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:">
<title>${escapeHtml(copy.title)}</title>
<style id="mb-theme">${themeCssProvider()}</style>
<style>
  ${fontDataUrlProvider() ? `@font-face { font-family: "Bebas Neue"; src: url("${fontDataUrlProvider()}") format("truetype"); font-weight: 400; font-display: block; }` : ""}
  :root {
    --font: ui-monospace, "Cascadia Mono", "Courier New", monospace;
    ${INTERACTION_VARS_MB_CSS}
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; background: var(--mb-bg, #f0efe9); color: var(--mb-fg, #0a0a0a); font-family: var(--font); }
  body { display: flex; align-items: center; justify-content: center; padding: 32px 20px; min-height: 100vh; }
  main { width: 100%; max-width: 640px; border: 3px solid var(--mb-fg, #0a0a0a); background: var(--mb-surface-2, #d8d7d1); box-shadow: 8px 8px 0 var(--mb-accent, #9c9b95); padding: 32px 32px 28px; }
  .glyph { font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: var(--mb-muted, #5c5b57); margin: 0 0 14px; }
  h1 { margin: 0 0 16px; font-family: "Bebas Neue", Impact, "Arial Narrow", sans-serif; font-size: 52px; line-height: .95; font-weight: 400; letter-spacing: .01em; text-transform: uppercase; }
  p { margin: 0 0 14px; font-size: 14px; line-height: 1.6; }
  .url { margin: 0 0 14px; padding: 9px 11px; border: 2px solid var(--mb-fg, #0a0a0a); background: var(--mb-bg, #f0efe9); font-size: 12px; word-break: break-all; }
  .muted { color: var(--mb-muted, #5c5b57); }
  .code { font-size: 11px; color: var(--mb-muted, #5c5b57); margin: 18px 0 0; }
  ul { margin: 0 0 18px; padding-left: 20px; font-size: 13px; line-height: 1.7; color: var(--mb-muted, #5c5b57); }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
  button { font: 700 12px var(--font); letter-spacing: .06em; text-transform: uppercase; padding: 11px 18px; border: 2px solid var(--mb-border, #0a0a0a); border-radius: 0; background: var(--mb-bg, #f0efe9); color: var(--mb-fg, #0a0a0a); cursor: pointer; }
  button:hover { background: var(--ctl-hover-bg); }
  button:active { background: var(--ctl-press-bg); }
  button:focus-visible, summary:focus-visible { outline: 2px solid var(--mb-accent, #9c9b95); outline-offset: 2px; }
  button.primary { background: var(--mb-fg, #0a0a0a); color: var(--mb-on-accent, var(--mb-bg, #f0efe9)); }
  button.primary:hover { background: var(--ctl-solid-hover); }
  button.primary:active { background: var(--ctl-solid-press); }
  button.danger { border-style: dashed; border-color: var(--mb-danger, #0a0a0a); }
  details { margin-top: 20px; border-top: 2px solid var(--mb-fg, #0a0a0a); padding-top: 14px; }
  summary { cursor: pointer; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 11px; }
  th { text-align: left; width: 34%; padding: 5px 8px 5px 0; color: var(--mb-muted, #5c5b57); font-weight: 400; vertical-align: top; }
  td { padding: 5px 0; word-break: break-all; }
</style>
</head>
<body>
<main role="alert">
  <p class="glyph">MonoBrowser${isCert ? " · TLS" : ""}</p>
  <h1>${escapeHtml(copy.title)}</h1>
  <div class="url">${escapeHtml(displayUrl(url))}</div>
  <p>${escapeHtml(hint)}</p>
  ${tips.length ? `<p class="muted" style="margin-bottom:6px">${escapeHtml(ui.tips)}:</p><ul>${tips.map((tip) => `<li>${escapeHtml(tip)}</li>`).join("")}</ul>` : ""}
  <div class="actions">
    <button id="primary" class="primary" type="button" autofocus>${escapeHtml(isCert ? ui.back : ui.retry)}</button>
  </div>
  ${isCert ? `<details><summary>${escapeHtml(ui.advanced)}</summary>
    <table>${certRows}</table>
    <p class="muted">${escapeHtml(ui.proceedNote)}</p>
    <div class="actions" style="margin-top:12px"><button id="proceed" class="danger" type="button">${escapeHtml(ui.proceed)}</button></div>
  </details>` : ""}
  <p class="code">${escapeHtml(ui.code)}: ${escapeHtml(errorName)} (${code})</p>
</main>
<script>
  (function () {
    var nonce = ${JSON.stringify(NONCE)};
    var send = function (action) { console.debug("MBERR|" + nonce + "|" + action); };
    document.getElementById("primary").addEventListener("click", function () { send(${JSON.stringify(isCert ? "back" : "retry")}); });
    var proceed = document.getElementById("proceed");
    if (proceed) proceed.addEventListener("click", function () { send("proceed"); });
    ${showAutoRetry ? 'window.addEventListener("online", function () { send("retry"); });' : ""}
    document.addEventListener("keydown", function (event) {
      if (event.key === "F5") { event.preventDefault(); send(${JSON.stringify(isCert ? "back" : "retry")}); }
    });
  })();
</script>
</body>
</html>`;
};

/** Parses a console message coming from an error page. Returns the action only for the page's own nonce. */
export const parseErrorPageMessage = (message: unknown, nonce: string = NONCE): ErrorAction | null => {
  if (typeof message !== "string") return null;
  const parts = message.split("|");
  if (parts.length !== 3 || parts[0] !== "MBERR" || parts[1] !== nonce) return null;
  return parts[2] === "retry" || parts[2] === "back" || parts[2] === "proceed" ? parts[2] : null;
};

