// Preload for extension service workers and extension pages (registered by extensions.ts after electron-chrome-extensions'
// own preload). Makes the global `browser` of MV3 extensions an alias of the (library-patched) `chrome` object.
// Without it uBlock Origin Lite and others fail at startup with "Cannot read properties of undefined (reading 'onCommand')".
// Plain preload: it may only require("electron") and is compiled by tsc like the other preloads.
import { contextBridge } from "electron";

contextBridge.executeInMainWorld({
  func: () => {
    // Runs in the main world: no outer variables are available here.
    if (typeof location !== "undefined" && location.protocol !== "chrome-extension:") return;
    const scope = globalThis as unknown as { chrome?: { runtime?: { id?: string; getManifest?: () => { manifest_version?: number } } }; browser?: unknown };
    const chromeApi = scope.chrome;
    if (!chromeApi?.runtime?.id || chromeApi.runtime.getManifest?.().manifest_version !== 3) return;
    if (scope.browser && scope.browser !== chromeApi) {
      try {
        Object.defineProperty(globalThis, "browser", { value: chromeApi, writable: true, configurable: true, enumerable: true });
      } catch {
        // The native object cannot be replaced: leave it alone.
      }
    }
  },
});
