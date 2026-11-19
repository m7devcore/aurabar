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

interface SecondaryDockEntry {
  displayId: number;
  win: BrowserWindow;
  popoverOpen: boolean;
  interactiveState: boolean;
  interactiveLock: boolean;
  localHitRects: HitRect[];
  lastInsideAt: number;
  fullscreenSuspended: boolean;
  notFullscreenStreak: number;
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
  for (const entry of secondaryDocks.values()) {
    applyTopmost(entry.win);
  }
}

function syncExtraHwndsToBridge(): void {
  const hwnds: string[] = [];
  for (const entry of secondaryDocks.values()) {
    const h = getHwndNumber(entry.win);
    if (h !== '0') hwnds.push(h);
  }
  void win32Daemon.send(hwnds.length > 0 ? `SET_EXTRA_HWNDS ${hwnds.join(',')}` : 'SET_EXTRA_HWNDS');
}

function findSecondaryEntryBySender(sender: Electron.WebContents): SecondaryDockEntry | null {
  for (const entry of secondaryDocks.values()) {
    if (!entry.win.isDestroyed() && entry.win.webContents === sender) return entry;
  }
  return null;
}

function placeSecondaryDockPhysical(
  entry: SecondaryDockEntry,
  display: Electron.Display,
  settings: DockSettings
): void {
  if (entry.win.isDestroyed()) return;
  const dipBounds = computeDockBoundsForDisplay(settings, display);
  // First setBounds moves the HWND onto the target monitor's DPI context; second applies exact DIP size for that monitor
  entry.win.setBounds(dipBounds, false);
  entry.win.setBounds(dipBounds, false);
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
    popoverOpen: false,
    interactiveState: false,
    interactiveLock: false,
    localHitRects: [],
    lastInsideAt: 0,
    fullscreenSuspended: false,
    notFullscreenStreak: 0
  };
  applyTopmost(win);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true);
  lockDownNavigation(win);
  loadView(win, 'secondary-dock');
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    const freshDisplay = screen.getAllDisplays().find((d) => d.id === display.id) ?? display;
    placeSecondaryDockPhysical(entry, freshDisplay, currentConfig.settings);
    syncExtraHwndsToBridge();
    if (!dockManuallyHidden && !entry.fullscreenSuspended) {
      win.showInactive();
      ensureOnTop(win);
    }
  });
  win.on('blur', () => {
    entry.interactiveLock = false;
    if (entry.popoverOpen) {
      entry.popoverOpen = false;
      if (!win.isDestroyed()) win.webContents.send('aurabar:blurred');
    }
    applyTopmost(win);
  });
  win.on('closed', () => {
    secondaryDocks.delete(display.id);
    syncExtraHwndsToBridge();
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
        entry.win.destroy();
      }
    }
  }

  for (const display of wanted) {
    let entry = secondaryDocks.get(display.id);
    if (!entry) {
      entry = createSecondaryDock(display, settings);
      secondaryDocks.set(display.id, entry);
    } else if (!entry.win.isDestroyed()) {
      applyTopmost(entry.win);
      placeSecondaryDockPhysical(entry, display, settings);
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
    win.webContents.send('aurabar:update-info', info);
  }
}

