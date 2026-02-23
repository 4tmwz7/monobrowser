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
  setViewportTop: (top: number) => Promise<boolean>;
  onTabsState: (callback: (payload: TabsStatePayload) => void) => () => void;
};

declare global {
  interface Window {
    browserApi: BrowserApi;
  }
}

const DEFAULT_URL = "https://www.google.com";

const state: {
  tabs: TabState[];
  activeTabId: number | null;
} = {
  tabs: [],
  activeTabId: null,
};

const CHROME_HEIGHT = 84; // 38px tab-strip + 46px nav-bar

const tabsContainer = document.getElementById("tabs") as HTMLDivElement;
const addressForm = document.getElementById("address-form") as HTMLFormElement;
const addressInput = document.getElementById("address") as HTMLInputElement;
const backButton = document.getElementById("back") as HTMLButtonElement;
const forwardButton = document.getElementById("forward") as HTMLButtonElement;
const reloadButton = document.getElementById("reload") as HTMLButtonElement;
const historyButton = document.getElementById("history") as HTMLButtonElement;
const newTabButton = document.getElementById("new-tab") as HTMLButtonElement;
const placeholder = document.getElementById("placeholder") as HTMLDivElement;

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

  state.tabs.forEach((tab) => {
    const isActive = tab.id === state.activeTabId;
    const button = document.createElement("button");
    button.className = `tab-btn${isActive ? " active" : ""}${tab.isLoading ? " loading" : ""}`;
    button.type = "button";
    button.title = tab.title || tab.url;

    // Loading spinner
    const spinner = document.createElement("span");
    spinner.className = "tab-loading";

    // Favicon placeholder
    const favicon = document.createElement("span");
    favicon.className = "tab-favicon";
    favicon.innerHTML = `<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm-.75 3.5h1.5v5h-1.5v-5Zm.75 7a.875.875 0 1 1 0-1.75A.875.875 0 0 1 8 11.5Z"/></svg>`;

    // Try to load real favicon
    try {
      const url = new URL(tab.url);
      const img = document.createElement("img");
      img.src = `${url.origin}/favicon.ico`;
      img.width = 14;
      img.height = 14;
      img.style.borderRadius = "2px";
      img.onerror = () => img.replaceWith(favicon.querySelector("svg")!);
      favicon.innerHTML = "";
      favicon.append(img);
    } catch {
      // keep default svg
    }

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.title || tab.url || "New Tab";

    const close = document.createElement("button");
    close.className = "close-tab";
    close.type = "button";
    close.title = "Close tab (Ctrl+W)";
    close.innerHTML = `<svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>`;

    close.addEventListener("click", async (event) => {
      event.stopPropagation();
      await window.browserApi.closeTab(tab.id);
    });

    button.addEventListener("click", async () => {
      await window.browserApi.switchTab(tab.id);
    });

    button.append(spinner, favicon, title, close);
    tabsContainer.append(button);
  });
};

const render = (): void => {
  renderControls();
  renderTabs();

  const active = getActiveTab();
  placeholder.style.display = active ? "none" : "block";
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
    await window.browserApi.createTab(DEFAULT_URL);
    return;
  }

  if (key === "r") {
    const activeTab = getActiveTab();
    if (!activeTab) {
      return;
    }

    event.preventDefault();
    await window.browserApi.reload();
    return;
  }

  if (key === "w") {
    const activeTab = getActiveTab();
    if (!activeTab) {
      return;
    }

    event.preventDefault();
    await window.browserApi.closeTab(activeTab.id);
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

  historyButton.addEventListener("click", async () => {
    await window.browserApi.openHistoryWindow();
  });

  newTabButton.addEventListener("click", async () => {
    await window.browserApi.createTab(DEFAULT_URL);
  });

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
    state.tabs = payload.tabs;
    state.activeTabId = payload.activeTabId;
    render();
  });
};

const bootstrap = async (): Promise<void> => {
  wireEvents();

  const tabsState = await window.browserApi.getTabsState();

  state.tabs = tabsState.tabs;
  state.activeTabId = tabsState.activeTabId;

  await syncViewportTop();
  render();
};

void bootstrap();
