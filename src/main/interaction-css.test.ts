import { strict as assert } from "node:assert";
import { test } from "node:test";
import { INTERACTION_CSS, INTERACTION_MIX, INTERACTION_VARS_CSS, INTERACTION_VARS_MB_CSS, interactionVars, SELECTED_STATE_CSS } from "./interaction-css.js";
import { UI_BASE_END_CSS } from "./ui-base-css.js";

test("state variables mix the foreground over the background with the shared percentages", () => {
  const css = interactionVars("FG", "BG");
  assert.match(css, new RegExp(`--ctl-hover-bg:color-mix\\(in srgb, FG ${INTERACTION_MIX.hover}%, BG\\)`));
  assert.match(css, new RegExp(`--ctl-press-bg:color-mix\\(in srgb, FG ${INTERACTION_MIX.press}%, BG\\)`));
  assert.ok(INTERACTION_MIX.hover < INTERACTION_MIX.press);
  assert.ok(INTERACTION_MIX.hover < INTERACTION_MIX.selected);
  assert.ok(INTERACTION_MIX.solidPress < INTERACTION_MIX.solidHover);
});

test("token-based and --mb-based variable sets define the same properties", () => {
  const names = (css: string): string[] => [...css.matchAll(/(--ctl-[a-z-]+):/g)].map((m) => m[1]);
  assert.deepEqual(names(INTERACTION_VARS_CSS), names(INTERACTION_VARS_MB_CSS));
  assert.match(INTERACTION_VARS_MB_CSS, /var\(--mb-fg,#0a0a0a\)/);
});

test("shared rules never use accent fills or hard inversion for hover/selected", () => {
  assert.doesNotMatch(INTERACTION_CSS, /hover[^{]*\{[^}]*background:var\(--accent\)/);
  assert.doesNotMatch(INTERACTION_CSS, /background:var\(--black\);[^}]*color:var\(--white\)/);
  assert.match(SELECTED_STATE_CSS, /--ctl-sel-bg/);
  assert.match(INTERACTION_CSS, /:focus-visible \{ outline:2px solid var\(--accent\)/);
});

test("interaction rules are part of the shared base css", () => {
  assert.ok(UI_BASE_END_CSS.includes(INTERACTION_CSS));
});
