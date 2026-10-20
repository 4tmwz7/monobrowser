// Portable mode runtime: cookie vault (export on quit / debounced on change, import at startup), optional password
// protection, settings state and IPC. Pure logic lives in portable-paths / portable-cookies / portable-vault.
import fs from "node:fs";
import fsp from "node:fs/promises";
import { app, session } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { getPortableInfo } from "./portable-mode.js";
import { normalizePortableSettings, type PortableSettings } from "./portable-paths.js";
import { cookieKey, serializeCookies, toSetDetails } from "./portable-cookies.js";
import { deriveVaultKey, inspectVault, openVault, sealVault, type VaultKey } from "./portable-vault.js";
import { promptVaultPassword } from "./portable-unlock.js";

type Language = "pl" | "en";
type HandleTrusted = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown) => void;

export const VAULT_EXPORT_DEBOUNCE_MS = 60_000;
const QUIT_FLUSH_TIMEOUT_MS = 4_000;
const MIN_PASSWORD_LENGTH = 4;
const IMPORT_BATCH = 40;

let getLanguage: () => Language = () => "en";
let settings: PortableSettings = { downloadsInDataFolder: false };
let vaultKey: VaultKey | null = null;
let vaultEncrypted = false;
let vaultLocked = false;
let vaultExists = false;
let lastSavedAt: string | null = null;
let vaultCookieCount = 0;
let restoredCount = 0;
let lastError: string | null = null;
let backupDone = false;
let started = false;
let dirtyTimer: NodeJS.Timeout | null = null;
let writeChain: Promise<void> = Promise.resolve();
let quitFlushed = false;
let quitting = false;
// Electron's default Downloads folder, captured before portable mode may override it.
let systemDownloads = "";

const nowSeconds = (): number => Date.now() / 1000;

const writeFileAtomic = async (target: string, text: string): Promise<void> => {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, text, { encoding: "utf8", mode: 0o600 });
  try {
    await fsp.rename(tmp, target);
  } catch (error) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
};

const applyDownloadsLocation = (): void => {
  const info = getPortableInfo();
  if (!info || !settings.downloadsInDataFolder) return;
  try {
    fs.mkdirSync(info.paths.downloads, { recursive: true });
    app.setPath("downloads", info.paths.downloads);
  } catch (error) {
    console.warn("Portable downloads folder unavailable:", error);
  }
};

const exportNowUnchained = async (): Promise<void> => {
  const info = getPortableInfo();
  if (!info || vaultLocked) return;
  try {
    const cookies = serializeCookies(await session.defaultSession.cookies.get({}), nowSeconds());
    const text = sealVault(cookies, new Date(), vaultEncrypted ? vaultKey : null);
    if (vaultEncrypted && !vaultKey) return; // Defensive: never downgrade an encrypted vault to plain text.
    if (!backupDone) {
      backupDone = true;
      await fsp.copyFile(info.paths.vault, info.paths.vaultBackup).catch(() => undefined);
    }
    await writeFileAtomic(info.paths.vault, text);
    vaultExists = true;
    vaultCookieCount = cookies.length;
    lastSavedAt = new Date().toISOString();
    lastError = null;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error("Portable cookie vault export failed:", error);
  }
};

/** Writes the vault now; concurrent calls are serialized so the file is never written twice at once. */
export const exportPortableVault = (): Promise<void> => {
  if (dirtyTimer) {
    clearTimeout(dirtyTimer);
    dirtyTimer = null;
  }
  writeChain = writeChain.then(exportNowUnchained, exportNowUnchained);
  return writeChain;
};

const scheduleExport = (): void => {
  if (dirtyTimer || vaultLocked) return;
  dirtyTimer = setTimeout(() => {
    dirtyTimer = null;
    void exportPortableVault();
  }, VAULT_EXPORT_DEBOUNCE_MS);
  dirtyTimer.unref?.();
};

