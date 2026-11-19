import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AppConfig,
  BackgroundApp,
  InstalledApp,
  LyricsResult,
  UpdateInfo,
  MediaInfo,
  NetworkInfo,
  PinnedApp,
  RunningWindow,
  SystemStats,
  VolumeInfo
} from '../src/types';

export interface HitRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface AuraBarApi {
  getConfig: () => Promise<AppConfig>;
  saveConfig: (config: AppConfig) => Promise<AppConfig>;
  setPopoverOpen: (open: boolean) => Promise<void>;
  setDockInteractive: (interactive: boolean) => void;
  setIslandExpanded: (expanded: boolean) => Promise<void>;
  setIslandInteractive: (interactive: boolean) => void;
  setHitRects: (view: 'dock' | 'island', rects: HitRect[]) => void;
  getSystemStats: () => Promise<SystemStats>;
  getRunningWindows: () => Promise<RunningWindow[]>;
  getBackgroundApps: () => Promise<BackgroundApp[]>;
  getInstalledApps: () => Promise<InstalledApp[]>;
  createPinnedFromPath: (filePath: string) => Promise<PinnedApp | null>;
  getPathForFile: (file: File) => string;
  importTaskbarApps: () => Promise<PinnedApp[]>;
  focusWindow: (pid: number, hwnd?: string) => Promise<boolean>;
  openApp: (pid: number, executablePath?: string) => Promise<boolean>;
  closeWindow: (hwnd: string) => Promise<boolean>;
  getWindowThumb: (hwnd: string) => Promise<string | undefined>;
  quitProcess: (pid: number, executablePath?: string) => Promise<boolean>;
  launchTarget: (target: string) => Promise<boolean>;
  pickAppFile: () => Promise<{
    path: string;
    name: string;
    kind: 'app' | 'folder';
    iconDataUrl?: string;
    exeName?: string;
  } | null>;
  getAppIcon: (target: string) => Promise<string | undefined>;
  getMediaInfo: () => Promise<MediaInfo | null>;
  sendMediaCommand: (cmd: 'playPause' | 'next' | 'previous') => Promise<void>;
  getLyrics: (title: string, artist: string, album: string, durationSec: number) => Promise<LyricsResult | null>;
  adjustVolume: (action: 'up' | 'down' | 'mute') => Promise<void>;
  getVolume: () => Promise<VolumeInfo>;
  setVolume: (level: number) => Promise<VolumeInfo>;
  toggleMute: () => Promise<VolumeInfo>;
  systemAction: (
    action: 'lock' | 'taskmgr' | 'settings' | 'start' | 'quicksettings' | 'desktop'
  ) => Promise<void>;
  getKeyboardLang: () => Promise<string>;
  switchKeyboardLang: () => Promise<void>;
  getNetworkInfo: () => Promise<NetworkInfo>;
  hideDock: () => Promise<void>;
  quitApp: () => Promise<void>;
  onDockBlurred: (cb: () => void) => () => void;
  onIslandBlurred: (cb: () => void) => () => void;
  onConfigUpdated: (cb: (cfg: AppConfig) => void) => () => void;
  getUpdateInfo: () => Promise<UpdateInfo>;
  checkForUpdates: () => Promise<void>;
  installUpdate: () => Promise<void>;
  onUpdateInfo: (cb: (info: UpdateInfo) => void) => () => void;
}

