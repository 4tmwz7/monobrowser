// Czysta logika zapisu/przywracania sesji (karty + przestrzenie + ostatnio zamknięte). Bez zależności od Electrona.
import { MAIN_WORKSPACE_ID, createMainWorkspace, normalizeWorkspaces, type Workspace } from "./workspaces.js";

export type SessionTab = {
  url: string;
  title: string;
  pinned: boolean;
  muted: boolean;
  /** Karta wyłączona z usypiania ("nie usypiaj"). */
  keepAwake: boolean;
  /** Przestrzeń karty (sesje sprzed przestrzeni: "main"). */
  workspaceId: string;
};

export type ClosedTab = {
  url: string;
  title: string;
  pinned: boolean;
};

/** Przestrzeń w sesji: `activeIndex` to indeks aktywnej karty tej przestrzeni w `tabs` (-1 = brak kart). */
export type SessionWorkspace = Workspace & { activeIndex: number };

export type SessionData = {
  version: 2;
  /** Karty pogrupowane według przestrzeni; kolejność w przestrzeni = kolejność wyświetlania. */
  tabs: SessionTab[];
  /** Indeks aktywnej karty bieżącej przestrzeni w `tabs`. */
  activeIndex: number;
  recentlyClosed: ClosedTab[];
  workspaces: SessionWorkspace[];
  currentWorkspaceId: string;
};

export const MAX_SESSION_TABS = 200;
export const MAX_RECENTLY_CLOSED = 25;
const MAX_URL_LENGTH = 4096;
const MAX_TITLE_LENGTH = 300;

const emptySessionData = (): SessionData => ({
  version: 2,
  tabs: [],
  activeIndex: 0,
  recentlyClosed: [],
  workspaces: [{ ...createMainWorkspace(), activeIndex: -1 }],
  currentWorkspaceId: MAIN_WORKSPACE_ID,
});

export const EMPTY_SESSION: SessionData = emptySessionData();

/** Adresy, które mają sens po ponownym uruchomieniu (bez data:, devtools:, pustych i wewnętrznych kart). */
export const isRestorableUrl = (value: unknown): value is string => {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL_LENGTH) return false;
  if (/^(?:https?:|file:|view-source:https?:)/i.test(value)) return true;
  return value === "about:blank" || value === "monobrowser://new-tab";
};

const cleanTitle = (value: unknown): string =>
  typeof value === "string" ? value.slice(0, MAX_TITLE_LENGTH) : "";

const normalizeClosedTab = (value: unknown): ClosedTab | null => {
  if (typeof value === "string") {
    return isRestorableUrl(value) ? { url: value, title: "", pinned: false } : null;
  }
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!isRestorableUrl(raw.url)) return null;
  return { url: raw.url, title: cleanTitle(raw.title), pinned: raw.pinned === true };
};

const normalizeSessionTab = (value: unknown, knownWorkspaces: ReadonlySet<string>): SessionTab | null => {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!isRestorableUrl(raw.url)) return null;
  return {
    url: raw.url,
    title: cleanTitle(raw.title),
    pinned: raw.pinned === true,
    muted: raw.muted === true,
    keepAwake: raw.keepAwake === true,
    workspaceId: typeof raw.workspaceId === "string" && knownWorkspaces.has(raw.workspaceId) ? raw.workspaceId : MAIN_WORKSPACE_ID,
  };
};

/**
 * Waliduje zawartość session.json (niezaufany plik): odrzuca śmieci, przycina listy, poprawia indeksy aktywnych kart.
 * Stary format (version 1, bez przestrzeni) jest migrowany: wszystkie karty trafiają do przestrzeni głównej.
 */
export const normalizeSessionData = (value: unknown): SessionData => {
  if (typeof value !== "object" || value === null) return emptySessionData();
  const raw = value as Record<string, unknown>;

  const workspaceList = normalizeWorkspaces(raw.workspaces);
  const knownWorkspaces = new Set(workspaceList.map((workspace) => workspace.id));
  const rawTabs = Array.isArray(raw.tabs) ? raw.tabs : [];
  const tabs: SessionTab[] = [];
  // Indeks w pliku -> indeks po odfiltrowaniu śmieci.
  const indexMap = new Map<number, number>();
  rawTabs.slice(0, MAX_SESSION_TABS).forEach((entry, index) => {
    const tab = normalizeSessionTab(entry, knownWorkspaces);
    if (!tab) return;
    indexMap.set(index, tabs.length);
    tabs.push(tab);
  });

  const firstIndexOf = (workspaceId: string): number => tabs.findIndex((tab) => tab.workspaceId === workspaceId);
  const resolveActive = (requested: unknown, workspaceId: string): number => {
    const rawIndex = typeof requested === "number" && Number.isInteger(requested) ? requested : -1;
    const mapped = indexMap.get(rawIndex);
    if (mapped !== undefined && tabs[mapped].workspaceId === workspaceId) return mapped;
    return firstIndexOf(workspaceId);
  };

  const rawWorkspaces = Array.isArray(raw.workspaces) ? raw.workspaces : [];
  const workspaces: SessionWorkspace[] = workspaceList.map((workspace) => {
    const source = rawWorkspaces.find((entry) => typeof entry === "object" && entry !== null && (entry as Record<string, unknown>).id === workspace.id) as Record<string, unknown> | undefined;
    return { ...workspace, activeIndex: resolveActive(source?.activeIndex, workspace.id) };
  });

  const currentWorkspaceId = typeof raw.currentWorkspaceId === "string" && knownWorkspaces.has(raw.currentWorkspaceId)
    ? raw.currentWorkspaceId
    : MAIN_WORKSPACE_ID;
  // Stary format: `activeIndex` wskazuje aktywną kartę przestrzeni głównej.
  const requestedActive = typeof raw.activeIndex === "number" && Number.isInteger(raw.activeIndex) ? raw.activeIndex : 0;
  let activeIndex = resolveActive(requestedActive, currentWorkspaceId);
  if (activeIndex < 0) activeIndex = 0;
  const currentEntry = workspaces.find((workspace) => workspace.id === currentWorkspaceId);
  if (currentEntry && !Array.isArray(raw.workspaces)) currentEntry.activeIndex = activeIndex;

  const closed: ClosedTab[] = [];
  for (const entry of Array.isArray(raw.recentlyClosed) ? raw.recentlyClosed : []) {
    const tab = normalizeClosedTab(entry);
    if (tab) closed.push(tab);
    if (closed.length >= MAX_RECENTLY_CLOSED) break;
  }

  return {
    version: 2,
    tabs,
    activeIndex: Math.min(activeIndex, Math.max(0, tabs.length - 1)),
    recentlyClosed: closed,
    workspaces,
    currentWorkspaceId,
  };
};

