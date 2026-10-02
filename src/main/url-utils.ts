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
