import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Bluetooth,
  Check,
  ChevronRight,
  Gauge,
  Lock,
  Moon,
  RefreshCw,
  SlidersHorizontal,
  Speaker,
  Sun,
  Volume1,
  Volume2,
  VolumeX,
  Wifi
} from 'lucide-react';
import { dockBridge } from '../hooks/useDockBridge';
import type {
  ActivePanel,
  AudioAppSession,
  AudioOutputDevice,
  BrightnessInfo,
  DockPosition,
  Language,
  NetworkInfo,
  NightLightInfo,
  SystemStats,
  VolumeInfo,
  WifiNetwork
} from '../types';
import { BatteryIcon, GlobeLangIcon, SettingsIcon, WifiIcon } from './PremiumIcons';

export type ControlCenterView = 'main' | 'audio' | 'wifi';

interface QuickSliderProps {
  value: number;
  muted?: boolean;
  ariaLabel: string;
  onChange: (next: number, commit: boolean) => void;
}

function QuickSlider({ value, muted = false, ariaLabel, onChange }: QuickSliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const valueFromClientX = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return value;
    const rect = el.getBoundingClientRect();
    const ratio = (clientX - rect.left) / Math.max(1, rect.width);
    return Math.max(0, Math.min(100, Math.round(ratio * 100)));
  };

  const display = muted ? 0 : Math.max(0, Math.min(100, Math.round(value)));

  return (
    <div
      ref={trackRef}
      dir="ltr"
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={display}
      aria-valuetext={`${display}%`}
      className={`vol-track-hit ${dragging ? 'is-dragging' : ''} ${muted ? 'is-muted' : ''}`}
      onWheel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY < 0 ? 4 : -4;
        onChange(Math.max(0, Math.min(100, display + delta)), true);
      }}
      onKeyDown={(e) => {
        const step = e.key === 'PageUp' ? 10 : e.key === 'PageDown' ? 10 : 2;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp') {
          e.preventDefault();
          onChange(Math.min(100, display + step), true);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown') {
          e.preventDefault();
          onChange(Math.max(0, display - step), true);
        } else if (e.key === 'Home') {
          e.preventDefault();
          onChange(0, true);
        } else if (e.key === 'End') {
          e.preventDefault();
          onChange(100, true);
        }
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        draggingRef.current = true;
        setDragging(true);
        dockBridge.setDockInteractive(true);
        onChange(valueFromClientX(e.clientX), true);
      }}
      onPointerMove={(e) => {
        if (!draggingRef.current) return;
        e.stopPropagation();
        onChange(valueFromClientX(e.clientX), false);
      }}
      onPointerUp={(e) => {
        if (!draggingRef.current) return;
        e.stopPropagation();
        draggingRef.current = false;
        setDragging(false);
        dockBridge.setDockInteractive(false);
        onChange(valueFromClientX(e.clientX), true);
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      }}
      onPointerCancel={() => {
        draggingRef.current = false;
        setDragging(false);
        dockBridge.setDockInteractive(false);
      }}
    >
      <div className="vol-track-bg">
        <div className="vol-track-fill" style={{ width: `${display}%` }} />
        <div className="vol-thumb" style={{ left: `${display}%` }} />
      </div>
    </div>
  );
}

interface Props {
  x: number;
  position: DockPosition;
  lang: Language;
  view: ControlCenterView;
  onChangeView: (view: ControlCenterView) => void;
  netInfo: NetworkInfo;
  trayVol: VolumeInfo;
  onVolumeChange: (v: VolumeInfo) => void;
  stats: SystemStats;
  kbdLang: string;
  onSwitchKbdLang: () => void;
  onOpenPanel: (panel: ActivePanel) => void;
  onClose: () => void;
}

