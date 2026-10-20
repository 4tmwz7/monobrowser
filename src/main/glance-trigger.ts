import { isHttpUrl } from "./url-utils.js";
import type { GlanceSettings } from "./glance-settings.js";

export const GLANCE_MESSAGE_PREFIX = "MBGLANCE:";
const MAX_GLANCE_URL_LENGTH = 4096;

/**
 * Extracts the URL from a console message sent by the injected trigger script.
 * The nonce is only known to the main process and the isolated-world script, so
 * a page cannot forge it; even a forged message could only open a Glance of an
 * http(s) URL of the page's choosing.
 */
export const parseGlanceMessage = (message: unknown, nonce: string): string | null => {
  if (typeof message !== "string") return null;
  const head = `${GLANCE_MESSAGE_PREFIX}${nonce}:`;
  if (!message.startsWith(head)) return null;
  const url = message.slice(head.length);
  if (!url || url.length > MAX_GLANCE_URL_LENGTH || !isHttpUrl(url)) return null;
  return url;
};

/**
 * Script run in an isolated world of every web tab (tabs have no preload). It is
 * idempotent: the listeners are installed once per document and later runs only
 * update the settings. The page cannot reach this world; the click is reported
 * to the main process through a nonce-tagged console message.
 */
export const buildGlanceTriggerScript = (nonce: string, settings: GlanceSettings): string => `(() => {
  const root = globalThis;
  const KEY = "__monobrowserGlance";
  const config = ${JSON.stringify({ nonce, enabled: settings.enabled, trigger: settings.trigger })};
  if (root[KEY]) { root[KEY].config = config; return; }
  const state = { config, timer: 0, startX: 0, startY: 0, suppressClick: false };
  root[KEY] = state;
  const linkFrom = (event) => {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const node of path) {
      if (node && node.tagName === "A" && typeof node.href === "string" && node.hasAttribute("href")) return node;
    }
    return null;
  };
  const report = (anchor) => {
    const href = anchor.href;
    if (typeof href === "string" && /^https?:\\/\\//i.test(href)) console.debug("${GLANCE_MESSAGE_PREFIX}" + state.config.nonce + ":" + href);
  };
  const modifierMatches = (event, trigger) => {
    const { altKey, ctrlKey, shiftKey, metaKey } = event;
    if (trigger === "alt") return altKey && !ctrlKey && !shiftKey && !metaKey;
    if (trigger === "ctrl") return ctrlKey && !altKey && !shiftKey && !metaKey;
    if (trigger === "shift") return shiftKey && !altKey && !ctrlKey && !metaKey;
    return false;
  };
  const cancelTimer = () => { if (state.timer) { clearTimeout(state.timer); state.timer = 0; } };
  window.addEventListener("click", (event) => {
    if (state.suppressClick) {
      state.suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const { enabled, trigger } = state.config;
    if (!enabled || !event.isTrusted || event.button !== 0 || trigger === "longpress") return;
    if (!modifierMatches(event, trigger)) return;
    const anchor = linkFrom(event);
    if (!anchor) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    report(anchor);
  }, true);
  window.addEventListener("pointerdown", (event) => {
    cancelTimer();
    state.suppressClick = false;
    const { enabled, trigger } = state.config;
    if (!enabled || trigger !== "longpress" || !event.isTrusted || event.button !== 0) return;
    if (event.altKey || event.ctrlKey || event.shiftKey || event.metaKey) return;
    const anchor = linkFrom(event);
    if (!anchor) return;
    state.startX = event.clientX;
    state.startY = event.clientY;
    state.timer = setTimeout(() => {
      state.timer = 0;
      state.suppressClick = true;
      report(anchor);
    }, 500);
  }, true);
  window.addEventListener("pointermove", (event) => {
    if (state.timer && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) > 8) cancelTimer();
  }, true);
  window.addEventListener("pointerup", cancelTimer, true);
  window.addEventListener("pointercancel", cancelTimer, true);
  window.addEventListener("dragstart", cancelTimer, true);
  window.addEventListener("contextmenu", cancelTimer, true);
})()`;
