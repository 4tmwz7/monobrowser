export type PortableBookmark = {
  url: string;
  title: string;
  createdAt?: string;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const decodeEntities = (value: string): string =>
  value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    const codePoint = lower.startsWith("#x") ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
    return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : match;
  });

/** Eksport w formacie Netscape Bookmark File (czytają go wszystkie popularne przeglądarki). */
export const exportBookmarksHtml = (bookmarks: PortableBookmark[]): string => {
  const rows = bookmarks.map((bookmark) => {
    const time = bookmark.createdAt ? Math.floor(Date.parse(bookmark.createdAt) / 1000) : NaN;
    const addDate = Number.isFinite(time) ? ` ADD_DATE="${time}"` : "";
    return `    <DT><A HREF="${escapeHtml(bookmark.url)}"${addDate}>${escapeHtml(bookmark.title || bookmark.url)}</A>`;
  });

  return [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
    "<DL><p>",
    ...rows,
    "</DL><p>",
    "",
  ].join("\n");
};

export const exportBookmarksJson = (bookmarks: PortableBookmark[]): string =>
  JSON.stringify(
    bookmarks.map(({ url, title, createdAt }) => ({ url, title, createdAt })),
    null,
    2,
  );

const parseJsonBookmarks = (text: string): PortableBookmark[] => {
  const result: PortableBookmark[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== "object" || node === null) {
      return;
    }
    const record = node as Record<string, unknown>;
    if (typeof record.url === "string") {
      result.push({
        url: record.url,
        title: typeof record.title === "string" ? record.title : typeof record.name === "string" ? record.name : "",
        createdAt: typeof record.createdAt === "string" ? record.createdAt : undefined,
      });
    }
    // Obsługa zagnieżdżonych struktur (np. drzewo zakładek Chromium).
    for (const value of Object.values(record)) {
      if (typeof value === "object" && value !== null) {
        visit(value);
      }
    }
  };
  visit(JSON.parse(text));
  return result;
};

const parseHtmlBookmarks = (text: string): PortableBookmark[] => {
  const result: PortableBookmark[] = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of text.matchAll(anchorPattern)) {
    const attributes = match[1];
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attributes);
    const url = decodeEntities((href?.[1] ?? href?.[2] ?? "").trim());
    if (!url) {
      continue;
    }
    const addDate = /\badd_date\s*=\s*"?(\d+)"?/i.exec(attributes);
    const seconds = addDate ? Number.parseInt(addDate[1], 10) : NaN;
    const createdAt = Number.isFinite(seconds) && seconds > 0 && seconds < 8.64e12 / 1000
      ? new Date(seconds * 1000).toISOString()
      : undefined;
    result.push({
      url,
      title: decodeEntities(match[2].replace(/<[^>]*>/g, "")).trim(),
      createdAt,
    });
  }
  return result;
};

/** Parsuje plik HTML (Netscape) lub JSON; zwraca wpisy bez walidacji adresów. */
export const parseBookmarksImport = (text: string): PortableBookmark[] => {
  const trimmed = text.replace(/^﻿/, "").trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return parseJsonBookmarks(trimmed);
  }
  return parseHtmlBookmarks(trimmed);
};
