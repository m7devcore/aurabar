import { useState } from 'react';
import {
  Check,
  Contrast,
  Disc3,
  EyeOff,
  Grid2x2,
  PanelBottom,
  Power,
  SlidersHorizontal
} from 'lucide-react';
import { dockBridge } from '../../hooks/useDockBridge';
import { t } from '../../i18n';
import type {
  AdaptiveAccentMode,
  DockSettings,
  NotchPlacement,
  ThemeId,
  UpdateInfo
} from '../../types';

interface Props {
  updateInfo: UpdateInfo | null;
  settings: DockSettings;
  onUpdateSettings: (patch: Partial<DockSettings>) => void;
  onOpenAppsManager: () => void;
}

type SettingsTab = 'dock' | 'island' | 'appearance' | 'system';

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
      <div style={{ minWidth: 0 }}>
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
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    updateInfo?.state === 'ready' ? 'system' : 'dock'
  );

  const curNotchPlacement: NotchPlacement =
    settings.notchPlacement ?? (settings.notchNookEnabled === false ? 'off' : 'top');
  const curAdaptiveMode: AdaptiveAccentMode =
    settings.adaptiveAccentMode ?? (settings.adaptiveAccent === false ? 'off' : 'media');
  const topIslandActive = settings.musicPosition === 'top' || curNotchPlacement === 'top';
  const hasUpdateBadge = updateInfo?.state === 'ready' || updateInfo?.state === 'downloading';

  const navItems: {
    id: SettingsTab;
    label: string;
    Icon: typeof PanelBottom;
    badge?: boolean;
  }[] = [
    { id: 'dock', label: dict.settingsTabDock, Icon: PanelBottom },
    { id: 'island', label: dict.settingsTabIsland, Icon: Disc3 },
    { id: 'appearance', label: dict.settingsTabAppearance, Icon: Contrast },
    { id: 'system', label: dict.settingsTabSystem, Icon: SlidersHorizontal, badge: hasUpdateBadge }
  ];

  const themeCards: {
    id: ThemeId;
    label: string;
    bg: string;
    bar: string;
    accent: string;
    border: string;
  }[] = [
    {
      id: 'obsidian',
      label: dict.themeObsidian,
      bg: '#0b0b0e',
      bar: '#18181c',
      accent: '#4cb3f0',
      border: '#2c2c33'
    },
    {
      id: 'platinum',
      label: dict.themePlatinum,
      bg: '#131210',
      bar: '#211f1c',
      accent: '#e5b85c',
      border: '#3a3630'
    },
    {
      id: 'oled',
      label: dict.themeOled,
      bg: '#000000',
      bar: '#0c0c0e',
      accent: '#e4e4e7',
      border: '#242429'
    },
    {
      id: 'midnight',
      label: dict.themeMidnight,
      bg: '#0b111b',
      bar: '#141d2d',
      accent: '#60a5fa',
      border: '#27364f'
    },
    {
      id: 'emerald',
      label: dict.themeEmerald,
      bg: '#0a1310',
      bar: '#12211c',
      accent: '#34d399',
      border: '#223b32'
    },
    {
      id: 'rosewood',
      label: dict.themeRosewood,
      bg: '#150e12',
      bar: '#23171e',
      accent: '#e87996',
      border: '#3d2834'
    },
    {
      id: 'amethyst',
      label: dict.themeAmethyst,
      bg: '#100e18',
      bar: '#1b1829',
      accent: '#a78bfa',
      border: '#312c47'
    },
    {
      id: 'frost',
      label: dict.themeFrost,
      bg: '#e9eaee',
      bar: '#ffffff',
      accent: '#0284c7',
      border: '#cfd1d9'
    },
    {
      id: 'sand',
      label: dict.themeSand,
      bg: '#efe9df',
      bar: '#faf6ef',
      accent: '#b45309',
      border: '#d8cfc0'
    }
  ];

  const shortcuts = [
    { keys: 'Alt + Space', label: dict.shortcutToggleDock },
    { keys: 'Alt + H', label: dict.shortcutToggleIsland },
    { keys: 'Alt + N', label: dict.shortcutOpenNook },
    { keys: 'Esc', label: dict.shortcutClosePanel }
  ];

  return (
    <div className="settings-shell">
      {/* Left Navigation Sidebar (macOS System Settings pattern) */}
      <aside className="settings-sidebar">
        <div className="settings-nav" role="tablist" aria-orientation="vertical">
          {navItems.map(({ id, label, Icon, badge }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`settings-nav-btn ${active ? 'active' : ''}`}
                onClick={() => setActiveTab(id)}
              >
                <Icon size={15} strokeWidth={1.65} className="settings-nav-icon" />
                <span className="settings-nav-label">{label}</span>
                {badge && <span className="settings-nav-dot" aria-hidden="true" />}
              </button>
            );
          })}
        </div>

        <div className="settings-sidebar-footer">
          {updateInfo?.currentVersion && (
            <div className="settings-version-tag tabular">
              {dict.versionLabel} v{updateInfo.currentVersion}
            </div>
          )}
          <div className="settings-footer-actions">
            <button
              type="button"
              className="settings-footer-btn"
              onClick={() => void dockBridge.hideDock()}
              title={dict.hideDock}
            >
              <EyeOff size={13} strokeWidth={1.65} />
              <span>{dict.hideShort}</span>
            </button>
            <button
              type="button"
              className="settings-footer-btn danger"
              onClick={() => void dockBridge.quitApp()}
              title={dict.quitApp}
            >
              <Power size={13} strokeWidth={1.65} />
              <span>{dict.quitShort}</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Right Category Content Pane */}
      <div className="settings-pane" role="tabpanel">
        {activeTab === 'dock' && (
          <>
            <div className="settings-pane-top-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="settings-section-title">{dict.dockPosition}</div>
                <div className="segmented-control">
                  <button
                    type="button"
                    className={`segmented-btn ${settings.position === 'bottom' ? 'active' : ''}`}
                    onClick={() => onUpdateSettings({ position: 'bottom' })}
                  >
                    {dict.posBottom}
                  </button>
                  <button
                    type="button"
                    className={`segmented-btn ${settings.position === 'top' ? 'active' : ''}`}
                    onClick={() => onUpdateSettings({ position: 'top' })}
                  >
                    {dict.posTop}
                  </button>
                </div>
              </div>

              <div className="settings-manage-wrap">
                <div className="settings-section-title">{dict.pinnedApps}</div>
                <button
                  type="button"
                  className="btn btn-primary settings-manage-btn"
                  onClick={onOpenAppsManager}
                >
                  <Grid2x2 size={14} strokeWidth={1.65} />
                  <span>{dict.manageAppsBtn}</span>
                </button>
              </div>
            </div>

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
                  checked={settings.dockMagnification !== false}
                  title={dict.dockMagnification}
                  desc={dict.dockMagnificationDesc}
                  onToggle={() =>
                    onUpdateSettings({ dockMagnification: settings.dockMagnification === false })
                  }
                />
                <ToggleSwitch
                  checked={settings.showOnAllDisplays}
                  title={dict.showOnAllDisplays}
                  desc={dict.showOnAllDisplaysDesc}
                  onToggle={() => onUpdateSettings({ showOnAllDisplays: !settings.showOnAllDisplays })}
                />
              </div>
            </div>
          </>
        )}

        {activeTab === 'island' && (
          <>
            <div>
              <div className="settings-section-title">{dict.musicSection}</div>
              <div className="segmented-control">
                <button
                  type="button"
                  className={`segmented-btn ${settings.musicPosition === 'top' ? 'active' : ''}`}
                  onClick={() => onUpdateSettings({ musicPosition: 'top' })}
                >
                  {dict.musicTop}
                </button>
                <button
                  type="button"
                  className={`segmented-btn ${settings.musicPosition === 'taskbar' ? 'active' : ''}`}
                  onClick={() => onUpdateSettings({ musicPosition: 'taskbar' })}
                >
                  {dict.musicTaskbar}
                </button>
              </div>
            </div>

            <div>
              <div className="settings-section-title">{dict.notchNook}</div>
              <div className="segmented-control">
                {(
                  [
                    { id: 'top', label: dict.notchPlaceTop },
                    { id: 'taskbar', label: dict.notchPlaceTaskbar },
                    { id: 'off', label: dict.notchPlaceOff }
                  ] as { id: NotchPlacement; label: string }[]
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`segmented-btn ${curNotchPlacement === opt.id ? 'active' : ''}`}
                    onClick={() =>
                      onUpdateSettings({
                        notchPlacement: opt.id,
                        notchNookEnabled: opt.id !== 'off'
                      })
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="toggle-desc" style={{ marginTop: 5 }}>
                {dict.notchNookDesc}
              </div>
            </div>

            <div className="settings-group">
              <ToggleSwitch
                checked={settings.islandHudEnabled !== false}
                title={dict.islandHud}
                desc={dict.islandHudDesc}
                onToggle={() =>
                  onUpdateSettings({ islandHudEnabled: settings.islandHudEnabled === false })
                }
              />
              {topIslandActive && (
                <ToggleSwitch
                  checked={Boolean(settings.autoHideIdleIsland)}
                  title={dict.autoHideIdleIsland}
                  desc={dict.autoHideIdleIslandDesc}
                  onToggle={() =>
                    onUpdateSettings({ autoHideIdleIsland: !settings.autoHideIdleIsland })
                  }
                />
              )}
            </div>
          </>
        )}

        {activeTab === 'appearance' && (
          <>
            <div>
              <div className="settings-section-title">{dict.theme}</div>
              <div className="settings-theme-grid">
                {themeCards.map((th) => {
                  const selected = settings.theme === th.id;
                  return (
                    <button
                      key={th.id}
                      type="button"
                      className={`settings-theme-card ${selected ? 'active' : ''}`}
                      onClick={() => onUpdateSettings({ theme: th.id })}
                    >
                      <div
                        className="settings-theme-preview"
                        style={{ background: th.bg, borderColor: th.border }}
                      >
                        <div className="settings-theme-island" style={{ background: th.bar }}>
                          <span style={{ background: th.accent }} />
                        </div>
                        <div
                          className="settings-theme-dock"
                          style={{ background: th.bar, borderColor: th.border }}
                        >
                          <span style={{ background: th.accent }} />
                          <span style={{ background: th.border }} />
                          <span style={{ background: th.border }} />
                        </div>
                      </div>
                      <div className="settings-theme-meta">
                        <span className="settings-theme-name">{th.label}</span>
                        {selected && (
                          <span className="settings-theme-check" aria-hidden="true">
                            <Check size={11} strokeWidth={2.5} />
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="settings-section-title">{dict.adaptiveAccent}</div>
              <div className="segmented-control">
                {(
                  [
                    { id: 'off', label: dict.adaptiveModeOff },
                    { id: 'media', label: dict.adaptiveModeMedia },
                    { id: 'all', label: dict.adaptiveModeAll }
                  ] as { id: AdaptiveAccentMode; label: string }[]
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`segmented-btn ${curAdaptiveMode === opt.id ? 'active' : ''}`}
                    onClick={() =>
                      onUpdateSettings({
                        adaptiveAccentMode: opt.id,
                        adaptiveAccent: opt.id !== 'off'
                      })
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="toggle-desc" style={{ marginTop: 5 }}>
                {dict.adaptiveAccentDesc}
              </div>
            </div>

            <div>
              <div className="settings-section-title">{dict.language}</div>
              <div className="segmented-control">
                <button
                  type="button"
                  className={`segmented-btn ${settings.language === 'en' ? 'active' : ''}`}
                  onClick={() => onUpdateSettings({ language: 'en' })}
                >
                  English
                </button>
                <button
                  type="button"
                  className={`segmented-btn ${settings.language === 'ar' ? 'active' : ''}`}
                  onClick={() => onUpdateSettings({ language: 'ar' })}
                >
                  العربية
                </button>
              </div>
            </div>
          </>
        )}

        {activeTab === 'system' && (
          <>
            {updateInfo?.available && <UpdateCard info={updateInfo} dict={dict} />}

            <div className="settings-group">
              <ToggleSwitch
                checked={settings.hideInFullscreen}
                title={dict.hideInFullscreen}
                desc={dict.hideInFullscreenDesc}
                onToggle={() =>
                  onUpdateSettings({ hideInFullscreen: !settings.hideInFullscreen })
                }
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
                onToggle={() =>
                  onUpdateSettings({ launchAtStartup: !settings.launchAtStartup })
                }
              />
            </div>

            <div>
              <div className="settings-section-title">{dict.shortcutsSection}</div>
              <div className="settings-group">
                {shortcuts.map((sc) => (
                  <div key={sc.keys} className="settings-shortcut-row">
                    <span className="settings-shortcut-label">{sc.label}</span>
                    <kbd className="settings-kbd" dir="ltr">
                      {sc.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
