import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig, ThemeId } from '../../src/types';

const DEFAULT_CONFIG: AppConfig = {
  settings: {
    musicPosition: 'top',
    replaceWindowsTaskbar: true,
    position: 'bottom',
    theme: 'obsidian',
    language: 'en',
    alwaysOnTop: true,
    showOpenWindowsInBar: true,
    compactMode: false,
    dockMagnification: true,
    launchAtStartup: false,
    hideInFullscreen: true,
    autoHideIdleIsland: false,
    showOnAllDisplays: true
  },
  pinnedApps: [
    {
      id: 'app-explorer',
      name: 'Explorer',
      target: 'explorer.exe',
      kind: 'system',
      icon: 'folder',
      color: '#F59E0B'
    },
    {
      id: 'app-vscode',
      name: 'VS Code',
      target: 'code',
      kind: 'system',
      icon: 'code',
      color: '#3B82F6'
    }
  ],
  calendarEvents: []
};

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'aurabar-config.json');
}

function normalizeTheme(raw: unknown): ThemeId {
  if (raw === 'frost' || raw === 'platinum' || raw === 'obsidian') return raw;
  return 'obsidian';
}

export function loadConfig(): AppConfig {
  const filePath = getConfigPath();
  try {
    if (!fs.existsSync(filePath)) {
      saveConfig(DEFAULT_CONFIG);
      return structuredClone(DEFAULT_CONFIG);
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as {
      settings?: Partial<AppConfig['settings']> & { showDynamicIsland?: boolean };
      pinnedApps?: AppConfig['pinnedApps'];
      calendarEvents?: AppConfig['calendarEvents'];
    };
    const rawSettings = parsed.settings ?? {};
    const musicPosition =
      rawSettings.musicPosition === 'top' || rawSettings.musicPosition === 'taskbar'
        ? rawSettings.musicPosition
        : rawSettings.showDynamicIsland === false
          ? 'taskbar'
          : 'top';

    return {
      settings: {
        musicPosition,
        replaceWindowsTaskbar:
          typeof rawSettings.replaceWindowsTaskbar === 'boolean'
            ? rawSettings.replaceWindowsTaskbar
            : DEFAULT_CONFIG.settings.replaceWindowsTaskbar,
        position: rawSettings.position === 'top' ? 'top' : 'bottom',
        theme: normalizeTheme(rawSettings.theme),
        language: rawSettings.language === 'ar' ? 'ar' : 'en',
        alwaysOnTop:
          typeof rawSettings.alwaysOnTop === 'boolean'
            ? rawSettings.alwaysOnTop
            : DEFAULT_CONFIG.settings.alwaysOnTop,
        showOpenWindowsInBar:
          typeof rawSettings.showOpenWindowsInBar === 'boolean'
            ? rawSettings.showOpenWindowsInBar
            : DEFAULT_CONFIG.settings.showOpenWindowsInBar,
        compactMode:
          typeof rawSettings.compactMode === 'boolean'
            ? rawSettings.compactMode
            : DEFAULT_CONFIG.settings.compactMode,
        dockMagnification:
          typeof rawSettings.dockMagnification === 'boolean'
            ? rawSettings.dockMagnification
            : DEFAULT_CONFIG.settings.dockMagnification,
        launchAtStartup:
          typeof rawSettings.launchAtStartup === 'boolean'
            ? rawSettings.launchAtStartup
            : DEFAULT_CONFIG.settings.launchAtStartup,
        hideInFullscreen:
          typeof rawSettings.hideInFullscreen === 'boolean'
            ? rawSettings.hideInFullscreen
            : DEFAULT_CONFIG.settings.hideInFullscreen,
        autoHideIdleIsland:
          typeof rawSettings.autoHideIdleIsland === 'boolean'
            ? rawSettings.autoHideIdleIsland
            : DEFAULT_CONFIG.settings.autoHideIdleIsland,
        showOnAllDisplays:
          typeof rawSettings.showOnAllDisplays === 'boolean'
            ? rawSettings.showOnAllDisplays
            : DEFAULT_CONFIG.settings.showOnAllDisplays
      },
      pinnedApps: Array.isArray(parsed.pinnedApps)
        ? parsed.pinnedApps
        : DEFAULT_CONFIG.pinnedApps,
      calendarEvents: Array.isArray(parsed.calendarEvents) ? parsed.calendarEvents : []
    };
  } catch {
    // Keep the unreadable file around; otherwise the next save silently replaces the user's
    // pinned apps and reminders with defaults
    try {
      fs.copyFileSync(filePath, `${filePath}.corrupt-${Date.now()}.bak`);
    } catch {
      // Nothing to back up
    }
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(config: AppConfig): AppConfig {
  const filePath = getConfigPath();
  const tmpPath = `${filePath}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // Write-then-rename so a crash mid-write never leaves a truncated config behind
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    console.error('Failed to save config:', err);
  }
  return config;
}
