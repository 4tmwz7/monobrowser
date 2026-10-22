// One interaction scheme for every internal page, overlay and error page (same as the shell toolbar and popup menus):
//   hover = quiet fill, pressed = stronger fill, selected = distinct fill + frame, keyboard focus = 2px accent outline (:focus-visible only).
// No accent fills and no black/white inversion on hover. Pure module (strings only) so it can be unit-tested.

/** Percentages of the foreground color mixed over the background for each state. */
export const INTERACTION_MIX = { hover: 16, press: 26, selected: 22, solidHover: 82, solidPress: 66 } as const;

/** Custom-property declarations for the states. `fg`/`bg` are CSS color expressions (token vars, with fallbacks where the page has none). */
export const interactionVars = (fg: string, bg: string): string => {
  const mix = (share: number): string => `color-mix(in srgb, ${fg} ${share}%, ${bg})`;
  return `--ctl-hover-bg:${mix(INTERACTION_MIX.hover)};--ctl-press-bg:${mix(INTERACTION_MIX.press)};--ctl-sel-bg:${mix(INTERACTION_MIX.selected)};`
    + `--ctl-solid-hover:${mix(INTERACTION_MIX.solidHover)};--ctl-solid-press:${mix(INTERACTION_MIX.solidPress)};`;
};

/** Declarations for pages that use the --black/--white legacy aliases (settings, history, overlays, ...). */
export const INTERACTION_VARS_CSS = interactionVars("var(--black)", "var(--white)");

/** Declarations for pages that only have the --mb-* tokens (with literal fallbacks): onboarding, error pages. */
export const INTERACTION_VARS_MB_CSS = interactionVars("var(--mb-fg,#0a0a0a)", "var(--mb-bg,#f0efe9)");

/** Selected state of selectable controls (tabs, radio cards, list rows): stronger fill plus a thicker frame in the foreground color. */
export const SELECTED_STATE_CSS = "background:var(--ctl-sel-bg);border-color:var(--black);box-shadow:inset 0 0 0 1px var(--black);";

// Selectors per control kind. Hover/press rules exclude the selected variant so the selected look wins on hover.
const SOLID_BUTTON = "button:not(.secondary):not(.danger):not(.row-danger):not(.tab):not(.theme-btn):not(.find-btn):not(.glance-btn):not(#mb-confirm *)";
const SOLID_BUTTON_OK = "#mb-confirm button[value=\"ok\"]";
const QUIET_BUTTON = "button.secondary, button.danger, #mb-confirm button:not([value=\"ok\"])";
const CARD_REST = ".tab:not(.active), .stats-radio:not(:checked) + .stats-tab, .theme-btn:not(.selected), .engine input:not(:checked) + .engine-body, .runat input:not(:checked) + .runat-body";
const CARD_SELECTED = ".tab.active, .stats-radio:checked + .stats-tab, .theme-btn.selected, .engine input:checked + .engine-body, .runat input:checked + .runat-body";

const each = (selectors: string, suffix: string): string => selectors.split(", ").map((selector) => `${selector}${suffix}`).join(", ");

/** Goes inside UI_BASE_END_CSS (last in the page, after the page's own rules). */
export const INTERACTION_CSS = `
  :root { ${INTERACTION_VARS_CSS} }
  /* Solid (filled) buttons: slightly lighter on hover, lighter again when pressed. */
  ${each(SOLID_BUTTON, ":hover:not(:disabled)")}, ${SOLID_BUTTON_OK}:hover:not(:disabled) { background:var(--ctl-solid-hover); border-color:var(--black); color:var(--white); }
  ${each(SOLID_BUTTON, ":active:not(:disabled)")}, ${SOLID_BUTTON_OK}:active:not(:disabled) { background:var(--ctl-solid-press); }
  /* Quiet (outlined) buttons, tabs, cards and selects: quiet fill on hover, stronger fill when pressed. */
  ${each(QUIET_BUTTON, ":hover:not(:disabled)")}, ${each(CARD_REST, ":hover:not(:disabled)")}, select:hover:not(:disabled) { background:var(--ctl-hover-bg); color:var(--black); }
  ${each(QUIET_BUTTON, ":active:not(:disabled)")}, ${each(CARD_REST, ":active:not(:disabled)")}, select:active:not(:disabled) { background:var(--ctl-press-bg); }
  /* Selected: one look for the current settings tab, stats period, chosen radio card and theme. */
  ${CARD_SELECTED} { ${SELECTED_STATE_CSS} color:var(--black); }
  /* Destructive row action keeps the danger color: tinted fill instead of an inverted one. */
  button.row-danger:hover:not(:disabled) { background:color-mix(in srgb, var(--mb-danger) 16%, var(--white)); border-color:var(--mb-danger); color:var(--mb-danger); }
  button.row-danger:active:not(:disabled) { background:color-mix(in srgb, var(--mb-danger) 28%, var(--white)); }
  /* Keyboard focus: outline only, never a fill change. */
  ${each("button, .tab, .theme-btn", ":focus-visible")} { outline:2px solid var(--accent); outline-offset:2px; }
  .stats-radio:focus-visible + .stats-tab, .engine input:focus-visible + .engine-body, .runat input:focus-visible + .runat-body { outline:2px solid var(--accent); outline-offset:2px; }
`;