export type SessionSourceTab = {
  id: number;
  url: string;
  title: string;
  isPinned: boolean;
  isMuted: boolean;
  /** Brak = false. */
  keepAwake?: boolean;
  isPrivate: boolean;
  internal: boolean;
  /** Przestrzeń karty; brak = główna. */
  workspaceId?: string;
};

export type SessionWorkspaceState = {
  workspaces: readonly Workspace[];
  currentWorkspaceId: string;
  /** Aktywna karta każdej przestrzeni (id karty lub null). */
  activeTabIdByWorkspace: Readonly<Record<string, number | null>>;
};

/**
 * Buduje migawkę sesji: tylko zwykłe (nieprywatne, niewewnętrzne) karty. Karty powinny być pogrupowane według
 * przestrzeni, w kolejności wyświetlania. Bez `state` powstaje jedna przestrzeń główna.
 */
export const buildSessionData = (
  orderedTabs: SessionSourceTab[],
  activeTabId: number | null,
  recentlyClosed: ClosedTab[],
  state?: SessionWorkspaceState,
): SessionData => {
  const workspaceList = state ? normalizeWorkspaces(state.workspaces) : [createMainWorkspace()];
  const known = new Set(workspaceList.map((workspace) => workspace.id));
  const currentWorkspaceId = state && known.has(state.currentWorkspaceId) ? state.currentWorkspaceId : MAIN_WORKSPACE_ID;
  const tabs: SessionTab[] = [];
  const idToIndex = new Map<number, number>();
  for (const tab of orderedTabs) {
    if (tab.isPrivate || tab.internal || !isRestorableUrl(tab.url)) continue;
    idToIndex.set(tab.id, tabs.length);
    tabs.push({
      url: tab.url,
      title: cleanTitle(tab.title),
      pinned: tab.isPinned,
      muted: tab.isMuted,
      keepAwake: tab.keepAwake === true,
      workspaceId: tab.workspaceId && known.has(tab.workspaceId) ? tab.workspaceId : MAIN_WORKSPACE_ID,
    });
    if (tabs.length >= MAX_SESSION_TABS) break;
  }
  const firstIndexOf = (workspaceId: string): number => tabs.findIndex((tab) => tab.workspaceId === workspaceId);
  const activeIndexOf = (workspaceId: string, tabId: number | null | undefined): number => {
    const index = tabId === null || tabId === undefined ? undefined : idToIndex.get(tabId);
    return index !== undefined && tabs[index].workspaceId === workspaceId ? index : firstIndexOf(workspaceId);
  };
  const workspaces: SessionWorkspace[] = workspaceList.map((workspace) => ({
    ...workspace,
    activeIndex: activeIndexOf(
      workspace.id,
      workspace.id === currentWorkspaceId ? activeTabId : state?.activeTabIdByWorkspace[workspace.id],
    ),
  }));
  const currentActive = workspaces.find((workspace) => workspace.id === currentWorkspaceId)?.activeIndex ?? -1;
  return {
    version: 2,
    tabs,
    activeIndex: Math.min(Math.max(currentActive, 0), Math.max(0, tabs.length - 1)),
    recentlyClosed: recentlyClosed.filter((tab) => isRestorableUrl(tab.url)).slice(0, MAX_RECENTLY_CLOSED),
    workspaces,
    currentWorkspaceId,
  };
};

/** Dodaje zamkniętą kartę na początek listy (najnowsza pierwsza), bez duplikatów pod rząd. */
export const pushClosedTab = (list: ClosedTab[], tab: ClosedTab): ClosedTab[] => {
  if (!isRestorableUrl(tab.url)) return list;
  const next = [{ url: tab.url, title: cleanTitle(tab.title), pinned: tab.pinned }, ...list.filter((entry) => entry.url !== tab.url || tab.url === "monobrowser://new-tab")];
  return next.slice(0, MAX_RECENTLY_CLOSED);
};
