type TabState = {
  id: number;
  title: string;
  url: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isPinned: boolean;
  isMuted: boolean;
  isSleeping: boolean;
  isPrivate: boolean;
  favicon: string | null;
};

type TabsStatePayload = {
  tabs: TabState[];
  activeTabId: number | null;
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
type BrowserApi = {
  createTab: (initialUrl?: string) => Promise<number>;
  closeTab: (tabId: number) => Promise<boolean>;
  switchTab: (tabId: number) => Promise<boolean>;
  moveTab: (tabId: number, beforeTabId: number | null) => Promise<boolean>;
  getTabsState: () => Promise<TabsStatePayload>;
  openTabContextMenu: (tabId: number, position: { x: number; y: number }) => Promise<boolean>;
  showFindWindow: () => Promise<boolean>;
  navigate: (input: string) => Promise<boolean>;
  back: () => Promise<boolean>;
  forward: () => Promise<boolean>;
  reload: () => Promise<boolean>;
  openHistoryWindow: () => Promise<boolean>;
  openDownloadsWindow: () => Promise<boolean>;
  openSiteDataWindow: () => Promise<boolean>;
  openNavigationMenu: (position: { x: number; y: number }) => Promise<boolean>;
  openSiteInfoMenu: (position: { x: number; y: number }) => Promise<boolean>;
  getLanguage: () => Promise<AppLanguage>;
  setLanguage: (language: AppLanguage) => Promise<boolean>;
  getSearchSettings: () => Promise<SearchSettings>;
  setSearchSettings: (settings: SearchSettings) => Promise<SearchSettingsResult>;
  openSettingsWindow: () => Promise<boolean>;
  openStatsWindow: () => Promise<boolean>;
  getAdblockStatus: () => Promise<AdblockerStatus>;
  toggleAdblock: () => Promise<AdblockerStatus>;
  toggleAdblockTabPause: () => Promise<AdblockerStatus>;
  onLanguageChanged: (callback: (language: AppLanguage) => void) => () => void;
  onFocusAddress: (callback: () => void) => () => void;
  setViewportTop: (top: number) => Promise<boolean>;
  onTabsState: (callback: (payload: TabsStatePayload) => void) => () => void;
  triggerNewTabShortcut: (initialUrl?: string) => void;
  triggerCloseTabShortcut: () => void;
  triggerReloadShortcut: () => void;
  triggerPaletteShortcut: () => void;
};

declare global {
  interface Window {
    browserApi: BrowserApi;
  }
}

const DEFAULT_URL = "monobrowser://new-tab";

const translations = {
  pl: {
    tabs: "Karty", newTab: "Nowa karta", closeTab: "Zamknij kartę (Ctrl+W)",
    back: "Wstecz", forward: "Dalej", reload: "Odśwież", menu: "Menu",
    siteInfo: "Informacje o stronie", addressPlaceholder: "Szukaj lub wpisz adres", go: "Przejdź", history: "Historia",
    downloads: "Pobieranie", siteData: "Dane witryn", language: "Język",
    sleeping: "Karta uśpiona — kliknij, aby wybudzić",
    privateTab: "Karta prywatna",
    palette: "Paleta komend (Ctrl+K)",
  },
  en: {
    tabs: "Tabs", newTab: "New tab", closeTab: "Close tab (Ctrl+W)",
    back: "Back", forward: "Forward", reload: "Reload", menu: "Menu",
    siteInfo: "Page information", addressPlaceholder: "Search or enter address", go: "Go", history: "History",
    downloads: "Downloads", siteData: "Site data", language: "Language",
    sleeping: "Tab sleeping — click to wake it up",
    privateTab: "Private tab",
    palette: "Command palette (Ctrl+K)",
  },
} as const;

const state: {
  tabs: TabState[];
  activeTabId: number | null;
  language: AppLanguage;
} = {
  tabs: [],
  activeTabId: null,
  language: "pl",
};

const BASE_CHROME_HEIGHT = 84; // 38px tab-strip + 46px nav-bar

const tabsContainer = document.getElementById("tab-list") as HTMLDivElement;
const addressForm = document.getElementById("address-form") as HTMLFormElement;
const addressInput = document.getElementById("address") as HTMLInputElement;
const backButton = document.getElementById("back") as HTMLButtonElement;
const forwardButton = document.getElementById("forward") as HTMLButtonElement;
const reloadButton = document.getElementById("reload") as HTMLButtonElement;
const siteInfoButton = document.getElementById("site-info-button") as HTMLButtonElement;
const menuButton = document.getElementById("menu-button") as HTMLButtonElement;
const newTabButton = document.getElementById("new-tab") as HTMLButtonElement;
const placeholder = document.getElementById("placeholder") as HTMLDivElement;
let renderFrame: number | null = null;

const applyLanguage = (language: AppLanguage): void => {
  state.language = language;
  const copy = translations[language];
  document.documentElement.lang = language;
  document.getElementById("tabs")?.setAttribute("aria-label", copy.tabs);
  newTabButton.title = `${copy.newTab} (Ctrl+T)`;
  newTabButton.setAttribute("aria-label", copy.newTab);
  backButton.title = `${copy.back} (Alt+←)`;
  backButton.setAttribute("aria-label", copy.back);
  forwardButton.title = `${copy.forward} (Alt+→)`;
  forwardButton.setAttribute("aria-label", copy.forward);
  reloadButton.title = `${copy.reload} (Ctrl+R)`;
  reloadButton.setAttribute("aria-label", copy.reload);
  siteInfoButton.title = copy.siteInfo;
  siteInfoButton.setAttribute("aria-label", copy.siteInfo);
  addressInput.placeholder = copy.addressPlaceholder;
  const goButton = document.getElementById("go") as HTMLButtonElement;
  goButton.title = `${copy.go} (Enter)`;
  goButton.setAttribute("aria-label", copy.go);
  menuButton.title = copy.menu;
  menuButton.setAttribute("aria-label", copy.menu);
  render();
};

const getActiveTab = (): TabState | undefined => {
  return state.tabs.find((tab) => tab.id === state.activeTabId);
};

const renderControls = (): void => {
  const activeTab = getActiveTab();

  backButton.disabled = !activeTab || !activeTab.canGoBack;
  forwardButton.disabled = !activeTab || !activeTab.canGoForward;
  reloadButton.disabled = !activeTab;

  if (!document.activeElement || document.activeElement !== addressInput) {
    addressInput.value = activeTab?.url ?? "";
  }
};

let draggedTabId: number | null = null;
let renderDeferredByDrag = false;

const renderTabs = (): void => {
  if (draggedTabId !== null) {
    renderDeferredByDrag = true;
    return;
  }
  tabsContainer.innerHTML = "";
  const copy = translations[state.language];

  state.tabs.forEach((tab) => {
    const isActive = tab.id === state.activeTabId;
    const button = document.createElement("button");
    button.className = `tab-btn${isActive ? " active" : ""}${tab.isLoading ? " loading" : ""}${tab.isPinned ? " pinned" : ""}${tab.isMuted ? " muted" : ""}${tab.isSleeping ? " sleeping" : ""}${tab.isPrivate ? " private" : ""}`;
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
    if (tab.isPinned) {
      status.innerHTML += `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 2.5h6l-1 3 2 2v1H8.75v4.75L8 14l-.75-.75V8.5H4v-1l2-2-1-3Z"/></svg>`;
    }
    if (tab.isMuted) {
      status.innerHTML += `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h2l3-2.5v9L4 10H2V6Zm7.2-.8 1.3 1.3 1.3-1.3 1 1-1.3 1.3 1.3 1.3-1 1-1.3-1.3L9.2 9l-1-1 1.3-1.3-1.3-1.3 1-1Z"/></svg>`;
    }

    let favicon: HTMLImageElement | null = null;
    if (tab.favicon) {
      favicon = document.createElement("img");
      favicon.className = "tab-favicon";
      favicon.alt = "";
      favicon.draggable = false;
      favicon.src = tab.favicon;
      favicon.addEventListener("error", () => favicon?.remove());
    }

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = !tab.title || tab.title === "New Tab" || tab.title === "Nowa karta"
      ? copy.newTab
      : tab.title;

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

    const draggedTab = (): TabState | undefined => state.tabs.find((entry) => entry.id === draggedTabId);
    const dropsBefore = (event: DragEvent): boolean => {
      const rect = button.getBoundingClientRect();
      return event.clientX < rect.left + rect.width / 2;
    };
    const clearDropMarks = (): void => {
      button.classList.remove("drop-before", "drop-after");
    };

    button.draggable = true;
    button.addEventListener("dragstart", (event) => {
      draggedTabId = tab.id;
      event.dataTransfer?.setData("text/plain", String(tab.id));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      requestAnimationFrame(() => button.classList.add("dragging"));
    });
    button.addEventListener("dragover", (event) => {
      const dragged = draggedTab();
      if (!dragged || dragged.id === tab.id || dragged.isPinned !== tab.isPinned) return;
      event.preventDefault();
      const before = dropsBefore(event);
      button.classList.toggle("drop-before", before);
      button.classList.toggle("drop-after", !before);
    });
    button.addEventListener("dragleave", clearDropMarks);
    button.addEventListener("drop", (event) => {
      const dragged = draggedTab();
      clearDropMarks();
      if (!dragged || dragged.id === tab.id || dragged.isPinned !== tab.isPinned) return;
      event.preventDefault();
      const index = state.tabs.findIndex((entry) => entry.id === tab.id);
      const next = state.tabs[index + 1];
      const beforeId = dropsBefore(event) ? tab.id : (next && next.isPinned === tab.isPinned ? next.id : null);
      void window.browserApi.moveTab(dragged.id, beforeId);
    });
    button.addEventListener("dragend", () => {
      draggedTabId = null;
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

    button.append(spinner, ...(favicon ? [favicon] : []), status, title, close);
    tabsContainer.append(button);
  });
};

const render = (): void => {
  renderControls();
  renderTabs();

  const active = getActiveTab();
  placeholder.style.display = active ? "none" : "block";
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

const syncViewportTop = async (): Promise<void> => {
  placeholder.style.top = `${BASE_CHROME_HEIGHT}px`;
  await window.browserApi.setViewportTop(BASE_CHROME_HEIGHT);
};

const navigateFromAddress = async (): Promise<void> => {
  const input = addressInput.value.trim();
  if (!input) {
    return;
  }

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
    window.browserApi.triggerReloadShortcut();
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

  siteInfoButton.addEventListener("click", async () => {
    const rect = siteInfoButton.getBoundingClientRect();
    await window.browserApi.openSiteInfoMenu({
      x: Math.round(rect.left),
      y: Math.round(rect.bottom),
    });
  });

  menuButton.addEventListener("click", async () => {
    const rect = menuButton.getBoundingClientRect();
    await window.browserApi.openNavigationMenu({
      x: Math.round(rect.left),
      y: Math.round(rect.bottom),
    });
  });

  newTabButton.addEventListener("click", async () => {
    await window.browserApi.createTab(DEFAULT_URL);
  });

  const tabsWrapper = document.getElementById("tabs") as HTMLDivElement;
  tabsWrapper.addEventListener("wheel", (event) => {
    if (event.deltaY !== 0 && !event.shiftKey) {
      tabsWrapper.scrollLeft += event.deltaY * 1.5;
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
      void syncViewportTop();
    }, 100);
  });

  window.browserApi.onTabsState((payload) => {
    const isNewTab = payload.tabs.length > state.tabs.length;
    const previousActive = state.activeTabId;
    
    state.tabs = payload.tabs;
    state.activeTabId = payload.activeTabId;
    
    scheduleRender();

    // Auto-scroll to newly created or newly focused tabs
    if (isNewTab || (state.activeTabId && state.activeTabId !== previousActive)) {
      setTimeout(() => {
        const activeTabBtn = tabsContainer.querySelector('.tab-btn.active');
        if (activeTabBtn) {
          activeTabBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        }
      }, 50);
    }
  });

  window.browserApi.onLanguageChanged((language) => {
    applyLanguage(language);
  });

  window.browserApi.onFocusAddress(() => {
    addressInput.focus();
    addressInput.select();
  });

};

const bootstrap = async (): Promise<void> => {
  wireEvents();

  const [tabsState, language] = await Promise.all([
    window.browserApi.getTabsState(),
    window.browserApi.getLanguage(),
  ]);

  state.tabs = tabsState.tabs;
  state.activeTabId = tabsState.activeTabId;
  applyLanguage(language);

  await syncViewportTop();
};

void bootstrap();
