// Preload of the browser shell (main window and compact-mode overlay): the regular UI bridge plus the
// <browser-action-list> element of electron-chrome-extensions. Sandboxed preloads cannot require node_modules,
// so this file is bundled by esbuild (npm run build:preload) and is NOT compiled by tsc (see tsconfig.main.json).
import { injectBrowserAction } from "electron-chrome-extensions/browser-action";
import "./preload.js";

injectBrowserAction();
