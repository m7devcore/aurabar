import { forwardRef, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { dockBridge } from '../hooks/useDockBridge';
import type { DockPosition, Language, RunningWindow } from '../types';
import { AppIconGlyph } from './IconMapper';

interface Props {
  windows: RunningWindow[];
  appName: string;
  appIconUrl?: string;
  x: number;
  position: DockPosition;
  lang: Language;
  onActivate: (win: RunningWindow) => void;
  onCloseWindow: (win: RunningWindow) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

const CARD_WIDTH = 148;
const CARD_GAP = 4;
const PADDING = 6;
// 1px border on each side; leaving it out made the content overflow and show a scrollbar
const BORDER = 1;

// Windows-taskbar-style hover preview: one card per open window of an app, with a live
// thumbnail (refreshed while open), its title, and a close button
export const WindowPeek = forwardRef<HTMLDivElement, Props>(function WindowPeek(
  { windows, appName, appIconUrl, x, position, lang, onActivate, onCloseWindow, onMouseEnter, onMouseLeave },
  ref
) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const hwndKey = windows
    .map((w) => `${w.hwnd ?? ''}:${w.isMinimized ? 1 : 0}`)
    .join('|');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      for (const w of windows) {
        if (!w.hwnd) continue;
        const url = await dockBridge.getWindowThumb(w.hwnd);
        if (!alive) return;
        if (url) setThumbs((prev) => (prev[w.hwnd!] === url ? prev : { ...prev, [w.hwnd!]: url }));
      }
    };
    void load();
    const id = setInterval(() => void load(), 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // windows is captured through hwndKey; refetch only when the set of windows changes
  }, [hwndKey]);

  const maxCards = Math.max(1, Math.floor((window.innerWidth - 24 - BORDER * 2 - PADDING * 2 + CARD_GAP) / (CARD_WIDTH + CARD_GAP)));
  const visibleCount = Math.min(windows.length, maxCards);
  const width = BORDER * 2 + PADDING * 2 + visibleCount * CARD_WIDTH + (visibleCount - 1) * CARD_GAP;
  const left = Math.round(Math.max(12, Math.min(window.innerWidth - width - 12, x - width / 2)));

  const appIcon = (size: number) =>
    appIconUrl ? (
      <img className="app-icon-img" src={appIconUrl} alt="" draggable={false} style={{ width: size, height: size }} />
    ) : (
      <AppIconGlyph name="app" color="var(--text-muted)" size={size} />
    );

  return (
    <div
      ref={ref}
      className="window-peek"
      style={{ left, width, ...(position === 'bottom' ? { bottom: 65 } : { top: 65 }) }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => e.stopPropagation()}
      role="menu"
      aria-label={appName}
    >
      {windows.map((win) => {
        // Minimized windows get the last frame captured before they were minimized
        const thumb = win.hwnd ? thumbs[win.hwnd] : undefined;
        const iconUrl = win.iconDataUrl ?? appIconUrl;
        return (
          <div
            key={win.hwnd ?? win.pid}
            className={`peek-card ${win.isActive ? 'active' : ''}`}
            role="menuitem"
            tabIndex={0}
            title={win.title}
            onClick={() => onActivate(win)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
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
              {win.hwnd && (
                <button
                  type="button"
                  className="peek-card-close"
                  aria-label={lang === 'ar' ? 'إغلاق النافذة' : 'Close window'}
                  title={lang === 'ar' ? 'إغلاق النافذة' : 'Close window'}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseWindow(win);
                  }}
                >
                  <X size={10} strokeWidth={2.5} />
                </button>
              )}
            </div>
            <div className="peek-card-thumb">
              {thumb ? (
                <img src={thumb} alt="" draggable={false} />
              ) : (
                <div className="peek-card-placeholder">
                  {appIcon(22)}
                  {win.isMinimized && (
                    <span>{lang === 'ar' ? 'مصغّرة' : 'Minimized'}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
});
