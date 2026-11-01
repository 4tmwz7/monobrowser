// Pure helpers shared by the main process and the renderer for the extension buttons in the toolbar
// (no Node/Electron imports: the renderer bundles this file).

/** Extension ids are 32 letters a-p. */
export const isExtensionId = (value: unknown): value is string => typeof value === "string" && /^[a-p]{32}$/.test(value);

/**
 * CSS for the shadow root of <browser-action-list> (the library offers no filter attribute): hides every action
 * button whose id is not in `pinnedIds`. With no pinned ids all buttons are hidden.
 */
export const pinnedActionsCss = (pinnedIds: readonly string[]): string =>
  `.action${pinnedIds.filter(isExtensionId).map((id) => `:not([id="${id}"])`).join("")} { display: none !important; }`;

/** What the toolbar needs to know about the extensions (sent by the main process whenever it changes). */
export type ExtensionToolbarInfo = {
  /** Partition of the private session's extensions (null: no extensions in private tabs). */
  privatePartition: string | null;
  /** Ids of the pinned, enabled extensions that have a toolbar action. */
  pinnedIds: string[];
  /** At least one enabled extension has a toolbar action: the Extensions button is shown. */
  hasActions: boolean;
};

export const EMPTY_TOOLBAR_INFO: ExtensionToolbarInfo = { privatePartition: null, pinnedIds: [], hasActions: false };

/** Normalizes an untrusted payload (IPC) into ExtensionToolbarInfo. */
export const normalizeToolbarInfo = (value: unknown): ExtensionToolbarInfo => {
  const raw = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    privatePartition: typeof raw.privatePartition === "string" && raw.privatePartition ? raw.privatePartition : null,
    pinnedIds: Array.isArray(raw.pinnedIds) ? [...new Set(raw.pinnedIds.filter(isExtensionId))] : [],
    hasActions: raw.hasActions === true,
  };
};
