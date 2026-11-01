import { displayUrl } from "../main/url-utils.js";
type TabState = {
  id: number;
  title: string;
  url: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isPinned: boolean;
  isMuted: boolean;
  keepAwake?: boolean;
  isSleeping: boolean;
  isPrivate: boolean;
  isAudible: boolean;
  zoom: number;
  favicon: string | null;
  splitGroupId?: number | null;
  splitSide?: "left" | "right" | null;
};

type WorkspaceInfo = { id: string; name: string; icon: string; color: string | null; colorCss: string | null; count: number };

type TabsStatePayload = {
  tabs: TabState[];
  activeTabId: number | null;
  workspaces?: WorkspaceInfo[];
  currentWorkspaceId?: string;
};

type AppLanguage = "pl" | "en";
type SearchEngine = "google" | "duckduckgo" | "custom";
type SearchSettings = { engine: SearchEngine; customUrl: string };
type SearchSettingsResult = { ok: boolean; message: string; settings: SearchSettings };
type AdblockerStatus = {
  enabled: boolean;
  ready: boolean;
  blockedTotal: number;
  activeTabBlocked: number;
  activeTabPaused: boolean;
  error: string | null;
};
type TabBarLayout = "horizontal" | "vertical";
type LayoutSettings = {
  tabBarLayout: TabBarLayout;
  verticalTabBarWidth: number;
  verticalTabBarCollapsed: boolean;
  verticalTabBarSide: "left" | "right";
  compactMode: boolean;
};
type BrowserApi = {
  createTab: (initialUrl?: string) => Promise<number>;
  closeTab: (tabId: number) => Promise<boolean>;
  switchTab: (tabId: number) => Promise<boolean>;
  moveTab: (tabId: number, beforeTabId: number | null) => Promise<boolean>;
  getTabsState: () => Promise<TabsStatePayload>;
  switchWorkspace: (id: string) => Promise<boolean>;
  createWorkspace: (anchor?: PopupAnchorArg) => Promise<string | null>;
  moveTabToWorkspace: (tabId: number, workspaceId: string) => Promise<boolean>;
  openWorkspaceSwitcher: (anchor: PopupAnchorArg) => Promise<boolean>;
  openWorkspaceMenu: (id: string, anchor: PopupAnchorArg) => Promise<boolean>;
  openTabContextMenu: (tabId: number, position: { x: number; y: number }) => Promise<boolean>;
  showFindWindow: () => Promise<boolean>;
  navigate: (input: string) => Promise<boolean>;
  back: () => Promise<boolean>;
  forward: () => Promise<boolean>;
  reload: () => Promise<boolean>;
  openNavigationMenu: (position: PopupAnchorArg) => Promise<boolean>;
  openSiteInfoMenu: (position: PopupAnchorArg) => Promise<boolean>;
  getLanguage: () => Promise<AppLanguage>;
  setLanguage: (language: AppLanguage) => Promise<boolean>;
  getSearchSettings: () => Promise<SearchSettings>;
  setSearchSettings: (settings: SearchSettings) => Promise<SearchSettingsResult>;
  openSettingsWindow: () => Promise<boolean>;
  getAdblockStatus: () => Promise<AdblockerStatus>;
  toggleAdblock: () => Promise<AdblockerStatus>;
  toggleAdblockTabPause: () => Promise<AdblockerStatus>;
  onLanguageChanged: (callback: (language: AppLanguage) => void) => () => void;
  onFocusAddress: (callback: () => void) => () => void;
  onBlurAddress: (callback: () => void) => () => void;
  setViewport: (rect: { x: number; y: number; right?: number }) => Promise<boolean>;
  setSidebarDragging: (dragging: boolean) => Promise<boolean>;
  setCompactKeep: (flags: { address: boolean }) => void;
  setCompactPointer: (inside: boolean) => void;
  notifyTabDrag: (tabId: number | null) => void;
  getToolbarPins: () => Promise<unknown>;
  runToolbarAction: (id: string) => Promise<boolean>;
  setToolbarPinned: (id: string, pinned: boolean) => Promise<unknown>;
  onToolbarPinsChanged: (callback: (payload: unknown) => void) => () => void;
  getLayoutSettings: () => Promise<LayoutSettings>;
  setLayoutSettings: (patch: Partial<LayoutSettings>) => Promise<LayoutSettings>;
  onLayoutChanged: (callback: (layout: LayoutSettings) => void) => () => void;
  onTabsState: (callback: (payload: TabsStatePayload) => void) => () => void;
  triggerNewTabShortcut: (initialUrl?: string) => void;
  triggerCloseTabShortcut: () => void;
  triggerReloadShortcut: (hard?: boolean) => void;
  toggleTabMute: (tabId: number) => Promise<boolean>;
  resetZoom: () => Promise<boolean>;
  getPathForFile: (file: File) => string;
  openDropped: (payload: { uriList: string; text: string; filePaths: string[] }) => Promise<number>;
  triggerPaletteShortcut: () => void;
};

declare global {
  interface Window {
    browserApi: BrowserApi;
  }
}

const DEFAULT_URL = "monobrowser://new-tab";
// Compact mode shows the chrome in a second shell instance hosted in an overlay view.
const isChromeOverlay = new URLSearchParams(window.location.search).get("chrome") === "overlay";
if (isChromeOverlay) document.documentElement.classList.add("chrome-overlay");

const translations = {
  pl: {
    tabs: "Karty", newTab: "Nowa karta", closeTab: "Zamknij kartę (Ctrl+W)",
    back: "Wstecz", forward: "Dalej", reload: "Odśwież", menu: "Menu",
    siteInfo: "Informacje o stronie", addressPlaceholder: "Szukaj lub wpisz adres", go: "Przejdź", history: "Historia",
    downloads: "Pobieranie", siteData: "Dane witryn", language: "Język",
    sleeping: "Karta uśpiona — kliknij, aby wybudzić",
    privateTab: "Karta prywatna",
    palette: "Paleta komend (Ctrl+K)",
    emptyHint: "lub wpisz adres powyżej",
    settings: "Ustawienia", collapseSidebar: "Zwiń panel boczny", expandSidebar: "Rozwiń panel boczny",
    resizeSidebar: "Zmień szerokość panelu bocznego",
    muteTab: "Wycisz kartę", unmuteTab: "Włącz dźwięk karty",
    zoomReset: "Powiększenie strony — kliknij, aby przywrócić 100% (Ctrl+0)",
    workspaces: "Przestrzenie", workspace: "Przestrzeń", newWorkspace: "Nowa przestrzeń",
  },
  en: {
    tabs: "Tabs", newTab: "New tab", closeTab: "Close tab (Ctrl+W)",
    back: "Back", forward: "Forward", reload: "Reload", menu: "Menu",
    siteInfo: "Page information", addressPlaceholder: "Search or enter address", go: "Go", history: "History",
    downloads: "Downloads", siteData: "Site data", language: "Language",
    sleeping: "Tab sleeping — click to wake it up",
    privateTab: "Private tab",
    palette: "Command palette (Ctrl+K)",
    emptyHint: "or type an address above",
    settings: "Settings", collapseSidebar: "Collapse sidebar", expandSidebar: "Expand sidebar",
    resizeSidebar: "Resize sidebar",
    muteTab: "Mute tab", unmuteTab: "Unmute tab",
    zoomReset: "Page zoom — click to reset to 100% (Ctrl+0)",
    workspaces: "Spaces", workspace: "Space", newWorkspace: "New space",
  },
} as const;

