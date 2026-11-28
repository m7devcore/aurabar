import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { DockBar } from './components/DockBar';
import { DynamicIsland } from './components/DynamicIsland';
import { AppLauncherPopover } from './components/popovers/AppLauncherPopover';
import { CalendarPopover } from './components/popovers/CalendarPopover';
import { MediaPopover } from './components/popovers/MediaPopover';
import { NotchNookPopover } from './components/popovers/NotchNookPopover';
import { SettingsPopover } from './components/popovers/SettingsPopover';
import { SystemPopover } from './components/popovers/SystemPopover';
import { dockBridge } from './hooks/useDockBridge';
import { useAdaptiveGlassTint } from './hooks/useAdaptiveGlassTint';
import { useMediaArtwork } from './hooks/useMediaArtwork';
import { useShelfItems } from './hooks/useShelfItems';
import { panelTitleLabel } from './i18n';
import type {
  ActivePanel,
  AppConfig,
  DockSettings,
  HudEvent,
  MediaInfo,
  PrivacyStatus,
  UpdateInfo,
  RunningWindow,
  SystemStats
} from './types';

const DEFAULT_PRIVACY: PrivacyStatus = {
  micActive: false,
  micApps: [],
  micMuted: false,
  hasMic: false,
  camActive: false,
  camApps: []
};

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
  const [privacy, setPrivacy] = useState<PrivacyStatus>(DEFAULT_PRIVACY);
  const [hudEvent, setHudEvent] = useState<HudEvent | null>(null);
  const hudTimerRef = useRef<number | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [kbdLang, setKbdLang] = useState('EN');
  const [now, setNow] = useState(() => new Date());
  const [suspended, setSuspended] = useState(false);

  useEffect(() => dockBridge.onSuspended(setSuspended), []);

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

  const activePanelRef = useRef<ActivePanel>(null);
  activePanelRef.current = activePanel;

  // System stats + clock + keyboard language tick (paused while hidden in fullscreen games)
  useEffect(() => {
    if (VIEW_MODE === 'island' || suspended) return;
    if (VIEW_MODE === 'secondary-dock') {
      const id = setInterval(() => {
        const d = new Date();
        setNow((prev) => (prev.getMinutes() === d.getMinutes() && prev.getHours() === d.getHours() ? prev : d));
      }, 3000);
      return () => clearInterval(id);
    }
    const poll = async () => {
      const [s, lang] = await Promise.all([
        dockBridge.getSystemStats(),
        dockBridge.getKeyboardLang()
      ]);
      const showTelemetry = activePanelRef.current === 'system';
      setStats((prev) => {
        if (
          prev.batteryPercent === s.batteryPercent &&
          prev.batteryCharging === s.batteryCharging &&
          (!showTelemetry ||
            (prev.cpuPercent === s.cpuPercent &&
              prev.ramPercent === s.ramPercent &&
              prev.diskFreeGb === s.diskFreeGb))
        ) {
          return prev;
        }
        return s;
      });
      if (showTelemetry) {
        setCpuHistory((prev) => [...prev.slice(-29), s.cpuPercent]);
        setRamHistory((prev) => [...prev.slice(-29), s.ramPercent]);
      }
      setKbdLang((prev) => (prev === lang ? prev : lang));
    };
    void poll();
    const id = setInterval(() => {
      const d = new Date();
      setNow((prev) => (prev.getMinutes() === d.getMinutes() && prev.getHours() === d.getHours() ? prev : d));
      void poll();
    }, 3000);
    return () => clearInterval(id);
  }, [suspended]);

  // Media polling — ignore linear playback progression so DockBar doesn't re-render every 1.5s
  const mediaPlayingRef = useRef(false);
  const refreshMedia = useCallback(async () => {
    const m = await dockBridge.getMediaInfo();
    mediaPlayingRef.current = m?.status === 'Playing';
    setMedia((prev) => {
      if (!prev && !m) return prev;
      if (!prev || !m) return m;
      if (
        prev.title === m.title &&
        prev.artist === m.artist &&
        prev.album === m.album &&
        prev.appId === m.appId &&
        prev.status === m.status &&
        prev.endSec === m.endSec &&
        prev.thumbnailDataUrl === m.thumbnailDataUrl
      ) {
        if (m.status !== 'Playing') {
          return prev.posSec === m.posSec ? prev : m;
        }
        // While playing, only re-render on a real seek (> 0.9s drift from linear extrapolation)
        const prevPosMs = (prev.posMs ?? (prev.posSec ?? 0) * 1000) + Math.max(0, (m.posAt ?? Date.now()) - (prev.posAt ?? Date.now()));
        const curPosMs = m.posMs ?? (m.posSec ?? 0) * 1000;
        if (Math.abs(curPosMs - prevPosMs) < 900) {
          return prev;
        }
      }
      return m;
    });
  }, []);

  // Only poll where music is actually on screen: the island when it is shown, the dock when the
  // inline player or the media panel is visible
  const musicPosition = config?.settings.musicPosition;
  const needsMedia =
    !suspended &&
    (VIEW_MODE === 'island'
      ? musicPosition === 'top' || islandPeekVisible
      : VIEW_MODE === 'dock' && (musicPosition === 'taskbar' || activePanel === 'media'));

  useEffect(() => {
    if (!needsMedia) return;
    let alive = true;
    let timerId: number | null = null;
    const schedule = async () => {
      await refreshMedia();
      if (!alive) return;
      const delay = mediaPlayingRef.current
        ? VIEW_MODE === 'island' || musicPosition === 'taskbar'
          ? 1100
          : 1800
        : 2200;
      timerId = window.setTimeout(() => void schedule(), delay);
    };
    void schedule();
    return () => {
      alive = false;
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [needsMedia, musicPosition, refreshMedia]);

  // Running windows polling — keep previous array reference when nothing visibly changed so
  // DockBar doesn't re-render every 1.8s while the desktop is idle
  const refreshWindows = useCallback(async () => {
    const wins = await dockBridge.getRunningWindows();
    setRunningWindows((prev) => {
      if (prev.length === wins.length) {
        let same = true;
        for (let i = 0; i < wins.length; i++) {
          const a = prev[i];
          const b = wins[i];
          if (
            a.hwnd !== b.hwnd ||
            a.pid !== b.pid ||
            a.title !== b.title ||
            a.isActive !== b.isActive ||
            a.isMinimized !== b.isMinimized ||
            Boolean(a.iconDataUrl) !== Boolean(b.iconDataUrl)
          ) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return wins;
    });
  }, []);

  useEffect(() => {
    if (VIEW_MODE === 'island' || suspended) return;
    void refreshWindows();
    const id = setInterval(() => {
      void refreshWindows();
    }, VIEW_MODE === 'secondary-dock' ? 3200 : 1800);
    return () => clearInterval(id);
  }, [refreshWindows, suspended]);

  // Live Mic / Camera privacy polling (active inside whichever surface hosts NotchNook)
  const notchPlacement =
    config?.settings.notchPlacement ?? (config?.settings.notchNookEnabled === false ? 'off' : 'top');
  const nookInIsland = notchPlacement === 'top';
  const nookInTaskbar = notchPlacement === 'taskbar';
  const shouldPollPrivacy =
    !suspended &&
    ((VIEW_MODE === 'island' && nookInIsland) || (VIEW_MODE === 'dock' && nookInTaskbar));

  const dockShelf = useShelfItems(VIEW_MODE === 'dock' && notchPlacement !== 'off');

  useEffect(() => {
    if (VIEW_MODE !== 'dock') return;
    return dockBridge.onToggleNookPopover(() => {
      const next: ActivePanel = activePanelRef.current === 'nook' ? null : 'nook';
      setActivePanel(next);
      void dockBridge.setPopoverOpen(next !== null);
    });
  }, []);

  useEffect(() => {
    if (!shouldPollPrivacy) return;
    let alive = true;
    const pollPrivacy = async () => {
      const next = await dockBridge.getPrivacyStatus();
      if (!alive) return;
      setPrivacy((prev) => {
        if (
          prev.micActive === next.micActive &&
          prev.micMuted === next.micMuted &&
          prev.hasMic === next.hasMic &&
          prev.camActive === next.camActive &&
          prev.micApps.join('|') === next.micApps.join('|') &&
          prev.camApps.join('|') === next.camApps.join('|')
        ) {
          return prev;
        }
        return next;
      });
    };
    void pollPrivacy();
    const id = setInterval(() => void pollPrivacy(), 1500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [shouldPollPrivacy]);

  // Subscribe to hardware HUD events (Volume, Brightness, Battery, Keyboard) inside Top Island
  const islandHudEnabled = config?.settings.islandHudEnabled !== false;
  useEffect(() => {
    if (VIEW_MODE !== 'island' || suspended || !islandHudEnabled) {
      setHudEvent(null);
      return;
    }
    const unsub = dockBridge.onHudEvent((ev) => {
      setHudEvent(ev);
      if (hudTimerRef.current !== null) window.clearTimeout(hudTimerRef.current);
      hudTimerRef.current = window.setTimeout(() => {
        hudTimerRef.current = null;
        setHudEvent(null);
      }, 1700);
    });
    return () => {
      unsub();
      if (hudTimerRef.current !== null) {
        window.clearTimeout(hudTimerRef.current);
        hudTimerRef.current = null;
      }
    };
  }, [suspended, islandHudEnabled]);

  // Living Glass adaptive accent: extract from active album art where media is hosted, else sync via storage/wallpaper
  const hostsMedia =
    (VIEW_MODE === 'island' &&
      ((config?.settings.musicPosition ?? 'top') === 'top' || islandPeekVisible)) ||
    (VIEW_MODE === 'dock' && config?.settings.musicPosition === 'taskbar');
  const activeMediaArt = useMediaArtwork(hostsMedia && !suspended ? media : null);
  const adaptiveMode =
    config?.settings.adaptiveAccentMode ??
    (config?.settings.adaptiveAccent === false ? 'off' : 'media');
  useAdaptiveGlassTint(
    adaptiveMode,
    config?.settings.theme ?? 'obsidian',
    hostsMedia ? activeMediaArt : undefined,
    suspended
  );

  const handleToggleMicMute = useCallback(async () => {
    const next = await dockBridge.toggleMicMute();
    setPrivacy(next);
  }, []);

  if (VIEW_MODE === 'island') {
    return (
      <DynamicIsland
        lang={config?.settings.language ?? 'en'}
        media={suspended ? null : media}
        musicInIsland={(config?.settings.musicPosition ?? 'top') === 'top' || islandPeekVisible}
        notchNookEnabled={nookInIsland}
        privacy={privacy}
        hudEvent={suspended ? null : hudEvent}
        expanded={suspended ? false : islandExpanded}
        autoHideIdle={Boolean(config?.settings.autoHideIdleIsland) && !islandPeekVisible}
        onToggleExpand={(open) => {
          setIslandExpanded(open);
          void dockBridge.setIslandExpanded(open);
        }}
        onRefreshMedia={() => void refreshMedia()}
        onToggleMicMute={() => void handleToggleMicMute()}
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

      <div className={`popover-body ${activePanel === 'settings' ? 'is-settings' : ''}`}>
        {activePanel === 'apps' && (
          <AppLauncherPopover
            lang={settings.language}
            pinnedApps={config.pinnedApps}
            runningWindows={runningWindows}
            onSavePinnedApps={(pinnedApps) => patchConfig({ pinnedApps })}
            onRefreshWindows={() => void refreshWindows()}
            onClose={() => handleTogglePanel(null)}
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

        {activePanel === 'nook' && (
          <NotchNookPopover
            lang={settings.language}
            privacy={privacy}
            shelfItems={dockShelf.shelfItems}
            onToggleMicMute={() => void handleToggleMicMute()}
            onAddFiles={dockShelf.addFilesViaPicker}
            onRemoveItem={dockShelf.removeShelfItem}
            onClearAll={dockShelf.clearShelf}
            onIngestDrop={dockShelf.ingestDataTransfer}
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
        privacy={privacy}
        shelfCount={dockShelf.shelfItems.length}
        runningWindows={runningWindows}
        kbdLang={kbdLang}
        now={now}
        onTogglePanel={handleTogglePanel}
        onSavePinnedApps={(pinnedApps) => patchConfig({ pinnedApps })}
        onRefreshMedia={() => void refreshMedia()}
        onRefreshWindows={() => void refreshWindows()}
        onToggleMicMute={() => void handleToggleMicMute()}
        onDropToNook={async (dt) => {
          const added = await dockShelf.ingestDataTransfer(dt);
          if (added > 0) {
            if (nookInTaskbar) {
              handleTogglePanel('nook');
            } else if (nookInIsland) {
              dockBridge.openIslandTray();
            }
          }
        }}
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
