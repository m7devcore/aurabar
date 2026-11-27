import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type {
  AppConfig,
  AudioAppSession,
  AudioOutputDevice,
  BackgroundApp,
  BrightnessInfo,
  InstalledApp,
  LyricsResult,
  UpdateInfo,
  MediaInfo,
  NetworkInfo,
  NightLightInfo,
  PinnedApp,
  PrivacyStatus,
  RunningWindow,
  ShelfItem,
  SystemAction,
  SystemStats,
  VolumeInfo,
  WifiNetwork
} from '../src/types';

export interface HitRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface LiveThumbSlot {
  hwnd: string;
  left: number;
  top: number;
  width: number;
  height: number;
  radius?: number;
}

export interface GlassyApi {
  getConfig: () => Promise<AppConfig>;
  saveConfig: (config: AppConfig) => Promise<AppConfig>;
  setPopoverOpen: (open: boolean) => Promise<void>;
  setDockInteractive: (interactive: boolean) => void;
  setIslandExpanded: (expanded: boolean) => Promise<void>;
  setIslandInteractive: (interactive: boolean) => void;
  openIslandTray: () => void;
  setHitRects: (view: 'dock' | 'island', rects: HitRect[]) => void;
  getSystemStats: () => Promise<SystemStats>;
  getRunningWindows: () => Promise<RunningWindow[]>;
  getBackgroundApps: () => Promise<BackgroundApp[]>;
  getInstalledApps: () => Promise<InstalledApp[]>;
  createPinnedFromPath: (filePath: string) => Promise<PinnedApp | null>;
  getPathForFile: (file: File) => string;
  importTaskbarApps: () => Promise<PinnedApp[]>;
  focusWindow: (pid: number, hwnd?: string) => Promise<boolean>;
  activateWindow: (pid: number, hwnd?: string) => Promise<boolean>;
  startWindowPeek: (hwnd: string) => void;
  stopWindowPeek: () => void;
  setLiveThumbs: (slots: LiveThumbSlot[]) => void;
  clearLiveThumbs: () => void;
  wakeHiddenApp: (exeName?: string, installDir?: string) => Promise<boolean>;
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
  getPrivacyStatus: () => Promise<PrivacyStatus>;
  toggleMicMute: () => Promise<PrivacyStatus>;
  inspectShelfPaths: (paths: string[]) => Promise<ShelfItem[]>;
  saveShelfBlob: (name: string, base64Data: string, kind?: 'file' | 'text') => Promise<ShelfItem | null>;
  pickShelfFiles: () => Promise<ShelfItem[]>;
  startShelfDrag: (paths: string[], iconDataUrl?: string) => void;
  openShelfItem: (filePath: string) => Promise<boolean>;
  revealShelfItem: (filePath: string) => Promise<boolean>;
  getAudioDevices: () => Promise<AudioOutputDevice[]>;
  setDefaultAudioDevice: (deviceId: string) => Promise<AudioOutputDevice[]>;
  getAudioSessions: () => Promise<AudioAppSession[]>;
  setAudioSessionVolume: (sessionId: string, level: number) => Promise<void>;
  toggleAudioSessionMute: (sessionId: string) => Promise<void>;
  getBrightness: () => Promise<BrightnessInfo>;
  setBrightness: (level: number) => Promise<BrightnessInfo>;
  getNightLight: () => Promise<NightLightInfo>;
  toggleNightLight: () => Promise<NightLightInfo>;
  listWifiNetworks: () => Promise<WifiNetwork[]>;
  connectWifiNetwork: (ssid: string) => Promise<boolean>;
  systemAction: (action: SystemAction) => Promise<void>;
  getKeyboardLang: () => Promise<string>;
  switchKeyboardLang: () => Promise<void>;
  getNetworkInfo: () => Promise<NetworkInfo>;
  hideDock: () => Promise<void>;
  quitApp: () => Promise<void>;
  onDockBlurred: (cb: () => void) => () => void;
  onToggleNookPopover: (cb: () => void) => () => void;
  onIslandBlurred: (cb: () => void) => () => void;
  onIslandOpenTray: (cb: () => void) => () => void;
  onIslandVisibility: (cb: (visible: boolean) => void) => () => void;
  onSuspended: (cb: (suspended: boolean) => void) => () => void;
  onConfigUpdated: (cb: (cfg: AppConfig) => void) => () => void;
  getUpdateInfo: () => Promise<UpdateInfo>;
  checkForUpdates: () => Promise<void>;
  installUpdate: () => Promise<void>;
  onUpdateInfo: (cb: (info: UpdateInfo) => void) => () => void;
}

