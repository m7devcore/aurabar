import { useEffect, useRef, useState } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { dockBridge } from '../hooks/useDockBridge';
import type { VolumeInfo } from '../types';

interface Props {
  compact?: boolean;
  surface?: 'dock' | 'island';
}

export function VolumeSlider({ compact = false, surface = 'dock' }: Props) {
  const [vol, setVol] = useState<VolumeInfo>({ level: 65, muted: false });
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const lockUntilRef = useRef(0);
  const lastSendRef = useRef(0);
  const pendingRef = useRef<number | null>(null);

  const setSurfaceInteractive = (interactive: boolean) => {
    if (surface === 'island') {
      dockBridge.setIslandInteractive(interactive);
    } else {
      dockBridge.setDockInteractive(interactive);
    }
  };

  useEffect(() => {
    let alive = true;
    let paused = false;
    const stopSusp = dockBridge.onSuspended((s) => {
      paused = s;
    });
    const sync = async () => {
      if (paused || draggingRef.current || Date.now() < lockUntilRef.current) return;
      const next = await dockBridge.getVolume();
      if (alive && !draggingRef.current && Date.now() >= lockUntilRef.current) {
        setVol((prev) => (prev.level === next.level && prev.muted === next.muted ? prev : next));
      }
    };
    void sync();
    const id = setInterval(() => void sync(), 1200);
    return () => {
      alive = false;
      stopSusp();
      clearInterval(id);
      if (pendingRef.current) {
        window.clearTimeout(pendingRef.current);
        pendingRef.current = null;
      }
      if (draggingRef.current) {
        draggingRef.current = false;
        setSurfaceInteractive(false);
      }
    };
  }, [surface]);

  const commitLevel = (nextLevel: number, force = false) => {
    const clamped = Math.max(0, Math.min(100, Math.round(nextLevel)));
    lockUntilRef.current = Date.now() + 900;
    setVol({ level: clamped, muted: clamped === 0 });

    const now = performance.now();
    if (force || now - lastSendRef.current >= 36) {
      lastSendRef.current = now;
      if (pendingRef.current) {
        window.clearTimeout(pendingRef.current);
        pendingRef.current = null;
      }
      void dockBridge.setVolume(clamped);
    } else {
      if (pendingRef.current) window.clearTimeout(pendingRef.current);
      pendingRef.current = window.setTimeout(() => {
        pendingRef.current = null;
        lastSendRef.current = performance.now();
        void dockBridge.setVolume(clamped);
      }, 36);
    }
  };

  const levelFromClientX = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return vol.level;
    const rect = el.getBoundingClientRect();
    const ratio = (clientX - rect.left) / Math.max(1, rect.width);
    return Math.max(0, Math.min(100, Math.round(ratio * 100)));
  };

  const effectiveLevel = vol.muted ? 0 : vol.level;
  const Icon = vol.muted || vol.level === 0 ? VolumeX : vol.level < 50 ? Volume1 : Volume2;

  return (
    <div
      className={`vol-slider-row ${compact ? 'compact' : ''} ${dragging ? 'is-dragging' : ''} ${
        vol.muted ? 'is-muted' : ''
      }`}
      onWheel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY < 0 ? 4 : -4;
        commitLevel((vol.muted ? 0 : vol.level) + delta, true);
      }}
    >
      <button
        type="button"
        className="vol-mute-btn"
        aria-label={vol.muted ? 'Unmute volume' : 'Mute volume'}
        aria-pressed={vol.muted}
        onClick={(e) => {
          e.stopPropagation();
          lockUntilRef.current = Date.now() + 900;
          void dockBridge.toggleMute().then(setVol);
        }}
        title={vol.muted ? 'Unmute' : 'Mute'}
      >
        <Icon size={compact ? 14 : 16} />
      </button>

      <div
        ref={trackRef}
        dir="ltr"
        role="slider"
        tabIndex={0}
        aria-label="Master Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={effectiveLevel}
        aria-valuetext={`${effectiveLevel}%`}
        title={`${effectiveLevel}%`}
        className="vol-track-hit"
        onKeyDown={(e) => {
          const step = e.key === 'PageUp' ? 10 : e.key === 'PageDown' ? -10 : 2;
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp') {
            e.preventDefault();
            commitLevel((vol.muted ? 0 : vol.level) + step, true);
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown') {
            e.preventDefault();
            commitLevel((vol.muted ? 0 : vol.level) - Math.abs(step), true);
          } else if (e.key === 'Home') {
            e.preventDefault();
            commitLevel(0, true);
          } else if (e.key === 'End') {
            e.preventDefault();
            commitLevel(100, true);
          }
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          draggingRef.current = true;
          setDragging(true);
          setSurfaceInteractive(true);
          commitLevel(levelFromClientX(e.clientX), true);
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          e.stopPropagation();
          commitLevel(levelFromClientX(e.clientX), false);
        }}
        onPointerUp={(e) => {
          if (!draggingRef.current) return;
          e.stopPropagation();
          draggingRef.current = false;
          setDragging(false);
          setSurfaceInteractive(false);
          commitLevel(levelFromClientX(e.clientX), true);
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
          setDragging(false);
          setSurfaceInteractive(false);
        }}
      >
        <div className="vol-track-bg">
          <div className="vol-track-fill" style={{ width: `${effectiveLevel}%` }} />
          <div className="vol-thumb" style={{ left: `${effectiveLevel}%` }} />
        </div>
      </div>

      <span className="vol-pct tabular">{effectiveLevel}%</span>
    </div>
  );
}
