// "Leave site?" handling for pages with a beforeunload handler.
//
// Electron cancels an unload silently unless a 'will-prevent-unload' listener calls
// event.preventDefault(). We do the opposite: the first time the event fires we leave
// the unload cancelled, ask the user with the in-window prompt and, on "Leave", allow
// the next unload and replay the navigation that was interrupted.
//
// The browser-initiated actions (loadURL, reload, history back/forward, tab close) are
// recorded as an "intent" right before they are issued, so they can be replayed.
// LIMITATION: navigations started by the page itself (link click, form submit,
// location change) are not recorded and cannot be replayed; after choosing "Leave" the
// user has to repeat the click, which is then allowed through (a short grace window).
import type { WebContents } from "electron";
import { buildLeaveRequest } from "./prompt-queue.js";
import type { PromptLang } from "./prompt-queue.js";
import type { PromptRequest } from "./prompt-overlay.js";

export type UnloadIntent =
  | { kind: "load"; url: string }
  | { kind: "reload"; ignoreCache: boolean }
  | { kind: "back" }
  | { kind: "forward" }
  | { kind: "close" };

export const INTENT_TTL_MS = 5000;
export const GRACE_AFTER_LEAVE_MS = 15000;
export const REPLAY_GRACE_MS = 5000;

/** Remembers the last browser-initiated navigation for a short time. */
export const createIntentStore = (now: () => number = Date.now, ttlMs: number = INTENT_TTL_MS) => {
  let current: { intent: UnloadIntent; at: number } | null = null;
  return {
    set: (intent: UnloadIntent): void => { current = { intent, at: now() }; },
    /** Returns the intent once, and only while it is fresh. */
    take: (): UnloadIntent | null => {
      const entry = current;
      current = null;
      return entry && now() - entry.at <= ttlMs ? entry.intent : null;
    },
    clear: (): void => { current = null; },
  };
};

/** One-shot permission to let the next unload through (after the user chose "Leave"). */
export const createLeaveGate = (now: () => number = Date.now) => {
  let until = -1;
  return {
    arm: (durationMs: number): void => { until = now() + durationMs; },
    /** True (once) while the gate is armed. */
    consume: (): boolean => {
      const open = now() <= until;
      until = -1;
      return open;
    },
    disarm: (): void => { until = -1; },
    isArmed: (): boolean => now() <= until,
  };
};

export type UnloadGuardHost = {
  getLanguage: () => PromptLang;
  /** Tab the prompt belongs to (the owner of Glance contents is its source tab). */
  getTabId: () => number | null;
  confirmLeave: (request: PromptRequest) => Promise<boolean>;
  /** Makes sure the user can see the prompt (activates a background tab being closed). */
  reveal: () => void;
  /** Replays a tab-close intent. */
  closeNow: () => void;
  /** The user stayed on the page. */
  onStay: () => void;
};

type Holder = { host: UnloadGuardHost; intents: ReturnType<typeof createIntentStore>; prompting: boolean };
const wired = new WeakMap<WebContents, Holder>();

const hostOf = (url: string): string => {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

let unloadGuardBypassed = false;
/** While true (app is quitting for an update) beforeunload handlers can no longer veto closing. */
export const setUnloadGuardBypass = (value: boolean): void => { unloadGuardBypassed = value; };

/** Whether a "Leave site?" prompt for this contents is open right now. */
export const isUnloadPromptOpen = (contents: WebContents): boolean => wired.get(contents)?.prompting === true;

/** Records that the browser itself asks this contents to close (replayed after "Leave"). */
export const recordCloseIntent = (contents: WebContents): void => {
  wired.get(contents)?.intents.set({ kind: "close" });
};

export const wireUnloadGuard = (contents: WebContents, host: UnloadGuardHost): void => {
  const existing = wired.get(contents);
  if (existing) {
    // Re-wired (Glance expanded into a tab): only the owner changes.
    existing.host = host;
    return;
  }
  const holder: Holder = { host, intents: createIntentStore(), prompting: false };
  wired.set(contents, holder);
  const gate = createLeaveGate();

  // Natives (possibly already wrapped by the error pages) used for recording and for replay.
  const inner = {
    loadURL: contents.loadURL.bind(contents),
    reload: contents.reload.bind(contents),
    reloadIgnoringCache: contents.reloadIgnoringCache.bind(contents),
  };
  contents.loadURL = ((url: string, options?: Electron.LoadURLOptions) => {
    holder.intents.set({ kind: "load", url });
    return inner.loadURL(url, options);
  }) as typeof contents.loadURL;
  contents.reload = () => {
    holder.intents.set({ kind: "reload", ignoreCache: false });
    inner.reload();
  };
  contents.reloadIgnoringCache = () => {
    holder.intents.set({ kind: "reload", ignoreCache: true });
    inner.reloadIgnoringCache();
  };
  const history = contents.navigationHistory;
  const innerBack = history.goBack.bind(history);
  const innerForward = history.goForward.bind(history);
  history.goBack = () => { holder.intents.set({ kind: "back" }); innerBack(); };
  history.goForward = () => { holder.intents.set({ kind: "forward" }); innerForward(); };

  const replay = (intent: UnloadIntent): void => {
    if (contents.isDestroyed()) return;
    switch (intent.kind) {
      case "load": inner.loadURL(intent.url).catch(() => undefined); break;
      case "reload": if (intent.ignoreCache) inner.reloadIgnoringCache(); else inner.reload(); break;
      case "back": innerBack(); break;
      case "forward": innerForward(); break;
      case "close": holder.host.closeNow(); break;
    }
  };

  contents.on("will-prevent-unload", (event) => {
    if (unloadGuardBypassed) {
      event.preventDefault(); // allow the unload: the app is quitting to install an update
      return;
    }
    if (gate.consume()) {
      event.preventDefault(); // allow the unload
      return;
    }
    const intent = holder.intents.take();
    // Not preventing the default keeps the unload cancelled until the user answers.
    if (holder.prompting) return;
    holder.prompting = true;
    holder.host.reveal();
    const request = buildLeaveRequest(holder.host.getLanguage(), holder.host.getTabId(), hostOf(contents.getURL()) || "page");
    holder.host.confirmLeave(request).then((leave) => {
      holder.prompting = false;
      if (contents.isDestroyed()) return;
      if (!leave) {
        holder.host.onStay();
        return;
      }
      if (intent) {
        gate.arm(REPLAY_GRACE_MS);
        replay(intent);
      } else {
        gate.arm(GRACE_AFTER_LEAVE_MS);
      }
    }).catch(() => { holder.prompting = false; });
  });

  contents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) holder.intents.clear();
  });
};
