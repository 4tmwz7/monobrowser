// Czyste generatory HTML okienek (popup) przestrzeni: przełącznik, menu, edytor, potwierdzenie usunięcia.
// Akcje to nawigacje monobrowser-menu://<akcja>?... obsługiwane w main.ts. Bez zależności od Electrona.
import {
  WORKSPACE_COLOR_PALETTE, WORKSPACE_COLOR_TOKENS, WORKSPACE_ICONS, MAX_WORKSPACE_NAME_LENGTH,
  workspaceColorCss, workspaceDisplayName, MAIN_WORKSPACE_ID, type Workspace,
} from "./workspaces.js";

export type PopupContext = {
  language: "pl" | "en";
  /** CSS tokenów motywu (themeCss) i wspólne style popupów (POPUP_MENU_STYLES). */
  themeCss: string;
  popupStyles: string;
  /** Script that reports the content height of a `.nav-popup` page (main: POPUP_HEIGHT_REPORT_SCRIPT); optional. */
  heightScript?: string;
};

export type WorkspaceView = Workspace & { count: number };

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const link = (className: string, name: string, params: Record<string, string>, label: string, shortcut = ""): string => {
  const query = new URLSearchParams(params).toString();
  return `<a class="${className}" href="monobrowser-menu://${name}${query ? `?${query}` : ""}">${label}${shortcut ? `<span class="shortcut">${escapeHtml(shortcut)}</span>` : ""}</a>`;
};

const action = (name: string, params: Record<string, string>, label: string, extraClass = "", shortcut = ""): string =>
  link(`menu-item${extraClass ? ` ${extraClass}` : ""}`, name, params, label, shortcut);

const iconBadge = (workspace: Workspace): string => {
  const color = workspaceColorCss(workspace.color);
  return `<span class="ws-badge"${color ? ` style="border-color:${color};box-shadow:inset 0 -3px 0 ${color}"` : ""}>${escapeHtml(workspace.icon)}</span>`;
};

const EXTRA_STYLES = `
  .ws-badge { display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; flex:none; border:2px solid currentColor; font-size:13px; line-height:1; }
  .menu-item .ws-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
  .menu-item.selected { background:var(--accent); color:var(--mb-on-accent); }
  .menu-item.selected .shortcut { color:inherit; opacity:.8; }
  .menu-item.selected::after { content:"✓"; font-weight:700; margin-left:8px; }
  .menu-item.selected::before { content:none; }
  .menu-item.selected .ws-badge { background:transparent; color:inherit; }
  .menu-item.selected:hover { background:var(--accent); color:var(--mb-on-accent); }
  .menu-item.disabled { cursor:default; }
  .ws-form { position:relative; z-index:1; padding:12px; display:grid; gap:12px; }
  .ws-form label { display:grid; gap:5px; font-size:10px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; }
  .ws-form input[type=text] { height:34px; padding:0 9px; border:2px solid var(--black); border-radius:0; background:var(--white); color:var(--black); font:inherit; font-size:12px; }
  .ws-form input[type=text]:focus { outline:0; box-shadow:inset 0 0 0 1px var(--black); }
  .ws-choices { display:flex; flex-wrap:wrap; gap:5px; }
  .ws-choice { min-width:32px; height:32px; padding:0 6px; border:2px solid var(--black); border-radius:0; background:var(--white); color:var(--black); font:inherit; font-size:14px; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; }
  .ws-choice:hover, .ws-choice:focus-visible { outline:0; background:var(--accent); color:var(--on-accent); }
  .ws-choice.sel { background:var(--black); color:var(--white); }
  .ws-swatch { width:32px; padding:0; }
  .ws-swatch i { display:block; width:16px; height:16px; border:1px solid var(--black); }
  .ws-swatch.sel { outline:3px solid var(--accent); outline-offset:1px; background:var(--white); }
  .ws-icon-custom { width:56px !important; text-align:center; }
  .message-text { position:relative; z-index:1; border:2px solid var(--black); padding:12px; font-size:12px; line-height:1.5; overflow-wrap:anywhere; white-space:pre-wrap; }
  .info-action.secondary { background:var(--white); color:var(--black); }
  .info-action.secondary:hover, .info-action.secondary:focus-visible { background:var(--accent); color:var(--on-accent); }
  .info-action.warn { background:var(--danger); color:var(--white); }
`;

