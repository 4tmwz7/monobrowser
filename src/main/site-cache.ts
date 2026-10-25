// Czysta logika akcji „Wyczyść pamięć podręczną strony i przeładuj".

/** Storage types cleared for the page's origin (Cache Storage API + service workers; cookies and local storage stay intact). */
export const SITE_CACHE_STORAGES = ["cachestorage", "serviceworkers"] as const;

/** Origin whose caches should be cleared for a tab URL; null for anything that is not http(s) (internal pages, file:, data:, ...). */
export const siteCacheOrigin = (pageUrl: string): string | null => {
  try {
    const parsed = new URL(pageUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
};
