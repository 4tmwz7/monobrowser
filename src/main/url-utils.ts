const HOST_PATTERNS = [
  /^localhost(?::\d+)?$/i,
  /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?$/,
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d+)?$/i,
];

export const isHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value);

export const isAboutBlankUrl = (value: string): boolean => /^about:blank(?:[?#].*)?$/i.test(value);

/** Czy wpisany tekst wygląda na adres hosta (a nie zapytanie wyszukiwarki). */
export const looksLikeHost = (input: string): boolean => {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return false;
  }

  const host = trimmed.split("/")[0];
  return HOST_PATTERNS.some((pattern) => pattern.test(host));
};

export const getErrorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;

/** view-source: dla stron http(s) (Ctrl+U); nie pozwalamy na view-source: dla pozostałych schematów. */
export const isViewSourceUrl = (value: string): boolean => /^view-source:https?:\/\//i.test(value);

export const buildViewSourceUrl = (pageUrl: string): string | null =>
  isHttpUrl(pageUrl) ? `view-source:${pageUrl}` : null;

export const isFileUrl = (value: string): boolean => /^file:\/\//i.test(value);

/** Adres do wyświetlenia: bez samotnego "/" po gołym hoście (jak w Chrome); reszta bez zmian. */
export const displayUrl = (value: string): string =>
  /^https?:\/\/[^/?#]+\/$/i.test(value) ? value.slice(0, -1) : value;

export const isInternalSchemeInput = (value: string): boolean => /^monobrowser:\/\//i.test(value.trim());

/**
 * Malformed address-bar text that starts with the internal scheme (typically a kind with a URL typed or pasted
 * right after it, e.g. "monobrowser://settingshttps://example.com"): the http(s) URL that follows, or null when
 * there is nothing to recover. Such input must never turn into a web search.
 */
export const recoverEmbeddedUrl = (value: string): string | null => {
  const match = /^monobrowser:\/\/[a-z-]*(https?:\/\/\S+)$/i.exec(value.trim());
  return match ? match[1] : null;
};

/** Host + path of an address for list rows (no scheme, no "www.", no lone trailing slash). */
export const shortUrlLabel = (value: string): string =>
  value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
