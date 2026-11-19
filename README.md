# AuraBar

An open-source, glassy smart taskbar replacement and top Music Dynamic Island for Windows 10/11 — built with Electron, React, TypeScript, Vite, and a lightweight persistent C#/Win32 native bridge.

> [!NOTE]
> AuraBar is currently in active development — expect frequent updates, polish, and bug fixes.

## Features
- **Glassy Smart Taskbar Pill**: Floating centered dock bar anchored cleanly above the bottom edge (or top), with optional native Windows taskbar replacement (`Shell_TrayWnd` hide + `SPI_SETWORKAREA` reserved workspace) and `Alt+Space` toggle.
- **Top Music Dynamic Island**: iPhone-style top Dynamic Island under the camera notch with live album artwork, timeline, and Windows media controls (`SMTC`), or switchable inline inside the taskbar.
- **Taskbar App Folders & Drag-and-Drop**: Drag any pinned or running app onto another to merge into a glassy 2×2 folder popup, rename folders inline, reorder icons, or eject apps back out onto the taskbar.
- **Installed Apps & Open Windows**: Scan installed Start Menu apps, pin `.exe`/folders/URLs, and switch or minimize active desktop windows using their real executable icons.
- **Live System & Audio Controls**: CPU/RAM sparklines, disk usage, battery indicator, volume controls, keyboard layout switcher (`EN`/`AR`), and quick system actions.
- **Calendar & Local Reminders**: Interactive monthly calendar stored locally in `%APPDATA%\aurabar\aurabar-config.json`.
- **Premium Glass Themes & RTL Support**: Choose between **Classy Obsidian**, **Platinum Gold**, and **Frost Light**, with English (`LTR`) and Arabic (`RTL`) UI support.

## Install

Download **`AuraBar-Setup-<version>.exe`** from the [latest release](https://github.com/m7devcore/aurabar/releases/latest) and run it. No Node.js needed; it installs for the current user only.

The installer is not code-signed, so Windows SmartScreen may show "Unknown publisher": choose **More info → Run anyway**.

**Updates are automatic.** The installed app checks GitHub Releases a few seconds after launch and every few hours. A new version downloads in the background, then a notification (and the tray menu) offers **Restart to update**. The tray menu also has **Check for updates**.

## Getting Started (from source)

```bash
npm install
npm run build
npm start
```

Or double-click **`Start-AuraBar.bat`** / **`Start-AuraBar-Silent.vbs`** on Windows after building.

## Releasing a new version

```bash
git tag v1.0.1
git push origin v1.0.1
```

The `Release` workflow builds the installer and publishes it as a GitHub Release; installed copies then update themselves. To test the installer locally, run `npm run dist` (output goes to `release/`).

## Development

```bash
npm run dev
```

## License

MIT
