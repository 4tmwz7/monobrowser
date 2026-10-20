// Portable ("live USB") mode bootstrap. Must run from start.ts before anything reads app.getPath("userData") and
// before app 'ready' / requestSingleInstanceLock, so every file Chromium and MonoBrowser write stays on the drive
// and the single-instance lock (derived from userData) is per drive.
import fs from "node:fs";
import { app } from "electron";
import { detectPortable, portablePaths, type PortableDetection, type PortablePaths } from "./portable-paths.js";

export type PortableInfo = PortableDetection & { paths: PortablePaths };

let resolved = false;
let current: PortableInfo | null = null;

export const applyPortableMode = (): PortableInfo | null => {
  if (resolved) return current;
  resolved = true;

  const detection = detectPortable({
    env: process.env,
    execPath: process.execPath,
    exists: (target) => {
      try {
        return fs.existsSync(target);
      } catch {
        return false;
      }
    },
  });
  if (!detection) return null;

  const paths = portablePaths(detection.dataDir);
  try {
    for (const dir of [paths.userData, paths.cache, paths.logs, paths.crashDumps, paths.temp]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.accessSync(paths.userData, fs.constants.W_OK);
  } catch (error) {
    // Read-only drive: behave like a normal install instead of failing to start.
    console.warn("Portable mode disabled: data folder is not writable:", detection.dataDir, error);
    return null;
  }

  app.setPath("userData", paths.userData);
  app.setPath("sessionData", paths.sessionData);
  app.setPath("cache", paths.cache);
  app.setPath("crashDumps", paths.crashDumps);
  app.setPath("temp", paths.temp);
  app.setAppLogsPath(paths.logs);
  app.commandLine.appendSwitch("disk-cache-dir", paths.cache);

  current = { ...detection, paths };
  return current;
};

export const getPortableInfo = (): PortableInfo | null => current;
export const isPortableMode = (): boolean => current !== null;
