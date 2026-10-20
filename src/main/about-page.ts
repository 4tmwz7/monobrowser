// Strona monobrowser://about: dane wersji, status aktualizacji, linki, licencje i skróty klawiszowe.
// Czysty moduł (bez Electrona) – HTML składany z danych przekazanych z procesu głównego.

import { LEGACY_ALIAS_CSS } from "./theme.js";
import { UI_BASE_END_CSS, UI_BASE_START_CSS } from "./ui-base-css.js";

export type AboutLanguage = "pl" | "en";

export type UpdateState = "idle" | "checking" | "up-to-date" | "available" | "downloading" | "downloaded" | "error";

export type UpdateStatus = {
  state: UpdateState;
  version: string | null;
  checkedAt: number | null;
  packaged: boolean;
  /** Portable (live USB) build: only notifies about new versions, updates are manual. */
  portable?: boolean;
  /** GitHub release page of the available version (portable notify-only builds: "Open release page"). */
  releaseUrl?: string | null;
};

export type AboutInfo = {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
  portable?: boolean;
};

export const ABOUT_LINKS = {
  github: "https://github.com/4tmwz7/monobrowser",
  site: "https://monobrowser.vercel.app",
} as const;

export const isAllowedAboutLink = (url: unknown): url is string =>
  typeof url === "string" && (Object.values(ABOUT_LINKS) as string[]).includes(url);

export const escapeAboutHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] as string
  ));

const describeUpdateError = (pl: boolean): string =>
  pl ? "Nie udało się sprawdzić aktualizacji." : "Could not check for updates.";

export const describeUpdateStatus = (status: UpdateStatus, language: AboutLanguage, locale: string = language === "pl" ? "pl-PL" : "en-US"): string => {
  const pl = language === "pl";
  const checked = status.checkedAt
    ? ` (${pl ? "sprawdzono" : "checked"} ${new Date(status.checkedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })})`
    : "";
  switch (status.state) {
    case "checking": return pl ? "Sprawdzanie aktualizacji…" : "Checking for updates…";
    case "up-to-date": return `${pl ? "Masz najnowszą wersję." : "You are up to date."}${checked}`;
    case "available":
      if (status.portable) {
        return pl
          ? `Dostępna nowa wersja ${status.version ?? ""}. Zbuduj nową wersję przenośną (npm run dist:win:portable) i podmień plik .exe na pendrive.`
          : `A new version ${status.version ?? ""} is available. Build a new portable version (npm run dist:win:portable) and replace the .exe file on the USB drive.`;
      }
      return status.packaged
        ? (pl ? `Dostępna nowa wersja ${status.version ?? ""}.` : `A new version ${status.version ?? ""} is available.`)
        : (pl ? `Dostępna nowa wersja ${status.version ?? ""} (pobierz ją ze strony projektu).` : `A new version ${status.version ?? ""} is available (get it from the project page).`);
    case "downloading": return pl ? `Pobieranie wersji ${status.version ?? ""}… postęp w oknie Pobieranie.` : `Downloading version ${status.version ?? ""}… progress is in Downloads.`;
    case "downloaded": return pl ? `Wersja ${status.version ?? ""} pobrana – uruchom ponownie, aby zainstalować.` : `Version ${status.version ?? ""} downloaded – restart to install.`;
    case "error": return describeUpdateError(pl);
    default:
      if (status.portable) return pl ? "Wersja przenośna - program tylko powiadamia o nowej wersji (aktualizacja ręczna)." : "Portable build - the app only notifies you about new versions (manual update).";
      return status.packaged
        ? (pl ? "Aktualizacje sprawdzane są automatycznie." : "Updates are checked automatically.")
        : (pl ? "Wersja deweloperska – automatyczne aktualizacje są wyłączone." : "Development build – automatic updates are disabled.");
  }
};

