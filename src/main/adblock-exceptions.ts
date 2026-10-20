const HOST_LABEL = /^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/;

/** Normalizes a hostname or URL to a lowercase host without a leading "www."; null when invalid. */
export const normalizeExceptionHost = (input: unknown): string | null => {
  if (typeof input !== "string") return null;
  let value = input.trim().toLowerCase();
  if (!value || value.length > 300) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(value)) {
    try {
      value = new URL(value).hostname;
    } catch {
      return null;
    }
  } else if (/[/?#@\s]/.test(value)) {
    return null;
  }
  value = value.replace(/\.$/, "").replace(/^www\./, "");
  if (!value || value.length > 253) return null;
  if (value.includes(":")) return null;
  const labels = value.split(".");
  if (!labels.every((label) => HOST_LABEL.test(label))) return null;
  return value;
};

/** True when host equals an allowlisted site or is one of its subdomains. */
export const isHostExcepted = (host: string | null | undefined, exceptions: ReadonlySet<string>): boolean => {
  const normalized = normalizeExceptionHost(host ?? "");
  if (!normalized) return false;
  let candidate = normalized;
  for (;;) {
    if (exceptions.has(candidate)) return true;
    const dot = candidate.indexOf(".");
    if (dot < 0) return false;
    candidate = candidate.slice(dot + 1);
  }
};

export const isUrlExcepted = (url: string | null | undefined, exceptions: ReadonlySet<string>): boolean => {
  if (!url || exceptions.size === 0) return false;
  try {
    return isHostExcepted(new URL(url).hostname, exceptions);
  } catch {
    return false;
  }
};

/** Parses stored JSON ({ hosts: string[] }) into a sorted, de-duplicated, validated list. */
export const parseExceptionList = (value: unknown): string[] => {
  const raw = Array.isArray(value) ? value : (value as { hosts?: unknown } | null)?.hosts;
  if (!Array.isArray(raw)) return [];
  const hosts = new Set<string>();
  for (const item of raw) {
    const host = normalizeExceptionHost(item);
    if (host) hosts.add(host);
  }
  return [...hosts].sort();
};
