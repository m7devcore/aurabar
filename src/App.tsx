import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { DockBar } from './components/DockBar';
import { DynamicIsland } from './components/DynamicIsland';
import { AppLauncherPopover } from './components/popovers/AppLauncherPopover';
import { CalendarPopover } from './components/popovers/CalendarPopover';
import { MediaPopover } from './components/popovers/MediaPopover';
import { SettingsPopover } from './components/popovers/SettingsPopover';
import { SystemPopover } from './components/popovers/SystemPopover';
import { dockBridge } from './hooks/useDockBridge';
import { panelTitleLabel } from './i18n';
import type {
  ActivePanel,
  AppConfig,
  DockSettings,
  MediaInfo,
  UpdateInfo,
  RunningWindow,
  SystemStats
} from './types';

const rawView = new URLSearchParams(window.location.search).get('view');
const VIEW_MODE: 'island' | 'secondary-dock' | 'dock' =
  rawView === 'island' ? 'island' : rawView === 'secondary-dock' ? 'secondary-dock' : 'dock';

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [islandExpanded, setIslandExpanded] = useState(false);
  const [islandPeekVisible, setIslandPeekVisible] = useState(false);
  const [stats, setStats] = useState<SystemStats>({
    cpuPercent: 0,
    ramPercent: 0,
    ramUsedGb: 0,
    ramTotalGb: 0,
    uptimeSeconds: 0,
    batteryPercent: null,
    batteryCharging: null,
    diskUsedPercent: null,
    diskFreeGb: null,
    diskTotalGb: null,
    hostname: 'PC'
  });
  const [cpuHistory, setCpuHistory] = useState<number[]>([0]);
  const [ramHistory, setRamHistory] = useState<number[]>([0]);
  const [runningWindows, setRunningWindows] = useState<RunningWindow[]>([]);
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [kbdLang, setKbdLang] = useState('EN');
  const [now, setNow] = useState(() => new Date());

  // Always merge edits into the newest config; render-time closures can be a save behind
  const configRef = useRef<AppConfig | null>(null);
  configRef.current = config;

  const persistConfig = useCallback(async (next: AppConfig) => {
    configRef.current = next;
    setConfig(next);
    const saved = await dockBridge.saveConfig(next);
    // Main may enrich the config (e.g. resolve exe names for running indicators); adopt it only
    // if no newer local edit happened while the save was in flight
    if (configRef.current === next) {
      configRef.current = saved;
      setConfig(saved);
    }
  }, []);

  const patchConfig = useCallback(
    (patch: Partial<Omit<AppConfig, 'settings'>>) => {
      const base = configRef.current;
      if (!base) return;
      void persistConfig({ ...base, ...patch });
    },
    [persistConfig]
  );

  const updateSettings = useCallback(
    (patch: Partial<DockSettings>) => {
      const base = configRef.current;
      if (!base) return;
      void persistConfig({ ...base, settings: { ...base.settings, ...patch } });
    },
    [persistConfig]
  );

  // Initial config load + live Tray / Settings sync for both Dock & Top Island
  useEffect(() => {
    void dockBridge.getConfig().then(setConfig);
    void dockBridge.getUpdateInfo().then(setUpdateInfo);
    const stopUpdateInfo = dockBridge.onUpdateInfo(setUpdateInfo);
    const stopConfig = dockBridge.onConfigUpdated((updated) => {
      setConfig(updated);
    });
    return () => {
      stopUpdateInfo();
      stopConfig();
    };
  }, []);

  // A file dropped anywhere outside the dock's own drop zone must not be opened by Chromium
  useEffect(() => {
    const block = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', block);
    window.addEventListener('drop', block);
    return () => {
      window.removeEventListener('dragover', block);
      window.removeEventListener('drop', block);
    };
  }, []);

  // Theme & RTL attribute sync
  useEffect(() => {
    if (!config) return;
    document.documentElement.setAttribute('data-theme', config.settings.theme);
    document.documentElement.setAttribute('dir', config.settings.language === 'ar' ? 'rtl' : 'ltr');
  }, [config?.settings.theme, config?.settings.language]);

  // Collapse popover or island when window blurs or Esc pressed
  useEffect(() => {
    const unsubBlur = dockBridge.onDockBlurred(() => setActivePanel(null));
    const unsubIslandBlur = dockBridge.onIslandBlurred(() => setIslandExpanded(false));
    const unsubIslandVis = dockBridge.onIslandVisibility((visible) => setIslandPeekVisible(visible));
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (VIEW_MODE === 'island') {
          setIslandExpanded(false);
          void dockBridge.setIslandExpanded(false);
        } else {
          setActivePanel(null);
          void dockBridge.setPopoverOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      unsubBlur();
      unsubIslandBlur();
      unsubIslandVis();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const handleTogglePanel = (panel: ActivePanel) => {
    setActivePanel(panel);
    void dockBridge.setPopoverOpen(panel !== null);
  };

  // System stats + clock + keyboard language tick
  useEffect(() => {
    if (VIEW_MODE === 'island') return;
    if (VIEW_MODE === 'secondary-dock') {
      const id = setInterval(() => setNow(new Date()), 2000);
      return () => clearInterval(id);
    }
    const poll = async () => {
      const s = await dockBridge.getSystemStats();
      setStats(s);
      setCpuHistory((prev) => [...prev.slice(-29), s.cpuPercent]);
      setRamHistory((prev) => [...prev.slice(-29), s.ramPercent]);
      const lang = await dockBridge.getKeyboardLang();
      setKbdLang(lang);
    };
    void poll();
    const id = setInterval(() => {
      setNow(new Date());
      void poll();
    }, 2000);
    return () => clearInterval(id);
  }, []);

  // Media polling
  const refreshMedia = useCallback(async () => {
    const m = await dockBridge.getMediaInfo();
    // Identical polls keep the same object, so the island/dock don't re-render for nothing
    setMedia((prev) => (JSON.stringify(prev) === JSON.stringify(m) ? prev : m));
  }, []);

  // Only poll where music is actually on screen: the island when it is shown, the dock when the
  // inline player or the media panel is visible
  const musicPosition = config?.settings.musicPosition;
  const needsMedia =
    VIEW_MODE === 'island'
      ? musicPosition === 'top' || islandPeekVisible
      : VIEW_MODE === 'dock' && (musicPosition === 'taskbar' || activePanel === 'media');

  useEffect(() => {
    if (!needsMedia) return;
    void refreshMedia();
    const intervalMs = VIEW_MODE === 'island' || musicPosition === 'taskbar' ? 1500 : 2500;
    const id = setInterval(() => {
      void refreshMedia();
    }, intervalMs);
    return () => clearInterval(id);
  }, [needsMedia, musicPosition, refreshMedia]);

  // Running windows polling
  const refreshWindows = useCallback(async () => {
    const wins = await dockBridge.getRunningWindows();
    setRunningWindows(wins);
  }, []);

  useEffect(() => {
    if (VIEW_MODE === 'island') return;
    void refreshWindows();
    const id = setInterval(() => {
      void refreshWindows();
    }, 1800);
    return () => clearInterval(id);
  }, [refreshWindows]);

  if (VIEW_MODE === 'island') {
    return (
      <DynamicIsland
        lang={config?.settings.language ?? 'en'}
        media={media}
        expanded={islandExpanded}
        onToggleExpand={(open) => {
          setIslandExpanded(open);
          void dockBridge.setIslandExpanded(open);
        }}
        onRefreshMedia={() => void refreshMedia()}
      />
    );
  }

  if (!config) return null;

  const { settings } = config;
  const panelTitle = panelTitleLabel(activePanel, settings.language);

  const popoverElement = activePanel ? (
    <div className="popover-card">
      <div className="popover-header">
        <div className="popover-title">{panelTitle}</div>
        <button
          className="btn btn-icon"
          onClick={() => handleTogglePanel(null)}
          title="Close (Esc)"
        >
          <X size={15} />
        </button>
      </div>

      <div className="popover-body">
        {activePanel === 'apps' && (
          <AppLauncherPopover
            lang={settings.language}
            pinnedApps={config.pinnedApps}
            runningWindows={runningWindows}
            onSavePinnedApps={(pinnedApps) => patchConfig({ pinnedApps })}
            onRefreshWindows={() => void refreshWindows()}
          />
        )}

        {activePanel === 'system' && (
          <SystemPopover
            lang={settings.language}
            stats={stats}
            cpuHistory={cpuHistory}
            ramHistory={ramHistory}
          />
        )}

        {activePanel === 'media' && (
          <MediaPopover
            lang={settings.language}
            media={media}
            onRefreshMedia={() => void refreshMedia()}
          />
        )}

        {activePanel === 'calendar' && (
          <CalendarPopover
            lang={settings.language}
            events={config.calendarEvents}
            onSaveEvents={(calendarEvents) => patchConfig({ calendarEvents })}
          />
        )}

        {activePanel === 'settings' && (
          <SettingsPopover
            updateInfo={updateInfo}
            settings={settings}
            onUpdateSettings={updateSettings}
            onOpenAppsManager={() => handleTogglePanel('apps')}
          />
        )}
      </div>
    </div>
  ) : null;

  return (
    <div
      className={`shell-root pos-${settings.position}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && activePanel) {
          handleTogglePanel(null);
        }
      }}
    >
      {settings.position === 'bottom' && popoverElement}
      <DockBar
        isSecondary={VIEW_MODE === 'secondary-dock'}
        updateInfo={updateInfo}
        config={config}
        activePanel={activePanel}
        stats={stats}
        media={media}
        runningWindows={runningWindows}
        kbdLang={kbdLang}
        now={now}
        onTogglePanel={handleTogglePanel}
        onSavePinnedApps={(pinnedApps) => patchConfig({ pinnedApps })}
        onRefreshMedia={() => void refreshMedia()}
        onRefreshWindows={() => void refreshWindows()}
        onSwitchKbdLang={() => {
          void dockBridge.switchKeyboardLang().then(() => {
            setTimeout(() => void dockBridge.getKeyboardLang().then(setKbdLang), 150);
          });
        }}
      />
      {settings.position === 'top' && popoverElement}
    </div>
  );
}
