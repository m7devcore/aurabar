import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward, Volume2, VolumeX, X } from 'lucide-react';
import { dockBridge } from '../hooks/useDockBridge';
import type { LiveThumbSlot } from '../../electron/preload';
import type { AudioAppSession, DockPosition, Language, MediaInfo, RunningWindow } from '../types';
import { AppIconGlyph } from './IconMapper';

interface Props {
  windows: RunningWindow[];
  appName: string;
  appIconUrl?: string;
  media: MediaInfo | null;
  x: number;
  position: DockPosition;
  lang: Language;
  onActivate: (win: RunningWindow) => void;
  onCloseWindow: (win: RunningWindow) => void;
  onRefreshMedia: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const CARD_WIDTH = 192;
const CARD_GAP = 6;
const PADDING = 6;
// 1px border on each side; leaving it out made the content overflow and show a scrollbar
const BORDER = 1;

function mediaMatchesWindow(media: MediaInfo | null, win: RunningWindow): boolean {
  if (!media || media.status === 'Closed' || !media.appId) return false;
  const appId = media.appId.toLowerCase();
  const proc = (win.processName || '').toLowerCase();
  const winAppId = (win.appId || win.aumid || '').toLowerCase();
  if (winAppId && (winAppId === appId || appId.includes(winAppId) || winAppId.includes(appId))) {
    return true;
  }
  const procClean = proc.replace(/\.exe$/i, '');
  const appBase = appId.replace(/\.exe$/i, '').split(/[\\!]/).pop() ?? appId;
  if (procClean.length >= 3 && (appId.includes(procClean) || appBase.includes(procClean))) {
    return true;
  }
  return false;
}

// Windows-11-style hover preview: true 60fps GPU-composited DWM live thumbnails inside each
// card, live full-screen Aero Peek when hovering a card, media controls for players (Spotify,
// browsers, etc.), and per-app mute toggle for active audio apps (Discord, games, etc.).
export const WindowPeek = forwardRef<HTMLDivElement, Props>(function WindowPeek(
  {
    windows,
    appName,
    appIconUrl,
    media: propMedia,
    x,
    position,
    lang,
    onActivate,
    onCloseWindow,
    onRefreshMedia,
    onMouseEnter,
    onMouseLeave
  },
  ref
) {
  const [fallbackThumbs, setFallbackThumbs] = useState<Record<string, string>>({});
  const [localMedia, setLocalMedia] = useState<MediaInfo | null>(propMedia);
  const [audioSessions, setAudioSessions] = useState<AudioAppSession[]>([]);
  const [peekingHwnd, setPeekingHwnd] = useState<string | null>(null);
  const peekTimerRef = useRef<number | null>(null);
  const peekingRef = useRef<string | null>(null);
  const thumbBoxRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const containerRef = useRef<HTMLDivElement | null>(null);

  const activeMedia = localMedia ?? propMedia;

  useEffect(() => {
    if (propMedia) setLocalMedia(propMedia);
  }, [propMedia]);

  const hwndKey = windows
    .map((w) => `${w.hwnd ?? ''}:${w.isMinimized ? 1 : 0}`)
    .join('|');

  const hasAnyMediaBar = windows.some((w) => mediaMatchesWindow(activeMedia, w));

  const windowsRef = useRef(windows);
  windowsRef.current = windows;

  // Send CSS DIP rects relative to the dock window; main.ts converts them via
  // screen.dipToScreenRect so multi-monitor mixed-DPI setups align to the exact physical pixel.
  const syncLiveThumbSlots = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const slots: LiveThumbSlot[] = [];

    for (const w of windowsRef.current) {
      if (!w.hwnd) continue;
      const box = thumbBoxRefs.current.get(w.hwnd);
      if (!box) continue;
      const r = box.getBoundingClientRect();
      // Skip cards scrolled outside the horizontal container viewport
      if (r.width < 16 || r.height < 16) continue;
      if (r.right < containerRect.left + 4 || r.left > containerRect.right - 4) continue;
      const visLeft = Math.max(r.left, containerRect.left + 4);
      const visRight = Math.min(r.right, containerRect.right - 4);
      const visW = visRight - visLeft;
      if (visW < 16) continue;
      slots.push({
        hwnd: w.hwnd,
        left: visLeft,
        top: r.top,
        width: visW,
        height: r.height,
        radius: 7
      });
    }

    if (slots.length > 0) {
      dockBridge.setLiveThumbs(slots);
    } else {
      dockBridge.clearLiveThumbs();
    }
  }, []);

