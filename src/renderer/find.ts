type AppLanguage = "pl" | "en";
type FindResult = { requestId: number; activeMatchOrdinal: number; matches: number; finalUpdate: boolean };
type TabsStatePayload = { activeTabId: number | null };

type FindApi = {
  findInPage: (query: string, options: { forward: boolean; findNext: boolean }) => Promise<FindResult | null>;
  stopFindInPage: (action: "clearSelection" | "keepSelection" | "activateSelection") => Promise<boolean>;
  hideFindWindow: () => Promise<boolean>;
  getLanguage: () => Promise<AppLanguage>;
  onLanguageChanged: (callback: (language: AppLanguage) => void) => () => void;
  onTabsState: (callback: (payload: TabsStatePayload) => void) => () => void;
};

declare global {
  interface Window {
    browserApi: FindApi;
  }
}

const translations = {
  pl: {
    placeholder: "Znajdź na stronie",
    previous: "Poprzedni wynik",
    next: "Następny wynik",
    close: "Zamknij wyszukiwanie",
  },
  en: {
    placeholder: "Find on page",
    previous: "Previous match",
    next: "Next match",
    close: "Close find",
  },
} as const;

const input = document.getElementById("find-input") as HTMLInputElement;
const resultLabel = document.getElementById("find-result") as HTMLSpanElement;
const previousButton = document.getElementById("find-previous") as HTMLButtonElement;
const nextButton = document.getElementById("find-next") as HTMLButtonElement;
const closeButton = document.getElementById("find-close") as HTMLButtonElement;
let requestVersion = 0;
let lastActiveTabId: number | null = null;

const updateResult = (activeMatchOrdinal: number, matches: number): void => {
  resultLabel.textContent = `${matches > 0 ? activeMatchOrdinal : 0}/${matches}`;
  previousButton.disabled = matches === 0;
  nextButton.disabled = matches === 0;
};

const applyLanguage = (language: AppLanguage): void => {
  const copy = translations[language];
  document.documentElement.lang = language;
  input.placeholder = copy.placeholder;
  input.setAttribute("aria-label", copy.placeholder);
  previousButton.title = copy.previous;
  previousButton.setAttribute("aria-label", copy.previous);
  nextButton.title = copy.next;
  nextButton.setAttribute("aria-label", copy.next);
  closeButton.title = copy.close;
  closeButton.setAttribute("aria-label", copy.close);
};

const runFind = async (findNext: boolean, forward = true): Promise<void> => {
  const version = ++requestVersion;
  const query = input.value;
  if (!query) {
    updateResult(0, 0);
    await window.browserApi.stopFindInPage("clearSelection");
    return;
  }
  const result = await window.browserApi.findInPage(query, { forward, findNext });
  if (version !== requestVersion || input.value !== query) return;
  updateResult(result?.activeMatchOrdinal ?? 0, result?.matches ?? 0);
};

const closeFind = async (): Promise<void> => {
  requestVersion += 1;
  updateResult(0, 0);
  await window.browserApi.hideFindWindow();
};

input.addEventListener("input", () => { void runFind(false); });
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void runFind(true, !event.shiftKey);
  } else if (event.key === "Escape") {
    event.preventDefault();
    void closeFind();
  }
});
previousButton.addEventListener("click", () => { void runFind(true, false); });
nextButton.addEventListener("click", () => { void runFind(true, true); });
closeButton.addEventListener("click", () => { void closeFind(); });
window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    input.focus();
    input.select();
  }
});
window.browserApi.onLanguageChanged(applyLanguage);
window.browserApi.onTabsState((payload) => {
  if (payload.activeTabId !== lastActiveTabId && input.value) {
    void runFind(false);
  }
  lastActiveTabId = payload.activeTabId;
});

void window.browserApi.getLanguage().then(applyLanguage);
input.focus();
