export type TabSleepSettings = {
  /** Idle minutes before a background tab is put to sleep; 0 = never sleep automatically. */
  afterMinutes: number;
  /** Lowercase hostnames (without scheme/path/port); a site matches itself and all its subdomains. */
  neverSleepSites: string[];
};

export const TAB_SLEEP_MINUTE_OPTIONS: readonly number[] = [0, 5, 10, 15, 30, 60, 120, 240];
export const MAX_NEVER_SLEEP_SITES = 500;

export const DEFAULT_TAB_SLEEP_SETTINGS: TabSleepSettings = {
  afterMinutes: 10,
  neverSleepSites: [],
};

const HOST_LABEL = /^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/;

export const isTabSleepMinutes = (value: unknown): value is number =>
  typeof value === "number" && TAB_SLEEP_MINUTE_OPTIONS.includes(value);

/** Accepts "example.com", "https://www.example.com/path", "*.example.com"; returns a lowercase hostname or null. */
export const normalizeSleepSite = (input: unknown): string | null => {
  if (typeof input !== "string") return null;
  let value = input.trim().toLowerCase();
  if (!value || value.length > 2048) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(value)) {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      value = url.hostname;
    } catch {
      return null;
    }
  } else {
    value = value.replace(/^\*\./, "");
    value = value.split(/[/?#]/, 1)[0] ?? "";
    if (/[@\s]/.test(value)) return null;
    value = value.replace(/:\d+$/, "");
  }
  value = value.replace(/^\*\./, "").replace(/\.$/, "").replace(/^www\./, "");
  if (!value || value.length > 253 || value.includes(":")) return null;
  if (!value.split(".").every((label) => HOST_LABEL.test(label))) return null;
  return value;
};

/** Normalizes a list of user-entered sites: valid hostnames only, de-duplicated, sorted, capped. */
export const normalizeSleepSites = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const hosts = new Set<string>();
  for (const item of value) {
    const host = normalizeSleepSite(item);
    if (host) hosts.add(host);
  }
  return [...hosts].sort().slice(0, MAX_NEVER_SLEEP_SITES);
};

/** Merges a (possibly partial, untrusted) patch over the current settings, ignoring invalid fields. */
export const mergeTabSleepSettings = (current: TabSleepSettings, patch: unknown): TabSleepSettings => {
  if (typeof patch !== "object" || patch === null) {
    return { afterMinutes: current.afterMinutes, neverSleepSites: [...current.neverSleepSites] };
  }
  const raw = patch as Record<string, unknown>;
  return {
    afterMinutes: isTabSleepMinutes(raw.afterMinutes) ? raw.afterMinutes : current.afterMinutes,
    neverSleepSites: Array.isArray(raw.neverSleepSites) ? normalizeSleepSites(raw.neverSleepSites) : [...current.neverSleepSites],
  };
};

export const normalizeTabSleepSettings = (value: unknown): TabSleepSettings =>
  mergeTabSleepSettings(DEFAULT_TAB_SLEEP_SETTINGS, value);

/** True for http(s) URLs whose host equals a listed site or is a subdomain of one. */
export const isSiteExcludedFromSleep = (url: string | null | undefined, sites: readonly string[]): boolean => {
  if (!url || sites.length === 0) return false;
  let hostname: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  if (!hostname) return false;
  const set = new Set(sites);
  let candidate = hostname;
  for (;;) {
    if (set.has(candidate)) return true;
    const dot = candidate.indexOf(".");
    if (dot < 0) return false;
    candidate = candidate.slice(dot + 1);
  }
};
