# MonoBrowser

MonoBrowser is a small desktop browser for Windows and Linux, built with Electron, TypeScript, and esbuild. The latest stable release is [v0.5.1](https://github.com/4tmwz7/monobrowser/releases/tag/v0.5.1).

## Download

- [Windows x64 installer](https://github.com/4tmwz7/monobrowser/releases/download/v0.5.1/MonoBrowser-Setup-0.5.1.exe)
- [Linux x64 AppImage](https://github.com/4tmwz7/monobrowser/releases/download/v0.5.1/MonoBrowser-0.5.1-x86_64.AppImage)

## System requirements

MonoBrowser is built on Electron 44 (Chromium 152) and ships 64-bit builds only.

| | Minimum | Recommended |
| --- | --- | --- |
| Windows | Windows 10 x64 | Windows 11 x64 |
| Linux | 64-bit distribution with a recent glibc (e.g. Ubuntu 22.04 LTS+, Debian 12+, Fedora 40+), X11 or Wayland, `libfuse2` for the AppImage | Current release of a mainstream distribution, Wayland or X11 |
| RAM | 2 GB | 4 GB or more for heavier tab use |
| Disk space | ~400 MB after install (~110–130 MB download) | SSD |
| GPU | Any GPU with OpenGL 2.1+ support, or the built-in software rendering fallback | Hardware-accelerated GPU |

Notes:

- 32-bit Windows (ia32) and Linux ARM (armv7l) builds are not provided; Electron 44 publishes 64-bit binaries only.
- macOS is not supported and no macOS builds are published.
- On Wayland sessions the app runs as a native Wayland client; XWayland can be forced with `--ozone-platform=x11`.
- If the AppImage fails to start because FUSE is missing, run it with `--appimage-extract-and-run`.

## Bookmarks and tabs

- Import bookmarks from HTML (Netscape format used by Chrome, Firefox, Edge) or JSON, and export to HTML or JSON, from the menu under Bookmarks.
- Drag tabs to reorder them; pinned and unpinned tabs are reordered within their own group.

## Security notes

- Windows installers are not code-signed, so SmartScreen may show a warning on first run.
- The Linux AppImage is not signed; verify downloads against the checksums in `latest-linux.yml`.
- Camera, microphone, location, notifications, and clipboard-read requests from sites are blocked unless you allow them in a prompt; the choice lasts until the app is closed.
- Only one MonoBrowser instance runs at a time; launching it again focuses the existing window.

## Keyboard shortcuts

- `Ctrl+T` - open new tab
- `Ctrl+Shift+T` - reopen the last closed tab
- `Ctrl+Shift+N` - open a private tab (in-memory session, no history; cleared when the last private tab closes)
- `Ctrl+W` - close current tab
- `Ctrl+R` or `F5` - reload current tab
- `Ctrl+L` - focus and select the address bar
- `Ctrl+K` - open the command palette
- `Ctrl+D` - add or remove the current bookmark
- `Ctrl+F` - find text on the current page
- `F12` or `Ctrl+Shift+I` - toggle DevTools for the current page
- `Ctrl+Tab` / `Ctrl+Shift+Tab` - switch between tabs
- `Ctrl+PageDown` / `Ctrl+PageUp` - switch between tabs
- `Ctrl+1`…`Ctrl+9` - select a tab (`9` selects the last tab)
- `Alt+Left` / `Alt+Right` - navigate back or forward
- `Ctrl++` / `Ctrl+-` / `Ctrl+0` - control page zoom
- `F11` - toggle full screen

## License

MIT
