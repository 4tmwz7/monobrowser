# MonoBrowser

MonoBrowser is a small desktop browser for Windows and Linux, built with Electron, TypeScript, and esbuild. The latest stable release is [v0.3.3](https://github.com/4tmwz7/monobrowser/releases/tag/v0.3.3).

## Download

- [Windows x64 installer](https://github.com/4tmwz7/monobrowser/releases/download/v0.3.3/MonoBrowser-Setup-0.3.3.exe)
- [Linux x64 AppImage](https://github.com/4tmwz7/monobrowser/releases/download/v0.3.3/MonoBrowser-0.3.3-x86_64.AppImage)

## Features

- Multiple tabs with tab switching and closing
- Back, forward, reload, and address bar navigation
- Branded start page with an integrated web search field
- Configurable default search engine: Google, DuckDuckGo, or a custom HTTP(S) search URL
- Bundled uBlock Origin network filtering with its standard filter lists
- Three-dot navigation menu with History, Downloads, Site data, and language selection
- Polish and English application interface, with the selected language saved between launches
- History window with clickable entries and history clearing
- Native download location picker, persistent history, bottom-right live progress, cancellation, opening completed files, and showing them in the folder
- Per-site data panel for cookies, Local Storage, IndexedDB, cache, and Service Workers
- Global browsing-data controls that do not delete downloaded files or download history
- Links opened with `window.open` or `target="_blank"` open in a new tab
- Batched tab-state updates and frame-scheduled UI rendering to reduce unnecessary work
- No permanently preloaded Google tab, reducing idle RAM use
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
npm run dist:win
npm run dist:linux
```

- `npm run dev` builds the app and starts Electron
- `npm run build` builds the main and renderer bundles
- `npm run dist` or `npm run dist:win` packages the Windows x64 NSIS installer
- `npm run dist:linux` packages the Linux x64 AppImage
- `npm run dist:all` packages both platforms on a host with the required cross-platform tooling

Packaged files are written to `release/`.

## Releases

Update the version in `package.json`, commit the change, and push a matching tag:

```bash
git tag v<version>
git push origin v<version>
```

The tag must exactly match `v<package.json version>`. The repository includes a GitHub Actions workflow for Windows and Linux release builds. Packages can also be built locally with `npm run dist:win` and `npm run dist:linux`.

## Auto-update

Packaged Windows and Linux builds check GitHub Releases automatically. The first check runs 45 seconds after startup and subsequent checks run every six hours. When an update has downloaded, MonoBrowser asks whether it should restart now or later.

The release must include:

- `latest.yml`
- `MonoBrowser-Setup-<version>.exe`
- `MonoBrowser-Setup-<version>.exe.blockmap`
- `latest-linux.yml`
- `MonoBrowser-<version>-x86_64.AppImage`

Linux auto-update requires running the AppImage from a location writable by the current user.

## Running on Linux

Download the AppImage from GitHub Releases, make it executable, and run it:

```bash
chmod +x MonoBrowser-<version>-x86_64.AppImage
./MonoBrowser-<version>-x86_64.AppImage
```

## Project structure

- `src/main/main.ts` - Electron main process, tabs, navigation, downloads, site data, and language settings
- `src/main/preload.ts` - narrow IPC bridge for browser and internal windows
- `src/renderer/app.ts` - tab strip, browser chrome, and native-menu anchor
- `src/renderer/index.html` - renderer shell and styles

## Notes

- The native menu bar is hidden by default.
- The app uses a sandboxed renderer with `contextIsolation` enabled and `nodeIntegration` disabled.
- New tabs open the local MonoBrowser start page; Google is the default search engine.
- The bundled uBlock Origin files retain their upstream GPLv3 license in `vendor/ublock-origin/LICENSE.txt`.

## License

MIT
