type AppLanguage = "pl" | "en";

type PaletteItem = {
  id: string;
  kind: "command" | "tab";
  label: string;
  hint?: string;
  keywords?: string;
  tabId?: number;
};

type PaletteApi = {
  showPaletteWindow: () => Promise<boolean>;
  hidePaletteWindow: () => Promise<boolean>;
  getPaletteItems: () => Promise<PaletteItem[]>;
  executePaletteCommand: (id: string) => Promise<boolean>;
  reportPaletteHeight: (height: number) => void;
  getLanguage: () => Promise<AppLanguage>;
  onLanguageChanged: (callback: (language: AppLanguage) => void) => () => void;
  onTabsState: (callback: (payload: { activeTabId: number | null }) => void) => () => void;
};

declare global {
  interface Window {
    browserApi: PaletteApi;
  }
}

const translations = {
  pl: {
    placeholder: "Wpisz komendę…",
    empty: "Brak wyników.",
    arrows: "↑↓ Wybór · Enter Uruchom · Esc Zamknij",
  },
  en: {
    placeholder: "Type a command…",
    empty: "No results.",
    arrows: "↑↓ Select · Enter Run · Esc Close",
  },
} as const;

const input = document.getElementById("palette-input") as HTMLInputElement;
const list = document.getElementById("palette-list") as HTMLUListElement;
const countLabel = document.getElementById("palette-count") as HTMLSpanElement;
const arrowsHint = document.getElementById("palette-hint-arrows") as HTMLSpanElement;
const emptyLabel = document.createElement("div");
emptyLabel.className = "palette-empty";

let allItems: PaletteItem[] = [];
let filteredItems: PaletteItem[] = [];
let selectedIndex = 0;
let reportFrame: number | null = null;

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const isFuzzyMatch = (needle: string, haystack: string): boolean => {
  let cursor = 0;
  for (const character of needle) {
    if (character === " ") continue;
    const found = haystack.indexOf(character, cursor);
    if (found === -1) return false;
    cursor = found + 1;
  }
  return true;
};

const filterItems = (query: string): PaletteItem[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return allItems.slice(0, 10);
  }

  const words = needle.split(/\s+/).filter(Boolean);
  const substringMatches = allItems.filter((item) => {
    const haystack = `${item.label} ${item.keywords ?? ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });

  if (substringMatches.length > 0) {
    return substringMatches.slice(0, 10);
  }

  return allItems
    .filter((item) => {
      const haystack = `${item.label} ${item.keywords ?? ""}`.toLowerCase().replace(/\s+/g, "");
      return isFuzzyMatch(needle, haystack);
    })
    .slice(0, 10);
};

const applyLanguage = (language: AppLanguage): void => {
  const copy = translations[language];
  document.documentElement.lang = language;
  input.placeholder = copy.placeholder;
  arrowsHint.textContent = copy.arrows;
  emptyLabel.textContent = copy.empty;
};

const TAB_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.75 3h10.5a.75.75 0 0 1 .75.75v9.5a.75.75 0 0 1-.75.75H2.75A.75.75 0 0 1 2 13V3.75A.75.75 0 0 1 2.75 2ZM3.5 5v7.25a.25.25 0 0 0 .25.25h8.5a.25.25 0 0 0 .25-.25V5h-9Z"/></svg>`;
const COMMAND_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.72a.75.75 0 0 1 1.06 0l4 4a.75.75 0 0 1 0 1.06l-4 4a.75.75 0 1 1-1.06-1.06L9.44 8.25 6 4.78a.75.75 0 0 1 0-1.06Z"/></svg>`;

const createRow = (item: PaletteItem, selected: boolean): HTMLLIElement => {
  const row = document.createElement("li");
  row.className = `palette-row${selected ? " selected" : ""}`;
  row.dataset.paletteId = item.id;

  const kind = document.createElement("span");
  kind.className = "kind";
  kind.innerHTML = item.kind === "tab" ? TAB_ICON : COMMAND_ICON;

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = item.label;

  row.append(kind, label);

  if (item.hint) {
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = item.hint;
    row.append(hint);
  }

  return row;
};

const reportHeight = (): void => {
  if (reportFrame !== null) {
    window.cancelAnimationFrame(reportFrame);
  }
  reportFrame = window.requestAnimationFrame(() => {
    reportFrame = null;
    const palette = document.getElementById("palette");
    if (!palette) return;
    window.browserApi.reportPaletteHeight(Math.ceil(palette.getBoundingClientRect().height) + 10);
  });
};

const render = (): void => {
  list.replaceChildren();
  if (filteredItems.length === 0) {
    list.append(emptyLabel);
    countLabel.textContent = "";
  } else {
    filteredItems.forEach((item, index) => {
      list.append(createRow(item, index === selectedIndex));
    });
    countLabel.textContent = String(filteredItems.length);
  }
  reportHeight();
};

const refetchItems = async (): Promise<void> => {
  allItems = await window.browserApi.getPaletteItems();
  filteredItems = filterItems(input.value);
  selectedIndex = 0;
  render();
};

const executeSelected = async (): Promise<void> => {
  const item = filteredItems[selectedIndex];
  if (!item) return;
  await window.browserApi.executePaletteCommand(item.id);
  await window.browserApi.hidePaletteWindow();
};

input.addEventListener("input", () => {
  filteredItems = filterItems(input.value);
  selectedIndex = 0;
  render();
});

input.addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (filteredItems.length > 0) {
      selectedIndex = (selectedIndex + 1) % filteredItems.length;
      render();
      list.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
    }
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (filteredItems.length > 0) {
      selectedIndex = (selectedIndex - 1 + filteredItems.length) % filteredItems.length;
      render();
      list.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
    }
    return;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    void executeSelected();
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    void window.browserApi.hidePaletteWindow();
  }
});

list.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement | null)?.closest(".palette-row") as HTMLElement | null;
  if (!target) return;
  const index = filteredItems.findIndex((item) => item.id === target.dataset.paletteId);
  if (index < 0) return;
  selectedIndex = index;
  void executeSelected();
});

window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    void window.browserApi.hidePaletteWindow();
  }
});

window.browserApi.onLanguageChanged(applyLanguage);
window.browserApi.onTabsState(() => {
  void refetchItems();
});

void (async () => {
  applyLanguage(await window.browserApi.getLanguage());
  await refetchItems();
})();
input.focus();
