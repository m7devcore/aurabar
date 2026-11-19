export type DockPosition = 'top' | 'bottom';
export type MusicPosition = 'top' | 'taskbar';
export type ThemeId = 'obsidian' | 'platinum' | 'frost';
export type Language = 'en' | 'ar';

export type ActivePanel = 'apps' | 'media' | 'system' | 'calendar' | 'settings' | null;

export interface PinnedApp {
  id: string;
  name: string;
  target: string;
  kind: 'app' | 'url' | 'folder' | 'system' | 'group';
  icon: string;
  color: string;
  iconDataUrl?: string;
  exeName?: string;
  children?: PinnedApp[];
}

export interface InstalledApp {
  name: string;
  target: string;
  exeName?: string;
  iconDataUrl?: string;
}

export interface RunningWindow {
  hwnd?: string;
  pid: number;
  processName: string;
  title: string;
  executablePath?: string;
  iconDataUrl?: string;
  isMinimized?: boolean;
  isActive?: boolean;
}

export interface BackgroundApp {
  pid: number;
  processName: string;
  displayName: string;
  executablePath: string;
  iconDataUrl?: string;
}

export interface SystemStats {
  cpuPercent: number;
  ramPercent: number;
  ramUsedGb: number;
  ramTotalGb: number;
  uptimeSeconds: number;
  batteryPercent: number | null;
  batteryCharging: boolean | null;
  diskUsedPercent: number | null;
  diskFreeGb: number | null;
  diskTotalGb: number | null;
  hostname: string;
}

export interface MediaInfo {
  title: string;
  artist: string;
  appId: string;
  status: 'Playing' | 'Paused' | 'Closed' | 'Unknown';
  posSec?: number;
  endSec?: number;
  album?: string;
  /** Playback position in ms as last reported by the player, valid at `posAt` */
  posMs?: number;
  /** Unix ms when `posMs` was true (the player's timeline update time) */
  posAt?: number;
}

export interface LyricLine {
  timeMs: number;
  text: string;
}

export interface LyricsResult {
  synced: LyricLine[] | null;
  plain: string[] | null;
  instrumental: boolean;
}

export interface VolumeInfo {
  level: number;
  muted: boolean;
}

export interface NetworkInfo {
  connected: boolean;
  kind: 'wifi' | 'ethernet' | 'offline';
  ssid?: string;
  signalPercent?: number;
  band?: string;
}

export interface CalendarEvent {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  time?: string;
}

export interface DockSettings {
  musicPosition: MusicPosition;
  replaceWindowsTaskbar: boolean;
  position: DockPosition;
  theme: ThemeId;
  language: Language;
  alwaysOnTop: boolean;
  showOpenWindowsInBar: boolean;
  compactMode: boolean;
  launchAtStartup: boolean;
}

export interface AppConfig {
  settings: DockSettings;
  pinnedApps: PinnedApp[];
  calendarEvents: CalendarEvent[];
}