const state: {
  tabs: TabState[];
  activeTabId: number | null;
  language: AppLanguage;
  workspaces: WorkspaceInfo[];
  currentWorkspaceId: string;
} = {
  tabs: [],
  activeTabId: null,
  language: "pl",
  workspaces: [],
  currentWorkspaceId: "main",
};

const HORIZONTAL_CHROME_HEIGHT = 36; // single compact toolbar row
const COLLAPSED_SIDEBAR_WIDTH = 52;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 400;

const layout: LayoutSettings = {
  tabBarLayout: "horizontal",
  verticalTabBarWidth: 240,
  verticalTabBarCollapsed: false,
  verticalTabBarSide: "left",
  compactMode: false,
};

const tabsContainer = document.getElementById("tab-list") as HTMLDivElement;
const pinnedContainer = document.getElementById("pinned-list") as HTMLDivElement;
const tabScroll = document.getElementById("tab-scroll") as HTMLDivElement;
const newTabLabel = document.getElementById("new-tab-label") as HTMLSpanElement;
const sidebarToggle = document.getElementById("sidebar-toggle") as HTMLButtonElement;
const settingsButton = document.getElementById("settings-button") as HTMLButtonElement;
const sidebarResizer = document.getElementById("sidebar-resizer") as HTMLDivElement;
const addressForm = document.getElementById("address-form") as HTMLFormElement;
const addressInput = document.getElementById("address") as HTMLInputElement;
const backButton = document.getElementById("back") as HTMLButtonElement;
const forwardButton = document.getElementById("forward") as HTMLButtonElement;
const reloadButton = document.getElementById("reload") as HTMLButtonElement;
const siteInfoButton = document.getElementById("site-info-button") as HTMLButtonElement;
const menuButton = document.getElementById("menu-button") as HTMLButtonElement;
const zoomPill = document.getElementById("zoom-pill") as HTMLButtonElement;
const newTabButton = document.getElementById("new-tab") as HTMLButtonElement;
const chromeBar = document.getElementById("chrome") as HTMLDivElement;
const wsSwitch = document.getElementById("ws-switch") as HTMLButtonElement;
const wsSwitchIcon = document.getElementById("ws-switch-icon") as HTMLSpanElement;
const wsList = document.getElementById("ws-list") as HTMLDivElement;
const wsAdd = document.getElementById("ws-add") as HTMLButtonElement;
const placeholder = document.getElementById("placeholder") as HTMLDivElement;
const placeholderNew = document.getElementById("placeholder-new") as HTMLButtonElement;
const placeholderHint = document.getElementById("placeholder-hint") as HTMLDivElement;
let renderFrame: number | null = null;
// True while the user has typed into the address bar and not yet committed/cancelled.
let addressDirty = false;
let resizingSidebar = false;
let sidebarSyncFrame: number | null = null;

// The label is visible in the expanded sidebar, so the tooltip would only overlap it.
const updateNewTabTitle = (): void => {
  const labelVisible = layout.tabBarLayout === "vertical" && !layout.verticalTabBarCollapsed;
  if (labelVisible) newTabButton.removeAttribute("title");
  else newTabButton.title = `${translations[state.language].newTab} (Ctrl+T)`;
};

const applyLanguage = (language: AppLanguage): void => {
  state.language = language;
  const copy = translations[language];
  document.documentElement.lang = language;
  document.getElementById("tabs")?.setAttribute("aria-label", copy.tabs);
  updateNewTabTitle();
  newTabButton.setAttribute("aria-label", copy.newTab);
  newTabLabel.textContent = copy.newTab;
  settingsButton.title = copy.settings;
  settingsButton.setAttribute("aria-label", copy.settings);
  sidebarResizer.title = copy.resizeSidebar;
  backButton.title = `${copy.back} (Alt+←)`;
  backButton.setAttribute("aria-label", copy.back);
  forwardButton.title = `${copy.forward} (Alt+→)`;
  forwardButton.setAttribute("aria-label", copy.forward);
  reloadButton.title = `${copy.reload} (Ctrl+R)`;
  reloadButton.setAttribute("aria-label", copy.reload);
  siteInfoButton.title = copy.siteInfo;
  siteInfoButton.setAttribute("aria-label", copy.siteInfo);
  addressInput.placeholder = copy.addressPlaceholder;
  placeholderNew.textContent = copy.newTab;
  placeholderHint.textContent = copy.emptyHint;
  menuButton.title = copy.menu;
  menuButton.setAttribute("aria-label", copy.menu);
  wsAdd.title = `${copy.newWorkspace}`;
  wsAdd.setAttribute("aria-label", copy.newWorkspace);
  renderSidebarToggle();
  render();
};

const isVertical = (): boolean => layout.tabBarLayout === "vertical";
const isSidebarRight = (): boolean => isVertical() && layout.verticalTabBarSide === "right";
const isCollapsed = (): boolean => isVertical() && layout.verticalTabBarCollapsed;
const currentSidebarWidth = (): number => (isCollapsed() ? COLLAPSED_SIDEBAR_WIDTH : layout.verticalTabBarWidth);

const renderSidebarToggle = (): void => {
  const copy = translations[state.language];
  const label = layout.verticalTabBarCollapsed ? copy.expandSidebar : copy.collapseSidebar;
  sidebarToggle.title = label;
  sidebarToggle.setAttribute("aria-label", label);
};

// Tells the main process where web content starts (below the toolbar or right of the sidebar).
const syncViewport = async (): Promise<void> => {
  const rect = isVertical()
    ? (isSidebarRight() ? { x: 0, y: 0, right: currentSidebarWidth() } : { x: currentSidebarWidth(), y: 0, right: 0 })
    : { x: 0, y: HORIZONTAL_CHROME_HEIGHT, right: 0 };
  placeholder.style.top = `${rect.y}px`;
  placeholder.style.left = `${rect.x}px`;
  placeholder.style.right = `${rect.right}px`;
  // Only the window's own shell positions the page area; the overlay instance is just a copy of the chrome.
  if (isChromeOverlay) return;
  await window.browserApi.setViewport(rect);
};

let lastViewportX = 0;
const applyLayout = (): void => {
  document.body.classList.toggle("vertical", isVertical());
  document.body.classList.toggle("sidebar-right", isSidebarRight());
  document.body.classList.toggle("collapsed", isCollapsed());
  document.documentElement.style.setProperty("--sidebar-width", `${currentSidebarWidth()}px`);
  renderSidebarToggle();
  updateNewTabTitle();
  render();
  // A shrinking sidebar keeps the old page bounds until its width animation ends; a growing one claims its room at once.
  const nextX = isVertical() ? currentSidebarWidth() : 0; // inset of the page from its window edge
  if (isVertical() && animationsOn() && nextX < lastViewportX) {
    window.setTimeout(() => void syncViewport(), animDurations().slow + 40);
  } else {
    void syncViewport();
  }
  lastViewportX = nextX;
};

const updateLayout = (patch: Partial<LayoutSettings>): void => {
  Object.assign(layout, patch);
  applyLayout();
  void window.browserApi.setLayoutSettings(patch);
};

const getActiveTab = (): TabState | undefined => {
  return state.tabs.find((tab) => tab.id === state.activeTabId);
};