  useLayoutEffect(() => {
    syncLiveThumbSlots();
    // Re-sync once layout settles (e.g. if media bar appeared asynchronously)
    const t1 = window.setTimeout(syncLiveThumbSlots, 60);
    window.addEventListener('resize', syncLiveThumbSlots);
    return () => {
      window.clearTimeout(t1);
      window.removeEventListener('resize', syncLiveThumbSlots);
    };
  }, [syncLiveThumbSlots, hwndKey, x, position, hasAnyMediaBar]);

  // Fetch media controls, audio sessions, and fallback snapshots (only for minimized windows
  // in case DWM has no cached surface yet)
  useEffect(() => {
    let alive = true;
    const loadControls = async () => {
      const [m, sessions] = await Promise.all([
        propMedia ? Promise.resolve(propMedia) : dockBridge.getMediaInfo(),
        dockBridge.getAudioSessions()
      ]);
      if (!alive) return;
      if (m) setLocalMedia(m);
      setAudioSessions(sessions);
    };
    const loadMinimizedFallbacks = async () => {
      for (const w of windows) {
        if (!w.hwnd || !w.isMinimized) continue;
        const url = await dockBridge.getWindowThumb(w.hwnd);
        if (!alive) return;
        if (url) {
          setFallbackThumbs((prev) => (prev[w.hwnd!] === url ? prev : { ...prev, [w.hwnd!]: url }));
        }
      }
    };
    void loadControls();
    void loadMinimizedFallbacks();
    return () => {
      alive = false;
    };
  }, [hwndKey]);

  const stopLivePeekNow = () => {
    if (peekTimerRef.current) {
      window.clearTimeout(peekTimerRef.current);
      peekTimerRef.current = null;
    }
    if (peekingRef.current !== null) {
      peekingRef.current = null;
      setPeekingHwnd(null);
      dockBridge.stopWindowPeek();
    }
  };

  // Guarantee both DWM overlays (full-screen peek + live card thumbs) always clear on unmount
  useEffect(() => {
    return () => {
      if (peekTimerRef.current) window.clearTimeout(peekTimerRef.current);
      if (peekingRef.current !== null) {
        peekingRef.current = null;
        dockBridge.stopWindowPeek();
      }
      dockBridge.clearLiveThumbs();
    };
  }, []);

  const scheduleCardPeek = (hwnd?: string) => {
    if (!hwnd) return;
    if (peekingRef.current === hwnd) return;
    if (peekTimerRef.current) {
      window.clearTimeout(peekTimerRef.current);
      peekTimerRef.current = null;
    }
    // Switching from one card to another while already peeking is instant (like Windows 11)
    const delay = peekingRef.current !== null ? 30 : 220;
    peekTimerRef.current = window.setTimeout(() => {
      peekTimerRef.current = null;
      peekingRef.current = hwnd;
      setPeekingHwnd(hwnd);
      dockBridge.startWindowPeek(hwnd);
    }, delay);
  };

  const handleMediaCmd = (e: React.MouseEvent, cmd: 'previous' | 'playPause' | 'next') => {
    e.stopPropagation();
    void dockBridge.sendMediaCommand(cmd).then(() => {
      setTimeout(() => {
        onRefreshMedia();
        void dockBridge.getMediaInfo().then((m) => {
          if (m) setLocalMedia(m);
        });
      }, 220);
    });
  };

