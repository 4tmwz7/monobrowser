// Pure parts of the in-window prompt system: queue selection, overlay geometry,
// de-duplication of identical pending prompts and the (PL/EN) prompt texts.
// No Electron imports here so everything is unit-testable.
import type { PromptKind, PromptRequest } from "./prompt-overlay.js";

export type PromptLang = "pl" | "en";

/** The first queued entry that may be shown now: tab-less prompts always, tab prompts only for the active tab. */
export const selectVisibleEntry = <T extends { request: { tabId: number | null } }>(
  queue: readonly T[],
  activeTabId: number | null,
): T | null => queue.find((entry) => entry.request.tabId === null || entry.request.tabId === activeTabId) ?? null;

export const OVERLAY_WIDTH: Record<PromptKind, number> = { permission: 380, auth: 420, confirm: 420 };

export type OverlayBoundsInput = {
  kind: PromptKind;
  contentWidth: number;
  contentHeight: number;
  top: number;
  left: number;
  reportedHeight: number;
  /** Size of the pane the prompt anchors to (split view: the active pane); defaults to the page area. */
  areaWidth?: number;
  areaHeight?: number;
};

/** Permissions hang from the left of the page area (right under the address bar); the rest is centered. */
export const computeOverlayBounds = (input: OverlayBoundsInput): { x: number; y: number; width: number; height: number } => {
  const { kind, contentWidth, contentHeight, top, left, reportedHeight } = input;
  const areaWidth = Math.max(240, input.areaWidth ?? contentWidth - left);
  const width = Math.max(120, Math.min(OVERLAY_WIDTH[kind], areaWidth - 24));
  const height = Math.max(80, Math.min(reportedHeight, (input.areaHeight ?? contentHeight - top) - 16));
  const x = kind === "permission" ? left + 12 : left + Math.round((areaWidth - width) / 2);
  return { x: Math.max(0, x), y: top + (kind === "permission" ? 4 : 16), width, height };
};

/** Groups callers waiting for the same prompt: only the first one opens it, all of them get the answer. */
export const createPendingGroups = <V>() => {
  const groups = new Map<string, Array<(value: V) => void>>();
  return {
    /** Returns true when the caller is first for this key and must open the prompt. */
    join: (key: string, callback: (value: V) => void): boolean => {
      const existing = groups.get(key);
      if (existing) {
        existing.push(callback);
        return false;
      }
      groups.set(key, [callback]);
      return true;
    },
    resolve: (key: string, value: V): number => {
      const callbacks = groups.get(key) ?? [];
      groups.delete(key);
      for (const callback of callbacks) callback(value);
      return callbacks.length;
    },
    has: (key: string): boolean => groups.has(key),
    size: (): number => groups.size,
  };
};

export const authDedupeKey = (host: string, realm: string, tabId: number): string => `${host}|${realm}|${tabId}`;

const hostOf = (url: string): string => {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

export type AuthPromptInput = {
  lang: PromptLang;
  tabId: number;
  host: string;
  realm: string;
  isProxy: boolean;
  scheme: string;
  secure: boolean;
};

export const buildAuthRequest = (input: AuthPromptInput): PromptRequest => {
  const pl = input.lang === "pl";
  const lines: PromptRequest["lines"] = [
    { text: pl
      ? `${input.host} wymaga nazwy użytkownika i hasła.`
      : `${input.host} requires a username and password.`, style: "strong" },
  ];
  if (input.realm) lines.push({ text: `${pl ? "Obszar" : "Realm"}: ${input.realm}`, style: "muted" });
  if (input.isProxy) lines.push({ text: pl ? "To żądanie serwera proxy." : "This is a proxy server request.", style: "muted" });
  if (!input.secure) {
    lines.push({
      text: pl ? "Połączenie nie jest szyfrowane — dane logowania mogą zostać przechwycone." : "This connection is not encrypted — your credentials could be intercepted.",
      style: "warn",
    });
  }
  return {
    kind: "auth",
    tabId: input.tabId,
    title: pl ? "Wymagane uwierzytelnienie" : "Authentication required",
    lines,
    fields: pl ? { username: "Nazwa użytkownika", password: "Hasło" } : { username: "Username", password: "Password" },
    primary: pl ? "Zaloguj" : "Sign in",
    secondary: pl ? "Anuluj" : "Cancel",
  };
};

export const buildPermissionRequest = (lang: PromptLang, tabId: number | null, origin: string, action: string): PromptRequest => {
  const pl = lang === "pl";
  return {
    kind: "permission",
    tabId,
    title: pl ? "Uprawnienia witryny" : "Site permission",
    lines: [
      { text: pl ? `${hostOf(origin)} chce ${action}.` : `${hostOf(origin)} wants to ${action}.`, style: "strong" },
      { text: pl ? "Decyzja obowiązuje do zamknięcia aplikacji." : "Your choice lasts until the app is closed.", style: "muted" },
    ],
    primary: pl ? "Zezwól" : "Allow",
    secondary: pl ? "Zablokuj" : "Block",
  };
};

export const buildLeaveRequest = (lang: PromptLang, tabId: number | null, host: string): PromptRequest => {
  const pl = lang === "pl";
  return {
    kind: "confirm",
    tabId,
    title: pl ? "Opuścić stronę?" : "Leave site?",
    lines: [
      { text: pl ? `${host} twierdzi, że wprowadzone zmiany mogą nie zostać zapisane.` : `${host} says the changes you made may not be saved.`, style: "strong" },
    ],
    primary: pl ? "Opuść" : "Leave",
    secondary: pl ? "Zostań" : "Stay",
    danger: true,
  };
};