type ShortcutRow = { keys: string; pl: string; en: string };
type ShortcutGroup = { pl: string; en: string; rows: ShortcutRow[] };

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    pl: "Karty", en: "Tabs",
    rows: [
      { keys: "Ctrl+T", pl: "Nowa karta", en: "New tab" },
      { keys: "Ctrl+Shift+N", pl: "Nowa karta prywatna", en: "New private tab" },
      { keys: "Ctrl+W", pl: "Zamknij kartę", en: "Close tab" },
      { keys: "Ctrl+Shift+T", pl: "Przywróć zamkniętą kartę", en: "Reopen closed tab" },
      { keys: "Ctrl+Tab / Ctrl+PgDn", pl: "Następna karta", en: "Next tab" },
      { keys: "Ctrl+Shift+Tab / Ctrl+PgUp", pl: "Poprzednia karta", en: "Previous tab" },
      { keys: "Ctrl+1 … Ctrl+8", pl: "Przejdź do karty o numerze", en: "Go to tab by number" },
      { keys: "Ctrl+9", pl: "Ostatnia karta", en: "Last tab" },
    ],
  },
  {
    pl: "Przestrzenie", en: "Spaces",
    rows: [
      { keys: "Ctrl+Alt+1 … Ctrl+Alt+9", pl: "Przełącz na przestrzeń o numerze", en: "Switch to space by number" },
      { keys: "Ctrl+Alt+PgDn / Ctrl+Alt+PgUp", pl: "Następna / poprzednia przestrzeń", en: "Next / previous space" },
      { keys: "Ctrl+K", pl: "Paleta: „Przełącz na przestrzeń …”", en: "Palette: “Switch to space …”" },
    ],
  },
  {
    pl: "Nawigacja", en: "Navigation",
    rows: [
      { keys: "Ctrl+L", pl: "Pasek adresu", en: "Address bar" },
      { keys: "Ctrl+K", pl: "Paleta komend", en: "Command palette" },
      { keys: "Ctrl+R / F5", pl: "Odśwież stronę", en: "Reload page" },
      { keys: "Alt+← / Alt+→", pl: "Wstecz / Dalej", en: "Back / Forward" },
      { keys: "Ctrl+F", pl: "Szukaj na stronie", en: "Find in page" },
      { keys: "Ctrl+D", pl: "Dodaj stronę do zakładek", en: "Bookmark page" },
      { keys: "Ctrl+Shift+M", pl: "Notatki", en: "Notes" },
      { keys: "Ctrl+Shift+C", pl: "Tryb kompaktowy", en: "Compact mode" },
    ],
  },
  {
    pl: "Strona", en: "Page",
    rows: [
      { keys: "Ctrl++ / Ctrl+− / Ctrl+0", pl: "Powiększ / Pomniejsz / Rozmiar rzeczywisty", en: "Zoom in / out / reset" },
      { keys: "Ctrl + kółko myszy", pl: "Powiększenie strony", en: "Page zoom" },
      { keys: "Ctrl+P", pl: "Drukuj", en: "Print" },
      { keys: "Ctrl+S", pl: "Zapisz stronę", en: "Save page" },
      { keys: "Ctrl+U", pl: "Pokaż źródło strony", en: "View page source" },
      { keys: "F12 / Ctrl+Shift+I", pl: "Narzędzia deweloperskie", en: "Developer tools" },
      { keys: "F11", pl: "Pełny ekran okna", en: "Fullscreen window" },
    ],
  },
];

export type RenderAboutOptions = {
  language: AboutLanguage;
  info: AboutInfo;
  status: UpdateStatus;
  fontDataUrl?: string;
};

