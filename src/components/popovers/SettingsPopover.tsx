import { EyeOff, Grid2x2, Power } from 'lucide-react';
import { dockBridge } from '../../hooks/useDockBridge';
import { t } from '../../i18n';
import type { DockSettings, ThemeId, UpdateInfo } from '../../types';

interface Props {
  updateInfo: UpdateInfo | null;
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

function UpdateCard({ info, dict }: { info: UpdateInfo; dict: ReturnType<typeof t> }) {
  const ready = info.state === 'ready';
  const downloading = info.state === 'downloading';
  const busy = ready || downloading || info.state === 'checking';

  let title = `${dict.versionLabel} v${info.currentVersion}`;
  let desc: string | null = null;
  if (ready) {
    title = dict.updateReady;
    desc = dict.updateReadyDesc.replace('{v}', info.version ?? '');
  } else if (downloading) {
    title = dict.updateDownloading;
    desc = `v${info.version ?? ''} — ${info.percent ?? 0}%`;
  } else if (info.state === 'checking') {
    desc = dict.checkingUpdates;
  } else if (info.state === 'upToDate') {
    desc = dict.upToDate;
  } else if (info.state === 'error') {
    desc = dict.updateError;
  }

  return (
    <div className={`update-card ${ready ? 'is-ready' : ''}`}>
      <div className="update-card-text">
        <div className="toggle-title">{title}</div>
        {desc && <div className="toggle-desc">{desc}</div>}
        {downloading && (
          <div className="update-progress">
            <div
              className="update-progress-fill"
              style={{ transform: `scaleX(${Math.max(0.02, (info.percent ?? 0) / 100)})` }}
            />
          </div>
        )}
      </div>
      {ready ? (
        <button className="btn btn-primary" onClick={() => void dockBridge.installUpdate()}>
          {dict.restartNow}
        </button>
      ) : (
        <button
          className="btn"
          disabled={busy}
          onClick={() => void dockBridge.checkForUpdates()}
        >
          {dict.checkUpdates}
        </button>
      )}
    </div>
  );
}

export function SettingsPopover({
  updateInfo,
  settings,
  onUpdateSettings,
  onOpenAppsManager
}: Props) {
  const dict = t(settings.language);

  const themes: { id: ThemeId; label: string }[] = [
    { id: 'obsidian', label: dict.themeObsidian },
    { id: 'platinum', label: dict.themePlatinum },
    { id: 'frost', label: dict.themeFrost }
  ];

  return (
    <div className="stack-md">
      {/* 0. App updates (installed build only) */}
      {updateInfo?.available && <UpdateCard info={updateInfo} dict={dict} />}

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

          <ToggleSwitch
            checked={settings.showOnAllDisplays}
            title={dict.showOnAllDisplays}
            desc={dict.showOnAllDisplaysDesc}
            onToggle={() => onUpdateSettings({ showOnAllDisplays: !settings.showOnAllDisplays })}
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
