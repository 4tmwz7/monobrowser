export type SwipeDirection = "back" | "forward";

export type SwipeNavigationOptions = {
  /** Ile px poziomego przesunięcia (suma delt w jednym geście) wystarcza do wykonania nawigacji. */
  threshold?: number;
  /** Przerwa bez zdarzeń kołka, po której uznajemy, że gest się skończył. */
  idleMs?: number;
  now?: () => number;
  onSwipe: (direction: SwipeDirection) => void;
  /** Postęp bieżącego gestu od -1 (wstecz) do 1 (dalej), do animacji; 0 gdy gest przewija stronę. */
  onProgress?: (progress: number) => void;
};

export type SwipeNavigationDetector = {
  handleWheel: (deltaX: number, deltaY: number) => void;
  /** Bieżący gest przewija coś na stronie: do jego końca nie nawigujemy. */
  cancelGesture: () => void;
};

/**
 * Wykrywa poziome gesty dwoma palcami na touchpadzie z kolejnych zdarzeń kółka myszy.
 * Przesunięcie palców w prawo (ujemne deltaX) to "wstecz", w lewo (dodatnie deltaX) to "dalej".
 * Jeden gest wykonuje nawigację najwyżej raz, nawet jeśli po palcach płynie inercja.
 */
export const createSwipeNavigationDetector = (options: SwipeNavigationOptions): SwipeNavigationDetector => {
  const threshold = options.threshold ?? 120;
  const idleMs = options.idleMs ?? 350;
  const now = options.now ?? Date.now;

  let accumulated = 0;
  let lastEventAt = Number.NEGATIVE_INFINITY;
  let fired = false;

  const touch = () => {
    const timestamp = now();
    if (timestamp - lastEventAt > idleMs) {
      accumulated = 0;
      fired = false;
    }
    lastEventAt = timestamp;
  };

  return {
    cancelGesture: () => {
      touch();
      if (!fired) options.onProgress?.(0);
      fired = true;
    },
    handleWheel: (deltaX, deltaY) => {
      touch();

      // Pionowe przewijanie zostawiamy stronie; liczy się tylko wyraźnie poziomy ruch.
      if (fired || !Number.isFinite(deltaX) || Math.abs(deltaX) <= Math.abs(deltaY)) return;

      accumulated += deltaX;
      options.onProgress?.(Math.max(-1, Math.min(1, accumulated / threshold)));
      if (Math.abs(accumulated) < threshold) return;

      fired = true;
      options.onSwipe(accumulated < 0 ? "back" : "forward");
    },
  };
};

export const SWIPE_MESSAGE_PREFIX = "MBSWIPE:";

/** Kierunek z wiadomości konsoli wysłanej przez wstrzyknięty skrypt (nonce zna tylko proces główny i izolowany świat). */
export const parseSwipeMessage = (message: unknown, nonce: string): SwipeDirection | null => {
  if (typeof message !== "string") return null;
  const head = `${SWIPE_MESSAGE_PREFIX}${nonce}:`;
  if (!message.startsWith(head)) return null;
  const direction = message.slice(head.length);
  return direction === "back" || direction === "forward" ? direction : null;
};

/**
 * Skrypt dla izolowanego świata karty. Zdarzenia input-event Electrona nie niosą
 * deltaX kółka, więc gest czytamy ze zdarzeń `wheel` strony. Gest, który przewija
 * coś w poziomie (karuzela, szeroka tabela), nie nawiguje. Podczas gestu przy
 * krawędzi wysuwa się kwadrat ze strzałką, który podąża za palcami i wypełnia się,
 * gdy puszczenie gestu wykona nawigację. Skrypt jest idempotentny: kolejne
 * uruchomienia tylko aktualizują, w którą stronę da się nawigować, i kolory motywu.
 */
export type SwipeIndicatorColors = { bg: string; fg: string; accent: string; onAccent: string };
export type SwipeTriggerConfig = { animate: boolean; canGoBack: boolean; canGoForward: boolean; colors: SwipeIndicatorColors };