const importCookies = async (cookies: ReturnType<typeof serializeCookies>): Promise<void> => {
  const ses = session.defaultSession;
  const present = new Set((await ses.cookies.get({})).map((cookie) => cookieKey({
    name: cookie.name, domain: cookie.domain ?? "", path: cookie.path ?? "/",
  })));
  const now = nowSeconds();
  const pending = cookies
    .filter((cookie) => !present.has(cookieKey(cookie))) // A cookie already in the browser's own store wins.
    .map((cookie) => toSetDetails(cookie, now))
    .filter((details): details is NonNullable<typeof details> => details !== null);

  let restored = 0;
  for (let index = 0; index < pending.length; index += IMPORT_BATCH) {
    const results = await Promise.all(pending.slice(index, index + IMPORT_BATCH).map((details) =>
      ses.cookies.set(details).then(() => true, () => false)));
    restored += results.filter(Boolean).length;
  }
  restoredCount = restored;
};

const restoreVault = async (): Promise<void> => {
  const info = getPortableInfo();
  if (!info) return;
  let text: string;
  try {
    text = await fsp.readFile(info.paths.vault, "utf8");
  } catch {
    return; // No vault yet.
  }
  vaultExists = true;
  const header = inspectVault(text);
  if (!header) {
    lastError = "corrupt";
    return; // Unreadable file: left in place; the first export keeps it as a .bak.
  }
  vaultEncrypted = header.encrypted;
  lastSavedAt = header.savedAt;

  let opened = header.encrypted ? null : await openVault(text, null);
  if (header.encrypted) {
    const unlocked = await promptVaultPassword(getLanguage(), async (password) => {
      const attempt = await openVault(text, password);
      if (attempt.ok) opened = attempt;
      return attempt.ok;
    });
    if (!unlocked || !opened) {
      vaultLocked = true; // Never overwrite a vault we could not read.
      return;
    }
  }
  if (!opened || !opened.ok) {
    lastError = "corrupt";
    return;
  }
  vaultKey = opened.key;
  vaultCookieCount = opened.cookies.length;
  await importCookies(opened.cookies);
};

/** Call once during startup, after the default session exists and before tabs are restored. */
export const initPortableSession = async (language: () => Language): Promise<void> => {
  const info = getPortableInfo();
  if (!info || started) return;
  started = true;
  getLanguage = language;
  try {
    settings = normalizePortableSettings(JSON.parse(fs.readFileSync(info.paths.settings, "utf8")));
  } catch {
    settings = normalizePortableSettings(null);
  }
  try { systemDownloads = app.getPath("downloads"); } catch { systemDownloads = ""; }
  applyDownloadsLocation();

  try {
    await restoreVault();
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.error("Portable cookie vault restore failed:", error);
  }

  session.defaultSession.cookies.on("changed", (_event, cookie) => {
    if (cookie.session || cookie.expirationDate === undefined) return;
    scheduleExport();
  });

  app.on("before-quit", (event) => {
    if (quitFlushed || vaultLocked) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, QUIT_FLUSH_TIMEOUT_MS).unref?.());
    void Promise.race([exportPortableVault(), timeout]).finally(() => {
      quitFlushed = true;
      app.quit();
    });
  });
};

type Message = { ok: boolean; message: string };

