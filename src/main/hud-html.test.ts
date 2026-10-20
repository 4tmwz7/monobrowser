import assert from "node:assert/strict";
import test from "node:test";
import { PROGRESS_HUD_HTML, STATUS_HUD_HTML } from "./hud-html.js";

test("HUD pages are self-contained and expose their control functions", () => {
  assert.match(PROGRESS_HUD_HTML, /window\.__start/);
  assert.match(PROGRESS_HUD_HTML, /window\.__done/);
  assert.match(STATUS_HUD_HTML, /window\.__set/);
  for (const html of [PROGRESS_HUD_HTML, STATUS_HUD_HTML]) {
    assert.match(html, /Content-Security-Policy/);
    assert.doesNotMatch(html, /https?:\/\//);
  }
});