const renderControls = (): void => {
  const activeTab = getActiveTab();

  backButton.disabled = !activeTab || !activeTab.canGoBack;
  forwardButton.disabled = !activeTab || !activeTab.canGoForward;
  reloadButton.disabled = !activeTab;

  const zoom = activeTab && !activeTab.isSleeping ? activeTab.zoom : 1;
  const zoomed = Math.abs(zoom - 1) > 0.005;
  zoomPill.hidden = !zoomed;
  if (zoomed) {
    zoomPill.textContent = `${Math.round(zoom * 100)}%`;
    zoomPill.title = translations[state.language].zoomReset;
    zoomPill.setAttribute("aria-label", zoomPill.title);
  }

  const editing = addressDirty && document.hasFocus() && document.activeElement === addressInput;
  if (!editing) {
    addressDirty = false;
    addressInput.value = displayUrl(activeTab?.url ?? "");
  }
};

let draggedTabId: number | null = null;
let renderDeferredByDrag = false;

// Tab reordering drop handling is delegated (not per tab button): the pointer rarely lands exactly on a
// button (gaps between rows, the blank part of the sidebar), so the nearest tab of the same group is the target.
const tabDropButtons = (pinned: boolean): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>(".tab-btn[data-tab-id]"))
    .filter((el) => !el.classList.contains("tab-ghost") && state.tabs.find((tab) => tab.id === Number(el.dataset.tabId))?.isPinned === pinned);
const clearTabDropMarks = (): void => {
  document.querySelectorAll(".tab-btn.drop-before, .tab-btn.drop-after").forEach((el) => el.classList.remove("drop-before", "drop-after"));
};
type TabDropTarget = { button: HTMLElement; tabId: number; before: boolean };
type DragPoint = { x: number; y: number; target: Element | null };
const dragPointOf = (event: DragEvent): DragPoint => ({ x: event.clientX, y: event.clientY, target: event.target instanceof Element ? event.target : null });
const resolveTabDropTarget = (point: DragPoint): TabDropTarget | null => {
  const dragged = state.tabs.find((entry) => entry.id === draggedTabId);
  if (!dragged) return null;
  const target = point.target;
  // Workspace icons and the address / navigation controls have their own meaning for a dragged tab.
  if (target?.closest(".ws-btn, #address-form, #nav-buttons, #ws-switch")) return null;
  const inTabsArea = Boolean(target?.closest("#tabs"));
  if (!inTabsArea && !(isVertical() && target?.closest("#chrome"))) return null;
  let best: { button: HTMLElement; rect: DOMRect; dist: number } | null = null;
  for (const button of tabDropButtons(dragged.isPinned)) {
    const rect = button.getBoundingClientRect();
    const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
    const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
    const dist = dx * dx + dy * dy;
    if (!best || dist < best.dist) best = { button, rect, dist };
  }
  if (!best) return null;
  const stacked = isVertical() && !dragged.isPinned;
  const before = stacked
    ? point.y < best.rect.top + best.rect.height / 2
    : point.x < best.rect.left + best.rect.width / 2;
  return { button: best.button, tabId: Number(best.button.dataset.tabId), before };
};
// The last drop target seen during the drag and whether a drop already moved the tab: a drag whose `drop`
// event never arrives (dragover fired once or was not cancelled in time) is still completed from `dragend`.
let lastTabDropTarget: TabDropTarget | null = null;
let tabDropDone = false;
const commitTabDrop = (drop: TabDropTarget | null): boolean => {
  const dragged = state.tabs.find((entry) => entry.id === draggedTabId);
  if (!drop || !dragged || drop.tabId === dragged.id) return false;
  const group = state.tabs.filter((entry) => entry.isPinned === dragged.isPinned);
  const index = group.findIndex((entry) => entry.id === drop.tabId);
  const beforeId = drop.before ? drop.tabId : (group[index + 1]?.id ?? null);
  if (beforeId === dragged.id) return false;
  void window.browserApi.moveTab(dragged.id, beforeId);
  return true;
};
const initTabDragDrop = (): void => {
  document.addEventListener("dragenter", (event) => {
    if (draggedTabId !== null && resolveTabDropTarget(dragPointOf(event))) event.preventDefault();
  });
  document.addEventListener("dragover", (event) => {
    if (draggedTabId === null) return;
    const drop = resolveTabDropTarget(dragPointOf(event));
    clearTabDropMarks();
    lastTabDropTarget = drop;
    // Cancel the event over the whole tab area (also over the dragged tab itself) so the browser always delivers `drop`.
    if (!drop) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    if (drop.tabId !== draggedTabId) drop.button.classList.add(drop.before ? "drop-before" : "drop-after");
  });
  document.addEventListener("dragleave", (event) => {
    // Leaving the window altogether clears the indicator.
    if (draggedTabId !== null && event.relatedTarget === null) {
      clearTabDropMarks();
      lastTabDropTarget = null;
    }
  });
  document.addEventListener("drop", (event) => {
    if (draggedTabId === null) return;
    // Another control (a workspace icon) already took this drop.
    if (event.defaultPrevented) { tabDropDone = true; clearTabDropMarks(); return; }
    // The target comes from the pointer position at drop time, not from the last dragover.
    const drop = resolveTabDropTarget(dragPointOf(event)) ?? lastTabDropTarget;
    clearTabDropMarks();
    if (!drop) return;
    event.preventDefault();
    tabDropDone = true;
    commitTabDrop(drop);
  });
};

// Strony wewnętrzne dostają od procesu głównego znacznik "mb-icon:<rodzaj>" zamiast favicony;
// powłoka rysuje monochromatyczną ikonę w kolorze karty (stroke: currentColor).
type PopupAnchorArg = { x: number; y: number; rect?: { x: number; y: number; width: number; height: number }; placement?: "below" | "above" | "right" | "left" };
const rectOf = (rect: DOMRect): { x: number; y: number; width: number; height: number } => ({
  x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height),
});

const INTERNAL_ICON_PREFIX = "mb-icon:";
const INTERNAL_ICON_PATHS: Record<string, string> = {
  settings: "M2 4h12M2 8h12M2 12h12M5 2.5v3M10 6.5v3M6 10.5v3",
  history: "M2.5 2.5h11v11h-11ZM8 5v3.5l2.5 1.5",
  downloads: "M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13h10",
  "site-data": "M2.5 2.5h11v3h-11ZM2.5 6.5h11v3h-11ZM2.5 10.5h11v3h-11Z",
  stats: "M3.5 13V8M8 13V3M12.5 13V6M2 13.5h12",
  onboarding: "M8 2v12M2 8h12M3.8 3.8l8.4 8.4M12.2 3.8l-8.4 8.4",
  // Blank page with a folded corner, so the start-page tab differs from the "+" new-tab button.
  "new-tab": "M4 2.5h5.5L12 5v8.5H4ZM9.5 2.5V5H12",
  about: "M8 2.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM8 7.2v3.6M8 4.9v.1",
};
const createInternalTabIcon = (kind: string): SVGElement | null => {
  const pathData = INTERNAL_ICON_PATHS[kind];
  if (!pathData) return null;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "tab-favicon tab-favicon-internal");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", pathData);
  svg.append(path);
  return svg;
};

// First letter of the site's host (without "www."), else of the tab title.
const tileLetterFor = (url: string, fallbackTitle: string): string => {
  if (url === DEFAULT_URL) return "M";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      const letter = parsed.hostname.replace(/^www\./i, "").charAt(0);
      if (letter) return letter.toUpperCase();
    }
  } catch {
    // not a URL: fall back to the title
  }
  return fallbackTitle.trim().charAt(0).toUpperCase() || "?";
};

