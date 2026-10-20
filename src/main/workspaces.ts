// Czysta logika przestrzeni (workspaces): lista przestrzeni, ikony, kolory, kolejność kart, wybór aktywnej karty.
// Bez zależności od Electrona; stan w procesie głównym to tylko lista + id bieżącej przestrzeni.

export type Workspace = {
  id: string;
  /** Pusta nazwa = nazwa domyślna zależna od języka (tylko przestrzeń główna). */
  name: string;
  icon: string;
  /** null = bez koloru; "accent" | "fg" | "muted" | "danger" = token motywu; "#rrggbb" = kolor z małej palety. */
  color: string | null;
};

export const MAIN_WORKSPACE_ID = "main";
export const MAX_WORKSPACES = 12;
export const MAX_WORKSPACE_NAME_LENGTH = 40;
const MAX_ICON_LENGTH = 16;

/** Mały monochromatyczny zestaw ikon (litery/symbole); emoji i dowolny pojedynczy znak też są dozwolone. */
export const WORKSPACE_ICONS: readonly string[] = ["◼", "●", "▲", "◆", "★", "♥", "☰", "⌂", "✦", "☾", "☀", "⚑"];
export const WORKSPACE_COLOR_TOKENS: readonly string[] = ["accent", "fg", "muted", "danger"];
export const WORKSPACE_COLOR_PALETTE: readonly string[] = ["#c8553d", "#d9a441", "#5b9a6a", "#3f88c5", "#7b6cc4", "#c26a9b"];

const COLOR_TOKEN_CSS: Record<string, string> = {
  accent: "var(--mb-accent, #9c9b95)",
  fg: "var(--mb-fg, #f0efe9)",
  muted: "var(--mb-muted, #a5a49e)",
  danger: "var(--mb-danger, #8b2931)",
};

/** Wartość CSS koloru przestrzeni (token motywu -> var(--mb-*), paleta -> hex); null gdy bez koloru. */
export const workspaceColorCss = (color: string | null): string | null => {
  if (!color) return null;
  return COLOR_TOKEN_CSS[color] ?? (WORKSPACE_COLOR_PALETTE.includes(color) ? color : null);
};

export const DEFAULT_MAIN_NAME = { pl: "Główna", en: "Main" } as const;
export const DEFAULT_NEW_NAME = { pl: "Przestrzeń", en: "Space" } as const;

export const createMainWorkspace = (): Workspace => ({ id: MAIN_WORKSPACE_ID, name: "", icon: "◼", color: null });

export const workspaceDisplayName = (workspace: Workspace, language: "pl" | "en"): string =>
  workspace.name || (workspace.id === MAIN_WORKSPACE_ID ? DEFAULT_MAIN_NAME[language] : DEFAULT_NEW_NAME[language]);

/** Pierwszy graf (grapheme) tekstu – emoji z ZWJ liczy się jako jeden znak. Zwraca null dla pustego wejścia. */
export const sanitizeIcon = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let first = trimmed;
  try {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    first = segmenter.segment(trimmed)[Symbol.iterator]().next().value?.segment ?? trimmed;
  } catch {
    first = Array.from(trimmed)[0] ?? trimmed;
  }
  return first.length > MAX_ICON_LENGTH ? null : first;
};

export const sanitizeName = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim().slice(0, MAX_WORKSPACE_NAME_LENGTH).trim();
  return cleaned || null;
};

export const sanitizeColor = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  if (WORKSPACE_COLOR_TOKENS.includes(lower)) return lower;
  if (WORKSPACE_COLOR_PALETTE.includes(lower)) return lower;
  return null;
};

const sanitizeId = (value: unknown): string | null =>
  typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,31}$/.test(value) ? value : null;

/** Waliduje listę z session.json: główna przestrzeń zawsze istnieje i jest pierwsza do czasu przestawienia; id bez duplikatów. */
export const normalizeWorkspaces = (value: unknown): Workspace[] => {
  const list: Workspace[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(value) ? value : []) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    const id = sanitizeId(raw.id);
    if (!id || seen.has(id) || list.length >= MAX_WORKSPACES) continue;
    seen.add(id);
    list.push({
      id,
      name: sanitizeName(raw.name) ?? "",
      icon: sanitizeIcon(raw.icon) ?? WORKSPACE_ICONS[0],
      color: sanitizeColor(raw.color),
    });
  }
  if (!seen.has(MAIN_WORKSPACE_ID)) list.unshift(createMainWorkspace());
  return list.slice(0, MAX_WORKSPACES);
};

export const generateWorkspaceId = (existing: readonly string[], random: () => number = Math.random): string => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const id = `ws-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, "0")}`;
    if (!existing.includes(id)) return id;
  }
  return `ws-${existing.length + 1}-${Date.now().toString(36)}`;
};

export type WorkspaceDraft = { name?: unknown; icon?: unknown; color?: unknown };

