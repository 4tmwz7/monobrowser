import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CONTROL_HEIGHT, TYPE_SCALE, UI_BASE_END_CSS, UI_BASE_START_CSS } from "./ui-base-css.js";

test("type scale is ascending and used by the shared empty state", () => {
  const sizes = Object.values(TYPE_SCALE);
  assert.deepEqual([...sizes].sort((a, b) => a - b), sizes);
  assert.match(UI_BASE_END_CSS, new RegExp(`font-size:${TYPE_SCALE.body}px`));
});

test("shared css has no hard-coded colors and form controls inherit the font", () => {
  assert.doesNotMatch(UI_BASE_START_CSS + UI_BASE_END_CSS, /#[0-9a-fA-F]{3,6}\b/);
  assert.match(UI_BASE_START_CSS, /button,input,select,textarea\) \{ font:inherit/);
});

test("find highlight uses theme accent colors", async () => {
  const { findHighlightCss } = await import("./ui-base-css.js");
  const css = findHighlightCss({ accent: "#907aa9", onAccent: "#ffffff" });
  assert.match(css, /rgba\(144,122,169,0\.45\)/);
  assert.match(css, /find-active\)\{background-color:#907aa9;color:#ffffff/);
});

test("single-line inputs and selects share one height and disabled header actions stay readable", () => {
  assert.match(UI_BASE_END_CSS, new RegExp(`select \\{ height:${CONTROL_HEIGHT}px`));
  assert.match(UI_BASE_END_CSS, /header button:disabled[^{]*\{ opacity:1;/);
});
