type AppLanguage = "pl" | "en";

type NotesApi = {
  showNotesWindow: () => Promise<boolean>;
  hideNotesWindow: () => Promise<boolean>;
  toggleNotesWindow: () => Promise<boolean>;
  getNotes: () => Promise<string>;
  saveNotes: (value: string) => Promise<boolean>;
  getLanguage: () => Promise<AppLanguage>;
  onLanguageChanged: (callback: (language: AppLanguage) => void) => () => void;
};

declare global {
  interface Window {
    browserApi: NotesApi;
  }
}

const translations = {
  pl: {
    title: "Notatki",
    toggle: "Podgląd",
    toggleBack: "Edycja",
    statusSaved: "Zapisano",
    statusSaving: "Zapisywanie…",
    statusEmpty: "Tekstowy notatnik (Markdown)",
  },
  en: {
    title: "Notes",
    toggle: "Preview",
    toggleBack: "Edit",
    statusSaved: "Saved",
    statusSaving: "Saving…",
    statusEmpty: "Plain-text notepad (Markdown)",
  },
} as const;

// ── Minimal Markdown renderer ───────────────────────────────────────────────
// Escapes all HTML first, then applies a tiny subset of Markdown:
// headings, bold, italic, inline code, links, lists, blockquotes and rules.
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const renderInlineMarkdown = (raw: string): string => {
  let text = escapeHtml(raw);
  text = text.replace(/`([^`]+)`/g, (_match, code: string) => `<code>${code}</code>`);
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  text = text.replace(/(^|[\s(])_([^_\s][^_]*)_/g, "$1<em>$2</em>");
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_match, label: string, url: string) =>
    `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  return text;
};

const renderMarkdown = (source: string): string => {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let listItems: { ordered: boolean; items: string[] } | null = null;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
      paragraph = [];
    }
  };

  const flushList = (): void => {
    if (listItems) {
      const tag = listItems.ordered ? "ol" : "ul";
      blocks.push(`<${tag}>${listItems.items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</${tag}>`);
      listItems = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (/^(---+|\*\*\*+)$/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push("<hr>");
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`);
      continue;
    }

    const unordered = trimmed.match(/^[-*+]\s+(.*)$/);
    const ordered = trimmed.match(/^\d+[.)]\s+(.*)$/);
    if (unordered || ordered) {
      flushParagraph();
      const orderedList = Boolean(ordered);
      if (!listItems || listItems.ordered !== orderedList) {
        flushList();
        listItems = { ordered: orderedList, items: [] };
      }
      listItems.items.push((unordered ?? ordered)![1]);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return blocks.join("\n");
};

const titleElement = document.getElementById("notes-title") as HTMLElement;
const toggleButton = document.getElementById("notes-toggle") as HTMLButtonElement;
const editor = document.getElementById("notes-editor") as HTMLTextAreaElement;
const preview = document.getElementById("notes-preview") as HTMLDivElement;
const statusLabel = document.getElementById("notes-status") as HTMLDivElement;

let language: AppLanguage = "pl";
let previewMode = false;
let saveTimer: number | null = null;
let dirty = false;

const applyLanguage = (next: AppLanguage): void => {
  language = next;
  const copy = translations[next];
  document.documentElement.lang = next;
  titleElement.textContent = copy.title;
  toggleButton.textContent = previewMode ? copy.toggleBack : copy.toggle;
  if (!dirty) {
    statusLabel.textContent = copy.statusEmpty;
  }
};

const setStatusSaved = (): void => {
  statusLabel.textContent = translations[language].statusSaved;
  dirty = false;
};

const scheduleSave = (): void => {
  dirty = true;
  statusLabel.textContent = translations[language].statusSaving;
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
  }
  saveTimer = window.setTimeout(async () => {
    saveTimer = null;
    await window.browserApi.saveNotes(editor.value);
    setStatusSaved();
  }, 500);
};

const renderPreview = (): void => {
  preview.innerHTML = renderMarkdown(editor.value);
};

const setPreviewMode = (enabled: boolean): void => {
  previewMode = enabled;
  editor.hidden = enabled;
  preview.hidden = !enabled;
  toggleButton.textContent = translations[language][enabled ? "toggleBack" : "toggle"];
  toggleButton.classList.toggle("active", enabled);
  if (enabled) {
    preview.innerHTML = renderMarkdown(editor.value);
    preview.scrollTop = 0;
  }
};

toggleButton.addEventListener("click", () => setPreviewMode(!previewMode));

editor.addEventListener("input", () => {
  scheduleSave();
  if (previewMode) {
    preview.innerHTML = renderMarkdown(editor.value);
  }
});

editor.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    void window.browserApi.hideNotesWindow();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.activeElement !== editor) {
    event.preventDefault();
    void window.browserApi.hideNotesWindow();
  }
});

window.browserApi.onLanguageChanged(applyLanguage);

void (async () => {
  const [value, initialLanguage] = await Promise.all([
    window.browserApi.getNotes(),
    window.browserApi.getLanguage(),
  ]);
  applyLanguage(initialLanguage);
  editor.value = value;
  statusLabel.textContent = translations[language].statusEmpty;
})();
editor.focus();