// ── Tab animations ──────────────────────────────────────────────────────────
// The tab strip is rebuilt on every state change, so enter/leave/active transitions are replayed
// from small bookkeeping maps (negative delay keeps a running animation continuous across rebuilds).
const animDurations = (): { dur: number; slow: number } => {
  const style = getComputedStyle(document.documentElement);
  return { dur: parseFloat(style.getPropertyValue("--mb-dur")) || 0, slow: parseFloat(style.getPropertyValue("--mb-dur-slow")) || 0 };
};
const animationsOn = (): boolean => animDurations().dur > 0;
const EASE = "cubic-bezier(.2,.7,.2,1)";
let tabsRenderedOnce = false;
/** Scrolls the tab strip (#tab-scroll: horizontal or vertical) so the whole active tab is visible, with a small margin. */
const revealActiveTab = (smooth: boolean): void => {
  const button = tabsContainer.querySelector<HTMLElement>(".tab-btn.active") ?? tabsContainer.querySelector<HTMLElement>(`.tab-btn[data-tab-id="${state.activeTabId}"]`);
  if (!button) return;
  const margin = 8;
  const box = tabScroll.getBoundingClientRect();
  const rect = button.getBoundingClientRect();
  const axis = isVertical() ? "top" : "left";
  const start = axis === "top" ? rect.top - box.top : rect.left - box.left;
  const end = axis === "top" ? rect.bottom - box.bottom : rect.right - box.right;
  let delta = 0;
  if (start < margin) delta = start - margin;
  else if (end > -margin) delta = end + margin;
  if (Math.abs(delta) < 1) return;
  tabScroll.scrollBy({ [axis]: delta, behavior: smooth && animationsOn() ? "smooth" : "auto" } as ScrollToOptions);
};

// Fade mask on the edges of the tab strip that still has hidden tabs (instead of a hard clip).
const updateTabFade = (): void => {
  const vertical = isVertical();
  const position = vertical ? tabScroll.scrollTop : tabScroll.scrollLeft;
  const total = vertical ? tabScroll.scrollHeight : tabScroll.scrollWidth;
  const visible = vertical ? tabScroll.clientHeight : tabScroll.clientWidth;
  const hiddenBefore = position > 1;
  const hiddenAfter = total - visible - position > 1;
  tabScroll.style.setProperty("--fade-start", hiddenBefore ? "28px" : "0px");
  tabScroll.style.setProperty("--fade-end", hiddenAfter ? "28px" : "0px");
};

const knownTabIds = new Set<number>();
const enterStarted = new Map<number, number>();
const activeChanged = new Map<number, { wasActive: boolean; at: number }>();
const previousActive = new Map<number, boolean>();
type TabGhost = { el: HTMLElement; parent: HTMLElement; index: number; start: number; dur: number; vertical: boolean };
const tabGhosts: TabGhost[] = [];
let lastRenderedWorkspaceId: string | null = null;

const runGhost = (ghost: TabGhost): void => {
  const elapsed = performance.now() - ghost.start;
  if (elapsed >= ghost.dur) { ghost.el.remove(); tabGhosts.splice(tabGhosts.indexOf(ghost), 1); return; }
  const shrink = ghost.vertical
    ? { height: "0px", minHeight: "0px", paddingTop: "0px", paddingBottom: "0px", borderTopWidth: "0px", borderBottomWidth: "0px" }
    : { width: "0px", minWidth: "0px", flexBasis: "0px", paddingLeft: "0px", paddingRight: "0px", borderLeftWidth: "0px", borderRightWidth: "0px", marginRight: "-2px" };
  const anim = ghost.el.animate([{ opacity: 0, ...shrink }], { duration: ghost.dur, delay: -elapsed, easing: EASE, fill: "forwards" });
  anim.addEventListener("finish", () => { ghost.el.remove(); const i = tabGhosts.indexOf(ghost); if (i >= 0) tabGhosts.splice(i, 1); });
};