const page = (ctx: PopupContext, title: string, bodyHtml: string, navClass = "popup context-popup"): string =>
  `<!doctype html><html lang="${ctx.language}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>${escapeHtml(title)}</title><style id="mb-theme">${ctx.themeCss}</style><style>${ctx.popupStyles}${EXTRA_STYLES}</style></head><body>
<section class="${navClass}" aria-label="${escapeHtml(title)}"><h1 class="popup-title">${escapeHtml(title)}</h1>${bodyHtml}</section>${navClass.includes("nav-popup") ? ctx.heightScript ?? "" : ""}</body></html>`;

const rowHeight = 44;
const SHORTCUT_HINT = "Ctrl+Alt+";

/** Lista przestrzeni (przełącznik w układzie poziomym). */
export const renderWorkspaceSwitcherHtml = (
  ctx: PopupContext,
  workspaces: readonly WorkspaceView[],
  currentId: string,
): { html: string; height: number } => {
  const pl = ctx.language === "pl";
  const title = pl ? "Przestrzenie" : "Spaces";
  const rows = workspaces.map((workspace, index) =>
    action(
      "ws-switch",
      { id: workspace.id },
      `${iconBadge(workspace)}<span class="ws-name">${escapeHtml(workspaceDisplayName(workspace, ctx.language))}</span>`,
      workspace.id === currentId ? "selected" : "",
      index < 9 ? `${SHORTCUT_HINT}${index + 1}` : "",
    ));
  const manage = [
    action("ws-new", {}, `+ ${pl ? "Nowa przestrzeń" : "New space"}`),
    action("ws-edit", { id: currentId }, pl ? "Edytuj bieżącą…" : "Edit current…"),
  ];
  const html = page(ctx, title, `${rows.join("")}<div class="menu-separator"></div>${manage.join("")}`);
  return { html, height: 66 + (rows.length + manage.length) * rowHeight + 7 };
};

/** Menu kontekstowe jednej przestrzeni (prawy klik na ikonie). */
export const renderWorkspaceMenuHtml = (
  ctx: PopupContext,
  workspace: Workspace,
  position: { index: number; total: number },
  orientation: "row" | "column",
): { html: string; height: number } => {
  const pl = ctx.language === "pl";
  const before = orientation === "row" ? (pl ? "Przesuń w lewo" : "Move left") : (pl ? "Przesuń w górę" : "Move up");
  const after = orientation === "row" ? (pl ? "Przesuń w prawo" : "Move right") : (pl ? "Przesuń w dół" : "Move down");
  const groups = [
    [action("ws-edit", { id: workspace.id }, pl ? "Zmień nazwę, ikonę, kolor…" : "Rename, icon, color…")],
    [
      ...(position.index > 0 ? [action("ws-left", { id: workspace.id }, before)] : []),
      ...(position.index < position.total - 1 ? [action("ws-right", { id: workspace.id }, after)] : []),
    ],
    ...(workspace.id !== MAIN_WORKSPACE_ID ? [[action("ws-delete", { id: workspace.id }, pl ? "Usuń przestrzeń…" : "Delete space…")]] : []),
  ].filter((group) => group.length > 0);
  const itemCount = groups.reduce((sum, group) => sum + group.length, 0);
  const html = page(ctx, workspaceDisplayName(workspace, ctx.language), groups.map((group) => group.join("")).join('<div class="menu-separator"></div>'));
  return { html, height: 66 + itemCount * rowHeight + Math.max(0, groups.length - 1) * 7 };
};

