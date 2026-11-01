// Strona monobrowser://extensions: lista rozszerzeń Chrome (włącz/wyłącz, usuń, opcje, tryb prywatny),
// instalacja ze sklepu Chrome Web Store i wczytywanie z folderu. Czysty moduł (bez Electrona) – HTML składany
// z tekstów; dane rozszerzeń (niezaufane nazwy/opisy) trafiają do strony wyłącznie przez textContent.

import { LEGACY_ALIAS_CSS } from "./theme.js";
import { UI_BASE_END_CSS, UI_BASE_START_CSS } from "./ui-base-css.js";

export type ExtensionsPageLanguage = "pl" | "en";

export type RenderExtensionsPageOptions = {
  language: ExtensionsPageLanguage;
  fontDataUrl?: string;
};

export const extensionsPageCopy = (language: ExtensionsPageLanguage) => language === "pl" ? {
  title: "MonoBrowser — Rozszerzenia", heading: "Rozszerzenia",
  storeHeading: "Dodaj rozszerzenia",
  storeText: "Otwórz Chrome Web Store i kliknij „Dodaj do Chrome”. Programiści mogą wczytać rozpakowane rozszerzenie z folderu.",
  openStore: "Chrome Web Store", loadUnpacked: "Wczytaj rozpakowane…", openFolder: "Otwórz folder rozszerzeń",
  installed: "Zainstalowane", empty: "Brak zainstalowanych rozszerzeń.",
  enabled: "Włączone", disabled: "Wyłączone", enable: "Włącz", disable: "Wyłącz", remove: "Usuń", options: "Opcje",
  allowPrivate: "Zezwól w trybie prywatnym",
  version: "Wersja",
  sourceStore: "Chrome Web Store", sourceUnpacked: "Rozpakowane (folder rozszerzeń)", sourceExternal: "Rozpakowane (własny folder)",
  blockerBadge: "Bloker treści",
  pausedNote: "Wbudowany bloker reklam jest wstrzymany, ponieważ zainstalowano rozszerzenie: {name}. Wróci po jego wyłączeniu lub usunięciu.",
  restartNote: "Zezwolenie w trybie prywatnym zadziała po ponownym uruchomieniu przeglądarki.",
  privateNote: "Rozszerzenia są domyślnie wyłączone w kartach prywatnych. Gdy zezwolisz któremuś, dane kart prywatnych są trzymane w tymczasowym profilu, który jest czyszczony po zamknięciu kart prywatnych i przy starcie.",
  loading: "Wczytywanie…", loadFailed: "Nie udało się wczytać listy rozszerzeń.", folderLabel: "Folder",
  manifestV: "Manifest V",
  unsupportedWarn: "Ograniczona zgodność: nie jest obsługiwane: {list}. Część funkcji tego rozszerzenia może nie działać.",
  blockerActive: "Ten bloker zastępuje wbudowany bloker reklam.",
  blockerIdle: "Ten bloker jeszcze nie działa (nie uruchomił się) – wbudowany bloker reklam pozostaje aktywny.",
} : {
  title: "MonoBrowser — Extensions", heading: "Extensions",
  storeHeading: "Add extensions",
  storeText: "Open the Chrome Web Store and click “Add to Chrome”. Developers can load an unpacked extension from a folder.",
  openStore: "Chrome Web Store", loadUnpacked: "Load unpacked…", openFolder: "Open extensions folder",
  installed: "Installed", empty: "No extensions installed.",
  enabled: "Enabled", disabled: "Disabled", enable: "Enable", disable: "Disable", remove: "Remove", options: "Options",
  allowPrivate: "Allow in private mode",
  version: "Version",
  sourceStore: "Chrome Web Store", sourceUnpacked: "Unpacked (extensions folder)", sourceExternal: "Unpacked (custom folder)",
  blockerBadge: "Content blocker",
  pausedNote: "The built-in ad blocker is paused because an extension is installed: {name}. It comes back when that extension is disabled or removed.",
  restartNote: "Allowing an extension in private mode takes effect after you restart the browser.",
  privateNote: "Extensions are off in private tabs by default. If you allow one, private-tab data is kept in a temporary profile that is wiped when the private tabs are closed and at startup.",
  loading: "Loading…", loadFailed: "Could not load the extension list.", folderLabel: "Folder",
  manifestV: "Manifest V",
  unsupportedWarn: "Limited compatibility: not supported: {list}. Some features of this extension may not work.",
  blockerActive: "This blocker replaces the built-in ad blocker.",
  blockerIdle: "This blocker is not working yet (it has not started) - the built-in ad blocker stays active.",
};

