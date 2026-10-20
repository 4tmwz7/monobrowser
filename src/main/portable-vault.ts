// Portable cookie vault file format with optional password protection (scrypt -> AES-256-GCM).
import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { parseCookieList, type PortableCookie } from "./portable-cookies.js";

const VAULT_APP = "MonoBrowser";
const VAULT_TYPE = "cookie-vault";
const VAULT_VERSION = 1;
const AAD = Buffer.from("MonoBrowser cookie vault v1");

export type ScryptParams = { N: number; r: number; p: number };
export const DEFAULT_SCRYPT: ScryptParams = { N: 32768, r: 8, p: 1 };
const MAX_SCRYPT_N = 1 << 20;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;

export type VaultKey = { key: Buffer; salt: Buffer; params: ScryptParams };

const scryptAsync = (password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEY_BYTES,
      { N: params.N, r: params.r, p: params.p, maxmem: 256 * 1024 * 1024 },
      (error, derived) => (error ? reject(error) : resolve(derived)),
    );
  });

export const deriveVaultKey = async (
  password: string,
  salt: Buffer = randomBytes(SALT_BYTES),
  params: ScryptParams = DEFAULT_SCRYPT,
): Promise<VaultKey> => ({ key: await scryptAsync(password, salt, params), salt, params });

/** Serializes cookies; with a key the cookie list is encrypted (fresh random IV on every call). */
export const sealVault = (cookies: readonly PortableCookie[], savedAt: Date, key: VaultKey | null): string => {
  const base = { app: VAULT_APP, type: VAULT_TYPE, version: VAULT_VERSION, savedAt: savedAt.toISOString() };
  if (!key) return JSON.stringify({ ...base, encrypted: false, cookies }, null, 2);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key.key, iv);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(JSON.stringify({ cookies }), "utf8"), cipher.final()]);
  return JSON.stringify({
    ...base,
    encrypted: true,
    kdf: { name: "scrypt", ...key.params, salt: key.salt.toString("base64") },
    cipher: { name: "aes-256-gcm", iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") },
    data: data.toString("base64"),
  }, null, 2);
};

type VaultFile = Record<string, any>;

const parseVaultFile = (text: string): VaultFile | null => {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const file = parsed as VaultFile;
    if (file.type !== VAULT_TYPE || file.version !== VAULT_VERSION) return null;
    return file;
  } catch {
    return null;
  }
};

/** Cheap look at a vault file without decrypting it; null when it is not a valid vault. */
export const inspectVault = (text: string): { encrypted: boolean; savedAt: string | null } | null => {
  const file = parseVaultFile(text);
  if (!file) return null;
  return { encrypted: file.encrypted === true, savedAt: typeof file.savedAt === "string" ? file.savedAt : null };
};

export type OpenVaultResult =
  | { ok: true; cookies: PortableCookie[]; encrypted: boolean; key: VaultKey | null; savedAt: string | null }
  | { ok: false; reason: "corrupt" | "password-required" | "wrong-password" };

export const openVault = async (text: string, password: string | null): Promise<OpenVaultResult> => {
  const file = parseVaultFile(text);
  if (!file) return { ok: false, reason: "corrupt" };
  const savedAt = typeof file.savedAt === "string" ? file.savedAt : null;

  if (file.encrypted !== true) {
    return { ok: true, cookies: parseCookieList(file.cookies), encrypted: false, key: null, savedAt };
  }
  if (password === null || password === "") return { ok: false, reason: "password-required" };

  try {
    const kdf = file.kdf;
    const params: ScryptParams = { N: Number(kdf?.N), r: Number(kdf?.r), p: Number(kdf?.p) };
    const valid = (n: number, max: number) => Number.isInteger(n) && n >= 1 && n <= max;
    if (kdf?.name !== "scrypt" || !valid(params.N, MAX_SCRYPT_N) || (params.N & (params.N - 1)) !== 0
      || !valid(params.r, 32) || !valid(params.p, 16) || file.cipher?.name !== "aes-256-gcm") {
      return { ok: false, reason: "corrupt" };
    }
    const salt = Buffer.from(String(kdf.salt), "base64");
    const iv = Buffer.from(String(file.cipher.iv), "base64");
    const tag = Buffer.from(String(file.cipher.tag), "base64");
    const data = Buffer.from(String(file.data), "base64");
    if (salt.length < 8 || iv.length !== IV_BYTES || tag.length !== 16) return { ok: false, reason: "corrupt" };

    const key = await deriveVaultKey(password, salt, params);
    const decipher = createDecipheriv("aes-256-gcm", key.key, iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    let plain: string;
    try {
      plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    } catch {
      return { ok: false, reason: "wrong-password" };
    }
    const inner = JSON.parse(plain) as { cookies?: unknown };
    return { ok: true, cookies: parseCookieList(inner.cookies), encrypted: true, key, savedAt };
  } catch {
    return { ok: false, reason: "corrupt" };
  }
};
