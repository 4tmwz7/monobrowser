// Czysta logika powiększenia stron: kroki, zapis per origin.

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 5;
export const MAX_ZOOM_ENTRIES = 500;

export type ZoomStore = Record<string, number>;

export const clampZoom = (value: number): number =>
  Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(value * 100) / 100));

/** Kolejny krok powiększenia (jak w Chrome: 25 33 50 67 75 80 90 100 110 125 150 175 200 250 300 400 500 %). */
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

export const stepZoom = (current: number, direction: "in" | "out"): number => {
  const value = Number.isFinite(current) ? current : 1;
  if (direction === "in") {
    return ZOOM_STEPS.find((step) => step > value + 0.001) ?? MAX_ZOOM;
  }
  for (let index = ZOOM_STEPS.length - 1; index >= 0; index -= 1) {
    if (ZOOM_STEPS[index] < value - 0.001) return ZOOM_STEPS[index];
  }
  return MIN_ZOOM;
};

export const formatZoomPercent = (factor: number): string => `${Math.round(factor * 100)}%`;

/** Klucz zapisu powiększenia: origin stron http(s); view-source: dzieli powiększenie z oryginałem; inne adresy nie mają zapamiętanego powiększenia. */
export const zoomOriginKey = (url: string): string | null => {
  try {
    const parsed = new URL(url.replace(/^view-source:/i, ""));
    // Chromium trzyma powiększenie per host (bez schematu i portu), więc klucz też jest hostem.
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? `https://${parsed.hostname}` : null;
  } catch {
    return null;
  }
};

export const normalizeZoomStore = (value: unknown): ZoomStore => {
  const store: ZoomStore = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) return store;
  for (const [origin, factor] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(store).length >= MAX_ZOOM_ENTRIES) break;
    if (!zoomOriginKey(origin) || typeof factor !== "number" || !Number.isFinite(factor)) continue;
    const clamped = clampZoom(factor);
    if (clamped !== 1) store[origin] = clamped;
  }
  return store;
};

/** Zwraca nowy zapis z ustawionym (lub usuniętym dla 100%) powiększeniem origin. */
export const withZoomEntry = (store: ZoomStore, origin: string, factor: number): ZoomStore => {
  const next: ZoomStore = { ...store };
  const clamped = clampZoom(factor);
  delete next[origin];
  if (clamped !== 1) {
    next[origin] = clamped;
    const keys = Object.keys(next);
    if (keys.length > MAX_ZOOM_ENTRIES) delete next[keys[0]];
  }
  return next;
};