const renderTabs = (): void => {
  if (draggedTabId !== null) {
    renderDeferredByDrag = true;
    return;
  }
  const { dur } = animDurations();
  // A Space switch swaps the whole strip at once: no enter/leave animations for that render.
  const workspaceSwitched = lastRenderedWorkspaceId !== null && lastRenderedWorkspaceId !== state.currentWorkspaceId;
  lastRenderedWorkspaceId = state.currentWorkspaceId;
  if (workspaceSwitched) {
    for (const ghost of tabGhosts) { ghost.el.getAnimations().forEach((a) => a.cancel()); ghost.el.remove(); }
    tabGhosts.length = 0;
    enterStarted.clear();
    state.tabs.forEach((tab) => knownTabIds.add(tab.id));
  }
  const animate = dur > 0 && !workspaceSwitched;
  const now = performance.now();
  // Snapshot the old strip: removed tabs become collapsing ghosts at their old position.
  const oldButtons = new Map<number, { el: HTMLElement; parent: HTMLElement; index: number }>();
  if (animate && tabsRenderedOnce) {
    for (const parent of [tabsContainer, pinnedContainer]) {
      Array.from(parent.children).forEach((el, index) => {
        const id = Number((el as HTMLElement).dataset.tabId);
        if (Number.isFinite(id) && !(el as HTMLElement).classList.contains("tab-ghost")) oldButtons.set(id, { el: el as HTMLElement, parent, index });
      });
    }
  }
  for (const ghost of tabGhosts) ghost.el.getAnimations().forEach((a) => a.cancel());
  tabsContainer.innerHTML = "";
  pinnedContainer.innerHTML = "";
  document.body.classList.toggle("has-pinned", isVertical() && state.tabs.some((tab) => tab.isPinned));
  const copy = translations[state.language];

  state.tabs.forEach((tab) => {
    const isActive = tab.id === state.activeTabId;
    const button = document.createElement("button");
    button.dataset.tabId = String(tab.id);
    // A tab whose active state just changed is built in its old look and flips next frame, so the CSS transition plays.
    if (animate && previousActive.has(tab.id) && previousActive.get(tab.id) !== isActive) activeChanged.set(tab.id, { wasActive: !isActive, at: now });
    const pendingFlip = animate ? activeChanged.get(tab.id) : undefined;
    const shownActive = pendingFlip && now - pendingFlip.at < dur ? pendingFlip.wasActive : isActive;
    // Split view: members are marked; the pair is joined when the tabs are adjacent in the bar.
    const tabIndex = state.tabs.indexOf(tab);
    const inSplit = tab.splitGroupId !== undefined && tab.splitGroupId !== null;
    const joinsNext = inSplit && state.tabs[tabIndex + 1]?.splitGroupId === tab.splitGroupId;
    const joinsPrev = inSplit && state.tabs[tabIndex - 1]?.splitGroupId === tab.splitGroupId;
    button.className = `tab-btn${inSplit ? " split-member" : ""}${joinsNext ? " split-join-next" : ""}${joinsPrev ? " split-join-prev" : ""}${shownActive ? " active" : ""}${tab.isLoading ? " loading" : ""}${tab.isPinned ? " pinned" : ""}${tab.isMuted ? " muted" : ""}${tab.isSleeping ? " sleeping" : ""}${tab.isPrivate ? " private" : ""}`;
    button.type = "button";
    button.title = tab.isSleeping
      ? `${tab.title || tab.url} — ${copy.sleeping}`
      : (tab.title || tab.url);
    if (tab.isPrivate) {
      button.title = `${button.title} — ${copy.privateTab}`;
    }

    // Loading spinner
    const spinner = document.createElement("span");
    spinner.className = "tab-loading";

    const status = document.createElement("span");
    status.className = "tab-status";
    if (tab.isPrivate) {
      status.innerHTML += `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 7h14v1.5H1V7Zm2.5-3.5L5 2h6l1.5 1.5L13 7H3l.5-3.5ZM4.5 14a2 2 0 1 1 0-4 2 2 0 0 1 2 2c0 .5.5.75 1.5.75s1.5-.25 1.5-.75a2 2 0 1 1 2 2 2 2 0 0 1-2-1.5 5 5 0 0 0-3 0A2 2 0 0 1 4.5 14Z"/></svg>`;
    }
    if (tab.isSleeping) {
      status.innerHTML += `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>`;
    }
    if (tab.keepAwake) {
      // "Never sleep": a small lightning bolt.
      status.innerHTML += `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 1.5 3.5 9h4l-1 5.5 6-7.5h-4l1-5.5Z"/></svg>`;
    }
    if (tab.isPinned) {
      status.innerHTML += `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 2.5h6l-1 3 2 2v1H8.75v4.75L8 14l-.75-.75V8.5H4v-1l2-2-1-3Z"/></svg>`;
    }
    // Speaker icon: audio playing or tab muted; a click toggles mute.
    let audio: HTMLSpanElement | null = null;
    if (tab.isAudible || tab.isMuted) {
      audio = document.createElement("span");
      audio.className = "tab-audio";
      audio.setAttribute("role", "button");
      audio.title = tab.isMuted ? copy.unmuteTab : copy.muteTab;
      audio.setAttribute("aria-label", audio.title);
      audio.innerHTML = tab.isMuted
        ? `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h2l3-2.5v9L4 10H2V6Zm7.2-.8 1.3 1.3 1.3-1.3 1 1-1.3 1.3 1.3 1.3-1 1-1.3-1.3L9.2 9l-1-1 1.3-1.3-1.3-1.3 1-1Z"/></svg>`
        : `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h2l3-2.5v9L4 10H2V6Zm8.1-.4a3.4 3.4 0 0 1 0 4.8l-.9-.9a2.1 2.1 0 0 0 0-3l.9-.9Zm2-2a6.2 6.2 0 0 1 0 8.8l-.9-.9a4.9 4.9 0 0 0 0-7l.9-.9Z"/></svg>`;
      const toggleMute = (event: Event): void => {
        event.stopPropagation();
        event.preventDefault();
        void window.browserApi.toggleTabMute(tab.id);
      };
      audio.addEventListener("click", toggleMute);
      audio.addEventListener("mousedown", (event) => event.stopPropagation());
      audio.addEventListener("dblclick", (event) => event.stopPropagation());
    }

    let favicon: HTMLImageElement | SVGElement | null = null;
    const internalIcon = tab.favicon?.startsWith(INTERNAL_ICON_PREFIX)
      ? createInternalTabIcon(tab.favicon.slice(INTERNAL_ICON_PREFIX.length))
      : (!tab.favicon && tab.url === DEFAULT_URL ? createInternalTabIcon("new-tab") : null);
    if (internalIcon) {
      favicon = internalIcon;
    } else if (tab.favicon && !tab.favicon.startsWith(INTERNAL_ICON_PREFIX)) {
      favicon = document.createElement("img");
      favicon.className = "tab-favicon";
      favicon.alt = "";
      favicon.draggable = false;
      favicon.src = tab.favicon;
      const imageFavicon = favicon;
      favicon.addEventListener("error", () => {
        imageFavicon.remove();
        button.classList.add("no-icon");
      });
    } else {
      button.classList.add("no-icon");
    }

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = !tab.title || tab.title === "New Tab" || tab.title === "Nowa karta"
      ? copy.newTab
      : tab.title;

    // Icon-only modes (pinned, collapsed sidebar) show the first letter when there is no favicon.
    const letter = document.createElement("span");
    letter.className = "tab-letter";
    letter.textContent = tileLetterFor(tab.url, title.textContent || "");

    const close = document.createElement("button");
    close.className = "close-tab";
    close.type = "button";
    close.title = copy.closeTab;
    close.innerHTML = `<svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>`;

    close.addEventListener("click", async (event) => {
      event.stopPropagation();
      await window.browserApi.closeTab(tab.id);
    });

    button.addEventListener("click", async () => {
      await window.browserApi.switchTab(tab.id);
    });
    button.addEventListener("mousedown", (event) => {
      if (event.button === 1) event.preventDefault();
    });
    button.addEventListener("auxclick", async (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      await window.browserApi.closeTab(tab.id);
    });

    button.draggable = true;
    button.addEventListener("dragstart", (event) => {
      draggedTabId = tab.id;
      lastTabDropTarget = null;
      tabDropDone = false;
      window.browserApi.notifyTabDrag(tab.id);
      event.dataTransfer?.setData("text/plain", String(tab.id));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      requestAnimationFrame(() => button.classList.add("dragging"));
    });
    button.addEventListener("dragend", () => {
      // No `drop` arrived (e.g. only one dragover fired): finish the move from the last pointer position seen.
      if (!tabDropDone && draggedTabId === tab.id) commitTabDrop(lastTabDropTarget);
      lastTabDropTarget = null;
      tabDropDone = false;
      draggedTabId = null;
      clearTabDropMarks();
      window.browserApi.notifyTabDrag(null);
      if (renderDeferredByDrag) {
        renderDeferredByDrag = false;
        scheduleRender();
      }
      button.classList.remove("dragging");
    });

    button.addEventListener("contextmenu", async (event) => {
      event.preventDefault();
      await window.browserApi.openTabContextMenu(tab.id, {
        x: Math.round(event.clientX),
        y: Math.round(event.clientY),
      });
    });

    button.append(spinner, ...(favicon ? [favicon] : []), letter, status, ...(audio ? [audio] : []), title, close);
    (isVertical() && tab.isPinned ? pinnedContainer : tabsContainer).append(button);
    if (shownActive !== isActive) {
      requestAnimationFrame(() => requestAnimationFrame(() => button.classList.toggle("active", isActive)));
    }
    if (animate && tabsRenderedOnce && !knownTabIds.has(tab.id)) enterStarted.set(tab.id, now);
    const enteredAt = enterStarted.get(tab.id);
    if (animate && enteredAt !== undefined) {
      const elapsed = now - enteredAt;
      if (elapsed < dur) {
        const from = isVertical() && !tab.isPinned ? (isSidebarRight() ? "translateX(8px)" : "translateX(-8px)") : "translateY(-4px) scale(.96)";
        button.animate([{ opacity: 0, transform: from }, { opacity: 1, transform: "none" }], { duration: dur, delay: -elapsed, easing: EASE, fill: "backwards" });
      } else {
        enterStarted.delete(tab.id);
      }
    }
  });

  // Removed tabs collapse in place (only in the first render after the removal and while their animation runs).
  const present = new Set(state.tabs.map((tab) => tab.id));
  oldButtons.forEach(({ el, parent, index }, id) => {
    if (present.has(id)) return;
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.classList.add("tab-ghost");
    ghost.classList.remove("active");
    ghost.removeAttribute("data-tab-id");
    ghost.setAttribute("aria-hidden", "true");
    ghost.tabIndex = -1;
    ghost.style.cssText = "overflow:hidden;pointer-events:none";
    tabGhosts.push({ el: ghost, parent, index, start: now, dur, vertical: isVertical() && !el.classList.contains("pinned") });
  });
  for (const ghost of [...tabGhosts].sort((a, b) => a.index - b.index)) {
    ghost.parent.insertBefore(ghost.el, ghost.parent.children[ghost.index] ?? null);
    runGhost(ghost);
  }
  state.tabs.forEach((tab) => { knownTabIds.add(tab.id); previousActive.set(tab.id, tab.id === state.activeTabId); });
  for (const id of [...knownTabIds]) if (!present.has(id)) { knownTabIds.delete(id); previousActive.delete(id); enterStarted.delete(id); activeChanged.delete(id); }
  tabsRenderedOnce = true;
};

