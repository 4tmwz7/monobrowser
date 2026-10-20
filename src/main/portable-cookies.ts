// Portable cookie vault: pure (de)serialization of Electron cookies. Windows Chromium encrypts its cookie DB with a
// DPAPI key bound to the PC/user, so on another computer the cookies are lost - the vault re-imports them.

export type SameSite = "unspecified" | "no_restriction" | "lax" | "strict";

/** Structural subset of Electron.Cookie. */
export type ElectronCookieLike = {
  name: string;
  value: string;
  domain?: string;
  hostOnly?: boolean;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  session?: boolean;
  expirationDate?: number;
  sameSite?: string;
};

export type PortableCookie = {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: SameSite;
  /** Seconds since the epoch. */
  expirationDate: number;
};

/** Mirror of the Electron.CookiesSetDetails fields we use. */
export type CookieSetDetails = {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate: number;
  sameSite: SameSite;
};

const SAME_SITE_VALUES: readonly string[] = ["unspecified", "no_restriction", "lax", "strict"];

const normalizeSameSite = (value: unknown): SameSite =>
  typeof value === "string" && SAME_SITE_VALUES.includes(value) ? (value as SameSite) : "unspecified";

const normalizePath = (value: unknown): string =>
  typeof value === "string" && value.startsWith("/") ? value : "/";

export const isPrefixedSecure = (name: string): boolean => name.startsWith("__Secure-") || name.startsWith("__Host-");

export const cookieKey = (cookie: { name: string; domain: string; path: string; hostOnly?: boolean }): string =>
  `${cookie.name}\u0000${cookie.domain.replace(/^\./, "").toLowerCase()}\u0000${cookie.path}`;

/** Persistent, non-expired cookies only; session cookies are never written to the USB drive. */
export const serializeCookies = (cookies: readonly ElectronCookieLike[], nowSeconds: number): PortableCookie[] => {
  const out: PortableCookie[] = [];
  for (const cookie of cookies) {
    if (!cookie || typeof cookie.name !== "string" || typeof cookie.value !== "string") continue;
    if (cookie.session === true) continue;
    const expirationDate = cookie.expirationDate;
    if (typeof expirationDate !== "number" || !Number.isFinite(expirationDate) || expirationDate <= nowSeconds) continue;
    const domain = typeof cookie.domain === "string" ? cookie.domain.trim() : "";
    if (!domain) continue;
    out.push({
      name: cookie.name,
      value: cookie.value,
      domain,
      hostOnly: cookie.hostOnly === true || (cookie.hostOnly === undefined && !domain.startsWith(".")),
      path: normalizePath(cookie.path),
      secure: cookie.secure === true,
      httpOnly: cookie.httpOnly === true,
      sameSite: normalizeSameSite(cookie.sameSite),
      expirationDate,
    });
  }
  return out;
};

/** Validates untrusted JSON (vault contents) into a clean list; invalid entries are dropped. */
export const parseCookieList = (value: unknown): PortableCookie[] => {
  if (!Array.isArray(value)) return [];
  const out: PortableCookie[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.name !== "string" || typeof item.value !== "string" || typeof item.domain !== "string") continue;
    if (typeof item.expirationDate !== "number" || !Number.isFinite(item.expirationDate)) continue;
    const domain = item.domain.trim();
    if (!domain) continue;
    out.push({
      name: item.name,
      value: item.value,
      domain,
      hostOnly: item.hostOnly === true,
      path: normalizePath(item.path),
      secure: item.secure === true,
      httpOnly: item.httpOnly === true,
      sameSite: normalizeSameSite(item.sameSite),
      expirationDate: item.expirationDate,
    });
  }
  return out;
};

const hostForUrl = (domain: string): string => {
  const host = domain.replace(/^\./, "");
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
};

/** URL that Electron's cookies.set() needs: scheme from `secure`, host from the domain, the cookie path. */
export const buildCookieUrl = (cookie: Pick<PortableCookie, "domain" | "path" | "secure" | "name">): string => {
  const secure = cookie.secure || isPrefixedSecure(cookie.name);
  const path = cookie.name.startsWith("__Host-") ? "/" : normalizePath(cookie.path);
  return `${secure ? "https" : "http"}://${hostForUrl(cookie.domain)}${path}`;
};

/**
 * Converts a vault cookie to cookies.set() details, or null when it must be skipped (expired / unusable).
 * - __Host-: Secure, Path=/, no Domain attribute (host-only).
 * - __Secure-: Secure.
 * - host-only cookies get no `domain` (setting it would turn them into domain cookies).
 * - SameSite=None needs Secure; without it the cookie would be rejected, so it is downgraded to unspecified.
 */
export const toSetDetails = (cookie: PortableCookie, nowSeconds: number): CookieSetDetails | null => {
  if (!(cookie.expirationDate > nowSeconds)) return null;
  const hostHeader = cookie.domain.replace(/^\./, "");
  if (!hostHeader) return null;
  const hostPrefixed = cookie.name.startsWith("__Host-");
  const secure = cookie.secure || isPrefixedSecure(cookie.name);
  const hostOnly = hostPrefixed || cookie.hostOnly;
  const details: CookieSetDetails = {
    url: buildCookieUrl(cookie),
    name: cookie.name,
    value: cookie.value,
    path: hostPrefixed ? "/" : normalizePath(cookie.path),
    secure,
    httpOnly: cookie.httpOnly,
    expirationDate: cookie.expirationDate,
    sameSite: cookie.sameSite === "no_restriction" && !secure ? "unspecified" : cookie.sameSite,
  };
  if (!hostOnly) details.domain = `.${hostHeader}`;
  return details;
};
