import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  Tray
} from 'electron';
import path from 'node:path';
import { getCurrentMedia, sendMediaCommand, stopMediaWorker } from './services/mediaControl';
import { getLyrics } from './services/lyrics';
import {
  checkForUpdates,
  getUpdateStatus,
  installUpdateNow,
  isUpdaterAvailable,
  startUpdater,
  stopUpdater
} from './services/updater';
import { loadConfig, saveConfig } from './services/store';
import { getSystemStats } from './services/systemStats';
import { win32Daemon } from './services/win32Daemon';
import {
  adjustSystemVolume,
  closeWindowByHwnd,
  createPinnedAppFromPath,
  focusWindowByPid,
  getIconDataUrl,
  getKeyboardLayoutCode,
  getNetworkInfo,
  getSystemVolume,
  getWindowThumbnail,
  importTaskbarPinnedApps,
  launchTarget,
  listBackgroundApps,
  listInstalledApps,
  listRunningWindows,
  openAppByPid,
  pickExecutableOrFolder,
  quitAppByPid,
  resolveExeName,
  restoreWindowsTaskbarSync,
  runQuickSystemAction,
  setSystemVolume,
  setWindowsTaskbarReplacement,
  switchKeyboardLayout,
  toggleSystemMute
} from './services/windowsManager';
import type { AppConfig, DockSettings, PinnedApp } from '../src/types';

interface HitRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const DOCK_CANVAS_HEIGHT = 500;