const api: AuraBarApi = {
  getConfig: () => ipcRenderer.invoke('aurabar:get-config'),
  saveConfig: (config) => ipcRenderer.invoke('aurabar:save-config', config),
  setPopoverOpen: (open) => ipcRenderer.invoke('aurabar:set-popover-open', open),
  setDockInteractive: (interactive) =>
    ipcRenderer.send('aurabar:set-dock-interactive', interactive),
  setIslandExpanded: (expanded) => ipcRenderer.invoke('aurabar:set-island-expanded', expanded),
  setIslandInteractive: (interactive) =>
    ipcRenderer.send('aurabar:set-island-interactive', interactive),
  setHitRects: (view, rects) => ipcRenderer.send('aurabar:set-hit-rects', view, rects),
  getSystemStats: () => ipcRenderer.invoke('aurabar:get-system-stats'),
  getRunningWindows: () => ipcRenderer.invoke('aurabar:get-running-windows'),
  getBackgroundApps: () => ipcRenderer.invoke('aurabar:get-background-apps'),
  getInstalledApps: () => ipcRenderer.invoke('aurabar:get-installed-apps'),
  createPinnedFromPath: (filePath) => ipcRenderer.invoke('aurabar:create-pinned-from-path', filePath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  importTaskbarApps: () => ipcRenderer.invoke('aurabar:import-taskbar-apps'),
  focusWindow: (pid, hwnd) => ipcRenderer.invoke('aurabar:focus-window', pid, hwnd),
  openApp: (pid, executablePath) => ipcRenderer.invoke('aurabar:open-app', pid, executablePath),
  closeWindow: (hwnd) => ipcRenderer.invoke('aurabar:close-window', hwnd),
  getWindowThumb: (hwnd) => ipcRenderer.invoke('aurabar:get-window-thumb', hwnd),
  quitProcess: (pid, executablePath) => ipcRenderer.invoke('aurabar:quit-process', pid, executablePath),
  launchTarget: (target) => ipcRenderer.invoke('aurabar:launch-target', target),
  pickAppFile: () => ipcRenderer.invoke('aurabar:pick-app-file'),
  getAppIcon: (target) => ipcRenderer.invoke('aurabar:get-app-icon', target),
  getMediaInfo: () => ipcRenderer.invoke('aurabar:get-media-info'),
  sendMediaCommand: (cmd) => ipcRenderer.invoke('aurabar:send-media-cmd', cmd),
  getLyrics: (title, artist, album, durationSec) =>
    ipcRenderer.invoke('aurabar:get-lyrics', title, artist, album, durationSec),
  adjustVolume: (action) => ipcRenderer.invoke('aurabar:adjust-volume', action),
  getVolume: () => ipcRenderer.invoke('aurabar:get-volume'),
  setVolume: (level) => ipcRenderer.invoke('aurabar:set-volume', level),
  toggleMute: () => ipcRenderer.invoke('aurabar:toggle-mute'),
  systemAction: (action) => ipcRenderer.invoke('aurabar:system-action', action),
  getKeyboardLang: () => ipcRenderer.invoke('aurabar:get-keyboard-lang'),
  switchKeyboardLang: () => ipcRenderer.invoke('aurabar:switch-keyboard-lang'),
  getNetworkInfo: () => ipcRenderer.invoke('aurabar:get-network-info'),
  hideDock: () => ipcRenderer.invoke('aurabar:hide-dock'),
  quitApp: () => ipcRenderer.invoke('aurabar:quit'),
  onDockBlurred: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('aurabar:blurred', handler);
    return () => ipcRenderer.removeListener('aurabar:blurred', handler);
  },
  onIslandBlurred: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('aurabar:island-blurred', handler);
    return () => ipcRenderer.removeListener('aurabar:island-blurred', handler);
  },
  onConfigUpdated: (cb) => {
    const handler = (_e: Electron.IpcRendererEvent, cfg: AppConfig) => cb(cfg);
    ipcRenderer.on('aurabar:config-updated', handler);
    return () => ipcRenderer.removeListener('aurabar:config-updated', handler);
  },
  getUpdateInfo: () => ipcRenderer.invoke('aurabar:get-update-info'),
  checkForUpdates: () => ipcRenderer.invoke('aurabar:check-updates'),
  installUpdate: () => ipcRenderer.invoke('aurabar:install-update'),
  onUpdateInfo: (cb) => {
    const handler = (_e: Electron.IpcRendererEvent, info: UpdateInfo) => cb(info);
    ipcRenderer.on('aurabar:update-info', handler);
    return () => ipcRenderer.removeListener('aurabar:update-info', handler);
  }
};

contextBridge.exposeInMainWorld('auraBar', api);
