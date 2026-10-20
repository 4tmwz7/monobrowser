// Portable ("live USB") mode: detection and on-disk layout. Pure module (no Electron) so it can be unit-tested.
import path from "node:path";

export const PORTABLE_DATA_DIR_NAME = "MonoBrowser Data";
export const PORTABLE_MARKER_FILE = "portable.txt";

export type PortableSource = "env" | "marker-file" | "marker-folder";

export type PortableDetection = {
  /** Directory of the launcher (.exe / AppImage / binary) - the USB drive folder. */
  exeDir: string;
  /** "<exeDir>/MonoBrowser Data" - everything the browser writes lives here. */
  dataDir: string;
  source: PortableSource;
};

export type PortableDetectionInput = {
  env: Record<string, string | undefined>;
  execPath: string;
  exists: (target: string) => boolean;
};

const nonEmpty = (value: string | undefined): string | null => (value && value.trim() ? value.trim() : null);

/**
 * Portable mode is on when electron-builder's portable launcher exported PORTABLE_EXECUTABLE_DIR, or when a
 * `portable.txt` file / "MonoBrowser Data" folder sits next to the executable (or next to the AppImage).
 */
export const detectPortable = (input: PortableDetectionInput): PortableDetection | null => {
  const make = (exeDir: string, source: PortableSource): PortableDetection => ({
    exeDir,
    dataDir: path.join(exeDir, PORTABLE_DATA_DIR_NAME),
    source,
  });

  const fromEnv = nonEmpty(input.env.PORTABLE_EXECUTABLE_DIR);
  if (fromEnv) return make(fromEnv, "env");

  const candidates: string[] = [];
  const appImage = nonEmpty(input.env.APPIMAGE);
  if (appImage) candidates.push(path.dirname(appImage));
  if (input.execPath) candidates.push(path.dirname(input.execPath));

  for (const dir of candidates) {
    if (input.exists(path.join(dir, PORTABLE_MARKER_FILE))) return make(dir, "marker-file");
    if (input.exists(path.join(dir, PORTABLE_DATA_DIR_NAME))) return make(dir, "marker-folder");
  }
  return null;
};

export type PortablePaths = {
  userData: string;
  sessionData: string;
  cache: string;
  logs: string;
  crashDumps: string;
  temp: string;
  downloads: string;
  vault: string;
  vaultBackup: string;
  settings: string;
};

export const PORTABLE_VAULT_FILE = "portable-cookies.json";

export const portablePaths = (dataDir: string): PortablePaths => ({
  userData: dataDir,
  sessionData: dataDir,
  cache: path.join(dataDir, "Cache"),
  logs: path.join(dataDir, "Logs"),
  crashDumps: path.join(dataDir, "Crashpad"),
  temp: path.join(dataDir, "Temp"),
  downloads: path.join(dataDir, "Downloads"),
  vault: path.join(dataDir, PORTABLE_VAULT_FILE),
  vaultBackup: path.join(dataDir, `${PORTABLE_VAULT_FILE}.bak`),
  settings: path.join(dataDir, "portable-settings.json"),
});

export type PortableSettings = { downloadsInDataFolder: boolean };

export const normalizePortableSettings = (value: unknown): PortableSettings => ({
  downloadsInDataFolder:
    typeof value === "object" && value !== null && (value as Record<string, unknown>).downloadsInDataFolder === true,
});