/** Domyślna nazwa nowej przestrzeni: "Przestrzeń 2", "Przestrzeń 3", ... (pierwsza wolna). */
export const nextDefaultName = (list: readonly Workspace[], language: "pl" | "en"): string => {
  const names = new Set(list.map((workspace) => workspaceDisplayName(workspace, language).toLowerCase()));
  for (let n = list.length + 1; n < list.length + 1000; n += 1) {
    const candidate = `${DEFAULT_NEW_NAME[language]} ${n}`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
  return `${DEFAULT_NEW_NAME[language]} ${Date.now()}`;
};

export const nextDefaultIcon = (list: readonly Workspace[]): string => {
  const used = new Set(list.map((workspace) => workspace.icon));
  return WORKSPACE_ICONS.find((icon) => !used.has(icon)) ?? WORKSPACE_ICONS[list.length % WORKSPACE_ICONS.length];
};

export const addWorkspace = (
  list: readonly Workspace[],
  draft: WorkspaceDraft,
  language: "pl" | "en",
  random: () => number = Math.random,
): { list: Workspace[]; workspace: Workspace } | null => {
  if (list.length >= MAX_WORKSPACES) return null;
  const workspace: Workspace = {
    id: generateWorkspaceId(list.map((entry) => entry.id), random),
    name: sanitizeName(draft.name) ?? nextDefaultName(list, language),
    icon: sanitizeIcon(draft.icon) ?? nextDefaultIcon(list),
    color: sanitizeColor(draft.color),
  };
  return { list: [...list, workspace], workspace };
};

/** Zmiana nazwy/ikony/koloru. Pole nieobecne w patchu zostaje bez zmian; pusta nazwa = domyślna (tylko główna) lub bez zmiany. */
export const updateWorkspace = (list: readonly Workspace[], id: string, patch: WorkspaceDraft): Workspace[] | null => {
  const index = list.findIndex((workspace) => workspace.id === id);
  if (index === -1) return null;
  const current = list[index];
  const next: Workspace = { ...current };
  if ("name" in patch) {
    const name = sanitizeName(patch.name);
    if (name) next.name = name;
    else if (id === MAIN_WORKSPACE_ID) next.name = "";
  }
  if ("icon" in patch) {
    const icon = sanitizeIcon(patch.icon);
    if (icon) next.icon = icon;
  }
  if ("color" in patch) next.color = patch.color === null || patch.color === "" ? null : (sanitizeColor(patch.color) ?? current.color);
  const copy = [...list];
  copy[index] = next;
  return copy;
};

/** Usuwa przestrzeń; głównej usunąć nie można. */
export const removeWorkspace = (list: readonly Workspace[], id: string): Workspace[] | null => {
  if (id === MAIN_WORKSPACE_ID || !list.some((workspace) => workspace.id === id)) return null;
  return list.filter((workspace) => workspace.id !== id);
};

/** Przesuwa przestrzeń o delta miejsc (z ograniczeniem do zakresu). */
export const moveWorkspace = (list: readonly Workspace[], id: string, delta: number): Workspace[] | null => {
  const index = list.findIndex((workspace) => workspace.id === id);
  if (index === -1) return null;
  const target = Math.max(0, Math.min(list.length - 1, index + delta));
  if (target === index) return [...list];
  const copy = [...list];
  const [moved] = copy.splice(index, 1);
  copy.splice(target, 0, moved);
  return copy;
};

/** Następna/poprzednia przestrzeń cyklicznie; null gdy jest tylko jedna. */
export const adjacentWorkspaceId = (list: readonly Workspace[], currentId: string, direction: 1 | -1): string | null => {
  if (list.length < 2) return null;
  const index = Math.max(0, list.findIndex((workspace) => workspace.id === currentId));
  return list[(index + direction + list.length) % list.length].id;
};

/** Numer 1..9 -> id przestrzeni (null gdy brak takiej). */
export const workspaceIdByNumber = (list: readonly Workspace[], number: number): string | null =>
  Number.isInteger(number) && number >= 1 && number <= list.length ? list[number - 1].id : null;

type OrderedTab = { id: number; workspaceId: string; isPinned: boolean };

/** Karty jednej przestrzeni w kolejności wyświetlania: przypięte, potem reszta (kolejność względna zachowana). */
export const orderTabsForWorkspace = <T extends OrderedTab>(tabs: readonly T[], workspaceId: string): T[] => {
  const inWorkspace = tabs.filter((tab) => tab.workspaceId === workspaceId);
  return [...inWorkspace.filter((tab) => tab.isPinned), ...inWorkspace.filter((tab) => !tab.isPinned)];
};

/** Wszystkie karty pogrupowane według przestrzeni (w kolejności listy przestrzeni); karty z nieznaną przestrzenią trafiają do głównej. */
export const orderTabsByWorkspaces = <T extends OrderedTab>(tabs: readonly T[], workspaces: readonly Workspace[]): T[] => {
  const known = new Set(workspaces.map((workspace) => workspace.id));
  const normalized = tabs.map((tab) => (known.has(tab.workspaceId) ? tab : { ...tab, workspaceId: MAIN_WORKSPACE_ID }));
  return workspaces.flatMap((workspace) => orderTabsForWorkspace(normalized, workspace.id));
};

/** Najnowsza (wg listy MRU) karta danej przestrzeni; null gdy brak. */
export const mostRecentTabInWorkspace = (
  mru: readonly number[],
  workspaceOf: (tabId: number) => string | undefined,
  workspaceId: string,
): number | null => {
  for (const tabId of mru) if (workspaceOf(tabId) === workspaceId) return tabId;
  return null;
};

/** Przestawia kartę w globalnej kolejności: przed `beforeId` (jeśli należy do tej samej grupy) lub na koniec swojej grupy. */
export const reorderTabIds = (
  order: readonly number[],
  movingId: number,
  beforeId: number | null,
  inSameGroup: (tabId: number) => boolean,
): number[] | null => {
  if (!order.includes(movingId) || movingId === beforeId) return null;
  const rest = order.filter((id) => id !== movingId);
  let insertAt = -1;
  if (beforeId !== null && inSameGroup(beforeId)) insertAt = rest.indexOf(beforeId);
  if (insertAt < 0) {
    let last = -1;
    rest.forEach((id, index) => { if (inSameGroup(id)) last = index; });
    insertAt = last + 1;
    if (last === -1) insertAt = rest.length;
  }
  rest.splice(insertAt, 0, movingId);
  return rest;
};