export const renderAboutPageHtml = (options: RenderAboutOptions): string => {
  const { language, info, status, fontDataUrl = "" } = options;
  const pl = language === "pl";
  const copy = pl ? {
    title: "MonoBrowser — O programie", heading: "O programie", tagline: "Minimalistyczna przeglądarka w stylu mono.",
    versions: "Wersje", version: "Wersja", electron: "Electron", chromium: "Chromium", node: "Node.js", platform: "System", mode: "Tryb", portableValue: "przenośny (portable)",
    updates: "Aktualizacje", check: "Sprawdź aktualizacje", checking: "Sprawdzanie aktualizacji…", release: "Otwórz stronę wydania",
    links: "Linki", github: "Projekt na GitHubie", site: "Strona internetowa",
    licenses: "Licencje", showLicenses: "Pokaż licencje", hideLicenses: "Ukryj licencje", licensesLoading: "Wczytywanie…",
    licensesFailed: "Nie udało się wczytać pliku licencji.",
    shortcuts: "Skróty klawiszowe", action: "Działanie", keys: "Skrót",
  } : {
    title: "MonoBrowser — About", heading: "About", tagline: "A minimalist monochrome browser.",
    versions: "Versions", version: "Version", electron: "Electron", chromium: "Chromium", node: "Node.js", platform: "System", mode: "Mode", portableValue: "portable (runs from a drive)",
    updates: "Updates", check: "Check for updates", checking: "Checking for updates…", release: "Open release page",
    links: "Links", github: "Project on GitHub", site: "Website",
    licenses: "Licenses", showLicenses: "Show licenses", hideLicenses: "Hide licenses", licensesLoading: "Loading…",
    licensesFailed: "Could not load the license file.",
    shortcuts: "Keyboard shortcuts", action: "Action", keys: "Shortcut",
  };

  const infoRows = [
    [copy.version, info.version],
    [copy.electron, info.electron],
    [copy.chromium, info.chrome],
    [copy.node, info.node],
    [copy.platform, `${info.platform} ${info.arch}`],
    ...(info.portable ? [[copy.mode, copy.portableValue]] : []),
  ].map(([label, value]) => `<div class="row"><span class="label">${escapeAboutHtml(label)}</span><strong>${escapeAboutHtml(value)}</strong></div>`).join("");

  const shortcutsHtml = SHORTCUT_GROUPS.map((group) => `
    <table>
      <caption>${escapeAboutHtml(pl ? group.pl : group.en)}</caption>
      <thead><tr><th scope="col">${copy.keys}</th><th scope="col">${copy.action}</th></tr></thead>
      <tbody>${group.rows.map((row) => `<tr><td>${row.keys.split(" / ").map((combo) => `<kbd>${escapeAboutHtml(combo)}</kbd>`).join(" ")}</td><td>${escapeAboutHtml(pl ? row.pl : row.en)}</td></tr>`).join("")}</tbody>
    </table>`).join("");

  const fontFace = fontDataUrl ? `@font-face { font-family:"Bebas Neue"; src:url("${fontDataUrl}") format("truetype"); font-weight:400; font-display:block; }` : "";
  const clientCopy = JSON.stringify({
    checking: copy.checking, show: copy.showLicenses, hide: copy.hideLicenses, loading: copy.licensesLoading, failed: copy.licensesFailed,
  });

  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; img-src data:">
<title>${copy.title}</title>
<style>
  ${fontFace}
  :root { ${LEGACY_ALIAS_CSS} font-family:ui-monospace,"Cascadia Mono","Courier New",monospace; --mb-body-dim:color-mix(in srgb,var(--black) 82%,var(--white)); }
  ${UI_BASE_START_CSS}
  * { box-sizing:border-box; }
  html, body { margin:0; height:100%; }
  body { display:flex; flex-direction:column; background:var(--white); color:var(--black); overflow:hidden; }
  header { flex:0 0 auto; padding:15px 18px; border-bottom:2px solid var(--black); background:var(--mb-surface,var(--white)); color:var(--black); font-size:13px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
  main { flex:1 1 auto; overflow:auto; padding:18px; display:grid; gap:16px; align-content:start; max-width:1100px; width:100%; margin:0 auto; }
  .card { border:2px solid var(--black); background:var(--white); padding:16px; display:grid; gap:12px; }
  h2 { margin:0; font-size:11px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--mb-body-dim); }
  .brand { margin:0; font-family:"Bebas Neue",Impact,"Arial Narrow",sans-serif; font-size:clamp(56px,10vw,120px); font-weight:400; line-height:.85; letter-spacing:-1px; text-transform:uppercase; }
  .tagline { margin:0; color:var(--grey); font-size:12px; }
  .row { display:flex; justify-content:space-between; gap:12px; padding:6px 0; border-top:1px solid var(--accent); font-size:12px; }
  .row:first-of-type { border-top:0; }
  .label { color:var(--mb-body-dim); text-transform:uppercase; letter-spacing:.08em; font-size:12px; }
  .actions { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
  #update-text { flex:1 1 220px; font-size:12px; }
  button { border:2px solid var(--black); background:var(--black); color:var(--white); border-radius:0; padding:9px 12px; font:inherit; font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; cursor:pointer; }
  button:hover:not(:disabled), button:focus-visible { background:var(--accent); color:var(--mb-on-accent); outline:0; }
  button:disabled { opacity:.45; cursor:not-allowed; }
  a { color:var(--black); font-size:12px; font-weight:700; }
  a:hover, a:focus-visible { background:var(--black); color:var(--white); outline:0; }
  .link-list { display:flex; gap:18px; flex-wrap:wrap; }
  button.secondary, button[aria-expanded="true"] { background:transparent; color:var(--black); }
  button.secondary:hover:not(:disabled), button.secondary:focus-visible, button[aria-expanded="true"]:hover:not(:disabled), button[aria-expanded="true"]:focus-visible { background:var(--mb-surface-2,var(--white)); color:var(--black); box-shadow:inset 0 0 0 1px var(--black); }
  .licenses { max-height:380px; overflow:auto; padding:14px 16px; border:2px solid var(--black); background:var(--mb-surface,var(--white)); color:var(--black); font-size:12px; line-height:1.6; overflow-wrap:anywhere; scrollbar-width:thin; scrollbar-color:var(--mb-muted,var(--grey)) var(--mb-surface-2,var(--white)); }
  .licenses[hidden] { display:none; }
  .licenses > :first-child { margin-top:0; }
  .licenses p { margin:0 0 10px; }
  .licenses .md-h { margin:18px 0 8px; line-height:1.25; letter-spacing:.04em; }
  .licenses h1.md-h { font-size:16px; text-transform:uppercase; letter-spacing:.1em; }
  .licenses h2.md-h { font-size:14px; padding-bottom:4px; border-bottom:2px solid var(--black); text-transform:uppercase; letter-spacing:.08em; }
  .licenses h3.md-h, .licenses h4.md-h { font-size:13px; }
  .licenses ul, .licenses ol { margin:0 0 10px; padding-left:22px; }
  .licenses li { margin:2px 0; }
  .licenses code { padding:1px 5px; background:var(--mb-surface-2,var(--white)); border:1px solid var(--line,var(--black)); font:inherit; font-size:11px; }
  .licenses pre.md-code { margin:0 0 12px; padding:10px 12px; overflow:auto; background:var(--mb-bg,var(--white)); border:1px solid var(--line,var(--black)); font-size:11px; line-height:1.5; white-space:pre; scrollbar-width:thin; scrollbar-color:var(--mb-muted,var(--grey)) var(--mb-surface-2,var(--white)); }
  .licenses pre.md-code code { padding:0; border:0; background:transparent; }
  .licenses blockquote { margin:0 0 10px; padding:4px 12px; border-left:4px solid var(--accent); color:var(--mb-body-dim); }
  .licenses hr { border:0; border-top:2px solid var(--line,var(--black)); margin:14px 0; }
  .licenses a { font-size:inherit; font-weight:700; text-decoration:underline; text-underline-offset:2px; }
  .shortcut-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(460px,1fr)); gap:16px; align-items:start; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  caption { text-align:left; padding:0 0 6px; font-size:11px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; }
  th { text-align:left; padding:6px 8px; background:var(--mb-surface-2,var(--white)); color:var(--black); border-bottom:2px solid var(--black); font-size:11px; letter-spacing:.08em; text-transform:uppercase; }
  td { padding:6px 8px; border-bottom:1px solid var(--accent); vertical-align:top; }
  td:first-child { white-space:nowrap; width:1%; padding-right:18px; }
  kbd { display:inline-block; padding:1px 5px; border:1px solid var(--black); font:inherit; font-size:11px; margin:1px 2px 1px 0; }
  ${UI_BASE_END_CSS}
</style>
</head>
<body>
<header>${copy.heading}</header>
<main>
  <section class="card">
    <h1 class="brand">MonoBrowser</h1>
    <p class="tagline">${copy.tagline}</p>
  </section>
  <section class="card">
    <h2>${copy.versions}</h2>
    ${infoRows}
  </section>
  <section class="card">
    <h2>${copy.updates}</h2>
    <div class="actions">
      <span id="update-text" role="status">${escapeAboutHtml(describeUpdateStatus(status, language))}</span>
      <button type="button" id="update-check"${status.state === "checking" || status.state === "downloading" ? " disabled" : ""}>${copy.check}</button>
      <button type="button" id="update-release"${status.state === "available" && status.releaseUrl ? "" : " hidden"}>${copy.release}</button>
    </div>
  </section>
  <section class="card">
    <h2>${copy.links}</h2>
    <div class="link-list">
      <a href="${ABOUT_LINKS.github}" data-link>${copy.github}</a>
      <a href="${ABOUT_LINKS.site}" data-link>${copy.site}</a>
    </div>
  </section>
  <section class="card">
    <h2>${copy.licenses}</h2>
    <div class="actions"><button type="button" id="licenses-toggle" class="secondary" aria-expanded="false" aria-controls="licenses">${copy.showLicenses}</button></div>
    <div id="licenses" class="licenses" hidden tabindex="0"></div>
  </section>
  <section class="card">
    <h2>${copy.shortcuts}</h2>
    <div class="shortcut-grid">${shortcutsHtml}</div>
  </section>
</main>
<script>
(() => {
  const L = ${clientCopy};
  const text = document.getElementById('update-text');
  const check = document.getElementById('update-check');
  const release = document.getElementById('update-release');
  let releaseUrl = null;
  const apply = (result) => {
    if (!result) return;
    text.textContent = result.text;
    check.disabled = result.status.state === 'checking' || result.status.state === 'downloading';
    releaseUrl = result.status.state === 'available' ? (result.status.releaseUrl || null) : null;
    release.hidden = !releaseUrl;
  };
  release.addEventListener('click', () => { if (releaseUrl) void window.browserApi.openAboutLink(releaseUrl); });
  check.addEventListener('click', async () => {
    check.disabled = true;
    text.textContent = L.checking;
    try { apply(await window.browserApi.checkForUpdates()); } catch { check.disabled = false; }
  });
  window.browserApi.getUpdateStatus().then(apply).catch(() => undefined);
  // Delegated: the license links are created after the page loads.
  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[data-link]') : null;
    if (!link) return;
    event.preventDefault();
    void window.browserApi.openAboutLink(link.href);
  });
  const toggle = document.getElementById('licenses-toggle');
  const box = document.getElementById('licenses');
  let loaded = false;
  toggle.addEventListener('click', async () => {
    if (!box.hidden) { box.hidden = true; toggle.textContent = L.show; toggle.setAttribute('aria-expanded', 'false'); return; }
    box.hidden = false; toggle.textContent = L.hide; toggle.setAttribute('aria-expanded', 'true');
    if (loaded) return;
    box.textContent = L.loading;
    try {
      // The main process renders THIRD-PARTY-NOTICES.md to escaped, tag-whitelisted HTML (markdown-lite.ts).
      const html = await window.browserApi.getLicenses();
      if (html) { box.innerHTML = html; loaded = true; } else { box.textContent = L.failed; }
    } catch { box.textContent = L.failed; }
  });
})();
</script>
</body>
</html>`;
};
