type TabState = {
  id: number;
  title: string;
  url: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

type TabsStatePayload = {
  tabs: TabState[];
  activeTabId: number | null;
};

type AppLanguage = "pl" | "en";

type BrowserApi = {
  createTab: (initialUrl?: string) => Promise<number>;
  closeTab: (tabId: number) => Promise<boolean>;
  switchTab: (tabId: number) => Promise<boolean>;
  getTabsState: () => Promise<TabsStatePayload>;
  navigate: (input: string) => Promise<boolean>;
  back: () => Promise<boolean>;
  forward: () => Promise<boolean>;
  reload: () => Promise<boolean>;
  openHistoryWindow: () => Promise<boolean>;
  openDownloadsWindow: () => Promise<boolean>;
  openSiteDataWindow: () => Promise<boolean>;
  openNavigationMenu: (position: { x: number; y: number }) => Promise<boolean>;
  getLanguage: () => Promise<AppLanguage>;
  setLanguage: (language: AppLanguage) => Promise<boolean>;
  onLanguageChanged: (callback: (language: AppLanguage) => void) => () => void;
  setViewportTop: (top: number) => Promise<boolean>;
  onTabsState: (callback: (payload: TabsStatePayload) => void) => () => void;
  triggerNewTabShortcut: (initialUrl?: string) => void;
  triggerCloseTabShortcut: () => void;
  triggerReloadShortcut: () => void;
};

declare global {
  interface Window {
    browserApi: BrowserApi;
  }
}

const DEFAULT_URL = "https://www.google.com";

const translations = {
  pl: {
    tabs: "Karty", newTab: "Nowa karta", closeTab: "Zamknij kartę (Ctrl+W)",
    back: "Wstecz", forward: "Dalej", reload: "Odśwież", menu: "Menu",
    addressPlaceholder: "Szukaj lub wpisz adres", go: "Przejdź", history: "Historia",
    downloads: "Pobieranie", siteData: "Dane witryn", language: "Język",
  },
  en: {
    tabs: "Tabs", newTab: "New tab", closeTab: "Close tab (Ctrl+W)",
    back: "Back", forward: "Forward", reload: "Reload", menu: "Menu",
    addressPlaceholder: "Search or enter address", go: "Go", history: "History",
    downloads: "Downloads", siteData: "Site data", language: "Language",
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

const CHROME_HEIGHT = 84; // 38px tab-strip + 46px nav-bar

const tabsContainer = document.getElementById("tab-list") as HTMLDivElement;
const addressForm = document.getElementById("address-form") as HTMLFormElement;
const addressInput = document.getElementById("address") as HTMLInputElement;
const backButton = document.getElementById("back") as HTMLButtonElement;
const forwardButton = document.getElementById("forward") as HTMLButtonElement;
const reloadButton = document.getElementById("reload") as HTMLButtonElement;
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

const renderTabs = (): void => {
  tabsContainer.innerHTML = "";
  const copy = translations[state.language];

  state.tabs.forEach((tab) => {
    const isActive = tab.id === state.activeTabId;
    const button = document.createElement("button");
    button.className = `tab-btn${isActive ? " active" : ""}${tab.isLoading ? " loading" : ""}`;
    button.type = "button";
    button.title = tab.title || tab.url;

    // Loading spinner
    const spinner = document.createElement("span");
    spinner.className = "tab-loading";

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

    button.append(spinner, title, close);
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
  await window.browserApi.setViewportTop(CHROME_HEIGHT);
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