const api: GlassyApi = {
  getConfig: () => ipcRenderer.invoke('glassy:get-config'),
  saveConfig: (config) => ipcRenderer.invoke('glassy:save-config', config),
  setPopoverOpen: (open) => ipcRenderer.invoke('glassy:set-popover-open', open),
  setDockInteractive: (interactive) =>
    ipcRenderer.send('glassy:set-dock-interactive', interactive),
  setIslandExpanded: (expanded) => ipcRenderer.invoke('glassy:set-island-expanded', expanded),
  setIslandInteractive: (interactive) =>
    ipcRenderer.send('glassy:set-island-interactive', interactive),
  openIslandTray: () => ipcRenderer.send('glassy:open-island-tray'),
  setHitRects: (view, rects) => ipcRenderer.send('glassy:set-hit-rects', view, rects),
  getSystemStats: () => ipcRenderer.invoke('glassy:get-system-stats'),
  getRunningWindows: () => ipcRenderer.invoke('glassy:get-running-windows'),
  getBackgroundApps: () => ipcRenderer.invoke('glassy:get-background-apps'),
  getInstalledApps: () => ipcRenderer.invoke('glassy:get-installed-apps'),
  createPinnedFromPath: (filePath) => ipcRenderer.invoke('glassy:create-pinned-from-path', filePath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  importTaskbarApps: () => ipcRenderer.invoke('glassy:import-taskbar-apps'),
  focusWindow: (pid, hwnd) => ipcRenderer.invoke('glassy:focus-window', pid, hwnd),
  activateWindow: (pid, hwnd) => ipcRenderer.invoke('glassy:activate-window', pid, hwnd),
  startWindowPeek: (hwnd) => ipcRenderer.send('glassy:peek-start', hwnd),
  stopWindowPeek: () => ipcRenderer.send('glassy:peek-stop'),
  setLiveThumbs: (slots) => ipcRenderer.send('glassy:live-thumbs', slots),
  clearLiveThumbs: () => ipcRenderer.send('glassy:live-thumbs-clear'),
  wakeHiddenApp: (exeName, installDir) =>
    ipcRenderer.invoke('glassy:wake-hidden-app', exeName, installDir),
  openApp: (pid, executablePath) => ipcRenderer.invoke('glassy:open-app', pid, executablePath),
  closeWindow: (hwnd) => ipcRenderer.invoke('glassy:close-window', hwnd),
  getWindowThumb: (hwnd) => ipcRenderer.invoke('glassy:get-window-thumb', hwnd),
  quitProcess: (pid, executablePath) => ipcRenderer.invoke('glassy:quit-process', pid, executablePath),
  launchTarget: (target) => ipcRenderer.invoke('glassy:launch-target', target),
  pickAppFile: () => ipcRenderer.invoke('glassy:pick-app-file'),
  getAppIcon: (target) => ipcRenderer.invoke('glassy:get-app-icon', target),
  getMediaInfo: () => ipcRenderer.invoke('glassy:get-media-info'),
  sendMediaCommand: (cmd) => ipcRenderer.invoke('glassy:send-media-cmd', cmd),
  getLyrics: (title, artist, album, durationSec) =>
    ipcRenderer.invoke('glassy:get-lyrics', title, artist, album, durationSec),
  adjustVolume: (action) => ipcRenderer.invoke('glassy:adjust-volume', action),
  getVolume: () => ipcRenderer.invoke('glassy:get-volume'),
  setVolume: (level) => ipcRenderer.invoke('glassy:set-volume', level),
  toggleMute: () => ipcRenderer.invoke('glassy:toggle-mute'),
  getPrivacyStatus: () => ipcRenderer.invoke('glassy:get-privacy-status'),
  toggleMicMute: () => ipcRenderer.invoke('glassy:toggle-mic-mute'),
  inspectShelfPaths: (paths) => ipcRenderer.invoke('glassy:shelf-inspect', paths),
  saveShelfBlob: (name, base64Data, kind) =>
    ipcRenderer.invoke('glassy:shelf-save-blob', name, base64Data, kind),
  pickShelfFiles: () => ipcRenderer.invoke('glassy:shelf-pick-files'),
  startShelfDrag: (paths, iconDataUrl) =>
    ipcRenderer.send('glassy:shelf-start-drag', paths, iconDataUrl),
  openShelfItem: (filePath) => ipcRenderer.invoke('glassy:shelf-open', filePath),
  revealShelfItem: (filePath) => ipcRenderer.invoke('glassy:shelf-reveal', filePath),
  getAudioDevices: () => ipcRenderer.invoke('glassy:get-audio-devices'),
  setDefaultAudioDevice: (deviceId) => ipcRenderer.invoke('glassy:set-audio-device', deviceId),
  getAudioSessions: () => ipcRenderer.invoke('glassy:get-audio-sessions'),
  setAudioSessionVolume: (sessionId, level) =>
    ipcRenderer.invoke('glassy:set-audio-session-vol', sessionId, level),
  toggleAudioSessionMute: (sessionId) =>
    ipcRenderer.invoke('glassy:toggle-audio-session-mute', sessionId),
  getBrightness: () => ipcRenderer.invoke('glassy:get-brightness'),
  setBrightness: (level) => ipcRenderer.invoke('glassy:set-brightness', level),
  getNightLight: () => ipcRenderer.invoke('glassy:get-nightlight'),
  toggleNightLight: () => ipcRenderer.invoke('glassy:toggle-nightlight'),
  listWifiNetworks: () => ipcRenderer.invoke('glassy:list-wifi-networks'),
  connectWifiNetwork: (ssid) => ipcRenderer.invoke('glassy:connect-wifi-network', ssid),
  systemAction: (action) => ipcRenderer.invoke('glassy:system-action', action),
  getKeyboardLang: () => ipcRenderer.invoke('glassy:get-keyboard-lang'),
  switchKeyboardLang: () => ipcRenderer.invoke('glassy:switch-keyboard-lang'),
  getNetworkInfo: () => ipcRenderer.invoke('glassy:get-network-info'),
  hideDock: () => ipcRenderer.invoke('glassy:hide-dock'),
  quitApp: () => ipcRenderer.invoke('glassy:quit'),
  onDockBlurred: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('glassy:blurred', handler);
    return () => ipcRenderer.removeListener('glassy:blurred', handler);
  },
  onToggleNookPopover: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('glassy:toggle-nook-popover', handler);
    return () => ipcRenderer.removeListener('glassy:toggle-nook-popover', handler);
  },
  onIslandBlurred: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('glassy:island-blurred', handler);
    return () => ipcRenderer.removeListener('glassy:island-blurred', handler);
  },
  onIslandOpenTray: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('glassy:island-open-tray', handler);
    return () => ipcRenderer.removeListener('glassy:island-open-tray', handler);
  },
  onIslandVisibility: (cb) => {
    const handler = (_e: Electron.IpcRendererEvent, visible: boolean) => cb(visible);
    ipcRenderer.on('glassy:island-visibility', handler);
    return () => ipcRenderer.removeListener('glassy:island-visibility', handler);
  },
  onSuspended: (cb) => {
    const handler = (_e: Electron.IpcRendererEvent, suspended: boolean) => cb(suspended);
    ipcRenderer.on('glassy:suspended', handler);
    return () => ipcRenderer.removeListener('glassy:suspended', handler);
  },
  onConfigUpdated: (cb) => {
    const handler = (_e: Electron.IpcRendererEvent, cfg: AppConfig) => cb(cfg);
    ipcRenderer.on('glassy:config-updated', handler);
    return () => ipcRenderer.removeListener('glassy:config-updated', handler);
  },
  getUpdateInfo: () => ipcRenderer.invoke('glassy:get-update-info'),
  checkForUpdates: () => ipcRenderer.invoke('glassy:check-updates'),
  installUpdate: () => ipcRenderer.invoke('glassy:install-update'),
  onUpdateInfo: (cb) => {
    const handler = (_e: Electron.IpcRendererEvent, info: UpdateInfo) => cb(info);
    ipcRenderer.on('glassy:update-info', handler);
    return () => ipcRenderer.removeListener('glassy:update-info', handler);
  }
};

contextBridge.exposeInMainWorld('glassy', api);
