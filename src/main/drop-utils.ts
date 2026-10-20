import { pathToFileURL } from "node:url";
import { isAboutBlankUrl, isHttpUrl, looksLikeHost } from "./url-utils.js";

export type DropPayload = {
  uriList?: unknown;
  text?: unknown;
  filePaths?: unknown;
};

export const MAX_DROPPED_TARGETS = 10;

const cleanString = (value: unknown, max = 8192): string =>
  typeof value === "string" ? value.slice(0, max) : "";

/**
 * Zamienia zawartość upuszczoną na powłokę (lista URI, zwykły tekst, pliki) na adresy do otwarcia w kartach.
 * Pliki trafiają jako file://, tekst będący adresem http(s)/hostem jako URL; inny tekst jest ignorowany
 * (nie zamieniamy go w wyszukiwanie, żeby przypadkowe upuszczenie niczego nie otwierało).
 */
export const resolveDropTargets = (payload: DropPayload): string[] => {
  const targets: string[] = [];
  const add = (url: string): void => {
    if (url && !targets.includes(url) && targets.length < MAX_DROPPED_TARGETS) targets.push(url);
  };

  const filePaths = Array.isArray(payload.filePaths) ? payload.filePaths : [];
  for (const filePath of filePaths) {
    if (typeof filePath === "string" && filePath.length > 0 && filePath.length < 4096 && /^(?:\/|[A-Za-z]:[\\/])/.test(filePath)) {
      add(pathToFileURL(filePath).href);
    }
  }
  if (targets.length > 0) return targets;

  const uriLines = cleanString(payload.uriList)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  for (const line of uriLines) {
    if (isHttpUrl(line) || isAboutBlankUrl(line) || /^file:\/\//i.test(line)) add(line);
  }
  if (targets.length > 0) return targets;

  const text = cleanString(payload.text).trim();
  if (text && !/\s/.test(text)) {
    if (isHttpUrl(text)) add(text);
    else if (looksLikeHost(text)) add(`https://${text}`);
  }
  return targets;
};
