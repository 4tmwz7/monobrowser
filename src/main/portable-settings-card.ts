// "Portable mode" card for monobrowser://settings (rendered only in portable mode). Pure: returns HTML + inline script
// that talks to the main process through window.browserApi.portable*. Reuses the settings page classes
// (.card, .description, .field, .checkbox-row, button.secondary) and --mb-* variables for anything new.

type Language = "pl" | "en";

const COPY = {
  pl: {
    heading: "Tryb przenośny",
    description: "Przeglądarka działa z nośnika (pendrive): wszystkie dane, pamięć podręczna i logi leżą w folderze obok programu.",
    updatesManual: "Aktualizacje: program tylko powiadamia o nowej wersji - zbuduj ją sam (npm run dist:win:portable) i podmień plik .exe (folder danych zostaje nietknięty).",
    updatesAuto: "Aktualizacje instalują się automatycznie (AppImage); folder danych zostaje nietknięty. Status w „O programie”.",
    updateStatus: "Aktualizacje",
    dataPath: "Folder danych",
    vault: "Magazyn sesji (ciasteczka)",
    vaultNone: "jeszcze nie zapisano",
    vaultLocked: "zablokowany (zaszyfrowany) - uruchom ponownie i podaj hasło",
    vaultCorrupt: "plik magazynu jest uszkodzony (kopia: portable-cookies.json.bak)",
    vaultSummary: "{n} ciasteczek, {mode}, zapisano {time}",
    plain: "bez szyfrowania", encrypted: "zaszyfrowane hasłem", restored: "przywrócono przy starcie: {n}",
    encrypt: "Szyfruj sesje na pendrive hasłem",
    warning: "Uwaga: bez szyfrowania każdy, kto ma ten pendrive, ma dostęp do Twoich zalogowanych sesji (Gmail, banki, media społecznościowe). Włącz szyfrowanie albo trzymaj nośnik bezpiecznie.",
    protectedNote: "Sesje są chronione hasłem. Nie zapomnij go - bez hasła nie da się ich odzyskać.",
    password: "Hasło", confirm: "Powtórz hasło", apply: "Włącz szyfrowanie", cancel: "Anuluj",
    disableConfirm: "Wyłączyć szyfrowanie? Sesje będą zapisywane na nośniku bez hasła.",
    downloads: "Pobieraj do folderu \"MonoBrowser Data/Downloads\"",
    downloadsHint: "Domyślnie pobrania trafiają do systemowego folderu Pobrane.",
    sync: "Zapisz sesje teraz", reset: "Usuń zaszyfrowany magazyn",
    resetConfirm: "Usunąć zaszyfrowany magazyn sesji? Zapisanych logowań nie da się odzyskać bez hasła.",
    loadFailed: "Nie udało się wczytać stanu trybu przenośnego.",
  },
  en: {
    heading: "Portable mode",
    description: "The browser runs from a drive (USB stick): all data, cache and logs live in the folder next to the program.",
    updatesManual: "Updates: the app only notifies you about a new version - build it yourself (npm run dist:win:portable) and replace the .exe file (the data folder stays untouched).",
    updatesAuto: "Updates install automatically (AppImage); the data folder stays untouched. Status in About.",
    updateStatus: "Updates",
    dataPath: "Data folder",
    vault: "Session vault (cookies)",
    vaultNone: "not saved yet",
    vaultLocked: "locked (encrypted) - restart and enter the password",
    vaultCorrupt: "the vault file is damaged (copy: portable-cookies.json.bak)",
    vaultSummary: "{n} cookies, {mode}, saved {time}",
    plain: "not encrypted", encrypted: "password protected", restored: "restored at startup: {n}",
    encrypt: "Encrypt sessions on the USB drive with a password",
    warning: "Warning: without encryption anyone who has this USB drive can access your logged-in sessions (email, banking, social media). Turn encryption on or keep the drive safe.",
    protectedNote: "Sessions are password protected. Do not forget it - they cannot be recovered without it.",
    password: "Password", confirm: "Repeat password", apply: "Turn encryption on", cancel: "Cancel",
    disableConfirm: "Turn encryption off? Sessions will be saved to the drive without a password.",
    downloads: "Download into \"MonoBrowser Data/Downloads\"",
    downloadsHint: "By default downloads go to the system Downloads folder.",
    sync: "Save sessions now", reset: "Delete the encrypted vault",
    resetConfirm: "Delete the encrypted session vault? The saved logins cannot be recovered without the password.",
    loadFailed: "Could not load the portable mode state.",
  },
} as const;

