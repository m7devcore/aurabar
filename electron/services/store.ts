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
    compactMode: false
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
            : DEFAULT_CONFIG.settings.compactMode
      },
      pinnedApps: Array.isArray(parsed.pinnedApps)
        ? parsed.pinnedApps
        : DEFAULT_CONFIG.pinnedApps,
      calendarEvents: Array.isArray(parsed.calendarEvents) ? parsed.calendarEvents : []
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(config: AppConfig): AppConfig {
  const filePath = getConfigPath();
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save config:', err);
  }
  return config;
}