const TEXT = {
  pl: {
    locked: "Magazyn jest zablokowany. Uruchom ponownie przeglądarkę i podaj hasło.",
    short: `Hasło musi mieć co najmniej ${MIN_PASSWORD_LENGTH} znaki.`,
    mismatch: "Hasła nie są takie same.",
    encOn: "Sesje na nośniku są teraz szyfrowane hasłem.",
    encOff: "Szyfrowanie wyłączone - sesje są zapisywane bez hasła.",
    saved: "Sesje zapisane na nośniku.",
    failed: "Nie udało się zapisać sesji na nośniku.",
    reset: "Zaszyfrowany magazyn usunięto. Sesje będą zapisywane od nowa.",
    notPortable: "Tryb przenośny jest wyłączony.",
  },
  en: {
    locked: "The vault is locked. Restart the browser and enter the password.",
    short: `The password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
    mismatch: "The passwords do not match.",
    encOn: "Sessions on the drive are now encrypted with a password.",
    encOff: "Encryption turned off - sessions are saved without a password.",
    saved: "Sessions saved to the drive.",
    failed: "Could not save the sessions to the drive.",
    reset: "The encrypted vault was deleted. Sessions will be saved afresh.",
    notPortable: "Portable mode is not active.",
  },
} as const;

export const getPortableState = () => {
  const info = getPortableInfo();
  if (!info) return null;
  return {
    dataDir: info.dataDir,
    exeDir: info.exeDir,
    source: info.source,
    downloadsInDataFolder: settings.downloadsInDataFolder,
    downloadsDir: info.paths.downloads,
    vault: {
      exists: vaultExists,
      encrypted: vaultEncrypted,
      locked: vaultLocked,
      cookieCount: vaultCookieCount,
      restored: restoredCount,
      savedAt: lastSavedAt,
      error: lastError,
    },
  };
};

const setEncryption = async (enabled: unknown, password: unknown, confirm: unknown): Promise<Message> => {
  const text = TEXT[getLanguage()];
  if (!getPortableInfo()) return { ok: false, message: text.notPortable };
  if (vaultLocked) return { ok: false, message: text.locked };
  if (enabled === true) {
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) return { ok: false, message: text.short };
    if (confirm !== password) return { ok: false, message: text.mismatch };
    vaultKey = await deriveVaultKey(password);
    vaultEncrypted = true;
  } else {
    vaultKey = null;
    vaultEncrypted = false;
  }
  await exportPortableVault();
  if (lastError) return { ok: false, message: text.failed };
  return { ok: true, message: vaultEncrypted ? text.encOn : text.encOff };
};

const resetVault = async (): Promise<Message> => {
  const info = getPortableInfo();
  const text = TEXT[getLanguage()];
  if (!info) return { ok: false, message: text.notPortable };
  await fsp.rm(info.paths.vault, { force: true }).catch(() => undefined);
  await fsp.rm(info.paths.vaultBackup, { force: true }).catch(() => undefined);
  vaultLocked = false;
  vaultEncrypted = false;
  vaultKey = null;
  vaultExists = false;
  vaultCookieCount = 0;
  lastSavedAt = null;
  backupDone = true;
  await exportPortableVault();
  return { ok: true, message: text.reset };
};

const setDownloadsInDataFolder = async (value: unknown): Promise<Message & { downloadsInDataFolder: boolean }> => {
  const info = getPortableInfo();
  const text = TEXT[getLanguage()];
  if (!info) return { ok: false, message: text.notPortable, downloadsInDataFolder: false };
  settings = { downloadsInDataFolder: value === true };
  try {
    await writeFileAtomic(info.paths.settings, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error("Could not save portable settings:", error);
  }
  if (settings.downloadsInDataFolder) {
    applyDownloadsLocation();
  } else if (systemDownloads) {
    try {
      app.setPath("downloads", systemDownloads);
    } catch {
      // Keeps the portable folder until the next restart.
    }
  }
  return { ok: true, message: "", downloadsInDataFolder: settings.downloadsInDataFolder };
};

export const registerPortableIpc = (handleTrusted: HandleTrusted): void => {
  handleTrusted("portable:get-state", () => getPortableState());
  handleTrusted("portable:set-encryption", (_event, payload: { enabled?: unknown; password?: unknown; confirm?: unknown } = {}) =>
    setEncryption(payload?.enabled, payload?.password, payload?.confirm).then(async (result) => ({ ...result, state: getPortableState() })));
  handleTrusted("portable:sync-now", async () => {
    const text = TEXT[getLanguage()];
    if (vaultLocked) return { ok: false, message: text.locked, state: getPortableState() };
    await exportPortableVault();
    return { ok: !lastError, message: lastError ? text.failed : text.saved, state: getPortableState() };
  });
  handleTrusted("portable:reset-vault", async () => ({ ...(await resetVault()), state: getPortableState() }));
  handleTrusted("portable:set-downloads", async (_event, value: unknown) => ({ ...(await setDownloadsInDataFolder(value)), state: getPortableState() }));
};
