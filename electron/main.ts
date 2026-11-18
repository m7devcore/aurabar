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
import { getCurrentMedia, sendMediaCommand } from './services/mediaControl';
import { loadConfig, saveConfig } from './services/store';
import { getSystemStats } from './services/systemStats';
import { win32Daemon } from './services/win32Daemon';
import {
  adjustSystemVolume,
  createPinnedAppFromPath,
  focusWindowByPid,
  getIconDataUrl,
  getKeyboardLayoutCode,
  importTaskbarPinnedApps,
  launchTarget,
  listInstalledApps,
  listRunningWindows,
  pickExecutableOrFolder,
  resolveExeName,
  restoreWindowsTaskbarSync,
  runQuickSystemAction,
  setWindowsTaskbarReplacement,
  switchKeyboardLayout
} from './services/windowsManager';
import type { AppConfig, DockSettings } from '../src/types';

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
  const height = 240;
  const x = Math.round(display.bounds.x + (display.bounds.width - width) / 2);
  const y = display.bounds.y + 4;
  return { x, y, width, height };
}

function getReservedHeightPx(settings: DockSettings): number {
  const barH = settings.compactMode ? 42 : 48;
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

function ensureOnTop(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
  const hwnd = getHwndNumber(win);
  if (hwnd !== '0') {
    void win32Daemon.send(`TOPMOST ${hwnd}`);
  }
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
    dockWindow.setAlwaysOnTop(true, 'screen-saver');
    dockWindow.setBounds(computeDockBounds(settings), false);
    placeDockPhysical(settings);
  }
  if (islandWindow && !islandWindow.isDestroyed()) {
    islandWindow.setAlwaysOnTop(true, 'screen-saver');
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
  currentConfig = loadConfig();
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
  dockWindow.setAlwaysOnTop(true, 'screen-saver');
  dockWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  dockWindow.setIgnoreMouseEvents(true);
  loadView(dockWindow, 'dock');
  dockWindow.once('ready-to-show', () => {
    dockWindow?.setAlwaysOnTop(true, 'screen-saver');
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
    ensureOnTop(dockWindow);
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
  islandWindow.setAlwaysOnTop(true, 'screen-saver');
  islandWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  islandWindow.setIgnoreMouseEvents(true);
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
    ensureOnTop(islandWindow);
  });

  void win32Daemon.send(`SET_HWNDS ${getHwndNumber(dockWindow)} ${getHwndNumber(islandWindow)}`);
}

let rebuildTrayMenu: () => void = () => undefined;

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
            dockWindow?.webContents.send('aurabar:config-updated', currentConfig);
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
            dockWindow?.webContents.send('aurabar:config-updated', currentConfig);
            rebuildTrayMenu();
          }
        },
        { type: 'separator' },
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
  ipcMain.handle('aurabar:get-config', () => {
    const missingIcons = currentConfig.pinnedApps.some((item) => !item.iconDataUrl);
    if (missingIcons) {
      void Promise.all(
        currentConfig.pinnedApps.map(async (item) => ({
          ...item,
          iconDataUrl: item.iconDataUrl || (await getIconDataUrl(item.target)),
          exeName: item.exeName ?? resolveExeName(item.target)
        }))
      ).then((enrichedApps) => {
        currentConfig = { ...currentConfig, pinnedApps: enrichedApps };
        dockWindow?.webContents.send('aurabar:config-updated', currentConfig);
      });
    }
    return currentConfig;
  });

  ipcMain.handle('aurabar:get-app-icon', (_e, target: string) => getIconDataUrl(target));

  ipcMain.handle('aurabar:save-config', (_e, nextConfig: AppConfig) => {
    currentConfig = saveConfig(nextConfig);
    syncTaskbarReplacement(currentConfig.settings);
    applyAllLayouts(currentConfig.settings);
    rebuildTrayMenu();
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
  ipcMain.handle('aurabar:get-installed-apps', () => listInstalledApps());
  ipcMain.handle('aurabar:create-pinned-from-path', (_e, filePath: string) =>
    createPinnedAppFromPath(filePath)
  );
  ipcMain.handle('aurabar:import-taskbar-apps', () => importTaskbarPinnedApps());
  ipcMain.handle('aurabar:focus-window', (_e, pid: number, hwnd?: string) =>
    focusWindowByPid(pid, hwnd)
  );
  ipcMain.handle('aurabar:launch-target', (_e, target: string) => launchTarget(target));
  ipcMain.handle('aurabar:pick-app-file', () => pickExecutableOrFolder(dockWindow));
  ipcMain.handle('aurabar:get-media-info', () => getCurrentMedia());
  ipcMain.handle('aurabar:send-media-cmd', (_e, cmd: 'playPause' | 'next' | 'previous') =>
    sendMediaCommand(cmd)
  );
  ipcMain.handle('aurabar:adjust-volume', (_e, action: 'up' | 'down' | 'mute') =>
    adjustSystemVolume(action)
  );
  ipcMain.handle(
    'aurabar:system-action',
    (_e, action: 'lock' | 'taskmgr' | 'settings' | 'start' | 'quicksettings' | 'desktop') =>
      runQuickSystemAction(action)
  );
  ipcMain.handle('aurabar:get-keyboard-lang', () => getKeyboardLayoutCode());
  ipcMain.handle('aurabar:switch-keyboard-lang', () => switchKeyboardLayout());
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
    if (taskbarWasAutoHidden) {
      restoreWindowsTaskbarSync();
    }
    win32Daemon.stop();
  });
}
