import { EyeOff, Grid2x2, Power } from 'lucide-react';
import { dockBridge } from '../../hooks/useDockBridge';
import { t } from '../../i18n';
import type { DockSettings, ThemeId } from '../../types';

interface Props {
  settings: DockSettings;
  onUpdateSettings: (patch: Partial<DockSettings>) => void;
  onOpenAppsManager: () => void;
}

function ToggleSwitch({
  checked,
  title,
  desc,
  onToggle
}: {
  checked: boolean;
  title: string;
  desc: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="toggle-row"
      onClick={onToggle}
      role="switch"
      aria-checked={checked}
    >
      <div>
        <div className="toggle-title">{title}</div>
        <div className="toggle-desc">{desc}</div>
      </div>
      <div className={`switch-track ${checked ? 'on' : ''}`}>
        <div className="switch-thumb" />
      </div>
    </button>
  );
}

export function SettingsPopover({ settings, onUpdateSettings, onOpenAppsManager }: Props) {
  const dict = t(settings.language);

  const themes: { id: ThemeId; label: string }[] = [
    { id: 'obsidian', label: dict.themeObsidian },
    { id: 'platinum', label: dict.themePlatinum },
    { id: 'frost', label: dict.themeFrost }
  ];

  return (
    <div className="stack-md">
      {/* 1. Music Player Placement */}
      <div>
        <div className="settings-section-title">{dict.musicSection}</div>
        <div className="segmented-control">
          <button
            className={`segmented-btn ${settings.musicPosition === 'top' ? 'active' : ''}`}
            onClick={() => onUpdateSettings({ musicPosition: 'top' })}
          >
            {dict.musicTop}
          </button>
          <button
            className={`segmented-btn ${settings.musicPosition === 'taskbar' ? 'active' : ''}`}
            onClick={() => onUpdateSettings({ musicPosition: 'taskbar' })}
          >
            {dict.musicTaskbar}
          </button>
        </div>
      </div>

      {/* 2. Theme & Language */}
      <div className="grid-2">
        <div>
          <div className="settings-section-title">{dict.theme}</div>
          <div className="segmented-control">
            {themes.map((th) => (
              <button
                key={th.id}
                className={`segmented-btn ${settings.theme === th.id ? 'active' : ''}`}
                onClick={() => onUpdateSettings({ theme: th.id })}
              >
                {th.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="settings-section-title">{dict.language}</div>
          <div className="segmented-control">
            <button
              className={`segmented-btn ${settings.language === 'en' ? 'active' : ''}`}
              onClick={() => onUpdateSettings({ language: 'en' })}
            >
              English
            </button>
            <button
              className={`segmented-btn ${settings.language === 'ar' ? 'active' : ''}`}
              onClick={() => onUpdateSettings({ language: 'ar' })}
            >
              العربية
            </button>
          </div>
        </div>
      </div>

      {/* 3. Active Taskbar Behavior */}
      <div>
        <div className="settings-section-title">{dict.behaviorSection}</div>

        <div className="settings-group">
          <ToggleSwitch
            checked={settings.replaceWindowsTaskbar}
            title={dict.replaceWindowsTaskbar}
            desc={dict.replaceTaskbarDesc}
            onToggle={() =>
              onUpdateSettings({ replaceWindowsTaskbar: !settings.replaceWindowsTaskbar })
            }
          />

          <ToggleSwitch
            checked={settings.showOpenWindowsInBar}
            title={dict.showOpenWindows}
            desc={dict.showOpenWindowsDesc}
            onToggle={() =>
              onUpdateSettings({ showOpenWindowsInBar: !settings.showOpenWindowsInBar })
            }
          />

          <ToggleSwitch
            checked={settings.compactMode}
            title={dict.compactMode}
            desc={dict.compactModeDesc}
            onToggle={() => onUpdateSettings({ compactMode: !settings.compactMode })}
          />

          <ToggleSwitch
            checked={settings.alwaysOnTop}
            title={dict.alwaysOnTop}
            desc={dict.alwaysOnTopDesc}
            onToggle={() => onUpdateSettings({ alwaysOnTop: !settings.alwaysOnTop })}
          />

          <ToggleSwitch
            checked={settings.launchAtStartup}
            title={dict.launchAtStartup}
            desc={dict.launchAtStartupDesc}
            onToggle={() => onUpdateSettings({ launchAtStartup: !settings.launchAtStartup })}
          />

          <ToggleSwitch
            checked={settings.hideInFullscreen}
            title={dict.hideInFullscreen}
            desc={dict.hideInFullscreenDesc}
            onToggle={() => onUpdateSettings({ hideInFullscreen: !settings.hideInFullscreen })}
          />
        </div>
      </div>

      {/* 4. Actions */}
      <div className="row-between" style={{ paddingTop: 4 }}>
        <button className="btn btn-primary" onClick={onOpenAppsManager}>
          <Grid2x2 size={14} />
          {dict.manageAppsBtn}
        </button>

        <div className="row-gap">
          <button className="btn" onClick={() => void dockBridge.hideDock()}>
            <EyeOff size={14} />
            {dict.hideDock}
          </button>
          <button
            className="btn"
            style={{ color: 'var(--rose)' }}
            onClick={() => void dockBridge.quitApp()}
          >
            <Power size={14} />
            {dict.quitApp}
          </button>
        </div>
      </div>
    </div>
  );
}
