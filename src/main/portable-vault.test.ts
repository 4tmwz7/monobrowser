import assert from "node:assert/strict";
import test from "node:test";
import { deriveVaultKey, inspectVault, openVault, sealVault } from "./portable-vault.js";
import type { PortableCookie } from "./portable-cookies.js";

const cookies: PortableCookie[] = [
  { name: "sid", value: "secret-value", domain: ".example.com", hostOnly: false, path: "/", secure: true, httpOnly: true, sameSite: "lax", expirationDate: 1_900_000_000 },
];
const savedAt = new Date("2026-01-01T00:00:00Z");
// Cheap scrypt parameters keep the tests fast; the format stores them, so reading works the same.
const fast = { N: 1024, r: 8, p: 1 };

test("plain vault round-trips and reports encrypted=false", async () => {
  const text = sealVault(cookies, savedAt, null);
  assert.deepEqual(inspectVault(text), { encrypted: false, savedAt: savedAt.toISOString() });
  const opened = await openVault(text, null);
  assert.ok(opened.ok);
  assert.deepEqual(opened.cookies, cookies);
  assert.equal(opened.encrypted, false);
});

test("encrypted vault hides cookie values and needs the right password", async () => {
  const key = await deriveVaultKey("correct horse", undefined, fast);
  const text = sealVault(cookies, savedAt, key);
  assert.doesNotMatch(text, /secret-value/);
  assert.equal(inspectVault(text)?.encrypted, true);

  assert.deepEqual(await openVault(text, null), { ok: false, reason: "password-required" });
  assert.deepEqual(await openVault(text, "wrong"), { ok: false, reason: "wrong-password" });
  const opened = await openVault(text, "correct horse");
  assert.ok(opened.ok);
  assert.deepEqual(opened.cookies, cookies);
  assert.equal(opened.encrypted, true);
  // The returned key can re-seal without deriving again; each seal uses a fresh IV.
  assert.ok(opened.key);
  const again = sealVault(cookies, savedAt, opened.key);
  assert.notEqual(JSON.parse(again).cipher.iv, JSON.parse(text).cipher.iv);
  assert.ok((await openVault(again, "correct horse")).ok);
});

test("tampered ciphertext fails authentication", async () => {
  const key = await deriveVaultKey("pw", undefined, fast);
  const file = JSON.parse(sealVault(cookies, savedAt, key));
  const data = Buffer.from(file.data, "base64");
  data[0] ^= 0xff;
  file.data = data.toString("base64");
  assert.deepEqual(await openVault(JSON.stringify(file), "pw"), { ok: false, reason: "wrong-password" });
});

test("corrupt or foreign files are rejected, absurd scrypt costs too", async () => {
  assert.equal(inspectVault("{not json"), null);
  assert.equal(inspectVault(JSON.stringify({ type: "other", version: 1 })), null);
  assert.deepEqual(await openVault("garbage", null), { ok: false, reason: "corrupt" });
  const key = await deriveVaultKey("pw", undefined, fast);
  const file = JSON.parse(sealVault(cookies, savedAt, key));
  file.kdf.N = 2 ** 30;
  assert.deepEqual(await openVault(JSON.stringify(file), "pw"), { ok: false, reason: "corrupt" });
});
