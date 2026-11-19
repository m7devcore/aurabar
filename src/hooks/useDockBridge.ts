import type { AuraBarApi } from '../../electron/preload';
import type { AppConfig } from '../types';

declare global {
  interface Window {
    auraBar?: AuraBarApi;
  }
}

const FALLBACK_CONFIG: AppConfig = {
  settings: {
    musicPosition: 'top',
    replaceWindowsTaskbar: true,
    position: 'bottom',
    theme: 'obsidian',
    language: 'en',
    alwaysOnTop: true,
    showOpenWindowsInBar: true,
    compactMode: false,
    launchAtStartup: false,
    hideInFullscreen: true,
    showOnAllDisplays: true
  },
  pinnedApps: [],
  calendarEvents: []
};

export const dockBridge: AuraBarApi = window.auraBar ?? {
  getConfig: async () => FALLBACK_CONFIG,
  saveConfig: async (cfg) => cfg,
  setPopoverOpen: async () => undefined,
  setDockInteractive: () => undefined,
  setIslandExpanded: async () => undefined,
  setIslandInteractive: () => undefined,
  setHitRects: () => undefined,
  getSystemStats: async () => ({
    cpuPercent: 18,
    ramPercent: 46,
    ramUsedGb: 7.4,
    ramTotalGb: 16,
    uptimeSeconds: 5400,
    batteryPercent: 88,
    batteryCharging: true,
    diskUsedPercent: 52,
    diskFreeGb: 220,
    diskTotalGb: 475,
    hostname: 'LOCAL-PC'
  }),
  getRunningWindows: async () => [],
  getBackgroundApps: async () => [],
  getInstalledApps: async () => [],
  createPinnedFromPath: async () => null,
  getPathForFile: () => '',
  importTaskbarApps: async () => [],
  focusWindow: async () => true,
  openApp: async () => true,
  closeWindow: async () => true,
  getWindowThumb: async () => undefined,
  quitProcess: async () => true,
  launchTarget: async (target) => {
    if (/^https?:\/\//i.test(target)) window.open(target, '_blank');
    return true;
  },
  pickAppFile: async () => null,
  getAppIcon: async () => undefined,
  getMediaInfo: async () => null,
  sendMediaCommand: async () => undefined,
  getLyrics: async () => null,
  adjustVolume: async () => undefined,
  getVolume: async () => ({ level: 65, muted: false }),
  setVolume: async (level) => ({ level, muted: false }),
  toggleMute: async () => ({ level: 65, muted: true }),
  systemAction: async () => undefined,
  getKeyboardLang: async () => 'EN',
  switchKeyboardLang: async () => undefined,
  getNetworkInfo: async () => ({ connected: true, kind: 'wifi', ssid: 'Wi-Fi', signalPercent: 85 }),
  hideDock: async () => undefined,
  quitApp: async () => undefined,
  onDockBlurred: () => () => undefined,
  onIslandBlurred: () => () => undefined,
  onIslandVisibility: () => () => undefined,
  onConfigUpdated: () => () => undefined,
  getUpdateInfo: async () => ({ available: false, currentVersion: 'dev', state: 'idle' }),
  checkForUpdates: async () => undefined,
  installUpdate: async () => undefined,
  onUpdateInfo: () => () => undefined
};