export const renderExtensionsPageHtml = (options: RenderExtensionsPageOptions): string => {
  const { language, fontDataUrl = "" } = options;
  const copy = extensionsPageCopy(language);
  const fontFace = fontDataUrl ? `@font-face { font-family:"Bebas Neue"; src:url("${fontDataUrl}") format("truetype"); font-weight:400; font-display:block; }` : "";
  const clientCopy = JSON.stringify(copy).replace(/</g, "\\u003c");

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
  p { margin:0; font-size:12px; line-height:1.5; }
  .hint { font-size:12px; color:var(--grey); line-height:1.5; }
  .actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  button { border:2px solid var(--black); background:var(--black); color:var(--white); border-radius:0; padding:9px 12px; font:inherit; font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; cursor:pointer; }
  button:disabled { opacity:.45; cursor:not-allowed; }
  button.secondary { background:transparent; color:var(--black); }
  button.secondary:hover:not(:disabled) { background:var(--ctl-hover-bg); }
  button.danger { background:transparent; color:var(--black); }
  .notice { border:2px solid var(--black); border-left-width:8px; padding:10px 12px; font-size:12px; line-height:1.5; background:var(--mb-surface,var(--white)); }
  .notice[hidden], #message:empty { display:none; }
  #message { font-size:12px; }
  #message.error { font-weight:700; }
  .ext { display:grid; grid-template-columns:44px 1fr; gap:6px 14px; border:2px solid var(--black); padding:14px; background:var(--white); }
  .ext.off { border-style:dashed; }
  .ext.off .ext-icon, .ext.off .ext-name { opacity:.55; }
  .ext-icon { width:44px; height:44px; border:1px solid var(--black); display:flex; align-items:center; justify-content:center; background:var(--mb-surface,var(--white)); font-size:18px; font-weight:700; text-transform:uppercase; overflow:hidden; }
  .ext-icon img { width:100%; height:100%; object-fit:contain; display:block; }
  .ext-body { display:grid; gap:6px; min-width:0; }
  .ext-title { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
  .ext-name { font-size:15px; font-weight:700; overflow-wrap:anywhere; }
  .ext-version { font-size:11px; color:var(--grey); }
  .badge { display:inline-block; border:1px solid var(--black); padding:1px 6px; font-size:10px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }
  .ext-desc { font-size:12px; line-height:1.5; color:var(--mb-body-dim); overflow-wrap:anywhere; }
  .ext-meta { font-size:11px; color:var(--grey); overflow-wrap:anywhere; }
  .ext-warn { font-size:12px; line-height:1.5; border-left:4px solid var(--black); padding-left:8px; overflow-wrap:anywhere; }
  .ext-error { font-size:12px; font-weight:700; overflow-wrap:anywhere; }
  .ext-actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:4px; }
  .check { display:inline-flex; align-items:center; gap:8px; font-size:12px; cursor:pointer; }
  .check input { width:16px; height:16px; accent-color:var(--black); margin:0; }
  .spacer { flex:1 1 auto; }
  ${UI_BASE_END_CSS}
</style>
</head>
<body>
<header>${copy.heading}</header>
<main>
  <section class="card">
    <h2>${copy.storeHeading}</h2>
    <p>${copy.storeText}</p>
    <div class="actions">
      <button type="button" id="open-store">${copy.openStore}</button>
      <button type="button" id="load-unpacked" class="secondary">${copy.loadUnpacked}</button>
      <button type="button" id="open-folder" class="secondary">${copy.openFolder}</button>
      <span id="message" role="status"></span>
    </div>
  </section>
  <div id="paused-note" class="notice" hidden></div>
  <div id="restart-note" class="notice" hidden>${copy.restartNote}</div>
  <section class="card">
    <h2>${copy.installed} <span id="count"></span></h2>
    <div id="list" style="display:grid;gap:12px"><p class="hint">${copy.loading}</p></div>
    <p class="hint">${copy.privateNote}</p>
  </section>
</main>
<script>
(() => {
  const L = ${clientCopy};
  const api = window.browserApi;
  const list = document.getElementById('list');
  const message = document.getElementById('message');
  const pausedNote = document.getElementById('paused-note');
  const restartNote = document.getElementById('restart-note');
  const count = document.getElementById('count');
  let busy = false;
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const say = (text, isError) => { message.textContent = text || ''; message.className = isError ? 'error' : ''; };
  const button = (label, handler, className) => { const el = make('button', className || 'secondary', label); el.type = 'button'; el.addEventListener('click', handler); return el; };
  const sourceLabel = (source) => source === 'store' ? L.sourceStore : source === 'external' ? L.sourceExternal : L.sourceUnpacked;

  const run = async (task) => {
    if (busy) return;
    busy = true; list.setAttribute('aria-busy', 'true');
    try { render(await task()); } catch { say(L.loadFailed, true); } finally { busy = false; list.removeAttribute('aria-busy'); }
  };

  const renderItem = (item) => {
    const row = make('article', 'ext' + (item.enabled ? '' : ' off'));
    const icon = make('div', 'ext-icon');
    if (item.iconDataUrl) { const img = document.createElement('img'); img.alt = ''; img.src = item.iconDataUrl; icon.appendChild(img); }
    else icon.textContent = (item.name || '?').charAt(0);
    const body = make('div', 'ext-body');
    const title = make('div', 'ext-title');
    title.appendChild(make('span', 'ext-name', item.name));
    if (item.version) title.appendChild(make('span', 'ext-version', L.version + ' ' + item.version));
    title.appendChild(make('span', 'badge', item.enabled ? L.enabled : L.disabled));
    if (item.contentBlocker) title.appendChild(make('span', 'badge', L.blockerBadge));
    body.appendChild(title);
    if (item.description) body.appendChild(make('div', 'ext-desc', item.description));
    const meta = [sourceLabel(item.source)];
    if (item.manifestVersion) meta.push(L.manifestV + item.manifestVersion);
    if (item.id) meta.push('ID ' + item.id);
    body.appendChild(make('div', 'ext-meta', meta.join(' · ')));
    body.appendChild(make('div', 'ext-meta', L.folderLabel + ': ' + item.path));
    if (item.error) body.appendChild(make('div', 'ext-error', item.error));
    if (item.unsupported && item.unsupported.length) body.appendChild(make('div', 'ext-warn', L.unsupportedWarn.replace('{list}', item.unsupported.join(', '))));
    if (item.contentBlocker && item.enabled) body.appendChild(make('div', 'ext-warn', item.blockerWorking ? L.blockerActive : L.blockerIdle));
    const actions = make('div', 'ext-actions');
    actions.appendChild(button(item.enabled ? L.disable : L.enable, () => run(() => api.setExtensionEnabled(item.key, !item.enabled)), item.enabled ? 'secondary' : 'primary'));
    if (item.hasOptions && item.enabled) actions.appendChild(button(L.options, () => { void api.openExtensionOptions(item.key); }));
    const label = make('label', 'check');
    const box = document.createElement('input'); box.type = 'checkbox'; box.checked = item.allowedInPrivate;
    box.addEventListener('change', () => run(() => api.setExtensionPrivate(item.key, box.checked)));
    label.append(box, document.createTextNode(L.allowPrivate));
    actions.appendChild(label);
    actions.appendChild(make('span', 'spacer'));
    actions.appendChild(button(L.remove, () => run(() => api.removeExtension(item.key)), 'danger'));
    body.appendChild(actions);
    row.append(icon, body);
    return row;
  };

  const render = (snapshot) => {
    list.replaceChildren();
    count.textContent = snapshot.items.length ? '(' + snapshot.items.length + ')' : '';
    if (!snapshot.items.length) list.appendChild(make('p', 'hint', L.empty));
    for (const item of snapshot.items) list.appendChild(renderItem(item));
    pausedNote.hidden = !snapshot.pausedBlocker;
    pausedNote.textContent = snapshot.pausedBlocker ? L.pausedNote.replace('{name}', snapshot.pausedBlocker) : '';
    restartNote.hidden = !snapshot.privateRestartNeeded;
  };

  const refresh = () => { if (!busy) void api.getExtensions().then(render).catch(() => say(L.loadFailed, true)); };
  document.getElementById('open-store').addEventListener('click', () => { void api.openExtensionStore(); });
  document.getElementById('open-folder').addEventListener('click', () => { void api.openExtensionsFolder(); });
  document.getElementById('load-unpacked').addEventListener('click', async () => {
    say('');
    if (busy) return;
    busy = true;
    try { const result = await api.loadUnpackedExtension(); render(result.snapshot); say(result.message || '', Boolean(result.message)); }
    catch { say(L.loadFailed, true); } finally { busy = false; }
  });
  // The list also changes without this page: installs/uninstalls from the Web Store, updates, popups.
  let refreshTimer = null;
  api.onExtensionsChanged(() => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 150); });
  refresh();
})();
</script>
</body>
</html>`;
};