// Przestrzenie: przełącznik (układ poziomy) i rząd ikon (panel boczny). Klasy ws-* są gotowe pod animacje.
// Geometric preset icons are drawn as SVG (font independent, optically centered); other symbols stay text.
const WORKSPACE_GLYPH_SHAPES: Record<string, string> = {
  "◼": '<rect x="4" y="4" width="8" height="8"/>',
  "●": '<circle cx="8" cy="8" r="4.5"/>',
  "▲": '<path d="M8 3 13.5 12.5H2.5Z"/>',
  "◆": '<path d="M8 2 14 8 8 14 2 8Z"/>',
};
const setWorkspaceGlyph = (target: HTMLElement, icon: string): void => {
  const shape = WORKSPACE_GLYPH_SHAPES[icon];
  if (shape) target.innerHTML = `<svg class="ws-glyph" viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">${shape}</svg>`;
  else target.textContent = icon;
};

// Popups of the workspace controls are placed next to the control: right of the sidebar (vertical) or below it (horizontal),
// never over the sidebar itself; the main process clamps them inside the window.
const workspacePopupAnchor = (element: HTMLElement, event?: MouseEvent): PopupAnchorArg => {
  const rect = element.getBoundingClientRect();
  if (isVertical()) {
    const bar = chromeBar.getBoundingClientRect();
    const side = { x: Math.round(bar.left), y: Math.round(rect.top), width: Math.round(bar.width), height: Math.round(rect.height) };
    return isSidebarRight()
      ? { x: side.x, y: side.y, rect: side, placement: "left" }
      : { x: side.x + side.width, y: side.y, rect: side, placement: "right" };
  }
  return { x: Math.round(event?.clientX ?? rect.left), y: Math.round(rect.bottom), rect: rectOf(rect), placement: "below" };
};

let renderedWorkspaceId: string | null = null;
const renderWorkspaces = (): void => {
  const copy = translations[state.language];
  const current = state.workspaces.find((workspace) => workspace.id === state.currentWorkspaceId) ?? state.workspaces[0];
  if (!current) return;
  document.body.dataset.workspace = current.id;
  chromeBar.style.setProperty("--ws-accent", current.colorCss ?? "transparent");
  setWorkspaceGlyph(wsSwitchIcon, current.icon);
  wsSwitch.title = `${copy.workspace}: ${current.name}`;
  wsSwitch.setAttribute("aria-label", wsSwitch.title);

  if (renderedWorkspaceId !== null && renderedWorkspaceId !== current.id) {
    const previousIndex = state.workspaces.findIndex((workspace) => workspace.id === renderedWorkspaceId);
    const currentIndex = state.workspaces.findIndex((workspace) => workspace.id === current.id);
    const shift = currentIndex >= previousIndex ? "8px" : "-8px";
    for (const list of [tabsContainer, pinnedContainer]) {
      list.style.setProperty("--ws-shift", shift);
      list.classList.remove("ws-enter");
      void list.offsetWidth; // restart the animation
      list.classList.add("ws-enter");
    }
  }
  renderedWorkspaceId = current.id;

  wsList.replaceChildren(...state.workspaces.map((workspace, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `ws-btn${workspace.id === current.id ? " active" : ""}`;
    setWorkspaceGlyph(button, workspace.icon);
    button.title = `${workspace.name}${index < 9 ? ` (Ctrl+Alt+${index + 1})` : ""}`;
    button.setAttribute("aria-label", workspace.name);
    button.setAttribute("aria-pressed", String(workspace.id === current.id));
    button.dataset.workspaceId = workspace.id;
    if (workspace.colorCss) button.style.setProperty("--ws-color", workspace.colorCss);
    button.addEventListener("click", () => { void window.browserApi.switchWorkspace(workspace.id); });
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      void window.browserApi.openWorkspaceMenu(workspace.id, workspacePopupAnchor(button, event));
    });
    // Drop a dragged tab here to move it to this workspace.
    // dragenter is accepted as well as dragover: a drop right after entering the icon must still land.
    for (const eventName of ["dragenter", "dragover"] as const) {
      button.addEventListener(eventName, (event) => {
        if (draggedTabId === null || workspace.id === current.id) return;
        event.preventDefault();
        button.classList.add("drop-target");
      });
    }
    button.addEventListener("dragleave", () => button.classList.remove("drop-target"));
    button.addEventListener("drop", (event) => {
      button.classList.remove("drop-target");
      if (draggedTabId === null || workspace.id === current.id) return;
      event.preventDefault();
      void window.browserApi.moveTabToWorkspace(draggedTabId, workspace.id);
    });
    return button;
  }));
};

const render = (): void => {
  renderControls();
  renderTabs();
  if (draggedTabId === null) renderWorkspaces();

  const active = getActiveTab();
  placeholder.style.display = active || isChromeOverlay ? "none" : "flex";
};

const scheduleRender = (): void => {
  if (renderFrame !== null) {
    return;
  }

  renderFrame = window.requestAnimationFrame(() => {
    renderFrame = null;
    render();
  });
};

const navigateFromAddress = async (): Promise<void> => {
  const input = addressInput.value.trim();
  if (!input) {
    return;
  }

  // Focus moves to the page view, but this document keeps the input as its
  // active element; renderControls would never update the address again.
  addressDirty = false;
  addressInput.blur();
  await window.browserApi.navigate(input);
};

const handleKeyboardShortcut = async (event: KeyboardEvent): Promise<void> => {
  const commandPressed = event.ctrlKey || event.metaKey;
  if (!commandPressed || event.altKey) {
    return;
  }

  const key = event.key.toLowerCase();

  if (key === "f") {
    event.preventDefault();
    await window.browserApi.showFindWindow();
    return;
  }

  if (key === "k") {
    event.preventDefault();
    window.browserApi.triggerPaletteShortcut();
    return;
  }

  if (key === "t") {
    event.preventDefault();
    window.browserApi.triggerNewTabShortcut(DEFAULT_URL);
    return;
  }

  if (key === "r") {
    event.preventDefault();
    window.browserApi.triggerReloadShortcut(event.shiftKey);
    return;
  }

  if (key === "w") {
    event.preventDefault();
    window.browserApi.triggerCloseTabShortcut();
  }
};