function broadcastConfig(cfg: AppConfig, except?: Electron.WebContents): void {
  for (const win of allOverlayWindows()) {
    if (win.webContents !== except) {
      win.webContents.send('aurabar:config-updated', cfg);
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

function setFullscreenSuspended(next: boolean): void {
  if (next === fullscreenSuspended) return;
  fullscreenSuspended = next;
  if (next) {
    suspendedDockWasVisible = dockWindow?.isVisible() ?? false;
    suspendedIslandWasVisible = islandWindow?.isVisible() ?? false;
    islandFullscreenPeek = false;
    isPopoverOpen = false;
    dockInteractiveLock = false;
    dockInteractiveState = false;
    islandInteractiveLock = false;
    islandInteractiveState = false;
    dockWindow?.setIgnoreMouseEvents(true);
    islandWindow?.setIgnoreMouseEvents(true);
    dockWindow?.hide();
    islandWindow?.hide();
  } else {
    islandFullscreenPeek = false;
    // The screen has just been through a mode/work-area change: lay everything out again from
    // fresh metrics *before* showing, and once more after it settles
    reassertLayoutAfterFullscreen();
    if (suspendedDockWasVisible && dockWindow && !dockWindow.isDestroyed()) {
      dockWindow.showInactive();
      ensureOnTop(dockWindow);
    }
    if (
      suspendedIslandWasVisible &&
      islandWindow &&
      !islandWindow.isDestroyed() &&
      currentConfig.settings.musicPosition === 'top'
    ) {
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
      islandWindow.webContents.send('aurabar:island-visibility', false);
    }
  }
}

function reassertLayoutAfterFullscreen(): void {
  const settings = currentConfig.settings;
  // Windows can reset the reserved work area when a full-screen app exits; only touch it
  // again when it really changed, since re-applying makes every window relayout
  if (settings.replaceWindowsTaskbar && taskbarWasAutoHidden) {
    const d = screen.getPrimaryDisplay();
    const expectedHeight = d.bounds.height - getReservedHeightPx(settings);
    if (Math.abs(d.workArea.height - expectedHeight) > 2) {
      lastTaskbarLayoutKey = '';
      syncTaskbarReplacement(settings);
    }
  }
  applyAllLayouts(settings);
  setTimeout(() => {
    if (!fullscreenSuspended && !isQuitting) applyAllLayouts(currentConfig.settings);
  }, 450);
}

function setSecondaryFullscreenSuspended(entry: SecondaryDockEntry, next: boolean): void {
  if (next === entry.fullscreenSuspended || entry.win.isDestroyed()) return;
  entry.fullscreenSuspended = next;
  if (next) {
    entry.popoverOpen = false;
    entry.interactiveLock = false;
    entry.interactiveState = false;
    entry.win.setIgnoreMouseEvents(true);
    entry.win.hide();
  } else if (!dockManuallyHidden) {
    const display = screen.getAllDisplays().find((d) => d.id === entry.displayId);
    if (display) {
      placeSecondaryDockPhysical(entry, display, currentConfig.settings);
    }
    entry.win.showInactive();
    ensureOnTop(entry.win);
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
      } else if (reply === '0') {
        notFullscreenStreak += 1;
        if (notFullscreenStreak >= 3) setFullscreenSuspended(false);
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
    } else if (flags[0] === '0') {
      notFullscreenStreak += 1;
      if (notFullscreenStreak >= 3) setFullscreenSuspended(false);
    }

    for (let i = 0; i < secEntries.length; i++) {
      const entry = secEntries[i];
      const flag = flags[i + 1];
      if (flag === '1') {
        entry.notFullscreenStreak = 0;
        setSecondaryFullscreenSuspended(entry, true);
      } else if (flag === '0') {
        entry.notFullscreenStreak += 1;
        if (entry.notFullscreenStreak >= 3) setSecondaryFullscreenSuspended(entry, false);
      }
    }
  } finally {
    fullscreenPolling = false;
  }
}

function syncFullscreenWatcher(): void {
  const wanted = currentConfig.settings.hideInFullscreen;
  if (wanted && !fullscreenPollTimer) {
    fullscreenPollTimer = setInterval(() => void pollFullscreen(), 300);
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

// Registers AuraBar to open when the user signs in. Only the installed build can: running from
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
  if (!dockWindow || fullscreenSuspended) return;
  if (dockWindow.isVisible()) {
    dockManuallyHidden = true;
    isPopoverOpen = false;
    dockInteractiveLock = false;
    dockInteractiveState = false;
    dockWindow.setIgnoreMouseEvents(true);
    dockWindow.hide();
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
  } else {
    dockManuallyHidden = false;
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
    islandWindow.webContents.send('aurabar:island-visibility', false);
  } else {
    if (fullscreenSuspended && currentConfig.settings.musicPosition !== 'top') {
      islandFullscreenPeek = true;
    }
    islandWindow.setAlwaysOnTop(true, 'screen-saver');
    islandWindow.setBounds(computeIslandBounds(), false);
    islandWindow.showInactive();
    islandWindow.webContents.send('aurabar:island-visibility', true);
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

  for (const entry of secondaryDocks.values()) {
    if (entry.win.isDestroyed() || !entry.win.isVisible()) continue;
    const b = entry.win.getBounds();
    const inside = isPointInRects(pt.x - b.x, pt.y - b.y, entry.localHitRects);
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
    return currentConfig;
  });

  ipcMain.handle('aurabar:set-popover-open', (e, open: boolean) => {
    const sec = findSecondaryEntryBySender(e.sender);
    if (sec) {
      sec.popoverOpen = open;
      if (open) {
        sec.interactiveState = true;
        sec.win.setIgnoreMouseEvents(false);
        ensureOnTop(sec.win);
        sec.win.focus();
      } else {
        updateCursorHitTesting();
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
      updateCursorHitTesting();
    }
  });

  ipcMain.on('aurabar:set-dock-interactive', (e, interactive: boolean) => {
    const sec = findSecondaryEntryBySender(e.sender);
    if (sec) {
      sec.interactiveLock = interactive;
    } else {
      dockInteractiveLock = interactive;
    }
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

  ipcMain.on('aurabar:set-hit-rects', (e, view: 'dock' | 'island', rects: HitRect[]) => {
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
  ipcMain.handle('aurabar:get-update-info', () => getUpdateInfo());
  ipcMain.handle('aurabar:check-updates', () => checkForUpdates(true));
  ipcMain.handle('aurabar:install-update', () => installUpdateNow());
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
    applyLaunchAtStartup(currentConfig.settings.launchAtStartup);
    syncFullscreenWatcher();
    // If the native bridge ever has to be restarted, Windows has already dropped the work area it
    // had reserved (it reverts when the process that set it dies): reserve and place again
    win32Daemon.onRestart(() => {
      if (isQuitting) return;
      lastTaskbarLayoutKey = '';
      void win32Daemon.send(
        `SET_HWNDS ${getHwndNumber(dockWindow)} ${getHwndNumber(islandWindow)}`
      );
      void win32Daemon.send(`KEEP_TOP ${currentConfig.settings.alwaysOnTop ? 1 : 0}`);
      if (currentConfig.settings.replaceWindowsTaskbar) {
        syncTaskbarReplacement(currentConfig.settings);
      }
      applyAllLayouts(currentConfig.settings);
    });
    startUpdater(
      () => {
        rebuildTrayMenu();
        broadcastUpdateInfo();
      },
      async () => {
        if (!taskbarWasAutoHidden) return;
        taskbarWasAutoHidden = false;
        lastTaskbarLayoutKey = '';
        await win32Daemon.send('TASKBAR_SHOW');
      }
    );
    // Cheap safety net: re-send the dock's target rect from fresh display metrics, so a wrong
    // reading taken during some display change can never stick
    setInterval(() => {
      if (!fullscreenSuspended && dockWindow?.isVisible()) {
        placeDockPhysical(currentConfig.settings);
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
    }, 4000);
    setInterval(updateCursorHitTesting, 10);

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

    const handleDisplayChange = () => {
      const nextKey = getTopologyKey();
      if (nextKey === lastTopologyKey) return;
      lastTopologyKey = nextKey;
      if (currentConfig.settings.replaceWindowsTaskbar) {
        syncTaskbarReplacement(currentConfig.settings);
      }
      applyAllLayouts(currentConfig.settings);
    };
    screen.on('display-metrics-changed', (_e, _disp, changed) => {
      if (changed.includes('bounds') || changed.includes('scaleFactor') || changed.includes('rotation')) {
        handleDisplayChange();
      }
    });
    screen.on('display-added', handleDisplayChange);
    screen.on('display-removed', handleDisplayChange);
  });

  app.on('before-quit', (e) => {
    if (isQuitting) return;
    isQuitting = true;
    stopMediaWorker();
    stopUpdater();
    dockWindow?.hide();
    islandWindow?.hide();
    for (const entry of secondaryDocks.values()) {
      if (!entry.win.isDestroyed()) entry.win.hide();
    }
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