export const ControlCenterFlyout = forwardRef<HTMLDivElement, Props>(function ControlCenterFlyout(
  {
    x,
    position,
    lang,
    view,
    onChangeView,
    netInfo,
    trayVol,
    onVolumeChange,
    stats,
    kbdLang,
    onSwitchKbdLang,
    onOpenPanel,
    onClose
  },
  ref
) {
  const isAr = lang === 'ar';

  const [brightness, setBrightness] = useState<BrightnessInfo>({ supported: false, level: 100 });
  const [nightLight, setNightLight] = useState<NightLightInfo>({ supported: false, enabled: false });
  const [devices, setDevices] = useState<AudioOutputDevice[]>([]);
  const [sessions, setSessions] = useState<AudioAppSession[]>([]);
  const [audioLoaded, setAudioLoaded] = useState(false);
  const [wifiList, setWifiList] = useState<WifiNetwork[]>([]);
  const [wifiLoading, setWifiLoading] = useState(false);
  const [connectingSsid, setConnectingSsid] = useState<string | null>(null);

  const volSendAtRef = useRef(0);
  const volTimerRef = useRef<number | null>(null);
  const brightSendAtRef = useRef(0);
  const brightTimerRef = useRef<number | null>(null);
  const sessionSendAtRef = useRef<Record<string, number>>({});
  const sessionTimerRef = useRef<Record<string, number>>({});

  // Load brightness & night light immediately when Control Center opens
  useEffect(() => {
    let alive = true;
    void Promise.all([dockBridge.getBrightness(), dockBridge.getNightLight()]).then(([b, nl]) => {
      if (!alive) return;
      setBrightness(b);
      setNightLight(nl);
    });
    return () => {
      alive = false;
      if (volTimerRef.current) window.clearTimeout(volTimerRef.current);
      if (brightTimerRef.current) window.clearTimeout(brightTimerRef.current);
      for (const id of Object.values(sessionTimerRef.current)) window.clearTimeout(id);
    };
  }, []);

  const refreshAudio = useCallback(async () => {
    const [devs, sess] = await Promise.all([
      dockBridge.getAudioDevices(),
      dockBridge.getAudioSessions()
    ]);
    setDevices(devs);
    setSessions(sess);
    setAudioLoaded(true);
  }, []);

  // Poll audio devices + per-app mixer sessions while on the Audio sub-view
  useEffect(() => {
    if (view !== 'audio') return;
    let alive = true;
    const load = async () => {
      const [devs, sess] = await Promise.all([
        dockBridge.getAudioDevices(),
        dockBridge.getAudioSessions()
      ]);
      if (!alive) return;
      setDevices(devs);
      setSessions(sess);
      setAudioLoaded(true);
    };
    void load();
    const id = window.setInterval(() => void load(), 1800);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [view]);

  const refreshWifi = useCallback(async () => {
    setWifiLoading(true);
    const list = await dockBridge.listWifiNetworks();
    setWifiList(list);
    setWifiLoading(false);
  }, []);

  useEffect(() => {
    if (view !== 'wifi') return;
    void refreshWifi();
  }, [view, refreshWifi]);

  const handleMasterVol = (nextLevel: number, commit: boolean) => {
    const clamped = Math.max(0, Math.min(100, Math.round(nextLevel)));
    onVolumeChange({ level: clamped, muted: clamped === 0 });
    const now = performance.now();
    if (commit || now - volSendAtRef.current >= 32) {
      volSendAtRef.current = now;
      if (volTimerRef.current) {
        window.clearTimeout(volTimerRef.current);
        volTimerRef.current = null;
      }
      void dockBridge.setVolume(clamped);
    } else {
      if (volTimerRef.current) window.clearTimeout(volTimerRef.current);
      volTimerRef.current = window.setTimeout(() => {
        volTimerRef.current = null;
        volSendAtRef.current = performance.now();
        void dockBridge.setVolume(clamped);
      }, 32);
    }
  };

  const handleBrightness = (nextLevel: number, commit: boolean) => {
    const clamped = Math.max(0, Math.min(100, Math.round(nextLevel)));
    setBrightness((prev) => ({ ...prev, level: clamped }));
    const now = performance.now();
    if (commit || now - brightSendAtRef.current >= 36) {
      brightSendAtRef.current = now;
      if (brightTimerRef.current) {
        window.clearTimeout(brightTimerRef.current);
        brightTimerRef.current = null;
      }
      void dockBridge.setBrightness(clamped);
    } else {
      if (brightTimerRef.current) window.clearTimeout(brightTimerRef.current);
      brightTimerRef.current = window.setTimeout(() => {
        brightTimerRef.current = null;
        brightSendAtRef.current = performance.now();
        void dockBridge.setBrightness(clamped);
      }, 36);
    }
  };

  const handleSessionVol = (sessionId: string, nextLevel: number, commit: boolean) => {
    const clamped = Math.max(0, Math.min(100, Math.round(nextLevel)));
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId ? { ...s, volume: clamped, muted: clamped === 0 } : s
      )
    );
    const now = performance.now();
    const last = sessionSendAtRef.current[sessionId] ?? 0;
    if (commit || now - last >= 32) {
      sessionSendAtRef.current[sessionId] = now;
      if (sessionTimerRef.current[sessionId]) {
        window.clearTimeout(sessionTimerRef.current[sessionId]);
        delete sessionTimerRef.current[sessionId];
      }
      void dockBridge.setAudioSessionVolume(sessionId, clamped);
    } else {
      if (sessionTimerRef.current[sessionId]) {
        window.clearTimeout(sessionTimerRef.current[sessionId]);
      }
      sessionTimerRef.current[sessionId] = window.setTimeout(() => {
        delete sessionTimerRef.current[sessionId];
        sessionSendAtRef.current[sessionId] = performance.now();
        void dockBridge.setAudioSessionVolume(sessionId, clamped);
      }, 32);
    }
  };

  const handleSessionMute = (sessionId: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, muted: !s.muted } : s))
    );
    void dockBridge.toggleAudioSessionMute(sessionId);
  };

  const handleSelectDevice = async (deviceId: string) => {
    setDevices((prev) => prev.map((d) => ({ ...d, isDefault: d.id === deviceId })));
    const nextDevs = await dockBridge.setDefaultAudioDevice(deviceId);
    if (nextDevs.length > 0) setDevices(nextDevs);
    setTimeout(() => void refreshAudio(), 160);
  };

  const handleConnectWifi = async (ssid: string) => {
    setConnectingSsid(ssid);
    await dockBridge.connectWifiNetwork(ssid);
    setTimeout(async () => {
      await refreshWifi();
      setConnectingSsid(null);
    }, 900);
  };

  const VolIcon =
    trayVol.muted || trayVol.level === 0 ? VolumeX : trayVol.level < 50 ? Volume1 : Volume2;
  const effectiveVol = trayVol.muted ? 0 : trayVol.level;

  return (
    <div
      ref={ref}
      className="control-center-flyout"
      style={{
        left: Math.round(Math.max(12, Math.min(window.innerWidth - 352, x - 170))),
        ...(position === 'bottom' ? { bottom: 65 } : { top: 65 })
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {view === 'main' && (
        <>
          {/* 3x2 Quick Toggles Grid */}
          <div className="cc-quick-grid">
            {/* Wi-Fi / Network Split Tile */}
            <div className={`cc-toggle-tile cc-split-tile ${netInfo.connected ? 'active' : ''}`}>
              <button
                type="button"
                className="cc-split-main"
                onClick={() => onChangeView('wifi')}
                title={isAr ? 'الشبكة والإنترنت' : 'Wi-Fi & Network'}
              >
                <span className="cc-toggle-icon">
                  <WifiIcon
                    connected={netInfo.connected}
                    signalPercent={netInfo.signalPercent}
                    kind={netInfo.kind}
                  />
                </span>
                <span className="cc-toggle-label">
                  {netInfo.kind === 'ethernet'
                    ? isAr
                      ? 'سلكي'
                      : 'Ethernet'
                    : netInfo.connected && netInfo.ssid
                      ? netInfo.ssid
                      : 'Wi-Fi'}
                </span>
              </button>
              <button
                type="button"
                className="cc-split-arrow"
                aria-label={isAr ? 'قائمة الشبكات' : 'Show networks'}
                onClick={() => onChangeView('wifi')}
              >
                <ChevronRight size={13} />
              </button>
            </div>

            {/* Bluetooth */}
            <button
              type="button"
              className="cc-toggle-tile"
              onClick={() => {
                onClose();
                void dockBridge.systemAction('bluetooth-settings');
              }}
              title={isAr ? 'البلوتوث والأجهزة' : 'Bluetooth & devices'}
            >
              <span className="cc-toggle-icon">
                <Bluetooth size={15} />
              </span>
              <span className="cc-toggle-label">{isAr ? 'بلوتوث' : 'Bluetooth'}</span>
            </button>

            {/* Night Light */}
            <button
              type="button"
              className={`cc-toggle-tile ${nightLight.enabled ? 'active warm' : ''}`}
              onClick={() => {
                if (nightLight.supported) {
                  setNightLight((prev) => ({ ...prev, enabled: !prev.enabled }));
                }
                void dockBridge.toggleNightLight().then(setNightLight);
              }}
              title={isAr ? 'الضوء الليلي' : 'Night light'}
            >
              <span className="cc-toggle-icon">
                <Moon size={15} />
              </span>
              <span className="cc-toggle-label">{isAr ? 'الضوء الليلي' : 'Night light'}</span>
            </button>

            {/* Keyboard Language */}
            <button
              type="button"
              className="cc-toggle-tile"
              onClick={onSwitchKbdLang}
              title={isAr ? 'تبديل لغة الكيبورد' : 'Switch keyboard language'}
            >
              <span className="cc-toggle-icon">
                <GlobeLangIcon />
              </span>
              <span className="cc-toggle-label">
                {kbdLang === 'AR' ? 'العربية' : kbdLang}
              </span>
            </button>

            {/* System / Power */}
            <button
              type="button"
              className="cc-toggle-tile"
              onClick={() => onOpenPanel('system')}
              title={isAr ? 'النظام والطاقة' : 'System & Power'}
            >
              <span className="cc-toggle-icon">
                <Activity size={15} />
              </span>
              <span className="cc-toggle-label tabular">
                {stats.batteryPercent !== null
                  ? isAr
                    ? `الطاقة ${stats.batteryPercent}%`
                    : `Power ${stats.batteryPercent}%`
                  : `CPU ${stats.cpuPercent}%`}
              </span>
            </button>

            {/* Lock PC */}
            <button
              type="button"
              className="cc-toggle-tile"
              onClick={() => {
                onClose();
                void dockBridge.systemAction('lock');
              }}
              title={isAr ? 'قفل الجهاز' : 'Lock PC'}
            >
              <span className="cc-toggle-icon">
                <Lock size={15} />
              </span>
              <span className="cc-toggle-label">{isAr ? 'قفل الشاشة' : 'Lock'}</span>
            </button>
          </div>

          {/* Sliders Card: Brightness + Volume (with Mixer drill-in) */}
          <div className="cc-sliders-card">
            {brightness.supported && (
              <div className="cc-slider-line">
                <span className="cc-slider-icon" aria-hidden="true">
                  <Sun size={15} />
                </span>
                <QuickSlider
                  value={brightness.level}
                  ariaLabel={isAr ? 'سطوع الشاشة' : 'Screen Brightness'}
                  onChange={handleBrightness}
                />
                <span className="vol-pct tabular">{brightness.level}%</span>
              </div>
            )}

            <div className="cc-slider-line">
              <button
                type="button"
                className={`vol-mute-btn ${trayVol.muted ? 'is-muted' : ''}`}
                aria-label={trayVol.muted ? 'Unmute' : 'Mute'}
                onClick={() => void dockBridge.toggleMute().then(onVolumeChange)}
                title={trayVol.muted ? (isAr ? 'إلغاء الكتم' : 'Unmute') : isAr ? 'كتم' : 'Mute'}
              >
                <VolIcon size={15} />
              </button>
              <QuickSlider
                value={trayVol.level}
                muted={trayVol.muted}
                ariaLabel={isAr ? 'مستوى الصوت' : 'Master Volume'}
                onChange={handleMasterVol}
              />
              <button
                type="button"
                className="cc-mixer-btn"
                onClick={() => onChangeView('audio')}
                title={isAr ? 'مخرج الصوت ومازج الصوت' : 'Sound output & Volume mixer'}
                aria-label={isAr ? 'مخرج الصوت ومازج الصوت' : 'Sound output & Volume mixer'}
              >
                <SlidersHorizontal size={13} />
                <ChevronRight size={12} />
              </button>
            </div>
          </div>

          {/* Footer Bar */}
          <div className="cc-footer-bar tabular">
            {stats.batteryPercent !== null ? (
              <button
                type="button"
                className="cc-footer-pill"
                onClick={() => {
                  onClose();
                  void dockBridge.systemAction('power-settings');
                }}
                title={isAr ? 'إعدادات الطاقة والبطارية' : 'Power & battery settings'}
              >
                <BatteryIcon percent={stats.batteryPercent} charging={stats.batteryCharging} />
                <span>
                  {stats.batteryPercent}%
                  {stats.batteryCharging ? (isAr ? ' · شحن' : ' · Charging') : ''}
                </span>
              </button>
            ) : (
              <span className="cc-footer-meta">
                CPU {stats.cpuPercent}% · RAM {stats.ramPercent}%
              </span>
            )}

            <div className="row-gap" style={{ gap: 4 }}>
              <button
                type="button"
                className="cc-footer-icon-btn"
                onClick={() => onOpenPanel('settings')}
                title={isAr ? 'إعدادات AuraBar' : 'AuraBar Settings'}
              >
                <SettingsIcon />
              </button>
            </div>
          </div>
        </>
      )}

      {view === 'audio' && (
        <div className="cc-subview">
          <div className="cc-subview-header">
            <button
              type="button"
              className="cc-back-btn"
              onClick={() => onChangeView('main')}
              aria-label={isAr ? 'رجوع' : 'Back'}
            >
              <ArrowLeft size={15} />
            </button>
            <span className="cc-subview-title">
              {isAr ? 'الصوت ومازج الصوت' : 'Sound & Volume mixer'}
            </span>
            <button
              type="button"
              className="cc-footer-icon-btn"
              onClick={() => {
                onClose();
                void dockBridge.systemAction('sound-settings');
              }}
              title={isAr ? 'إعدادات الصوت' : 'Sound settings'}
            >
              <SettingsIcon />
            </button>
          </div>

          <div className="cc-subview-scroll">
            {/* Output Devices */}
            <div className="cc-section-label">
              {isAr ? 'مخرج الصوت' : 'Sound output'}
            </div>
            <div className="cc-device-list">
              {devices.length === 0 && audioLoaded ? (
                <div className="cc-empty-hint">
                  {isAr ? 'لم يتم العثور على أجهزة صوت' : 'No playback devices found'}
                </div>
              ) : (
                devices.map((dev) => (
                  <button
                    key={dev.id}
                    type="button"
                    className={`cc-device-row ${dev.isDefault ? 'active' : ''}`}
                    onClick={() => void handleSelectDevice(dev.id)}
                  >
                    <Speaker size={14} className="cc-device-ico" />
                    <span className="cc-device-name">{dev.name}</span>
                    {dev.isDefault && <Check size={14} className="cc-device-check" />}
                  </button>
                ))
              )}
            </div>

            <div className="cc-subview-divider" />

            {/* Per-App Volume Mixer */}
            <div className="cc-section-label">
              {isAr ? 'مازج الصوت' : 'Volume mixer'}
            </div>

            {/* Master Row inside Mixer */}
            <div className="cc-mixer-list">
              <div className="cc-mixer-row">
                <div className="cc-mixer-row-head">
                  <div className="cc-mixer-app">
                    <span className="cc-mixer-icon-fallback">
                      <Speaker size={13} />
                    </span>
                    <span className="cc-mixer-name">
                      {isAr ? 'الصوت الرئيسي' : 'Master'}
                    </span>
                  </div>
                  <span className="cc-mixer-pct tabular">{effectiveVol}%</span>
                </div>
                <div className="cc-mixer-controls">
                  <button
                    type="button"
                    className={`vol-mute-btn compact ${trayVol.muted ? 'is-muted' : ''}`}
                    onClick={() => void dockBridge.toggleMute().then(onVolumeChange)}
                  >
                    <VolIcon size={13} />
                  </button>
                  <QuickSlider
                    value={trayVol.level}
                    muted={trayVol.muted}
                    ariaLabel="Master"
                    onChange={handleMasterVol}
                  />
                </div>
              </div>

              {sessions.map((s) => {
                const eff = s.muted ? 0 : s.volume;
                const SIcon = s.muted || s.volume === 0 ? VolumeX : s.volume < 50 ? Volume1 : Volume2;
                return (
                  <div key={s.id} className="cc-mixer-row">
                    <div className="cc-mixer-row-head">
                      <div className="cc-mixer-app">
                        {s.iconDataUrl ? (
                          <img
                            className="cc-mixer-icon"
                            src={s.iconDataUrl}
                            alt={s.name}
                            draggable={false}
                          />
                        ) : (
                          <span className="cc-mixer-icon-fallback">
                            <Volume2 size={13} />
                          </span>
                        )}
                        <span className="cc-mixer-name">
                          {s.isSystem && isAr ? 'أصوات النظام' : s.name}
                        </span>
                        {s.active && <span className="cc-live-dot" aria-hidden="true" />}
                      </div>
                      <span className="cc-mixer-pct tabular">{eff}%</span>
                    </div>
                    <div className="cc-mixer-controls">
                      <button
                        type="button"
                        className={`vol-mute-btn compact ${s.muted ? 'is-muted' : ''}`}
                        onClick={() => handleSessionMute(s.id)}
                      >
                        <SIcon size={13} />
                      </button>
                      <QuickSlider
                        value={s.volume}
                        muted={s.muted}
                        ariaLabel={s.name}
                        onChange={(v, commit) => handleSessionVol(s.id, v, commit)}
                      />
                    </div>
                  </div>
                );
              })}

              {audioLoaded && sessions.length === 0 && (
                <div className="cc-empty-hint">
                  {isAr ? 'لا توجد تطبيقات تشغّل صوت حالياً' : 'No active app audio streams'}
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            className="cc-subview-footer-link"
            onClick={() => {
              onClose();
              void dockBridge.systemAction('volume-mixer');
            }}
          >
            <span>{isAr ? 'المزيد من إعدادات الصوت' : 'More volume settings'}</span>
            <ChevronRight size={13} />
          </button>
        </div>
      )}

      {view === 'wifi' && (
        <div className="cc-subview">
          <div className="cc-subview-header">
            <button
              type="button"
              className="cc-back-btn"
              onClick={() => onChangeView('main')}
              aria-label={isAr ? 'رجوع' : 'Back'}
            >
              <ArrowLeft size={15} />
            </button>
            <span className="cc-subview-title">
              {isAr ? 'الشبكة والإنترنت' : 'Wi-Fi & Network'}
            </span>
            <button
              type="button"
              className={`cc-footer-icon-btn ${wifiLoading ? 'spinning' : ''}`}
              onClick={() => void refreshWifi()}
              title={isAr ? 'تحديث' : 'Refresh'}
            >
              <RefreshCw size={13} />
            </button>
          </div>

          <div className="cc-subview-scroll">
            {netInfo.kind === 'ethernet' && netInfo.connected && (
              <div className="cc-net-banner">
                <WifiIcon connected kind="ethernet" />
                <div>
                  <div className="cc-device-name">
                    {isAr ? 'اتصال سلكي (Ethernet)' : 'Ethernet'}
                  </div>
                  <div className="cc-sub">{isAr ? 'متصل بالإنترنت' : 'Connected'}</div>
                </div>
              </div>
            )}

            <div className="cc-device-list">
              {wifiLoading && wifiList.length === 0 ? (
                <div className="cc-empty-hint">
                  {isAr ? 'جارٍ البحث عن الشبكات…' : 'Scanning Wi-Fi networks…'}
                </div>
              ) : wifiList.length === 0 ? (
                <div className="cc-empty-hint">
                  {netInfo.kind === 'ethernet'
                    ? isAr
                      ? 'لا يوجد محول Wi-Fi نشط'
                      : 'No active Wi-Fi networks detected'
                    : isAr
                      ? 'لم يتم العثور على شبكات Wi-Fi'
                      : 'No Wi-Fi networks found'}
                </div>
              ) : (
                wifiList.map((net) => {
                  const isBusy = connectingSsid === net.ssid;
                  return (
                    <button
                      key={net.ssid}
                      type="button"
                      className={`cc-device-row ${net.connected ? 'active' : ''}`}
                      onClick={() => {
                        if (!net.connected && !isBusy) void handleConnectWifi(net.ssid);
                      }}
                    >
                      <Wifi size={14} className="cc-device-ico" />
                      <div className="cc-wifi-meta">
                        <span className="cc-device-name">{net.ssid}</span>
                        <span className="cc-sub tabular">
                          {isBusy
                            ? isAr
                              ? 'جارٍ الاتصال…'
                              : 'Connecting…'
                            : net.connected
                              ? isAr
                                ? `متصل · ${net.signalPercent}%`
                                : `Connected · ${net.signalPercent}%`
                              : `${net.signalPercent}%${net.secured ? (isAr ? ' · محمية' : ' · Secured') : ''}`}
                        </span>
                      </div>
                      {net.connected && <Check size={14} className="cc-device-check" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="cc-subview-footer-row">
            <button
              type="button"
              className="cc-subview-footer-link"
              style={{ flex: 1 }}
              onClick={() => {
                onClose();
                void dockBridge.systemAction('network-settings');
              }}
            >
              <span>{isAr ? 'إعدادات الشبكة' : 'Network settings'}</span>
              <ChevronRight size={13} />
            </button>
            <button
              type="button"
              className="cc-footer-icon-btn"
              onClick={() => {
                onClose();
                void dockBridge.systemAction('network-speedtest');
              }}
              title={isAr ? 'اختبار سرعة الإنترنت' : 'Perform speed test'}
            >
              <Gauge size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