const wireEvents = (): void => {
  addressForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await navigateFromAddress();
  });

  backButton.addEventListener("click", async () => {
    await window.browserApi.back();
  });

  forwardButton.addEventListener("click", async () => {
    await window.browserApi.forward();
  });

  reloadButton.addEventListener("click", async () => {
    await window.browserApi.reload();
  });

  // Menu buttons open on mouse-down (like native menus): the press that
  // dismisses an open menu through focus loss then arrives together with the
  // toggle request instead of after a slow release. Keyboard activation
  // (click without a pointer, detail === 0) still works.
  const onPress = (button: HTMLElement, handler: () => Promise<unknown>): void => {
    button.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault(); // keep focus where it is; the popup takes it
      void handler().finally(() => {
        if (document.activeElement === button) button.blur();
      });
    });
    button.addEventListener("click", (event) => {
      if (event.detail === 0) void handler();
    });
  };

  onPress(siteInfoButton, async () => {
    const rect = siteInfoButton.getBoundingClientRect();
    await window.browserApi.openSiteInfoMenu({
      x: Math.round(rect.left),
      y: Math.round(rect.bottom),
      rect: rectOf(rect),
    });
  });

  onPress(menuButton, async () => {
    const rect = menuButton.getBoundingClientRect();
    // The sidebar menu button sits at the bottom, so the menu opens beside the sidebar instead.
    // The sidebar menu button sits at the bottom: the menu grows upward from it (auto-flips when there is no room).
    await window.browserApi.openNavigationMenu({ x: Math.round(rect.left), y: Math.round(rect.bottom), rect: rectOf(rect), placement: isVertical() ? "above" : "below" });
  });

  settingsButton.addEventListener("click", async () => {
    await window.browserApi.openSettingsWindow();
  });

  // Pinned menu functions (icon buttons left of the hamburger). Same action as the menu row, run in the main process.
  const TOOLBAR_PIN_ICONS: Record<string, { path: string; evenodd?: boolean }> = {
    notes: { evenodd: true, path: "M3.5 2h6.9l2.6 2.6V14h-9.5V2Zm1.5 1.5v9h6.5V5.5H9.5V3.5H5Zm1 4h4v1.2H6V7.5Zm0 2.4h4v1.2H6V9.9Z" },
    downloads: { path: "M7.25 2h1.5v6.19l2.22-2.22 1.06 1.06L8 11.06 3.97 7.03l1.06-1.06 2.22 2.22V2ZM2.5 12h11v1.5h-11V12Z" },
    history: { evenodd: true, path: "M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2Zm0 1.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Zm-.75 1.75h1.5v2.44l1.78 1.78-1.06 1.06-2.22-2.22V5.25Z" },
    bookmarks: { evenodd: true, path: "M4 2h8v12L8 11l-4 3V2Zm1.5 1.5v7.6L8 9.2l2.5 1.9V3.5h-5Z" },
    "new-private-tab": { path: "M5.2 2h5.6l1.2 4H4l1.2-4ZM2 7h12v1.3H2V7Zm1 2.8h3.6a.9.9 0 0 1 .9.9v.4a2.2 2.2 0 0 1-2.2 2.2h-1A2.2 2.2 0 0 1 2.1 11v-.3a.9.9 0 0 1 .9-.9Zm5.5 0h3.6a.9.9 0 0 1 .9.9v.3a2.2 2.2 0 0 1-2.2 2.2h-1a2.2 2.2 0 0 1-2.2-2.2v-.4a.9.9 0 0 1 .9-.9Z" },
    "dev-tools": { path: "M5.53 4.47 2 8l3.53 3.53 1.06-1.06L4.12 8l2.47-2.47-1.06-1.06Zm4.94 0-1.06 1.06L11.88 8l-2.47 2.47 1.06 1.06L14 8l-3.53-3.53Z" },
    "compact-toggle": { evenodd: true, path: "M2.5 3h11v10h-11V3Zm1.5 3.5v5h8v-5H4Z" },
  };
  const toolbarPinsHost = document.getElementById("toolbar-pins") as HTMLDivElement;
  const SVG_NS = "http://www.w3.org/2000/svg";
  const renderToolbarPins = (payload: unknown): void => {
    const pinned = (payload as { pinned?: Array<{ id?: unknown; label?: unknown }> } | null)?.pinned;
    toolbarPinsHost.replaceChildren();
    if (!Array.isArray(pinned)) return;
    for (const entry of pinned) {
      const id = typeof entry?.id === "string" ? entry.id : "";
      const icon = TOOLBAR_PIN_ICONS[id];
      if (!icon) continue;
      const label = typeof entry.label === "string" ? entry.label : id;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "nav-btn toolbar-pin";
      button.dataset.action = id;
      button.title = label;
      button.setAttribute("aria-label", label);
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("viewBox", "0 0 16 16");
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", icon.path);
      if (icon.evenodd) path.setAttribute("fill-rule", "evenodd");
      svg.appendChild(path);
      button.appendChild(svg);
      onPress(button, () => window.browserApi.runToolbarAction(id));
      toolbarPinsHost.appendChild(button);
    }
  };
  window.browserApi.onToolbarPinsChanged(renderToolbarPins);
  // Tooltips are localized in the main process: refetch when the language changes.
  window.browserApi.onLanguageChanged(() => { void window.browserApi.getToolbarPins().then(renderToolbarPins); });
  void window.browserApi.getToolbarPins().then(renderToolbarPins);

  // Like Chrome: a click that focuses the address bar selects all of it; a
  // click into an already focused field just places the caret.
  let selectAddressOnMouseUp = false;
  addressInput.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    selectAddressOnMouseUp = !(document.hasFocus() && document.activeElement === addressInput);
  });
  addressInput.addEventListener("mouseup", (event) => {
    if (!selectAddressOnMouseUp) return;
    selectAddressOnMouseUp = false;
    // Only a plain click; a drag-selection the user made stays as it is.
    if (addressInput.selectionStart === addressInput.selectionEnd) {
      event.preventDefault();
      addressInput.select();
    }
  });
  addressInput.addEventListener("input", () => { addressDirty = true; });
  // Compact mode: a focused address field keeps the revealed chrome open.
  if (isChromeOverlay) {
    // The main process hides the revealed chrome shortly after the pointer leaves it.
    let pointerInside = false;
    let lastInsideReport = 0;
    const reportPointer = (inside: boolean): void => {
      const now = Date.now();
      // "inside" is re-sent every 200ms while moving: the main process may have reset its state when it hid the chrome.
      if (inside === pointerInside && !(inside && now - lastInsideReport > 200)) return;
      pointerInside = inside;
      if (inside) lastInsideReport = now;
      window.browserApi.setCompactPointer(inside);
    };
    document.addEventListener("mouseenter", () => reportPointer(true));
    document.addEventListener("mousemove", () => reportPointer(true), { passive: true });
    document.addEventListener("mouseleave", () => reportPointer(false));
    document.documentElement.addEventListener("mouseleave", () => reportPointer(false));
    addressInput.addEventListener("focus", () => window.browserApi.setCompactKeep({ address: true }));
    addressInput.addEventListener("blur", () => window.browserApi.setCompactKeep({ address: false }));
    window.addEventListener("blur", () => window.browserApi.setCompactKeep({ address: false }));
  }
  addressInput.addEventListener("blur", () => {
    addressDirty = false;
    addressInput.setSelectionRange(0, 0);
    scheduleRender();
  });
  addressInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      addressDirty = false;
      addressInput.value = displayUrl(getActiveTab()?.url ?? "");
      addressInput.select();
    }
  });

  zoomPill.addEventListener("click", () => {
    void window.browserApi.resetZoom();
  });

  // Drop a link / URL text / file onto the shell or tab bar: opens it in a new tab.
  // (Tab reordering uses its own drag state, so those drags are left alone.)
  initTabDragDrop();
  const isExternalDrag = (event: DragEvent): boolean => {
    if (draggedTabId !== null) return false;
    if (event.target instanceof Element && event.target.closest("input")) return false;
    const types = Array.from(event.dataTransfer?.types ?? []);
    return types.includes("Files") || types.includes("text/uri-list") || types.includes("text/plain");
  };
  let dragDepth = 0;
  document.addEventListener("dragenter", (event) => {
    if (!isExternalDrag(event)) return;
    dragDepth += 1;
    document.body.classList.add("dropping");
  });
  document.addEventListener("dragleave", (event) => {
    if (!isExternalDrag(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) document.body.classList.remove("dropping");
  });
  document.addEventListener("dragover", (event) => {
    if (!isExternalDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  document.addEventListener("drop", (event) => {
    dragDepth = 0;
    document.body.classList.remove("dropping");
    if (!isExternalDrag(event) || !event.dataTransfer) return;
    event.preventDefault();
    const filePaths = Array.from(event.dataTransfer.files)
      .map((file) => window.browserApi.getPathForFile(file))
      .filter((filePath) => filePath.length > 0);
    void window.browserApi.openDropped({
      uriList: event.dataTransfer.getData("text/uri-list"),
      text: event.dataTransfer.getData("text/plain"),
      filePaths,
    });
  });

  placeholderNew.addEventListener("click", async () => {
    await window.browserApi.createTab(DEFAULT_URL);
  });
  placeholder.addEventListener("dblclick", async (event) => {
    if (event.target === placeholder) await window.browserApi.createTab(DEFAULT_URL);
  });
  sidebarToggle.addEventListener("click", () => {
    updateLayout({ verticalTabBarCollapsed: !layout.verticalTabBarCollapsed });
  });

  // While dragging, main keeps the page view's left edge a little past the
  // sidebar edge so the shell keeps receiving pointer events.
  const releaseDrag = (): void => {
    if (!resizingSidebar) return;
    resizingSidebar = false;
    sidebarResizer.classList.remove("dragging");
    void window.browserApi.setSidebarDragging(false);
    void syncViewport();
    void window.browserApi.setLayoutSettings({ verticalTabBarWidth: layout.verticalTabBarWidth });
  };
  sidebarResizer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    try { sidebarResizer.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
    sidebarResizer.classList.add("dragging");
    resizingSidebar = true;
    void window.browserApi.setSidebarDragging(true);
  });
  sidebarResizer.addEventListener("pointermove", (event) => {
    if (!resizingSidebar) return;
    if (event.buttons === 0) { releaseDrag(); return; }
    layout.verticalTabBarWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(isSidebarRight() ? window.innerWidth - event.clientX : event.clientX)));
    document.documentElement.style.setProperty("--sidebar-width", `${layout.verticalTabBarWidth}px`);
    if (sidebarSyncFrame === null) {
      sidebarSyncFrame = window.requestAnimationFrame(() => {
        sidebarSyncFrame = null;
        void syncViewport();
      });
    }
  });
  sidebarResizer.addEventListener("pointerup", releaseDrag);
  sidebarResizer.addEventListener("pointercancel", releaseDrag);
  sidebarResizer.addEventListener("lostpointercapture", releaseDrag);
  window.addEventListener("blur", releaseDrag);

  newTabButton.addEventListener("click", async () => {
    await window.browserApi.createTab(DEFAULT_URL);
  });

  onPress(wsSwitch, async () => {
    const rect = wsSwitch.getBoundingClientRect();
    await window.browserApi.openWorkspaceSwitcher({ x: Math.round(rect.left), y: Math.round(rect.bottom), rect: rectOf(rect), placement: isVertical() ? "above" : "below" });
  });
  wsSwitch.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    void window.browserApi.openWorkspaceMenu(state.currentWorkspaceId, workspacePopupAnchor(wsSwitch, event));
  });
  // "+" creates the space and the main process opens its editor right away, next to this button.
  wsAdd.addEventListener("click", () => { void window.browserApi.createWorkspace(workspacePopupAnchor(wsAdd)); });

  // Horizontal swipe / scroll over the sidebar switches to the next/previous workspace (throttled).
  let lastWorkspaceWheel = 0;
  chromeBar.addEventListener("wheel", (event) => {
    if (!isVertical() || Math.abs(event.deltaX) <= Math.abs(event.deltaY) || Math.abs(event.deltaX) < 30) return;
    const now = Date.now();
    if (now - lastWorkspaceWheel < 450) return;
    lastWorkspaceWheel = now;
    const index = state.workspaces.findIndex((workspace) => workspace.id === state.currentWorkspaceId);
    const next = state.workspaces[(index + (event.deltaX > 0 ? 1 : -1) + state.workspaces.length) % state.workspaces.length];
    if (next && next.id !== state.currentWorkspaceId) void window.browserApi.switchWorkspace(next.id);
  }, { passive: true });

  tabScroll.addEventListener("scroll", updateTabFade, { passive: true });
  new ResizeObserver(updateTabFade).observe(tabScroll);
  new ResizeObserver(updateTabFade).observe(tabsContainer);
  tabScroll.addEventListener("wheel", (event) => {
    if (!isVertical() && event.deltaY !== 0 && !event.shiftKey) {
      tabScroll.scrollLeft += event.deltaY * 1.5;
    }
  }, { passive: true });

  window.addEventListener("keydown", (event) => {
    void handleKeyboardShortcut(event);
  });

  let resizeTimeout: number | undefined;
  window.addEventListener("resize", () => {
    if (resizeTimeout) {
      window.clearTimeout(resizeTimeout);
    }

    resizeTimeout = window.setTimeout(() => {
      void syncViewport();
    }, 100);
  });

  window.browserApi.onTabsState((payload) => {
    const isNewTab = payload.tabs.length > state.tabs.length;
    const previousActive = state.activeTabId;
    const workspaceChanged = !!payload.currentWorkspaceId && payload.currentWorkspaceId !== state.currentWorkspaceId;
    
    state.tabs = payload.tabs;
    state.activeTabId = payload.activeTabId;
    if (payload.workspaces) state.workspaces = payload.workspaces;
    if (payload.currentWorkspaceId) state.currentWorkspaceId = payload.currentWorkspaceId;
    if (previousActive !== null && payload.activeTabId === null && payload.tabs.length === 0) {
      addressDirty = false;
      addressInput.value = "";
      addressInput.focus();
    }

    scheduleRender();

    // Auto-scroll to newly created or newly focused tabs (also after the enter animation has settled the layout).
    if (isNewTab || (state.activeTabId && state.activeTabId !== previousActive)) {
      const smooth = !workspaceChanged;
      requestAnimationFrame(() => requestAnimationFrame(() => revealActiveTab(smooth)));
      window.setTimeout(() => revealActiveTab(smooth), animDurations().dur + 60);
    }
  });

  window.browserApi.onLanguageChanged((language) => {
    applyLanguage(language);
  });

  window.browserApi.onLayoutChanged((next) => {
    if (resizingSidebar) return;
    Object.assign(layout, next);
    applyLayout();
  });

  // Focus moved into a page (WebContentsView): the field gets no blur of its own, so drop focus and selection here.
  window.browserApi.onBlurAddress(() => {
    if (document.activeElement === addressInput) addressInput.blur();
    addressInput.setSelectionRange(0, 0);
    window.getSelection()?.removeAllRanges();
    selectAddressOnMouseUp = false;
  });

  window.browserApi.onFocusAddress(() => {
    if (isCollapsed()) {
      // The address field is hidden in the icon-only sidebar; expand it first.
      updateLayout({ verticalTabBarCollapsed: false });
    }
    addressInput.focus();
    addressInput.select();
  });

};

const bootstrap = async (): Promise<void> => {
  wireEvents();

  const [tabsState, language, layoutSettings] = await Promise.all([
    window.browserApi.getTabsState(),
    window.browserApi.getLanguage(),
    window.browserApi.getLayoutSettings(),
  ]);

  state.tabs = tabsState.tabs;
  state.activeTabId = tabsState.activeTabId;
  if (tabsState.workspaces) state.workspaces = tabsState.workspaces;
  if (tabsState.currentWorkspaceId) state.currentWorkspaceId = tabsState.currentWorkspaceId;
  Object.assign(layout, layoutSettings);
  applyLayout();
  applyLanguage(language);

  await syncViewport();
};

void bootstrap();
