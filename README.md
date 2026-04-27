# MonoBrowser

MonoBrowser is a small desktop browser built with Electron, TypeScript, and esbuild.

## Features

- Multiple tabs with tab switching and closing
- Back, forward, reload, and address bar navigation
- Search terms in the address bar open Google search
- History window with clickable entries
- Links opened with `window.open` or `target="_blank"` open in a new tab
- Custom tab strip with loading state and favicon handling
- Auto-updates from GitHub Releases
- Generated monochrome app icon during build

## Keyboard shortcuts

- `Ctrl+T` - open new tab
- `Ctrl+W` - close current tab
- `Ctrl+R` - reload current tab

## Scripts

```bash
npm install
npm run dev
npm run build
npm run dist
```

- `npm run dev` builds the app and starts Electron
- `npm run build` builds the main and renderer bundles
- `npm run dist` builds the app and packages the Windows installer

## Auto-update

Packaged builds check GitHub Releases automatically.

For updates to work, the release must include:

- `latest.yml`
- `MonoBrowser-Setup-<version>.exe`
- `MonoBrowser-Setup-<version>.exe.blockmap`

## Project structure

- `src/main/main.ts` - Electron main process, tabs, navigation, history, release helpers
- `src/main/preload.ts` - IPC bridge
- `src/renderer/app.ts` - tab strip and browser chrome UI
- `src/renderer/index.html` - renderer shell and styles

## Notes

- The native menu bar is hidden by default.
- The app uses a sandboxed renderer with `contextIsolation` enabled and `nodeIntegration` disabled.
- The default start page is Google.

## License

MIT
