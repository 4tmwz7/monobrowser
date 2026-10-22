/**
 * Menu functions that can be pinned to the toolbar as icon buttons (order here = order in the pin list defaults).
 * Settings is not pinnable: the toolbar already has its own settings button.
 */
export const PINNABLE_TOOLBAR_ACTIONS = [
  "notes",
  "downloads",
  "history",
  "bookmarks",
  "new-private-tab",
  "dev-tools",
  "compact-toggle",
] as const;

export type ToolbarActionId = (typeof PINNABLE_TOOLBAR_ACTIONS)[number];

export const MAX_TOOLBAR_PINS = PINNABLE_TOOLBAR_ACTIONS.length;

export const isToolbarActionId = (value: unknown): value is ToolbarActionId =>
  typeof value === "string" && (PINNABLE_TOOLBAR_ACTIONS as readonly string[]).includes(value);

/**
 * Normalizes untrusted input (the stored JSON, an IPC payload) into a list of unique, known action ids.
 * Accepts either a bare array or `{ pinned: [...] }`; anything else yields an empty list.
 */
export const normalizeToolbarPins = (value: unknown): ToolbarActionId[] => {
  const list = Array.isArray(value)
    ? value
    : typeof value === "object" && value !== null && Array.isArray((value as { pinned?: unknown }).pinned)
      ? (value as { pinned: unknown[] }).pinned
      : [];
  const result: ToolbarActionId[] = [];
  for (const entry of list) {
    if (isToolbarActionId(entry) && !result.includes(entry)) result.push(entry);
  }
  return result;
};

/** Pins or unpins one action (new pins are appended, so the toolbar order is the order they were pinned in). */
export const setToolbarPinned = (current: readonly ToolbarActionId[], id: unknown, pinned: boolean): ToolbarActionId[] => {
  if (!isToolbarActionId(id)) return [...current];
  const without = current.filter((entry) => entry !== id);
  return pinned ? [...without, id] : without;
};
