import assert from "node:assert/strict";
import test from "node:test";
import { spellcheckLanguagesFor } from "./spellcheck-utils.js";

test("spellcheckLanguagesFor maps the app language and respects availability", () => {
  assert.deepEqual(spellcheckLanguagesFor("pl", ["pl", "en-US"]), ["pl"]);
  assert.deepEqual(spellcheckLanguagesFor("en", ["pl", "en-US"]), ["en-US"]);
  assert.deepEqual(spellcheckLanguagesFor("pl", ["de"]), []);
});