export const renderPortableSettingsCard = (language: Language, autoUpdate = false): string => {
  const copy = COPY[language];
  const json = JSON.stringify(copy).replace(/</g, "\\u003c");
  const e = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  return `<section class="card" id="portable-card">
<style>
  #portable-card .pt-row { display:grid; gap:4px; margin-bottom:13px; }
  #portable-card .pt-row > label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; }
  #portable-card .pt-path { overflow-wrap:anywhere; font-size:11px; }
  #portable-card .pt-warn { margin:0 0 13px; padding:9px 11px; border:2px solid var(--mb-danger,#8b2931); color:var(--mb-fg,#0a0a0a); font-size:11px; line-height:1.5; }
  #portable-card .pt-warn.ok { border-color:var(--mb-border,#0a0a0a); }
  #portable-card .pt-pw { display:grid; gap:8px; max-width:320px; margin:0 0 13px; }
  #portable-card .pt-pw[hidden], #portable-card [hidden] { display:none; }
  #portable-card .pt-pw input { width:100%; padding:10px; border:2px solid var(--mb-border,#0a0a0a); border-radius:0; outline:0; background:var(--mb-surface,#f0efe9); color:var(--mb-fg,#0a0a0a); font:11px ui-monospace,"Cascadia Mono","Courier New",monospace; }
  #portable-card .pt-actions { display:flex; gap:9px; flex-wrap:wrap; align-items:center; }
  #pt-message { min-height:18px; font-size:11px; color:var(--mb-fg,#0a0a0a); } #pt-message.error { color:var(--mb-danger,#8b2931); }
</style>
<h2>${e(copy.heading)}</h2><p class="description">${e(copy.description)} ${e(autoUpdate ? copy.updatesAuto : copy.updatesManual)}</p>
<div class="pt-row"><label>${e(copy.dataPath)}</label><code id="pt-path" class="pt-path"></code></div>
<div class="pt-row"><label>${e(copy.updateStatus)}</label><span id="pt-update" class="hint" role="status"></span></div>
<div class="pt-row"><label>${e(copy.vault)}</label><span id="pt-vault" class="hint"></span></div>
<div class="field"><label class="checkbox-row" for="pt-enc"><input id="pt-enc" type="checkbox">${e(copy.encrypt)}</label></div>
<div id="pt-pw" class="pt-pw" hidden>
  <input id="pt-pw1" type="password" autocomplete="new-password" spellcheck="false" placeholder="${e(copy.password)}" aria-label="${e(copy.password)}">
  <input id="pt-pw2" type="password" autocomplete="new-password" spellcheck="false" placeholder="${e(copy.confirm)}" aria-label="${e(copy.confirm)}">
  <div class="pt-actions"><button type="button" id="pt-apply" class="secondary">${e(copy.apply)}</button><button type="button" id="pt-cancel" class="secondary">${e(copy.cancel)}</button></div>
</div>
<p id="pt-warn" class="pt-warn" role="note"></p>
<div class="field"><label class="checkbox-row" for="pt-dl"><input id="pt-dl" type="checkbox">${e(copy.downloads)}</label><span class="hint">${e(copy.downloadsHint)}</span></div>
<div class="pt-actions"><button type="button" id="pt-sync" class="secondary">${e(copy.sync)}</button><button type="button" id="pt-reset" class="secondary" hidden>${e(copy.reset)}</button><span id="pt-message" role="status"></span></div>
<script>
(() => {
  const L = ${json};
  const $ = (id) => document.getElementById(id);
  const api = window.browserApi;
  const enc = $('pt-enc'), pwBox = $('pt-pw'), pw1 = $('pt-pw1'), pw2 = $('pt-pw2'), msg = $('pt-message');
  const say = (text, ok = true) => { msg.textContent = text || ''; msg.className = ok ? '' : 'error'; };
  const confirmAsk = (text) => window.mbConfirm ? window.mbConfirm(text) : Promise.resolve(true);
  const render = (state) => {
    if (!state) return;
    const v = state.vault;
    $('pt-path').textContent = state.dataDir;
    let vault;
    if (v.locked) vault = L.vaultLocked;
    else if (v.error === 'corrupt') vault = L.vaultCorrupt;
    else if (!v.exists) vault = L.vaultNone;
    else {
      const when = v.savedAt ? new Date(v.savedAt).toLocaleString() : '-';
      vault = L.vaultSummary.replace('{n}', String(v.cookieCount)).replace('{mode}', v.encrypted ? L.encrypted : L.plain).replace('{time}', when);
      if (v.restored) vault += ' (' + L.restored.replace('{n}', String(v.restored)) + ')';
    }
    $('pt-vault').textContent = vault;
    enc.checked = v.encrypted; enc.disabled = v.locked; pwBox.hidden = true;
    const warn = $('pt-warn');
    warn.textContent = v.encrypted ? L.protectedNote : L.warning;
    warn.classList.toggle('ok', v.encrypted);
    $('pt-dl').checked = state.downloadsInDataFolder;
    $('pt-reset').hidden = !v.locked;
    $('pt-sync').disabled = v.locked;
  };
  const run = async (call) => {
    try { const result = await call(); say(result.message, result.ok); render(result.state); return result; }
    catch { say(L.loadFailed, false); return null; }
  };
  enc.addEventListener('change', async () => {
    if (enc.checked) { pwBox.hidden = false; pw1.value = ''; pw2.value = ''; pw1.focus(); return; }
    if (!await confirmAsk(L.disableConfirm)) { enc.checked = true; return; }
    await run(() => api.setPortableEncryption({ enabled: false }));
  });
  $('pt-apply').addEventListener('click', async () => {
    const result = await run(() => api.setPortableEncryption({ enabled: true, password: pw1.value, confirm: pw2.value }));
    if (result && !result.ok) { pwBox.hidden = false; enc.checked = true; }
    pw1.value = ''; pw2.value = '';
  });
  $('pt-cancel').addEventListener('click', () => { pwBox.hidden = true; pw1.value = ''; pw2.value = ''; enc.checked = false; say(''); });
  $('pt-dl').addEventListener('change', () => run(() => api.setPortableDownloads($('pt-dl').checked)));
  $('pt-sync').addEventListener('click', () => run(() => api.syncPortableVault()));
  $('pt-reset').addEventListener('click', async () => { if (await confirmAsk(L.resetConfirm)) await run(() => api.resetPortableVault()); });
  api.getUpdateStatus().then((r) => { if (r) $('pt-update').textContent = r.text; }).catch(() => undefined);
  api.getPortableState().then(render).catch(() => say(L.loadFailed, false));
})();
</script>
</section>`;
};
