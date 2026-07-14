# MonoBrowser

MonoBrowser is a small desktop browser for Windows and Linux, built with Electron, TypeScript, and esbuild.

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

Stable releases are built by GitHub Actions. Update the version in `package.json`, commit the change, and push a matching tag:

```bash
git tag v0.4.0
git push origin v0.4.0
```

The tag must exactly match `v<package.json version>`. The workflow builds Windows on a Windows runner and Linux on an Ubuntu runner, then publishes both packages in one GitHub Release.

## Auto-update

Packaged Windows and Linux builds check GitHub Releases automatically. The first check runs 45 seconds after startup and subsequent checks run every six hours. When an update has downloaded, MonoBrowser asks whether it should restart now or later.

The release must include:

- `latest.yml`
- `MonoBrowser-Setup-<version>.exe`
- `MonoBrowser-Setup-<version>.exe.blockmap`
- `latest-linux.yml`
- `MonoBrowser-<version>-x86_64.AppImage`
- `MonoBrowser-<version>-x86_64.AppImage.blockmap`

Linux auto-update requires running the AppImage from a location writable by the current user.

## Running on Linux

Download the AppImage from GitHub Releases, make it executable, and run it:

```bash
chmod +x MonoBrowser-<version>-x86_64.AppImage
./MonoBrowser-<version>-x86_64.AppImage
```

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
