import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  screen,
  Tray
} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getCurrentMedia, sendMediaCommand, stopMediaWorker } from './services/mediaControl';
import { getLyrics } from './services/lyrics';
import {
  checkForUpdates,
  getUpdateInfo,
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
  activateWindowByPid,
  adjustSystemVolume,
  clearLiveThumbnails,
  closeWindowByHwnd,
  connectWifiNetwork,
  createPinnedAppFromPath,
  focusWindowByPid,
  getIconDataUrl,
  getKeyboardLayoutCode,
  getNetworkInfo,
  getNightLightStatus,
  getScreenBrightness,
  getSystemVolume,
  getWindowThumbnail,
  importTaskbarPinnedApps,
  launchTarget,
  listAudioDevices,
  listAudioSessions,
  listBackgroundApps,
  listInstalledApps,
  listRunningWindows,
  listWifiNetworks,
  openAppByPid,
  pickExecutableOrFolder,
  quitAppByPid,
  resolveAppIdentity,
  resolveExeName,
  restoreWindowsTaskbarSync,
  runQuickSystemAction,
  setAudioSessionVolume,
  setDefaultAudioDevice,
  setLiveThumbnails,
  setScreenBrightness,
  setSystemVolume,
  setWindowsTaskbarReplacement,
  startLiveWindowPeek,
  stopLiveWindowPeek,
  switchKeyboardLayout,
  toggleAudioSessionMute,
  toggleNightLight,
  toggleSystemMute,
  wakeHiddenApp,
  type LiveThumbSlot
} from './services/windowsManager';
import type { AppConfig, DockSettings, PinnedApp, SystemAction } from '../src/types';

interface HitRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface SecondaryDockEntry {
  displayId: number;
  win: BrowserWindow;
  ready: boolean;
  popoverOpen: boolean;
  interactiveState: boolean;
  interactiveLock: boolean;
  localHitRects: HitRect[];
  cachedBounds: Electron.Rectangle;
  lastInsideAt: number;
  fullscreenSuspended: boolean;
  notFullscreenStreak: number;
  lastReserveKey: string;
}

const DOCK_CANVAS_HEIGHT = 500;

let dockWindow: BrowserWindow | null = null;
let islandWindow: BrowserWindow | null = null;
const secondaryDocks = new Map<number, SecondaryDockEntry>();
let dockManuallyHidden = false;
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
let dockBoundsCache: Electron.Rectangle | null = null;
let islandBoundsCache: Electron.Rectangle | null = null;
let dockLastInsideAt = 0;
let islandLastInsideAt = 0;
let taskbarWasAutoHidden = false;
let lastTaskbarLayoutKey = '';
let isQuitting = false;

function createTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect x="2" y="2" width="28" height="28" rx="8" fill="#121215" stroke="#D8BF95" stroke-width="1.6"/>
      <rect x="6" y="11" width="20" height="10" rx="5" fill="#2A2B31" stroke="#8C8F99" stroke-width="0.9"/>
      <rect x="9.5" y="13.5" width="3" height="5" rx="1.5" fill="#C9CFD8"/>
      <rect x="14.5" y="13.5" width="3" height="5" rx="1.5" fill="#EBD2A4"/>
      <rect x="19.5" y="13.5" width="3" height="5" rx="1.5" fill="#C9CFD8"/>
    </svg>
  `.trim();
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  );
}

function computeDockBoundsForDisplay(settings: DockSettings, display: Electron.Display) {
  const area = settings.replaceWindowsTaskbar ? display.bounds : display.workArea;
  const width = area.width;
  const height = DOCK_CANVAS_HEIGHT;
  const x = area.x;
  const y = settings.position === 'top' ? area.y : area.y + area.height - height;
  return { x, y, width, height };
}

function computeDockBounds(settings: DockSettings) {
  return computeDockBoundsForDisplay(settings, screen.getPrimaryDisplay());
}

function computeIslandBounds() {
  const display = screen.getPrimaryDisplay();
  const width = 440;
  // Tall enough for the expanded island with lyrics; the window is click-through outside it
  const height = 360;
  const x = Math.round(display.bounds.x + (display.bounds.width - width) / 2);
  const topOffset =
    currentConfig?.settings.position === 'top' ? getReservedHeightPx(currentConfig.settings) + 4 : 4;
  const y = display.bounds.y + topOffset;
  return { x, y, width, height };
}

function getReservedHeightPx(settings: DockSettings): number {
  const barH = settings.compactMode ? 46 : 54;
  // Floating pill sits 4px from edge + 6px clean breathing gap so maximized borders never touch
  return barH + 10;
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
  const wanted = currentConfig?.settings.alwaysOnTop ?? true;
  if (win.isAlwaysOnTop() !== wanted) {
    win.setAlwaysOnTop(wanted, 'screen-saver');
  }
}

function syncKeepOnTop(settings: DockSettings): void {
  void win32Daemon.send(`KEEP_TOP ${settings.alwaysOnTop ? 1 : 0}`);
  applyTopmost(dockWindow);
  applyTopmost(islandWindow);
  for (const entry of secondaryDocks.values()) {
    applyTopmost(entry.win);
  }
}

let lastExtraHwndsKey = '';
let liveThumbOwner: Electron.WebContents | null = null;
let livePeekOwner: Electron.WebContents | null = null;

function clearLiveThumbsIfOwner(sender?: Electron.WebContents | null): void {
  if (!sender || liveThumbOwner === null || liveThumbOwner === sender) {
    liveThumbOwner = null;
    clearLiveThumbnails();
  }
}

function stopLivePeekIfOwner(sender?: Electron.WebContents | null): void {
  if (!sender || livePeekOwner === null || livePeekOwner === sender) {
    livePeekOwner = null;
    stopLiveWindowPeek();
  }
}

function syncExtraHwndsToBridge(): void {
  const hwnds: string[] = [];
  for (const entry of secondaryDocks.values()) {
    if (!entry.ready || entry.win.isDestroyed()) continue;
    const h = getHwndNumber(entry.win);
    if (h !== '0') hwnds.push(h);
  }
  const key = hwnds.join(',');
  if (key === lastExtraHwndsKey) return;
  lastExtraHwndsKey = key;
  void win32Daemon.send(hwnds.length > 0 ? `SET_EXTRA_HWNDS ${key}` : 'SET_EXTRA_HWNDS');
}

function findSecondaryEntryBySender(sender: Electron.WebContents): SecondaryDockEntry | null {
  for (const entry of secondaryDocks.values()) {
    if (!entry.win.isDestroyed() && entry.win.webContents === sender) return entry;
  }
  return null;
}

function syncSecondaryWorkArea(
  entry: SecondaryDockEntry,
  display: Electron.Display,
  settings: DockSettings
): void {
  if (!entry.ready || entry.win.isDestroyed()) return;
  const hwnd = getHwndNumber(entry.win);
  if (hwnd === '0') return;
  if (!settings.replaceWindowsTaskbar || dockManuallyHidden) {
    if (entry.lastReserveKey) {
      entry.lastReserveKey = '';
      void win32Daemon.send(`SEC_RELEASE ${hwnd}`);
    }
    return;
  }
  const reservePhys = Math.round(getReservedHeightPx(settings) * (display.scaleFactor || 1));
  const key = `${settings.position}|${reservePhys}|${display.bounds.width}x${display.bounds.height}`;
  if (entry.lastReserveKey === key) return;
  entry.lastReserveKey = key;
  void win32Daemon.send(`SEC_RESERVE ${hwnd} ${settings.position} ${reservePhys}`);
}

function placeSecondaryDockPhysical(
  entry: SecondaryDockEntry,
  display: Electron.Display,
  settings: DockSettings
): void {
  if (entry.win.isDestroyed()) return;
  const dipBounds = computeDockBoundsForDisplay(settings, display);
  setBoundsIfChanged(entry.win, dipBounds);
  entry.cachedBounds = dipBounds;
  const hwnd = getHwndNumber(entry.win);
  if (hwnd !== '0') {
    const phys = screen.dipToScreenRect(entry.win, dipBounds);
    void win32Daemon.send(`PLACE_WIN ${hwnd} ${phys.x} ${phys.y} ${phys.width} ${phys.height}`);
  }
}

function createSecondaryDock(display: Electron.Display, settings: DockSettings): SecondaryDockEntry {
  const bounds = computeDockBoundsForDisplay(settings, display);
  const win = new BrowserWindow({
    ...bounds,
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
  const entry: SecondaryDockEntry = {
    displayId: display.id,
    win,
    ready: false,
    popoverOpen: false,
    interactiveState: false,
    interactiveLock: false,
    localHitRects: [],
    cachedBounds: bounds,
    lastInsideAt: 0,
    fullscreenSuspended: false,
    notFullscreenStreak: 0,
    lastReserveKey: ''
  };
  applyTopmost(win);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true);
  lockDownNavigation(win);
  loadView(win, 'secondary-dock');
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    entry.ready = true;
    const freshDisplay = screen.getAllDisplays().find((d) => d.id === display.id) ?? display;
    const targetBounds = computeDockBoundsForDisplay(currentConfig.settings, freshDisplay);
    win.setBounds(targetBounds, false);
    win.setBounds(targetBounds, false);
    syncExtraHwndsToBridge();
    placeSecondaryDockPhysical(entry, freshDisplay, currentConfig.settings);
    syncSecondaryWorkArea(entry, freshDisplay, currentConfig.settings);
    if (!dockManuallyHidden && !entry.fullscreenSuspended) {
      win.showInactive();
      ensureOnTop(win);
    }
  });
  win.on('blur', () => {
    entry.interactiveLock = false;
    stopLivePeekIfOwner(win.webContents);
    clearLiveThumbsIfOwner(win.webContents);
    if (entry.popoverOpen) {
      entry.popoverOpen = false;
      if (!win.isDestroyed()) win.webContents.send('glassy:blurred');
    }
    applyTopmost(win);
  });
  win.on('show', syncCursorHitTestTimer);
  win.on('hide', syncCursorHitTestTimer);
  win.on('closed', () => {
    secondaryDocks.delete(display.id);
    syncExtraHwndsToBridge();
    syncCursorHitTestTimer();
  });
  return entry;
}

function syncSecondaryDocks(settings: DockSettings): void {
  const primary = screen.getPrimaryDisplay();
  const wanted = settings.showOnAllDisplays
    ? screen.getAllDisplays().filter((d) => d.id !== primary.id)
    : [];
  const wantedIds = new Set(wanted.map((d) => d.id));

  for (const [id, entry] of Array.from(secondaryDocks.entries())) {
    if (!wantedIds.has(id) || entry.win.isDestroyed()) {
      secondaryDocks.delete(id);
      if (!entry.win.isDestroyed()) {
        if (entry.lastReserveKey) {
          const hwnd = getHwndNumber(entry.win);
          if (hwnd !== '0') void win32Daemon.send(`SEC_RELEASE ${hwnd}`);
        }
        entry.win.destroy();
      }
    }
  }

  for (const display of wanted) {
    let entry = secondaryDocks.get(display.id);
    if (!entry) {
      entry = createSecondaryDock(display, settings);
      secondaryDocks.set(display.id, entry);
    } else if (entry.ready && !entry.win.isDestroyed()) {
      applyTopmost(entry.win);
      placeSecondaryDockPhysical(entry, display, settings);
      syncSecondaryWorkArea(entry, display, settings);
      if (!dockManuallyHidden && !entry.fullscreenSuspended && !entry.win.isVisible()) {
        entry.win.showInactive();
        ensureOnTop(entry.win);
      } else if (dockManuallyHidden && entry.win.isVisible()) {
        entry.win.hide();
      }
    }
  }

  syncExtraHwndsToBridge();
}

function ensureOnTop(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed()) return;
  if (!(currentConfig?.settings.alwaysOnTop ?? true)) return;
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

function setBoundsIfChanged(win: BrowserWindow, next: Electron.Rectangle): void {
  const cur = win.getBounds();
  if (
    Math.abs(cur.x - next.x) > 1 ||
    Math.abs(cur.y - next.y) > 1 ||
    Math.abs(cur.width - next.width) > 1 ||
    Math.abs(cur.height - next.height) > 1
  ) {
    win.setBounds(next, false);
  }
  if (win === dockWindow) dockBoundsCache = next;
  else if (win === islandWindow) islandBoundsCache = next;
}

function placeDockPhysical(settings: DockSettings): void {
  if (!dockWindow || dockWindow.isDestroyed()) return;
  const dipBounds = computeDockBounds(settings);
  const phys = screen.dipToScreenRect(dockWindow, dipBounds);
  void win32Daemon.send(`PLACE_DOCK ${phys.x} ${phys.y} ${phys.width} ${phys.height}`);
}

function applyAllLayouts(settings: DockSettings): void {
  if (dockWindow && !dockWindow.isDestroyed()) {
    applyTopmost(dockWindow);
    setBoundsIfChanged(dockWindow, computeDockBounds(settings));
    placeDockPhysical(settings);
  }
  if (islandWindow && !islandWindow.isDestroyed()) {
    applyTopmost(islandWindow);
    setBoundsIfChanged(islandWindow, computeIslandBounds());
    if (settings.musicPosition === 'top') {
      if (!islandWindow.isVisible() && !fullscreenSuspended) {
        islandWindow.showInactive();
        ensureOnTop(islandWindow);
      }
    } else if (islandWindow.isVisible() && !(fullscreenSuspended && islandFullscreenPeek)) {
      islandWindow.hide();
    }
  }
  syncSecondaryDocks(settings);
}

function loadView(win: BrowserWindow, view: 'dock' | 'secondary-dock' | 'island'): void {
  const devUrl = process.env.GLASSY_DEV_URL;
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
  dockWindow.on('show', syncCursorHitTestTimer);
  dockWindow.on('hide', () => {
    syncCursorHitTestTimer();
    // Only restore the native Windows taskbar if the user explicitly hid the dock (never on
    // transient OS hides or fullscreen suspension).
    if (!dockManuallyHidden || fullscreenSuspended || isQuitting) return;
    if (taskbarWasAutoHidden) {
      taskbarWasAutoHidden = false;
      lastTaskbarLayoutKey = '';
      void setWindowsTaskbarReplacement(false);
    }
  });
  dockWindow.on('blur', () => {
    dockInteractiveLock = false;
    stopLivePeekIfOwner(dockWindow?.webContents);
    clearLiveThumbsIfOwner(dockWindow?.webContents);
    if (isPopoverOpen) {
      isPopoverOpen = false;
      dockWindow?.webContents.send('glassy:blurred');
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
  islandWindow.on('show', syncCursorHitTestTimer);
  islandWindow.on('hide', syncCursorHitTestTimer);
  islandWindow.on('blur', () => {
    islandInteractiveLock = false;
    if (isIslandExpanded) {
      isIslandExpanded = false;
      islandWindow?.webContents.send('glassy:island-blurred');
    }
    applyTopmost(islandWindow);
  });

  syncKeepOnTop(currentConfig.settings);
  void win32Daemon.send(`SET_HWNDS ${getHwndNumber(dockWindow)} ${getHwndNumber(islandWindow)}`);
  syncSecondaryDocks(currentConfig.settings);
}

let rebuildTrayMenu: () => void = () => undefined;

// The window that saved a config already has it; echoing it back would race with newer local
// edits (e.g. typing a folder name) and briefly revert them
function allOverlayWindows(): BrowserWindow[] {
  const wins: BrowserWindow[] = [];
  if (dockWindow && !dockWindow.isDestroyed()) wins.push(dockWindow);
  if (islandWindow && !islandWindow.isDestroyed()) wins.push(islandWindow);
  for (const entry of secondaryDocks.values()) {
    if (!entry.win.isDestroyed()) wins.push(entry.win);
  }
  return wins;
}

function broadcastUpdateInfo(): void {
  const info = getUpdateInfo();
  for (const win of allOverlayWindows()) {
    win.webContents.send('glassy:update-info', info);
  }
}

function broadcastConfig(cfg: AppConfig, except?: Electron.WebContents): void {
  for (const win of allOverlayWindows()) {
    if (win.webContents !== except) {
      win.webContents.send('glassy:config-updated', cfg);
    }
  }
}

// While a full-screen app (game, video, browser F11) is in front, the dock and island step aside:
// they sit above everything, so they would otherwise be drawn over the game. What was visible
// before is shown again afterwards, so a dock the user hid on purpose stays hidden.
let fullscreenSuspended = false;
let suspendedDockWasVisible = false;
let suspendedIslandWasVisible = false;
let islandFullscreenPeek = false;
let fullscreenPollTimer: ReturnType<typeof setInterval> | null = null;
let fullscreenPolling = false;
let notFullscreenStreak = 0;
let reassertTimer: ReturnType<typeof setTimeout> | null = null;

function clearReassertTimer(): void {
  if (reassertTimer) {
    clearTimeout(reassertTimer);
    reassertTimer = null;
  }
}

function setFullscreenSuspended(next: boolean): void {
  if (next === fullscreenSuspended) return;
  fullscreenSuspended = next;
  clearReassertTimer();
  if (next) {
    stopLivePeekIfOwner(dockWindow?.webContents);
    clearLiveThumbsIfOwner(dockWindow?.webContents);
    suspendedDockWasVisible = !dockManuallyHidden;
    suspendedIslandWasVisible = islandWindow?.isVisible() ?? false;
    islandFullscreenPeek = false;
    isPopoverOpen = false;
    dockInteractiveLock = false;
    dockInteractiveState = false;
    islandInteractiveLock = false;
    islandInteractiveState = false;
    dockWindow?.setIgnoreMouseEvents(true);
    islandWindow?.setIgnoreMouseEvents(true);
    dockWindow?.webContents.send('glassy:suspended', true);
    islandWindow?.webContents.send('glassy:suspended', true);
    dockWindow?.hide();
    islandWindow?.hide();
  } else {
    islandFullscreenPeek = false;
    // Sync bounds synchronously BEFORE showing so the dock appears directly at the right
    // coordinates without jumping (even after exiting 4:3 stretched fullscreen games).
    reassertLayoutAfterFullscreen();
    if ((suspendedDockWasVisible || !dockManuallyHidden) && dockWindow && !dockWindow.isDestroyed()) {
      dockWindow.showInactive();
      ensureOnTop(dockWindow);
      dockWindow.webContents.send('glassy:suspended', false);
    }
    if (
      suspendedIslandWasVisible &&
      islandWindow &&
      !islandWindow.isDestroyed() &&
      currentConfig.settings.musicPosition === 'top'
    ) {
      islandWindow.webContents.send('glassy:suspended', false);
      islandWindow.showInactive();
      ensureOnTop(islandWindow);
    } else if (
      currentConfig.settings.musicPosition !== 'top' &&
      islandWindow &&
      !islandWindow.isDestroyed() &&
      islandWindow.isVisible()
    ) {
      isIslandExpanded = false;
      islandInteractiveLock = false;
      islandInteractiveState = false;
      islandWindow.setIgnoreMouseEvents(true);
      islandWindow.hide();
      islandWindow.webContents.send('glassy:island-visibility', false);
    }
  }
}

function reassertLayoutAfterFullscreen(): void {
  clearReassertTimer();
  const applyOnce = () => {
    if (fullscreenSuspended || isQuitting) return;
    const settings = currentConfig.settings;
    // Re-place primary & secondary docks from fresh display metrics after a fullscreen
    // display-mode change (e.g. 4:3 stretched CS2) without triggering SPI_SETWORKAREA loops.
    if (dockWindow && !dockWindow.isDestroyed()) {
      applyTopmost(dockWindow);
      setBoundsIfChanged(dockWindow, computeDockBounds(settings));
      placeDockPhysical(settings);
    }
    if (islandWindow && !islandWindow.isDestroyed()) {
      applyTopmost(islandWindow);
      setBoundsIfChanged(islandWindow, computeIslandBounds());
    }
    const displays = screen.getAllDisplays();
    for (const entry of secondaryDocks.values()) {
      if (!entry.fullscreenSuspended && !entry.win.isDestroyed() && entry.ready) {
        const disp = displays.find((d) => d.id === entry.displayId);
        if (disp) placeSecondaryDockPhysical(entry, disp, settings);
      }
    }
  };
  applyOnce();
  // Single settle pass for games whose display-mode switch completes ~500ms after exit
  reassertTimer = setTimeout(() => {
    reassertTimer = null;
    applyOnce();
  }, 600);
}

function setSecondaryFullscreenSuspended(entry: SecondaryDockEntry, next: boolean): void {
  if (next === entry.fullscreenSuspended || entry.win.isDestroyed()) return;
  entry.fullscreenSuspended = next;
  if (next) {
    stopLivePeekIfOwner(entry.win.webContents);
    clearLiveThumbsIfOwner(entry.win.webContents);
    entry.popoverOpen = false;
    entry.interactiveLock = false;
    entry.interactiveState = false;
    entry.win.setIgnoreMouseEvents(true);
    entry.win.webContents.send('glassy:suspended', true);
    entry.win.hide();
  } else if (!dockManuallyHidden) {
    const display = screen.getAllDisplays().find((d) => d.id === entry.displayId);
    if (display) {
      placeSecondaryDockPhysical(entry, display, currentConfig.settings);
      entry.lastReserveKey = '';
      syncSecondaryWorkArea(entry, display, currentConfig.settings);
    }
    entry.win.showInactive();
    ensureOnTop(entry.win);
    entry.win.webContents.send('glassy:suspended', false);
  }
}

async function pollFullscreen(): Promise<void> {
  if (fullscreenPolling || isQuitting) return;
  const primaryLockedByIsland =
    fullscreenSuspended && Boolean(islandWindow && !islandWindow.isDestroyed() && islandWindow.isFocused());

  const secEntries = Array.from(secondaryDocks.values()).filter((e) => !e.win.isDestroyed());
  if (secEntries.length === 0) {
    if (primaryLockedByIsland) {
      notFullscreenStreak = 0;
      return;
    }
    fullscreenPolling = true;
    try {
      const reply = await win32Daemon.send('FULLSCREEN');
      if (reply === '1') {
        notFullscreenStreak = 0;
        setFullscreenSuspended(true);
      } else if (reply === '2') {
        // User pressed Windows key (Start Menu / Search active): wake immediately with 0 delay!
        notFullscreenStreak = 2;
        setFullscreenSuspended(false);
      } else if (reply === '0') {
        notFullscreenStreak += 1;
        if (notFullscreenStreak >= 2) setFullscreenSuspended(false);
      }
    } finally {
      fullscreenPolling = false;
    }
    return;
  }

  fullscreenPolling = true;
  try {
    const primaryHwnd = getHwndNumber(dockWindow);
    const hwnds = [primaryHwnd, ...secEntries.map((e) => getHwndNumber(e.win))];
    const reply = await win32Daemon.send(`FULLSCREEN_OF ${hwnds.join(',')}`);
    const flags = reply.split(',');

    if (primaryLockedByIsland) {
      notFullscreenStreak = 0;
    } else if (flags[0] === '1') {
      notFullscreenStreak = 0;
      setFullscreenSuspended(true);
    } else if (flags[0] === '2') {
      notFullscreenStreak = 2;
      setFullscreenSuspended(false);
    } else if (flags[0] === '0') {
      notFullscreenStreak += 1;
      if (notFullscreenStreak >= 2) setFullscreenSuspended(false);
    }

    for (let i = 0; i < secEntries.length; i++) {
      const entry = secEntries[i];
      const flag = flags[i + 1];
      if (flag === '1') {
        entry.notFullscreenStreak = 0;
        setSecondaryFullscreenSuspended(entry, true);
      } else if (flag === '2') {
        entry.notFullscreenStreak = 2;
        setSecondaryFullscreenSuspended(entry, false);
      } else if (flag === '0') {
        entry.notFullscreenStreak += 1;
        if (entry.notFullscreenStreak >= 2) setSecondaryFullscreenSuspended(entry, false);
      }
    }
  } finally {
    fullscreenPolling = false;
  }
}

function syncFullscreenWatcher(): void {
  const wanted = currentConfig.settings.hideInFullscreen;
  if (wanted && !fullscreenPollTimer) {
    fullscreenPollTimer = setInterval(() => void pollFullscreen(), 450);
  } else if (!wanted) {
    if (fullscreenPollTimer) clearInterval(fullscreenPollTimer);
    fullscreenPollTimer = null;
    notFullscreenStreak = 0;
    setFullscreenSuspended(false);
    for (const entry of secondaryDocks.values()) {
      entry.notFullscreenStreak = 0;
      setSecondaryFullscreenSuspended(entry, false);
    }
  }
}

// Removes leftover legacy AuraBar shortcuts/cache after upgrading to Glassy
function cleanupLegacyBrandArtifacts(): void {
  if (!app.isPackaged) return;
  const targets = [
    path.join(app.getPath('desktop'), 'AuraBar.lnk'),
    path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'AuraBar.lnk'),
    path.join(process.env.LOCALAPPDATA || '', 'AuraBar', 'native-cache')
  ];
  for (const p of targets) {
    try {
      if (p && fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true });
      }
    } catch {
      // Best-effort cleanup
    }
  }
}

// Registers Glassy to open when the user signs in. Only the installed build can: running from
// source would register the bare electron.exe, which is not the app.
function applyLaunchAtStartup(enabled: boolean): void {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: enabled });
  } catch {
    // Registry write refused (policy / antivirus): the toggle simply has no effect
  }
}

function layoutKeyOf(s: DockSettings): string {
  return [
    s.replaceWindowsTaskbar,
    s.position,
    s.compactMode,
    s.musicPosition,
    s.alwaysOnTop,
    s.showOnAllDisplays
  ].join('|');
}

function withResolvedExeNames(apps: PinnedApp[]): PinnedApp[] {
  return apps.map((item) => {
    if (item.kind === 'group') {
      return { ...item, children: item.children ? withResolvedExeNames(item.children) : [] };
    }
    // Re-resolve missing exeName OR legacy 'update' from Squirrel shortcuts (Discord, Slack, Postman...)
    if ((item.exeName && item.exeName.toLowerCase() !== 'update') || !item.target) return item;
    const exeName = resolveExeName(item.target);
    return exeName ? { ...item, exeName } : item;
  });
}

let refreshedShellIconsOnce = false;

async function backfillPinnedIcons(): Promise<void> {
  const needIcon = new Map<string, string>();
  const needIdentity = new Map<string, string>();
  const refreshShell = !refreshedShellIconsOnce;
  refreshedShellIconsOnce = true;

  const collect = (apps: PinnedApp[]) => {
    for (const item of apps) {
      if (item.kind === 'group') {
        collect(item.children ?? []);
      } else if (item.target) {
        const isShell = /^shell:appsfolder\\/i.test(item.target);
        if (!item.iconDataUrl || (refreshShell && isShell)) {
          needIcon.set(item.id, item.target);
        }
        if (!item.appId && !item.installDir) needIdentity.set(item.id, item.target);
      }
    }
  };
  collect(currentConfig.pinnedApps);
  if (needIcon.size === 0 && needIdentity.size === 0) return;

  const foundIcons = new Map<string, string>();
  for (const [id, target] of needIcon) {
    const url = await getIconDataUrl(target);
    if (url) foundIcons.set(id, url);
  }

  const foundIdentities = new Map<string, { exeName?: string; appId?: string; installDir?: string }>();
  for (const [id, target] of needIdentity) {
    const ident = await resolveAppIdentity(target);
    if (ident.appId || ident.installDir || ident.exeName) {
      foundIdentities.set(id, ident);
    }
  }
  if (foundIcons.size === 0 && foundIdentities.size === 0) return;

  let changed = false;
  // Merge into whatever the config is *now*; the user may have edited pins meanwhile
  const apply = (apps: PinnedApp[]): PinnedApp[] =>
    apps.map((item) => {
      if (item.kind === 'group') {
        return { ...item, children: apply(item.children ?? []) };
      }
      const nextIcon = foundIcons.get(item.id);
      const iconUpdated = Boolean(nextIcon && nextIcon !== item.iconDataUrl);
      const ident = foundIdentities.get(item.id);
      const nextAppId = !item.appId && ident?.appId ? ident.appId : item.appId;
      const nextDir = !item.installDir && ident?.installDir ? ident.installDir : item.installDir;
      const nextExe =
        (!item.exeName || item.exeName.toLowerCase() === 'update') && ident?.exeName
          ? ident.exeName
          : item.exeName;
      if (
        iconUpdated ||
        nextAppId !== item.appId ||
        nextDir !== item.installDir ||
        nextExe !== item.exeName
      ) {
        changed = true;
        return {
          ...item,
          ...(iconUpdated ? { iconDataUrl: nextIcon } : {}),
          ...(nextAppId ? { appId: nextAppId } : {}),
          ...(nextDir ? { installDir: nextDir } : {}),
          ...(nextExe ? { exeName: nextExe } : {})
        };
      }
      return item;
    });
  const nextPinned = apply(currentConfig.pinnedApps);
  if (!changed) return;
  currentConfig = saveConfig({ ...currentConfig, pinnedApps: nextPinned });
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
  items.push({ label: `Glassy v${app.getVersion()}`, enabled: false }, { type: 'separator' });
  return items;
}

function setupTray(): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Glassy — Taskbar & Music Island');
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
        ...(app.isPackaged
          ? [
              {
                label: currentConfig.settings.launchAtStartup
                  ? '✓ Launch at Windows startup'
                  : 'Launch at Windows startup',
                click: () => {
                  currentConfig.settings.launchAtStartup = !currentConfig.settings.launchAtStartup;
                  saveConfig(currentConfig);
                  applyLaunchAtStartup(currentConfig.settings.launchAtStartup);
                  broadcastConfig(currentConfig);
                  rebuildTrayMenu();
                }
              } as Electron.MenuItemConstructorOptions
            ]
          : []),
        { type: 'separator' },
        ...updateMenuItems(),
        {
          label: 'Quit Glassy',
          click: () => app.quit()
        }
      ])
    );
  };
  rebuildTrayMenu();
  tray.on('click', () => toggleDockVisibility());
}

function toggleDockVisibility(): void {
  if (!dockWindow || fullscreenSuspended) return;
  if (dockWindow.isVisible()) {
    stopLivePeekIfOwner();
    clearLiveThumbsIfOwner();
    dockManuallyHidden = true;
    isPopoverOpen = false;
    dockInteractiveLock = false;
    dockInteractiveState = false;
    dockWindow.setIgnoreMouseEvents(true);
    dockWindow.webContents.send('glassy:suspended', true);
    dockWindow.hide();
    for (const entry of secondaryDocks.values()) {
      entry.popoverOpen = false;
      entry.interactiveLock = false;
      entry.interactiveState = false;
      if (!entry.win.isDestroyed()) {
        if (entry.lastReserveKey) {
          const hwnd = getHwndNumber(entry.win);
          if (hwnd !== '0') void win32Daemon.send(`SEC_RELEASE ${hwnd}`);
          entry.lastReserveKey = '';
        }
        entry.win.setIgnoreMouseEvents(true);
        entry.win.webContents.send('glassy:suspended', true);
        entry.win.hide();
      }
    }
    if (taskbarWasAutoHidden) {
      taskbarWasAutoHidden = false;
      lastTaskbarLayoutKey = '';
      void setWindowsTaskbarReplacement(false);
    }
  } else {
    dockManuallyHidden = false;
    dockWindow.webContents.send('glassy:suspended', false);
    for (const entry of secondaryDocks.values()) {
      if (!entry.win.isDestroyed() && !entry.fullscreenSuspended) {
        entry.win.webContents.send('glassy:suspended', false);
      }
    }
    if (currentConfig.settings.replaceWindowsTaskbar) {
      syncTaskbarReplacement(currentConfig.settings);
    }
    applyAllLayouts(currentConfig.settings);
    dockWindow.showInactive();
    ensureOnTop(dockWindow);
  }
  rebuildTrayMenu();
}

function toggleIslandVisibility(): void {
  if (!islandWindow || islandWindow.isDestroyed()) return;
  if (currentConfig.settings.musicPosition !== 'top' && !fullscreenSuspended) {
    return;
  }
  if (islandWindow.isVisible()) {
    if (fullscreenSuspended && currentConfig.settings.musicPosition !== 'top') {
      islandFullscreenPeek = false;
    }
    isIslandExpanded = false;
    islandInteractiveLock = false;
    islandInteractiveState = false;
    islandWindow.setIgnoreMouseEvents(true);
    islandWindow.hide();
    islandWindow.webContents.send('glassy:island-visibility', false);
  } else {
    if (fullscreenSuspended && currentConfig.settings.musicPosition !== 'top') {
      islandFullscreenPeek = true;
    }
    islandWindow.setAlwaysOnTop(true, 'screen-saver');
    islandWindow.setBounds(computeIslandBounds(), false);
    islandWindow.showInactive();
    islandWindow.webContents.send('glassy:island-visibility', true);
    ensureOnTop(islandWindow);
  }
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

let lastCursorX = Number.NaN;
let lastCursorY = Number.NaN;
let cursorHitTimer: ReturnType<typeof setInterval> | null = null;

function hasAnyVisibleOverlay(): boolean {
  if (isQuitting) return false;
  if (dockWindow && !dockWindow.isDestroyed() && dockWindow.isVisible()) return true;
  if (islandWindow && !islandWindow.isDestroyed() && islandWindow.isVisible()) return true;
  for (const entry of secondaryDocks.values()) {
    if (!entry.win.isDestroyed() && entry.win.isVisible()) return true;
  }
  return false;
}

function syncCursorHitTestTimer(): void {
  const needed = hasAnyVisibleOverlay();
  if (needed && !cursorHitTimer) {
    cursorHitTimer = setInterval(() => updateCursorHitTesting(false), 25);
  } else if (!needed && cursorHitTimer) {
    clearInterval(cursorHitTimer);
    cursorHitTimer = null;
  }
}

function updateCursorHitTesting(force = false): void {
  if (isQuitting) return;
  const dockVis = Boolean(dockWindow && !dockWindow.isDestroyed() && dockWindow.isVisible());
  const islandVis = Boolean(islandWindow && !islandWindow.isDestroyed() && islandWindow.isVisible());
  let secVis = false;
  let anySecWaitingLeave = false;
  for (const entry of secondaryDocks.values()) {
    if (!entry.win.isDestroyed() && entry.win.isVisible()) {
      secVis = true;
      if (entry.interactiveState && !entry.popoverOpen && !entry.interactiveLock) {
        anySecWaitingLeave = true;
      }
    }
  }
  if (!dockVis && !islandVis && !secVis) {
    syncCursorHitTestTimer();
    return;
  }

  const pt = screen.getCursorScreenPoint();
  const anyWaitingLeave =
    (dockInteractiveState && !isPopoverOpen && !dockInteractiveLock) ||
    (islandInteractiveState && !isIslandExpanded && !islandInteractiveLock) ||
    anySecWaitingLeave;
  // When the cursor is stationary and nothing is pending the 90ms leave-grace timer, skip all
  // getBounds() calls (cuts ~120 Win32 calls/sec down to 0 while idle or gaming).
  if (!force && !anyWaitingLeave && pt.x === lastCursorX && pt.y === lastCursorY) {
    return;
  }
  lastCursorX = pt.x;
  lastCursorY = pt.y;
  const nowMs = Date.now();

  if (dockVis && dockWindow) {
    const b = dockBoundsCache ?? (dockBoundsCache = dockWindow.getBounds());
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

  if (islandVis && islandWindow) {
    const b = islandBoundsCache ?? (islandBoundsCache = islandWindow.getBounds());
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

  for (const entry of secondaryDocks.values()) {
    if (entry.win.isDestroyed() || !entry.win.isVisible()) continue;
    const b = entry.cachedBounds;
    // Fast bounding-box reject: while gaming on Monitor 1 with a 1000Hz mouse, skip immediately!
    const inBox = pt.x >= b.x && pt.x <= b.x + b.width && pt.y >= b.y && pt.y <= b.y + b.height;
    const inside = inBox && isPointInRects(pt.x - b.x, pt.y - b.y, entry.localHitRects);
    const shouldBeInteractive = entry.popoverOpen || entry.interactiveLock || inside;
    if (shouldBeInteractive) {
      entry.lastInsideAt = nowMs;
      if (!entry.interactiveState) {
        entry.interactiveState = true;
        entry.win.setIgnoreMouseEvents(false);
      }
    } else if (entry.interactiveState && nowMs - entry.lastInsideAt > 90) {
      entry.interactiveState = false;
      entry.win.setIgnoreMouseEvents(true);
    }
  }
}

function registerIpcHandlers(): void {
  let iconBackfillStarted = false;
  ipcMain.handle('glassy:get-config', () => {
    if (!iconBackfillStarted) {
      iconBackfillStarted = true;
      // Defer icon/identity backfill slightly so startup taskbar hide & first paint are instant
      setTimeout(() => void backfillPinnedIcons(), 2500);
    }
    return currentConfig;
  });

  ipcMain.handle('glassy:get-app-icon', (_e, target: string) => getIconDataUrl(target));

  ipcMain.handle('glassy:save-config', (e, nextConfig: AppConfig) => {
    const prevSettings = currentConfig.settings;
    currentConfig = saveConfig({
      ...nextConfig,
      pinnedApps: withResolvedExeNames(nextConfig.pinnedApps)
    });
    if (prevSettings.hideInFullscreen !== currentConfig.settings.hideInFullscreen) {
      syncFullscreenWatcher();
    }
    if (prevSettings.launchAtStartup !== currentConfig.settings.launchAtStartup) {
      applyLaunchAtStartup(currentConfig.settings.launchAtStartup);
      rebuildTrayMenu();
    }
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
    void backfillPinnedIcons();
    return currentConfig;
  });

  ipcMain.handle('glassy:set-popover-open', (e, open: boolean) => {
    const sec = findSecondaryEntryBySender(e.sender);
    if (sec) {
      sec.popoverOpen = open;
      if (open) {
        sec.interactiveState = true;
        sec.win.setIgnoreMouseEvents(false);
        ensureOnTop(sec.win);
        sec.win.focus();
      } else {
        updateCursorHitTesting(true);
      }
      return;
    }
    isPopoverOpen = open;
    if (open) {
      dockInteractiveState = true;
      dockWindow?.setIgnoreMouseEvents(false);
      ensureOnTop(dockWindow);
      dockWindow?.focus();
    } else {
      updateCursorHitTesting(true);
    }
  });

  ipcMain.on('glassy:set-dock-interactive', (e, interactive: boolean) => {
    const sec = findSecondaryEntryBySender(e.sender);
    if (sec) {
      sec.interactiveLock = interactive;
    } else {
      dockInteractiveLock = interactive;
    }
    updateCursorHitTesting(true);
  });

  ipcMain.handle('glassy:set-island-expanded', (_e, expanded: boolean) => {
    isIslandExpanded = expanded;
    if (expanded) {
      islandInteractiveState = true;
      islandWindow?.setIgnoreMouseEvents(false);
      ensureOnTop(islandWindow);
      islandWindow?.focus();
    } else {
      updateCursorHitTesting(true);
    }
  });

  ipcMain.on('glassy:set-island-interactive', (_e, interactive: boolean) => {
    islandInteractiveLock = interactive;
    updateCursorHitTesting(true);
  });

  ipcMain.on('glassy:set-hit-rects', (e, view: 'dock' | 'island', rects: HitRect[]) => {
    const clean = Array.isArray(rects) ? rects : [];
    if (view === 'dock') {
      const sec = findSecondaryEntryBySender(e.sender);
      if (sec) {
        sec.localHitRects = clean;
      } else {
        dockLocalHitRects = clean;
      }
    } else {
      islandLocalHitRects = clean;
    }
    updateCursorHitTesting(true);
  });

  ipcMain.handle('glassy:get-system-stats', () => getSystemStats());
  ipcMain.handle('glassy:get-running-windows', () => listRunningWindows());
  ipcMain.handle('glassy:get-background-apps', () => listBackgroundApps());
  ipcMain.handle('glassy:get-installed-apps', () => listInstalledApps());
  ipcMain.handle('glassy:create-pinned-from-path', (_e, filePath: string) =>
    createPinnedAppFromPath(filePath)
  );
  ipcMain.handle('glassy:import-taskbar-apps', () => importTaskbarPinnedApps());
  ipcMain.handle('glassy:focus-window', (_e, pid: number, hwnd?: string) =>
    focusWindowByPid(pid, hwnd)
  );
  ipcMain.handle('glassy:activate-window', (_e, pid: number, hwnd?: string) =>
    activateWindowByPid(pid, hwnd)
  );
  ipcMain.on('glassy:peek-start', (e, hwnd: string) => {
    livePeekOwner = e.sender;
    startLiveWindowPeek(hwnd);
  });
  ipcMain.on('glassy:peek-stop', (e) => stopLivePeekIfOwner(e.sender));
  ipcMain.on('glassy:live-thumbs', (e, slots: LiveThumbSlot[]) => {
    const sec = findSecondaryEntryBySender(e.sender);
    const hostWin = sec ? sec.win : dockWindow;
    if (!hostWin || hostWin.isDestroyed() || !Array.isArray(slots) || slots.length === 0) {
      clearLiveThumbsIfOwner(e.sender);
      return;
    }
    liveThumbOwner = e.sender;
    const winBounds = hostWin.getBounds();
    const disp = screen.getDisplayMatching(winBounds);
    const scale = disp.scaleFactor || 1;
    const physicalSlots: LiveThumbSlot[] = slots.map((s) => {
      const phys = screen.dipToScreenRect(hostWin, {
        x: Math.round(winBounds.x + s.left),
        y: Math.round(winBounds.y + s.top),
        width: Math.round(s.width),
        height: Math.round(s.height)
      });
      return {
        hwnd: s.hwnd,
        left: phys.x,
        top: phys.y,
        width: phys.width,
        height: phys.height,
        radius: Math.round((s.radius ?? 7) * scale)
      };
    });
    setLiveThumbnails(physicalSlots);
  });
  ipcMain.on('glassy:live-thumbs-clear', (e) => clearLiveThumbsIfOwner(e.sender));
  ipcMain.handle('glassy:wake-hidden-app', (_e, exeName?: string, installDir?: string) =>
    wakeHiddenApp(exeName, installDir)
  );
  ipcMain.handle('glassy:open-app', (_e, pid: number, executablePath?: string) =>
    openAppByPid(pid, executablePath)
  );
  ipcMain.handle('glassy:close-window', (_e, hwnd: string) => closeWindowByHwnd(hwnd));
  ipcMain.handle('glassy:get-window-thumb', (_e, hwnd: string) => getWindowThumbnail(hwnd));
  ipcMain.handle('glassy:quit-process', (_e, pid: number, executablePath?: string) =>
    quitAppByPid(pid, executablePath)
  );
  ipcMain.handle('glassy:launch-target', (_e, target: string) => launchTarget(target));
  ipcMain.handle('glassy:pick-app-file', () => pickExecutableOrFolder(dockWindow));
  ipcMain.handle('glassy:get-update-info', () => getUpdateInfo());
  ipcMain.handle('glassy:check-updates', () => checkForUpdates(true));
  ipcMain.handle('glassy:install-update', () => installUpdateNow());
  ipcMain.handle('glassy:get-media-info', () => getCurrentMedia());
  ipcMain.handle(
    'glassy:get-lyrics',
    (_e, title: unknown, artist: unknown, album: unknown, durationSec: unknown) =>
      getLyrics(
        typeof title === 'string' ? title.slice(0, 300) : '',
        typeof artist === 'string' ? artist.slice(0, 300) : '',
        typeof album === 'string' ? album.slice(0, 300) : '',
        typeof durationSec === 'number' && Number.isFinite(durationSec) ? durationSec : 0
      )
  );
  ipcMain.handle('glassy:send-media-cmd', (_e, cmd: 'playPause' | 'next' | 'previous') =>
    sendMediaCommand(cmd)
  );
  ipcMain.handle('glassy:adjust-volume', (_e, action: 'up' | 'down' | 'mute') =>
    adjustSystemVolume(action)
  );
  ipcMain.handle('glassy:get-volume', () => getSystemVolume());
  ipcMain.handle('glassy:set-volume', (_e, level: number) => setSystemVolume(level));
  ipcMain.handle('glassy:toggle-mute', () => toggleSystemMute());
  ipcMain.handle('glassy:get-audio-devices', () => listAudioDevices());
  ipcMain.handle('glassy:set-audio-device', (_e, deviceId: string) =>
    setDefaultAudioDevice(deviceId)
  );
  ipcMain.handle('glassy:get-audio-sessions', () => listAudioSessions());
  ipcMain.handle('glassy:set-audio-session-vol', (_e, sessionId: string, level: number) =>
    setAudioSessionVolume(sessionId, level)
  );
  ipcMain.handle('glassy:toggle-audio-session-mute', (_e, sessionId: string) =>
    toggleAudioSessionMute(sessionId)
  );
  ipcMain.handle('glassy:get-brightness', () => getScreenBrightness());
  ipcMain.handle('glassy:set-brightness', (_e, level: number) => setScreenBrightness(level));
  ipcMain.handle('glassy:get-nightlight', () => getNightLightStatus());
  ipcMain.handle('glassy:toggle-nightlight', () => toggleNightLight());
  ipcMain.handle('glassy:list-wifi-networks', () => listWifiNetworks());
  ipcMain.handle('glassy:connect-wifi-network', (_e, ssid: string) => connectWifiNetwork(ssid));
  ipcMain.handle('glassy:system-action', (_e, action: SystemAction) =>
    runQuickSystemAction(action)
  );
  ipcMain.handle('glassy:get-keyboard-lang', () => getKeyboardLayoutCode());
  ipcMain.handle('glassy:switch-keyboard-lang', () => switchKeyboardLayout());
  ipcMain.handle('glassy:get-network-info', () => getNetworkInfo());
  ipcMain.handle('glassy:hide-dock', () => {
    stopLiveWindowPeek();
    clearLiveThumbnails();
    dockManuallyHidden = true;
    isPopoverOpen = false;
    dockInteractiveLock = false;
    dockInteractiveState = false;
    dockWindow?.setIgnoreMouseEvents(true);
    dockWindow?.hide();
    for (const entry of secondaryDocks.values()) {
      entry.popoverOpen = false;
      entry.interactiveLock = false;
      entry.interactiveState = false;
      if (!entry.win.isDestroyed()) {
        entry.win.setIgnoreMouseEvents(true);
        entry.win.hide();
      }
    }
    if (taskbarWasAutoHidden) {
      taskbarWasAutoHidden = false;
      lastTaskbarLayoutKey = '';
      void setWindowsTaskbarReplacement(false);
    }
    rebuildTrayMenu();
  });
  ipcMain.handle('glassy:quit', () => app.quit());
}

// Same data folder whether run from source or installed, so an update never loses the config
app.setPath(
  'userData',
  process.env.GLASSY_USER_DATA || path.join(app.getPath('appData'), 'glassy')
);
app.setAppUserModelId('com.m7devcore.glassy');

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  win32Daemon.start();

  app.on('second-instance', () => {
    dockManuallyHidden = false;
    if (dockWindow) {
      if (!dockWindow.isVisible() && !fullscreenSuspended) dockWindow.showInactive();
      ensureOnTop(dockWindow);
      dockWindow.focus();
    }
    for (const entry of secondaryDocks.values()) {
      if (!entry.win.isDestroyed() && !entry.win.isVisible() && !entry.fullscreenSuspended) {
        entry.win.showInactive();
        ensureOnTop(entry.win);
      }
    }
    if (islandWindow && currentConfig.settings.musicPosition === 'top') {
      if (!islandWindow.isVisible() && !fullscreenSuspended) islandWindow.showInactive();
      ensureOnTop(islandWindow);
    }
  });

  app.whenReady().then(() => {
    registerIpcHandlers();
    createWindows();
    setupTray();
    cleanupLegacyBrandArtifacts();
    applyLaunchAtStartup(currentConfig.settings.launchAtStartup);
    // Instant wake when the user presses the Windows key inside any fullscreen game!
    win32Daemon.onEvent((ev) => {
      if (ev === 'FS_WAKE' && fullscreenSuspended && !dockManuallyHidden && !isQuitting) {
        notFullscreenStreak = 2;
        setFullscreenSuspended(false);
      }
    });
    // Start fullscreen watcher only after the native bridge is ready and startup work-area
    // settlement has finished, so launch never triggers a false suspend/resume bounce.
    void win32Daemon.whenReady().then(() => {
      if (isQuitting) return;
      setTimeout(() => {
        if (!isQuitting) syncFullscreenWatcher();
      }, 1500);
    });
    // If the native bridge ever has to be restarted, Windows has already dropped the work area it
    // had reserved (it reverts when the process that set it dies): reserve and place again
    win32Daemon.onRestart(() => {
      if (isQuitting) return;
      lastTaskbarLayoutKey = '';
      lastExtraHwndsKey = '';
      for (const entry of secondaryDocks.values()) entry.lastReserveKey = '';
      void win32Daemon.send(
        `SET_HWNDS ${getHwndNumber(dockWindow)} ${getHwndNumber(islandWindow)}`
      );
      void win32Daemon.send(`KEEP_TOP ${currentConfig.settings.alwaysOnTop ? 1 : 0}`);
      if (currentConfig.settings.replaceWindowsTaskbar) {
        syncTaskbarReplacement(currentConfig.settings);
      }
      applyAllLayouts(currentConfig.settings);
    });
    const releaseAllReservedWorkAreas = async (): Promise<void> => {
      const tasks: Promise<unknown>[] = [];
      for (const entry of secondaryDocks.values()) {
        if (entry.lastReserveKey && !entry.win.isDestroyed()) {
          const hwnd = getHwndNumber(entry.win);
          entry.lastReserveKey = '';
          if (hwnd !== '0') tasks.push(win32Daemon.send(`SEC_RELEASE ${hwnd}`));
        }
      }
      if (taskbarWasAutoHidden) {
        taskbarWasAutoHidden = false;
        lastTaskbarLayoutKey = '';
        tasks.push(win32Daemon.send('TASKBAR_SHOW'));
      }
      if (tasks.length === 0) return;
      await Promise.race([
        Promise.allSettled(tasks),
        new Promise<void>((r) => setTimeout(r, 1500))
      ]);
    };

    startUpdater(
      () => {
        rebuildTrayMenu();
        broadcastUpdateInfo();
      },
      async () => {
        isQuitting = true;
        clearReassertTimer();
        if (fullscreenPollTimer) {
          clearInterval(fullscreenPollTimer);
          fullscreenPollTimer = null;
        }
        if (cursorHitTimer) {
          clearInterval(cursorHitTimer);
          cursorHitTimer = null;
        }
        stopLivePeekIfOwner();
        clearLiveThumbsIfOwner();
        stopMediaWorker();
        dockWindow?.hide();
        islandWindow?.hide();
        for (const entry of secondaryDocks.values()) {
          if (!entry.win.isDestroyed()) entry.win.hide();
        }
        await releaseAllReservedWorkAreas();
        win32Daemon.stop();
      }
    );
    // Cheap safety net: re-sync dock bounds only if they actually drifted from display metrics
    setInterval(() => {
      if (!fullscreenSuspended && dockWindow && !dockWindow.isDestroyed() && dockWindow.isVisible()) {
        const expected = computeDockBounds(currentConfig.settings);
        const cur = dockWindow.getBounds();
        if (
          Math.abs(cur.x - expected.x) > 2 ||
          Math.abs(cur.y - expected.y) > 2 ||
          Math.abs(cur.width - expected.width) > 2 ||
          Math.abs(cur.height - expected.height) > 2
        ) {
          dockWindow.setBounds(expected, false);
          dockBoundsCache = expected;
          placeDockPhysical(currentConfig.settings);
        }
      }
      if (secondaryDocks.size > 0) {
        const displays = screen.getAllDisplays();
        for (const entry of secondaryDocks.values()) {
          if (!entry.fullscreenSuspended && !entry.win.isDestroyed() && entry.win.isVisible()) {
            const disp = displays.find((d) => d.id === entry.displayId);
            if (disp) placeSecondaryDockPhysical(entry, disp, currentConfig.settings);
          }
        }
      }
    }, 10000);
    syncCursorHitTestTimer();

    globalShortcut.register('Alt+Space', () => {
      toggleDockVisibility();
    });

    globalShortcut.register('Alt+H', () => {
      toggleIslandVisibility();
    });

    const getTopologyKey = () =>
      screen
        .getAllDisplays()
        .map((d) => `${d.id}:${d.bounds.x},${d.bounds.y},${d.bounds.width}x${d.bounds.height}@${d.scaleFactor}`)
        .join('|');
    let lastTopologyKey = getTopologyKey();

    let displayChangeTimer: ReturnType<typeof setTimeout> | null = null;
    const handleDisplayChange = () => {
      if (displayChangeTimer) clearTimeout(displayChangeTimer);
      // Debounce display-mode transitions (e.g. stretched CS2 <-> native 16:9 when pressing Win)
      // so we never bounce the dock or broadcast TASKBAR_HIDE mid-resolution-switch.
      displayChangeTimer = setTimeout(() => {
        displayChangeTimer = null;
        if (isQuitting) return;
        const nextKey = getTopologyKey();
        if (nextKey === lastTopologyKey) return;
        lastTopologyKey = nextKey;
        dockBoundsCache = null;
        islandBoundsCache = null;
        if (fullscreenSuspended) return;
        if (currentConfig.settings.replaceWindowsTaskbar) {
          syncTaskbarReplacement(currentConfig.settings);
        }
        applyAllLayouts(currentConfig.settings);
      }, 350);
    };
    screen.on('display-metrics-changed', (_e, _disp, changed) => {
      if (changed.includes('bounds') || changed.includes('scaleFactor') || changed.includes('rotation')) {
        handleDisplayChange();
      }
    });
    screen.on('display-added', handleDisplayChange);
    screen.on('display-removed', handleDisplayChange);

    const reapplyAfterPowerEvent = () => {
      if (isQuitting) return;
      const run = () => {
        if (isQuitting) return;
        lastTaskbarLayoutKey = '';
        for (const entry of secondaryDocks.values()) entry.lastReserveKey = '';
        if (currentConfig.settings.replaceWindowsTaskbar && !dockManuallyHidden) {
          syncTaskbarReplacement(currentConfig.settings);
        }
        syncKeepOnTop(currentConfig.settings);
        applyAllLayouts(currentConfig.settings);
      };
      run();
      setTimeout(run, 650);
    };
    powerMonitor.on('resume', reapplyAfterPowerEvent);
    powerMonitor.on('unlock-screen', reapplyAfterPowerEvent);
  });

  app.on('before-quit', (e) => {
    if (isQuitting) return;
    isQuitting = true;
    clearReassertTimer();
    if (fullscreenPollTimer) {
      clearInterval(fullscreenPollTimer);
      fullscreenPollTimer = null;
    }
    if (cursorHitTimer) {
      clearInterval(cursorHitTimer);
      cursorHitTimer = null;
    }
    stopLivePeekIfOwner();
    clearLiveThumbsIfOwner();
    stopMediaWorker();
    stopUpdater();
    const secHwnds: string[] = [];
    for (const entry of secondaryDocks.values()) {
      if (!entry.win.isDestroyed()) {
        if (entry.lastReserveKey) {
          const hwnd = getHwndNumber(entry.win);
          if (hwnd !== '0') secHwnds.push(hwnd);
          entry.lastReserveKey = '';
        }
        entry.win.hide();
      }
    }
    dockWindow?.hide();
    islandWindow?.hide();
    if (taskbarWasAutoHidden || secHwnds.length > 0) {
      e.preventDefault();
      const tasks: Promise<unknown>[] = secHwnds.map((h) => win32Daemon.send(`SEC_RELEASE ${h}`));
      if (taskbarWasAutoHidden) {
        taskbarWasAutoHidden = false;
        lastTaskbarLayoutKey = '';
        tasks.push(win32Daemon.send('TASKBAR_SHOW'));
      }
      void Promise.race([
        Promise.allSettled(tasks),
        new Promise<void>((r) => setTimeout(r, 1500))
      ]).finally(() => {
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