let dockWindow: BrowserWindow | null = null;
let islandWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let currentConfig: AppConfig;
let isPopoverOpen = false;
let isIslandExpanded = false;
let dockInteractiveState = false;
let islandInteractiveState = false;
let dockInteractiveLock = false;
let islandInteractiveLock = false;
let dockLocalHitRects: HitRect[] = [];
let islandLocalHitRects: HitRect[] = [];
let dockLastInsideAt = 0;
let islandLastInsideAt = 0;
let taskbarWasAutoHidden = false;
let lastTaskbarLayoutKey = '';
let isQuitting = false;

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect x="2" y="2" width="28" height="28" rx="8" fill="#0B1120" stroke="#60A5FA" stroke-width="2.5"/>
      <rect x="7" y="12" width="18" height="8" rx="4" fill="#60A5FA"/>
      <circle cx="11" cy="16" r="2" fill="#0B1120"/>
      <circle cx="16" cy="16" r="2" fill="#0B1120"/>
      <circle cx="21" cy="16" r="2" fill="#0B1120"/>
    </svg>
  `.trim();
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  );
}

function computeDockBounds(settings: DockSettings) {
  const display = screen.getPrimaryDisplay();
  const area = settings.replaceWindowsTaskbar ? display.bounds : display.workArea;
  const width = area.width;
  const height = DOCK_CANVAS_HEIGHT;
  const x = area.x;
  const y = settings.position === 'top' ? area.y : area.y + area.height - height;
  return { x, y, width, height };
}

function computeIslandBounds() {
  const display = screen.getPrimaryDisplay();
  const width = 440;
  // Tall enough for the expanded island with lyrics; the window is click-through outside it
  const height = 360;
  const x = Math.round(display.bounds.x + (display.bounds.width - width) / 2);
  const y = display.bounds.y + 4;
  return { x, y, width, height };
}

function getReservedHeightPx(settings: DockSettings): number {
  const barH = settings.compactMode ? 46 : 54;
  // Floating pill sits 4px from bottom edge + 4px clean breathing gap below maximized apps
  return barH + 8;
}

function syncTaskbarReplacement(settings: DockSettings): void {
  const display = screen.getPrimaryDisplay();
  const scale = display.scaleFactor || 1;
  const physBounds = {
    x: Math.round(display.bounds.x * scale),
    y: Math.round(display.bounds.y * scale),
    width: Math.round(display.bounds.width * scale),
    height: Math.round(display.bounds.height * scale)
  };
  const reservePhys = Math.round(getReservedHeightPx(settings) * scale);
  const layoutKey = `${settings.replaceWindowsTaskbar}-${settings.position}-${reservePhys}-${physBounds.width}x${physBounds.height}`;

  if (settings.replaceWindowsTaskbar) {
    if (taskbarWasAutoHidden && lastTaskbarLayoutKey === layoutKey) return;
    taskbarWasAutoHidden = true;
    lastTaskbarLayoutKey = layoutKey;
    void setWindowsTaskbarReplacement(true, settings.position, reservePhys, physBounds).then(() => {
      applyAllLayouts(currentConfig.settings);
    });
  } else if (taskbarWasAutoHidden) {
    taskbarWasAutoHidden = false;
    lastTaskbarLayoutKey = '';
    void setWindowsTaskbarReplacement(false, settings.position, 48, physBounds).then(() => {
      applyAllLayouts(currentConfig.settings);
    });
  }
}

function getHwndNumber(win: BrowserWindow | null): string {
  if (!win || win.isDestroyed()) return '0';
  const buf = win.getNativeWindowHandle();
  if (buf.length >= 8) return buf.readBigInt64LE(0).toString();
  if (buf.length >= 4) return String(buf.readInt32LE(0));
  return '0';
}

function applyTopmost(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(currentConfig?.settings.alwaysOnTop ?? true, 'screen-saver');
}

function syncKeepOnTop(settings: DockSettings): void {
  void win32Daemon.send(`KEEP_TOP ${settings.alwaysOnTop ? 1 : 0}`);
  applyTopmost(dockWindow);
  applyTopmost(islandWindow);
}

function ensureOnTop(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  applyTopmost(win);
  win.moveTop();
  const hwnd = getHwndNumber(win);
  if (hwnd !== '0') {
    void win32Daemon.send(`TOPMOST ${hwnd}`);
  }
}

// Keep the transparent overlay windows from ever navigating away from the app (e.g. a file
// dropped outside the dock's drop zone) or spawning new windows
function lockDownNavigation(win: BrowserWindow): void {
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function placeDockPhysical(settings: DockSettings): void {
  if (!dockWindow || dockWindow.isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  const scale = display.scaleFactor || 1;
  const area = settings.replaceWindowsTaskbar ? display.bounds : display.workArea;
  const px = Math.round(area.x * scale);
  const pw = Math.round(area.width * scale);
  const ph = Math.round(DOCK_CANVAS_HEIGHT * scale);
  const py =
    settings.position === 'top'
      ? Math.round(area.y * scale)
      : Math.round((area.y + area.height) * scale) - ph;
  void win32Daemon.send(`PLACE_DOCK ${px} ${py} ${pw} ${ph}`);
}

function applyAllLayouts(settings: DockSettings): void {
  if (dockWindow && !dockWindow.isDestroyed()) {
    applyTopmost(dockWindow);
    dockWindow.setBounds(computeDockBounds(settings), false);
    placeDockPhysical(settings);
  }
  if (islandWindow && !islandWindow.isDestroyed()) {
    applyTopmost(islandWindow);
    islandWindow.setBounds(computeIslandBounds(), false);
    if (settings.musicPosition === 'top') {
      if (!islandWindow.isVisible()) {
        islandWindow.showInactive();
        ensureOnTop(islandWindow);
      }
    } else if (islandWindow.isVisible()) {
      islandWindow.hide();
    }
  }
}

function loadView(win: BrowserWindow, view: 'dock' | 'island'): void {
  const devUrl = process.env.AURABAR_DEV_URL;
  if (devUrl) {
    void win.loadURL(`${devUrl}?view=${view}`);
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'), {
      search: `view=${view}`
    });
  }
}

function createWindows(): void {
  const loaded = loadConfig();
  currentConfig = { ...loaded, pinnedApps: withResolvedExeNames(loaded.pinnedApps) };
  if (currentConfig.settings.replaceWindowsTaskbar) {
    syncTaskbarReplacement(currentConfig.settings);
  }

  dockWindow = new BrowserWindow({
    ...computeDockBounds(currentConfig.settings),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    enableLargerThanScreen: true,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  applyTopmost(dockWindow);
  dockWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  dockWindow.setIgnoreMouseEvents(true);
  lockDownNavigation(dockWindow);
  loadView(dockWindow, 'dock');
  dockWindow.once('ready-to-show', () => {
    applyTopmost(dockWindow);
    dockWindow?.showInactive();
    void win32Daemon.send(`SET_HWNDS ${getHwndNumber(dockWindow)} ${getHwndNumber(islandWindow)}`);
    placeDockPhysical(currentConfig.settings);
    ensureOnTop(dockWindow);
  });
  dockWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      isPopoverOpen = false;
      dockInteractiveLock = false;
      dockInteractiveState = false;
      dockWindow?.setIgnoreMouseEvents(true);
      dockWindow?.hide();
      if (taskbarWasAutoHidden) {
        taskbarWasAutoHidden = false;
        lastTaskbarLayoutKey = '';
        void setWindowsTaskbarReplacement(false);
      }
      rebuildTrayMenu();
    }
  });
  dockWindow.on('hide', () => {
    if (taskbarWasAutoHidden) {
      taskbarWasAutoHidden = false;
      lastTaskbarLayoutKey = '';
      void setWindowsTaskbarReplacement(false);
    }
  });
  dockWindow.on('blur', () => {
    dockInteractiveLock = false;
    if (isPopoverOpen) {
      isPopoverOpen = false;
      dockWindow?.webContents.send('aurabar:blurred');
    }
    applyTopmost(dockWindow);
  });

  islandWindow = new BrowserWindow({
    ...computeIslandBounds(),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  applyTopmost(islandWindow);
  islandWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  islandWindow.setIgnoreMouseEvents(true);
  lockDownNavigation(islandWindow);
  loadView(islandWindow, 'island');
  islandWindow.once('ready-to-show', () => {
    void win32Daemon.send(`SET_HWNDS ${getHwndNumber(dockWindow)} ${getHwndNumber(islandWindow)}`);
    if (currentConfig.settings.musicPosition === 'top') {
      islandWindow?.showInactive();
      ensureOnTop(islandWindow);
    }
  });
  islandWindow.on('blur', () => {
    islandInteractiveLock = false;
    if (isIslandExpanded) {
      isIslandExpanded = false;
      islandWindow?.webContents.send('aurabar:island-blurred');
    }
    applyTopmost(islandWindow);
  });

  syncKeepOnTop(currentConfig.settings);
  void win32Daemon.send(`SET_HWNDS ${getHwndNumber(dockWindow)} ${getHwndNumber(islandWindow)}`);
}

let rebuildTrayMenu: () => void = () => undefined;

// The window that saved a config already has it; echoing it back would race with newer local
// edits (e.g. typing a folder name) and briefly revert them
function broadcastConfig(cfg: AppConfig, except?: Electron.WebContents): void {
  for (const win of [dockWindow, islandWindow]) {
    if (win && !win.isDestroyed() && win.webContents !== except) {
      win.webContents.send('aurabar:config-updated', cfg);
    }
  }
}

function layoutKeyOf(s: DockSettings): string {
  return [s.replaceWindowsTaskbar, s.position, s.compactMode, s.musicPosition, s.alwaysOnTop].join('|');
}

function withResolvedExeNames(apps: PinnedApp[]): PinnedApp[] {
  return apps.map((item) => {
    if (item.kind === 'group') {
      return { ...item, children: item.children ? withResolvedExeNames(item.children) : [] };
    }
    if (item.exeName || !item.target) return item;
    const exeName = resolveExeName(item.target);
    return exeName ? { ...item, exeName } : item;
  });
}

async function backfillPinnedIcons(): Promise<void> {
  const missing = new Map<string, string>();
  const collect = (apps: PinnedApp[]) => {
    for (const item of apps) {
      if (item.kind === 'group') collect(item.children ?? []);
      else if (!item.iconDataUrl && item.target) missing.set(item.id, item.target);
    }
  };
  collect(currentConfig.pinnedApps);
  if (missing.size === 0) return;

  const found = new Map<string, string>();
  for (const [id, target] of missing) {
    const url = await getIconDataUrl(target);
    if (url) found.set(id, url);
  }
  if (found.size === 0) return;

  // Merge into whatever the config is *now*; the user may have edited pins meanwhile
  const apply = (apps: PinnedApp[]): PinnedApp[] =>
    apps.map((item) =>
      item.kind === 'group'
        ? { ...item, children: apply(item.children ?? []) }
        : !item.iconDataUrl && found.has(item.id)
          ? { ...item, iconDataUrl: found.get(item.id) }
          : item
    );
  currentConfig = saveConfig({ ...currentConfig, pinnedApps: apply(currentConfig.pinnedApps) });
  broadcastConfig(currentConfig);
}

function updateMenuItems(): Electron.MenuItemConstructorOptions[] {
  if (!isUpdaterAvailable()) return [];
  const status = getUpdateStatus();
  const items: Electron.MenuItemConstructorOptions[] = [];
  if (status.state === 'ready') {
    items.push({
      label: `Restart to update to v${status.version}`,
      click: () => installUpdateNow()
    });
  } else if (status.state === 'downloading') {
    items.push({ label: `Downloading update v${status.version}… ${status.percent}%`, enabled: false });
  } else if (status.state === 'checking') {
    items.push({ label: 'Checking for updates…', enabled: false });
  } else {
    items.push({ label: 'Check for updates', click: () => checkForUpdates(true) });
  }
  items.push({ label: `AuraBar v${app.getVersion()}`, enabled: false }, { type: 'separator' });
  return items;
}

function setupTray(): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('AuraBar — Taskbar & Music Island');
  rebuildTrayMenu = () => {
    const dockVisible = dockWindow?.isVisible() ?? false;
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: dockVisible ? 'Hide Taskbar' : 'Show Taskbar',
          click: () => toggleDockVisibility()
        },
        {
          label:
            currentConfig.settings.musicPosition === 'top'
              ? 'Music: Top Island → Move to Taskbar'
              : 'Music: In Taskbar → Move to Top Island',
          click: () => {
            currentConfig.settings.musicPosition =
              currentConfig.settings.musicPosition === 'top' ? 'taskbar' : 'top';
            saveConfig(currentConfig);
            isIslandExpanded = false;
            applyAllLayouts(currentConfig.settings);
            broadcastConfig(currentConfig);
            rebuildTrayMenu();
          }
        },
        {
          label: currentConfig.settings.replaceWindowsTaskbar
            ? '✓ Replace Windows Taskbar'
            : 'Replace Windows Taskbar',
          click: () => {
            currentConfig.settings.replaceWindowsTaskbar =
              !currentConfig.settings.replaceWindowsTaskbar;
            saveConfig(currentConfig);
            syncTaskbarReplacement(currentConfig.settings);
            applyAllLayouts(currentConfig.settings);
            broadcastConfig(currentConfig);
            rebuildTrayMenu();
          }
        },
        { type: 'separator' },
        ...updateMenuItems(),
        {
          label: 'Quit AuraBar',
          click: () => app.quit()
        }
      ])
    );
  };
  rebuildTrayMenu();
  tray.on('click', () => toggleDockVisibility());
}

function toggleDockVisibility(): void {
  if (!dockWindow) return;
  if (dockWindow.isVisible()) {
    isPopoverOpen = false;
    dockInteractiveLock = false;
    dockInteractiveState = false;
    dockWindow.setIgnoreMouseEvents(true);
    dockWindow.hide();
    if (taskbarWasAutoHidden) {
      taskbarWasAutoHidden = false;
      lastTaskbarLayoutKey = '';
      void setWindowsTaskbarReplacement(false);
    }
  } else {
    if (currentConfig.settings.replaceWindowsTaskbar) {
      syncTaskbarReplacement(currentConfig.settings);
    }
    applyAllLayouts(currentConfig.settings);
    dockWindow.showInactive();
    ensureOnTop(dockWindow);
  }
  rebuildTrayMenu();
}

function isPointInRects(x: number, y: number, rects: HitRect[]): boolean {
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return true;
    }
  }
  return false;
}

function updateCursorHitTesting(): void {
  if (isQuitting) return;
  const pt = screen.getCursorScreenPoint();
  const nowMs = Date.now();

  if (dockWindow && !dockWindow.isDestroyed() && dockWindow.isVisible()) {
    const b = dockWindow.getBounds();
    const insideDock = isPointInRects(pt.x - b.x, pt.y - b.y, dockLocalHitRects);
    const shouldBeInteractive = isPopoverOpen || dockInteractiveLock || insideDock;
    if (shouldBeInteractive) {
      dockLastInsideAt = nowMs;
      if (!dockInteractiveState) {
        dockInteractiveState = true;
        dockWindow.setIgnoreMouseEvents(false);
      }
    } else if (dockInteractiveState && nowMs - dockLastInsideAt > 90) {
      dockInteractiveState = false;
      dockWindow.setIgnoreMouseEvents(true);
    }
  }

  if (islandWindow && !islandWindow.isDestroyed() && islandWindow.isVisible()) {
    const b = islandWindow.getBounds();
    const insideIsland = isPointInRects(pt.x - b.x, pt.y - b.y, islandLocalHitRects);
    const shouldBeInteractive = isIslandExpanded || islandInteractiveLock || insideIsland;
    if (shouldBeInteractive) {
      islandLastInsideAt = nowMs;
      if (!islandInteractiveState) {
        islandInteractiveState = true;
        islandWindow.setIgnoreMouseEvents(false);
      }
    } else if (islandInteractiveState && nowMs - islandLastInsideAt > 90) {
      islandInteractiveState = false;
      islandWindow.setIgnoreMouseEvents(true);
    }
  }
}

function registerIpcHandlers(): void {
  let iconBackfillStarted = false;
  ipcMain.handle('aurabar:get-config', () => {
    if (!iconBackfillStarted) {
      iconBackfillStarted = true;
      void backfillPinnedIcons();
    }
    return currentConfig;
  });

  ipcMain.handle('aurabar:get-app-icon', (_e, target: string) => getIconDataUrl(target));

  ipcMain.handle('aurabar:save-config', (e, nextConfig: AppConfig) => {
    const prevSettings = currentConfig.settings;
    currentConfig = saveConfig({
      ...nextConfig,
      pinnedApps: withResolvedExeNames(nextConfig.pinnedApps)
    });
    // Pin edits and reminders save often; only touch window layout when it can have changed
    if (layoutKeyOf(prevSettings) !== layoutKeyOf(currentConfig.settings)) {
      if (prevSettings.alwaysOnTop !== currentConfig.settings.alwaysOnTop) {
        syncKeepOnTop(currentConfig.settings);
      }
      syncTaskbarReplacement(currentConfig.settings);
      applyAllLayouts(currentConfig.settings);
      rebuildTrayMenu();
    }
    broadcastConfig(currentConfig, e.sender);
    return currentConfig;
  });

  ipcMain.handle('aurabar:set-popover-open', (_e, open: boolean) => {
    isPopoverOpen = open;
    if (open) {
      dockInteractiveState = true;
      dockWindow?.setIgnoreMouseEvents(false);
      ensureOnTop(dockWindow);
      dockWindow?.focus();
    } else {
      updateCursorHitTesting();
    }
  });

  ipcMain.on('aurabar:set-dock-interactive', (_e, interactive: boolean) => {
    dockInteractiveLock = interactive;
    updateCursorHitTesting();
  });

  ipcMain.handle('aurabar:set-island-expanded', (_e, expanded: boolean) => {
    isIslandExpanded = expanded;
    if (expanded) {
      islandInteractiveState = true;
      islandWindow?.setIgnoreMouseEvents(false);
      ensureOnTop(islandWindow);
      islandWindow?.focus();
    } else {
      updateCursorHitTesting();
    }
  });

  ipcMain.on('aurabar:set-island-interactive', (_e, interactive: boolean) => {
    islandInteractiveLock = interactive;
    updateCursorHitTesting();
  });

  ipcMain.on('aurabar:set-hit-rects', (_e, view: 'dock' | 'island', rects: HitRect[]) => {
    if (view === 'dock') {
      dockLocalHitRects = Array.isArray(rects) ? rects : [];
    } else {
      islandLocalHitRects = Array.isArray(rects) ? rects : [];
    }
    updateCursorHitTesting();
  });

  ipcMain.handle('aurabar:get-system-stats', () => getSystemStats());
  ipcMain.handle('aurabar:get-running-windows', () => listRunningWindows());
  ipcMain.handle('aurabar:get-background-apps', () => listBackgroundApps());
  ipcMain.handle('aurabar:get-installed-apps', () => listInstalledApps());
  ipcMain.handle('aurabar:create-pinned-from-path', (_e, filePath: string) =>
    createPinnedAppFromPath(filePath)
  );
  ipcMain.handle('aurabar:import-taskbar-apps', () => importTaskbarPinnedApps());
  ipcMain.handle('aurabar:focus-window', (_e, pid: number, hwnd?: string) =>
    focusWindowByPid(pid, hwnd)
  );
  ipcMain.handle('aurabar:open-app', (_e, pid: number, executablePath?: string) =>
    openAppByPid(pid, executablePath)
  );
  ipcMain.handle('aurabar:close-window', (_e, hwnd: string) => closeWindowByHwnd(hwnd));
  ipcMain.handle('aurabar:get-window-thumb', (_e, hwnd: string) => getWindowThumbnail(hwnd));
  ipcMain.handle('aurabar:quit-process', (_e, pid: number, executablePath?: string) =>
    quitAppByPid(pid, executablePath)
  );
  ipcMain.handle('aurabar:launch-target', (_e, target: string) => launchTarget(target));
  ipcMain.handle('aurabar:pick-app-file', () => pickExecutableOrFolder(dockWindow));
  ipcMain.handle('aurabar:get-media-info', () => getCurrentMedia());
  ipcMain.handle(
    'aurabar:get-lyrics',
    (_e, title: unknown, artist: unknown, album: unknown, durationSec: unknown) =>
      getLyrics(
        typeof title === 'string' ? title.slice(0, 300) : '',
        typeof artist === 'string' ? artist.slice(0, 300) : '',
        typeof album === 'string' ? album.slice(0, 300) : '',
        typeof durationSec === 'number' && Number.isFinite(durationSec) ? durationSec : 0
      )
  );
  ipcMain.handle('aurabar:send-media-cmd', (_e, cmd: 'playPause' | 'next' | 'previous') =>
    sendMediaCommand(cmd)
  );
  ipcMain.handle('aurabar:adjust-volume', (_e, action: 'up' | 'down' | 'mute') =>
    adjustSystemVolume(action)
  );
  ipcMain.handle('aurabar:get-volume', () => getSystemVolume());
  ipcMain.handle('aurabar:set-volume', (_e, level: number) => setSystemVolume(level));
  ipcMain.handle('aurabar:toggle-mute', () => toggleSystemMute());
  ipcMain.handle(
    'aurabar:system-action',
    (_e, action: 'lock' | 'taskmgr' | 'settings' | 'start' | 'quicksettings' | 'desktop') =>
      runQuickSystemAction(action)
  );
  ipcMain.handle('aurabar:get-keyboard-lang', () => getKeyboardLayoutCode());
  ipcMain.handle('aurabar:switch-keyboard-lang', () => switchKeyboardLayout());
  ipcMain.handle('aurabar:get-network-info', () => getNetworkInfo());
  ipcMain.handle('aurabar:hide-dock', () => {
    isPopoverOpen = false;
    dockInteractiveLock = false;
    dockInteractiveState = false;
    dockWindow?.setIgnoreMouseEvents(true);
    dockWindow?.hide();
    if (taskbarWasAutoHidden) {
      taskbarWasAutoHidden = false;
      lastTaskbarLayoutKey = '';
      void setWindowsTaskbarReplacement(false);
    }
    rebuildTrayMenu();
  });
  ipcMain.handle('aurabar:quit', () => app.quit());
}

// Same data folder whether run from source or installed, so an update never loses the config
app.setPath(
  'userData',
  process.env.AURABAR_USER_DATA || path.join(app.getPath('appData'), 'aurabar')
);
app.setAppUserModelId('com.m7devcore.aurabar');

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  win32Daemon.start();

  app.on('second-instance', () => {
    if (dockWindow) {
      if (!dockWindow.isVisible()) dockWindow.showInactive();
      ensureOnTop(dockWindow);
      dockWindow.focus();
    }
    if (islandWindow && currentConfig.settings.musicPosition === 'top') {
      if (!islandWindow.isVisible()) islandWindow.showInactive();
      ensureOnTop(islandWindow);
    }
  });

  app.whenReady().then(() => {
    registerIpcHandlers();
    createWindows();
    setupTray();
    startUpdater(
      () => rebuildTrayMenu(),
      async () => {
        if (!taskbarWasAutoHidden) return;
        taskbarWasAutoHidden = false;
        lastTaskbarLayoutKey = '';
        await win32Daemon.send('TASKBAR_SHOW');
      }
    );
    setInterval(updateCursorHitTesting, 10);

    globalShortcut.register('Alt+Space', () => {
      toggleDockVisibility();
    });

    screen.on('display-metrics-changed', () => {
      if (currentConfig.settings.replaceWindowsTaskbar) {
        syncTaskbarReplacement(currentConfig.settings);
      }
      applyAllLayouts(currentConfig.settings);
    });
  });

  app.on('before-quit', (e) => {
    if (isQuitting) return;
    isQuitting = true;
    stopMediaWorker();
    stopUpdater();
    dockWindow?.hide();
    islandWindow?.hide();
    if (taskbarWasAutoHidden) {
      e.preventDefault();
      taskbarWasAutoHidden = false;
      lastTaskbarLayoutKey = '';
      void win32Daemon.send('TASKBAR_SHOW').finally(() => {
        win32Daemon.stop();
        app.exit(0);
      });
    } else {
      win32Daemon.stop();
    }
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    stopMediaWorker();
    if (taskbarWasAutoHidden) {
      restoreWindowsTaskbarSync();
    }
    win32Daemon.stop();
  });
}