  const handleToggleAppMute = (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    setAudioSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, muted: !s.muted } : s))
    );
    void dockBridge.toggleAudioSessionMute(sessionId);
  };

  const maxCards = Math.max(
    1,
    Math.floor((window.innerWidth - 24 - BORDER * 2 - PADDING * 2 + CARD_GAP) / (CARD_WIDTH + CARD_GAP))
  );
  const visibleCount = Math.min(windows.length, maxCards);
  const width = BORDER * 2 + PADDING * 2 + visibleCount * CARD_WIDTH + (visibleCount - 1) * CARD_GAP;
  const left = Math.round(Math.max(12, Math.min(window.innerWidth - width - 12, x - width / 2)));

  const appIcon = (size: number) =>
    appIconUrl ? (
      <img className="app-icon-img" src={appIconUrl} alt="" draggable={false} style={{ width: size, height: size }} />
    ) : (
      <AppIconGlyph name="app" color="var(--text-muted)" size={size} />
    );

  const assignRootRef = (node: HTMLDivElement | null) => {
    containerRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  return (
    <div
      ref={assignRootRef}
      className="window-peek"
      style={{ left, width, ...(position === 'bottom' ? { bottom: 65 } : { top: 65 }) }}
      onScroll={syncLiveThumbSlots}
      onMouseEnter={onMouseEnter}
      onMouseLeave={() => {
        stopLivePeekNow();
        onMouseLeave();
      }}
      onClick={(e) => e.stopPropagation()}
      role="menu"
      aria-label={appName}
    >
      {windows.map((win) => {
        const fallback = win.hwnd ? fallbackThumbs[win.hwnd] : undefined;
        const iconUrl = win.iconDataUrl ?? appIconUrl;
        const isPeeking = Boolean(win.hwnd && peekingHwnd === win.hwnd);
        const showMediaControls = mediaMatchesWindow(activeMedia, win);
        const procKey = (win.processName || '').toLowerCase();
        const audioSession = audioSessions.find((s) => !s.isSystem && s.id.toLowerCase() === procKey);

        return (
          <div
            key={win.hwnd ?? win.pid}
            className={`peek-card ${win.isActive ? 'active' : ''} ${isPeeking ? 'is-peeking' : ''}`}
            role="menuitem"
            tabIndex={0}
            onMouseEnter={() => scheduleCardPeek(win.hwnd)}
            onClick={() => {
              stopLivePeekNow();
              dockBridge.clearLiveThumbs();
              onActivate(win);
            }}
            onMouseDown={(e) => {
              if (e.button === 1 && win.hwnd) {
                e.preventDefault();
                e.stopPropagation();
                stopLivePeekNow();
                dockBridge.clearLiveThumbs();
                onCloseWindow(win);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                stopLivePeekNow();
                dockBridge.clearLiveThumbs();
                onActivate(win);
              }
            }}
          >
            <div className="peek-card-header">
              {iconUrl ? (
                <img className="peek-card-icon" src={iconUrl} alt="" draggable={false} />
              ) : (
                <AppIconGlyph name="app" color="var(--text-muted)" size={14} />
              )}
              <span className="peek-card-title" dir="auto">
                {win.title || appName}
              </span>
              {audioSession && (
                <button
                  type="button"
                  className={`peek-card-mute ${audioSession.muted ? 'is-muted' : ''}`}
                  aria-label={audioSession.muted ? 'Unmute app' : 'Mute app'}
                  title={
                    audioSession.muted
                      ? lang === 'ar'
                        ? 'إلغاء كتم التطبيق'
                        : 'Unmute app'
                      : lang === 'ar'
                        ? 'كتم التطبيق'
                        : 'Mute app'
                  }
                  onClick={(e) => handleToggleAppMute(e, audioSession.id)}
                >
                  {audioSession.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
                </button>
              )}
              {win.hwnd && (
                <button
                  type="button"
                  className="peek-card-close"
                  aria-label={lang === 'ar' ? 'إغلاق النافذة' : 'Close window'}
                  title={lang === 'ar' ? 'إغلاق النافذة' : 'Close window'}
                  onClick={(e) => {
                    e.stopPropagation();
                    stopLivePeekNow();
                    dockBridge.clearLiveThumbs();
                    onCloseWindow(win);
                  }}
                >
                  <X size={10} strokeWidth={2.5} />
                </button>
              )}
            </div>

            <div
              className="peek-card-thumb"
              ref={(el) => {
                if (!win.hwnd) return;
                if (el) thumbBoxRefs.current.set(win.hwnd, el);
                else thumbBoxRefs.current.delete(win.hwnd);
              }}
            >
              {fallback ? (
                <img src={fallback} alt="" draggable={false} />
              ) : (
                <div className="peek-card-placeholder">
                  {appIcon(24)}
                  {win.isMinimized && (
                    <span>{lang === 'ar' ? 'مصغّرة' : 'Minimized'}</span>
                  )}
                </div>
              )}
            </div>

            {showMediaControls && (
              <div className="peek-media-bar" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="peek-media-btn"
                  title={lang === 'ar' ? 'السابق' : 'Previous'}
                  onClick={(e) => handleMediaCmd(e, 'previous')}
                >
                  <SkipBack size={12} />
                </button>
                <button
                  type="button"
                  className="peek-media-btn play"
                  title={
                    activeMedia?.status === 'Playing'
                      ? lang === 'ar'
                        ? 'إيقاف مؤقت'
                        : 'Pause'
                      : lang === 'ar'
                        ? 'تشغيل'
                        : 'Play'
                  }
                  onClick={(e) => handleMediaCmd(e, 'playPause')}
                >
                  {activeMedia?.status === 'Playing' ? <Pause size={12} /> : <Play size={12} />}
                </button>
                <button
                  type="button"
                  className="peek-media-btn"
                  title={lang === 'ar' ? 'التالي' : 'Next'}
                  onClick={(e) => handleMediaCmd(e, 'next')}
                >
                  <SkipForward size={12} />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});