export const buildSwipeTriggerScript = (nonce: string, config: SwipeTriggerConfig): string => `(() => {
  const KEY = "__monobrowserSwipe";
  const config = ${JSON.stringify({ canGoBack: config.canGoBack, canGoForward: config.canGoForward, colors: config.colors })};
  if (globalThis[KEY]) { globalThis[KEY].config = config; globalThis[KEY].applyColors(); return; }
  const state = { config };
  globalThis[KEY] = state;
  const allowed = (forward) => forward ? state.config.canGoForward : state.config.canGoBack;
  const IDLE_MS = 350;
  const createSwipeNavigationDetector = ${createSwipeNavigationDetector.toString()};
  let host = null;
  // Kolory motywu jako zmienne na hoście: zmiana motywu nie wymaga przebudowy wskaźnika.
  const applyColors = () => {
    if (!host) return;
    const { bg, fg, accent, onAccent } = state.config.colors;
    host.style.setProperty("--mb-bg", bg);
    host.style.setProperty("--mb-fg", fg);
    host.style.setProperty("--mb-accent", accent);
    host.style.setProperty("--mb-on-accent", onAccent);
  };
  state.applyColors = applyColors;
  let arrow = null;
  let hideTimer = 0;
  const ensureIndicator = () => {
    if (arrow && host.isConnected) return arrow;
    host = document.createElement("div");
    host.style.cssText = "all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
    const shadow = host.attachShadow({ mode: "closed" });
    // Arkusz konstruowany zamiast <style>: nie blokuje go CSP strony (style-src).
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(''
      + '.arrow{position:fixed;top:50%;left:0;width:44px;height:44px;margin-top:-22px;box-sizing:border-box;display:grid;place-items:center;'
      + 'border:3px solid var(--mb-fg);background:var(--mb-bg);color:var(--mb-fg);box-shadow:4px 4px 0 var(--mb-accent);opacity:0;transform:translateX(-60px);'
      + '${config.animate ? "transition:opacity 120ms ease,background 120ms ease,color 120ms ease;" : ""}}'
      + '.arrow.forward{left:auto;right:0;transform:translateX(60px);}'
      + '.arrow.ready{background:var(--mb-accent);color:var(--mb-on-accent);box-shadow:4px 4px 0 var(--mb-fg);}'
      + '.arrow.leaving{${config.animate ? "transition:opacity 180ms ease,transform 180ms ease,background 120ms ease,color 120ms ease;" : ""}}'
      + 'svg{width:22px;height:22px;}');
    shadow.adoptedStyleSheets = [sheet];
    // Bez innerHTML: strony z Trusted Types odrzuciłyby taki zapis.
    const SVG = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(SVG, "svg");
    const path = document.createElementNS(SVG, "path");
    for (const [name, value] of [["viewBox", "0 0 24 24"], ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "2.5"], ["stroke-linecap", "square"]]) svg.setAttribute(name, value);
    path.setAttribute("d", "M20 12H5M11 5l-7 7 7 7");
    svg.appendChild(path);
    arrow = document.createElement("div");
    arrow.className = "arrow";
    arrow.appendChild(svg);
    shadow.append(arrow);
    applyColors();
    document.documentElement.appendChild(host);
    return arrow;
  };
  const hide = () => {
    if (!arrow) return;
    arrow.classList.add("leaving");
    arrow.style.opacity = "0";
    arrow.style.transform = arrow.classList.contains("forward") ? "translateX(60px)" : "translateX(-60px)";
  };
  const showProgress = (progress) => {
    clearTimeout(hideTimer);
    if (progress === 0 || !allowed(progress > 0)) { hide(); return; }
    let element;
    try { element = ensureIndicator(); } catch { return; }
    const forward = progress > 0;
    const amount = Math.abs(progress);
    element.classList.remove("leaving");
    element.classList.toggle("forward", forward);
    element.classList.toggle("ready", amount >= 1);
    element.querySelector("svg").style.transform = forward ? "scaleX(-1)" : "";
    // Wysuwa się od krawędzi (poza ekranem) do 16 px od niej, z lekkim spowolnieniem na końcu.
    const offset = -60 + (60 + 16) * (1 - Math.pow(1 - amount, 2));
    element.style.transform = "translateX(" + (forward ? -offset : offset) + "px)";
    element.style.opacity = String(Math.min(1, amount * 2));
    hideTimer = setTimeout(hide, amount >= 1 ? 220 : IDLE_MS);
  };
  const detector = createSwipeNavigationDetector({
    idleMs: IDLE_MS,
    onProgress: showProgress,
    onSwipe: (direction) => allowed(direction === "forward") && console.debug(${JSON.stringify(`${SWIPE_MESSAGE_PREFIX}${nonce}:`)} + direction),
  });
  const canScrollX = (path, deltaX) => {
    for (const node of path) {
      if (!(node instanceof Element) || node.scrollWidth <= node.clientWidth + 1) continue;
      const scrollable = node === document.scrollingElement || /auto|scroll|overlay/.test(getComputedStyle(node).overflowX);
      if (!scrollable) continue;
      const left = Math.abs(node.scrollLeft);
      if (deltaX < 0 ? left > 0 : left + node.clientWidth < node.scrollWidth - 1) return true;
    }
    return false;
  };
  window.addEventListener("wheel", (event) => {
    if (!event.isTrusted || event.ctrlKey || event.deltaMode !== 0) return;
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) { detector.handleWheel(event.deltaX, event.deltaY); return; }
    if (event.defaultPrevented || canScrollX(event.composedPath(), event.deltaX)) { detector.cancelGesture(); return; }
    detector.handleWheel(event.deltaX, event.deltaY);
  }, { passive: true });
})()`;