/** Edytor: nazwa, ikona (zestaw + własny znak), kolor. Zapis = nawigacja monobrowser-menu://ws-save?... */
export const renderWorkspaceEditorHtml = (ctx: PopupContext, workspace: Workspace): { html: string; height: number } => {
  const pl = ctx.language === "pl";
  const iconButtons = WORKSPACE_ICONS.map((icon) =>
    `<button type="button" class="ws-choice icon-choice${icon === workspace.icon ? " sel" : ""}" data-icon="${escapeHtml(icon)}">${escapeHtml(icon)}</button>`).join("");
  const colorChoice = (value: string, css: string | null, label: string): string =>
    `<button type="button" class="ws-choice ws-swatch color-choice${(workspace.color ?? "") === value ? " sel" : ""}" data-color="${escapeHtml(value)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"><i style="${css ? `background:${css}` : "background:transparent"}"></i></button>`;
  const colors = [
    colorChoice("", null, pl ? "Bez koloru" : "No color"),
    ...WORKSPACE_COLOR_TOKENS.map((token) => colorChoice(token, workspaceColorCss(token), token)),
    ...WORKSPACE_COLOR_PALETTE.map((hex) => colorChoice(hex, hex, hex)),
  ].join("");
  const copy = pl
    ? { name: "Nazwa", icon: "Ikona", custom: "Własny znak (litera, symbol, emoji)", color: "Kolor", save: "Zapisz", cancel: "Anuluj", title: "Edytuj przestrzeń" }
    : { name: "Name", icon: "Icon", custom: "Custom character (letter, symbol, emoji)", color: "Color", save: "Save", cancel: "Cancel", title: "Edit space" };
  const body = `<form class="ws-form" id="ws-form" autocomplete="off">
  <label>${copy.name}<input type="text" id="ws-name" maxlength="${MAX_WORKSPACE_NAME_LENGTH}" value="${escapeHtml(workspace.name)}" placeholder="${escapeHtml(workspaceDisplayName(workspace, ctx.language))}" autofocus></label>
  <label>${copy.icon}<div class="ws-choices" id="ws-icons">${iconButtons}<input type="text" id="ws-icon" class="ws-icon-custom" maxlength="8" value="${escapeHtml(workspace.icon)}" title="${escapeHtml(copy.custom)}" aria-label="${escapeHtml(copy.custom)}"></div></label>
  <label>${copy.color}<div class="ws-choices" id="ws-colors">${colors}</div></label>
  <a class="info-action" href="#" id="ws-save">${copy.save}</a>
  <a class="info-action secondary" href="monobrowser-menu://close">${copy.cancel}</a>
</form>
<script>
(() => {
  const id = ${JSON.stringify(workspace.id)};
  let color = ${JSON.stringify(workspace.color ?? "")};
  const name = document.getElementById('ws-name');
  const icon = document.getElementById('ws-icon');
  const mark = (selector, test) => document.querySelectorAll(selector).forEach((el) => el.classList.toggle('sel', test(el)));
  document.querySelectorAll('.icon-choice').forEach((button) => button.addEventListener('click', () => { icon.value = button.dataset.icon; mark('.icon-choice', (el) => el === button); }));
  icon.addEventListener('input', () => mark('.icon-choice', (el) => el.dataset.icon === icon.value.trim()));
  document.querySelectorAll('.color-choice').forEach((button) => button.addEventListener('click', () => { color = button.dataset.color; mark('.color-choice', (el) => el === button); }));
  const save = () => {
    const params = new URLSearchParams({ id, name: name.value, icon: icon.value, color });
    location.href = 'monobrowser-menu://ws-save?' + params.toString();
  };
  document.getElementById('ws-save').addEventListener('click', (event) => { event.preventDefault(); save(); });
  document.getElementById('ws-form').addEventListener('submit', (event) => { event.preventDefault(); save(); });
  name.focus(); name.select();
})();
</script>`;
  // Sized to its content: the page reports its real height (nav-popup); 466 is only the first guess.
  return { html: page(ctx, copy.title, body, "popup nav-popup context-popup"), height: 66 + 400 };
};

/** Potwierdzenie usunięcia przestrzeni (w oknie, bez natywnego dialogu): przenieś karty do głównej albo zamknij. */
export const renderWorkspaceDeleteHtml = (
  ctx: PopupContext,
  workspace: Workspace,
  tabCount: number,
  mainName: string,
): { html: string; height: number } => {
  const pl = ctx.language === "pl";
  const name = workspaceDisplayName(workspace, ctx.language);
  const title = pl ? "Usunąć przestrzeń?" : "Delete space?";
  const message = tabCount > 0
    ? (pl ? `Przestrzeń „${name}” zawiera kart: ${tabCount}. Co z nimi zrobić?` : `Space “${name}” has ${tabCount} tab(s). What should happen to them?`)
    : (pl ? `Przestrzeń „${name}” jest pusta.` : `Space “${name}” is empty.`);
  const buttons = tabCount > 0
    ? [
        link("info-action", "ws-delete-move", { id: workspace.id }, escapeHtml(pl ? `Przenieś karty do „${mainName}” i usuń` : `Move tabs to “${mainName}” and delete`)),
        link("info-action warn", "ws-delete-close", { id: workspace.id }, escapeHtml(pl ? "Zamknij karty i usuń" : "Close tabs and delete")),
      ]
    : [link("info-action warn", "ws-delete-move", { id: workspace.id }, escapeHtml(pl ? "Usuń" : "Delete"))];
  const body = `<div class="info-body"><div class="message-text">${escapeHtml(message)}</div>${buttons.join("")}<a class="info-action secondary" href="monobrowser-menu://close">${pl ? "Anuluj" : "Cancel"}</a></div>`;
  return { html: page(ctx, title, body, "popup"), height: 50 + 24 + 70 + (buttons.length + 1) * 52 + 20 };
};
