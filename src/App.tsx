import { useCallback, useEffect, useState } from 'react';
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
  RunningWindow,
  SystemStats
} from './types';

const VIEW_MODE =
  new URLSearchParams(window.location.search).get('view') === 'island' ? 'island' : 'dock';

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [islandExpanded, setIslandExpanded] = useState(false);
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
  const [kbdLang, setKbdLang] = useState('EN');
  const [now, setNow] = useState(() => new Date());

  const persistConfig = useCallback(async (next: AppConfig) => {
    setConfig(next);
    await dockBridge.saveConfig(next);
  }, []);

  const updateSettings = useCallback(
    (patch: Partial<DockSettings>) => {
      if (!config) return;
      const next: AppConfig = {
        ...config,
        settings: { ...config.settings, ...patch }
      };
      void persistConfig(next);
    },
    [config, persistConfig]
  );

  // Initial config load + Tray updates
  useEffect(() => {
    if (VIEW_MODE !== 'dock') return;
    void dockBridge.getConfig().then(setConfig);
    return dockBridge.onConfigUpdated((updated) => {
      setConfig(updated);
    });
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
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const handleTogglePanel = (panel: ActivePanel) => {
    setActivePanel(panel);
    void dockBridge.setPopoverOpen(panel !== null);
  };

  // System stats + clock + keyboard language tick
  useEffect(() => {
    if (VIEW_MODE !== 'dock') return;
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
    setMedia(m);
  }, []);

  useEffect(() => {
    void refreshMedia();
    const intervalMs = VIEW_MODE === 'island' ? 1500 : 2500;
    const id = setInterval(() => {
      void refreshMedia();
    }, intervalMs);
    return () => clearInterval(id);
  }, [refreshMedia]);

  // Running windows polling
  const refreshWindows = useCallback(async () => {
    const wins = await dockBridge.getRunningWindows();
    setRunningWindows(wins);
  }, []);

  useEffect(() => {
    if (VIEW_MODE !== 'dock') return;
    void refreshWindows();
    const id = setInterval(() => {
      if (config?.settings.showOpenWindowsInBar || activePanel === 'apps') {
        void refreshWindows();
      }
    }, 1800);
    return () => clearInterval(id);
  }, [activePanel, config?.settings.showOpenWindowsInBar, refreshWindows]);

  if (VIEW_MODE === 'island') {
    return (
      <DynamicIsland
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
            onSavePinnedApps={(pinnedApps) => void persistConfig({ ...config, pinnedApps })}
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
            onSaveEvents={(calendarEvents) => void persistConfig({ ...config, calendarEvents })}
          />
        )}

        {activePanel === 'settings' && (
          <SettingsPopover
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
        config={config}
        activePanel={activePanel}
        stats={stats}
        media={media}
        runningWindows={runningWindows}
        kbdLang={kbdLang}
        now={now}
        onTogglePanel={handleTogglePanel}
        onSavePinnedApps={(pinnedApps) => void persistConfig({ ...config, pinnedApps })}
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
