import { useEffect, useRef, useState } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { dockBridge } from '../hooks/useDockBridge';
import type { VolumeInfo } from '../types';

interface Props {
  compact?: boolean;
}

export function VolumeSlider({ compact = false }: Props) {
  const [vol, setVol] = useState<VolumeInfo>({ level: 65, muted: false });
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const lastSendRef = useRef(0);
  const pendingRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    const sync = async () => {
      if (draggingRef.current) return;
      const next = await dockBridge.getVolume();
      if (alive && !draggingRef.current) {
        setVol(next);
      }
    };
    void sync();
    const id = setInterval(() => void sync(), 1200);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const commitLevel = (nextLevel: number, force = false) => {
    const clamped = Math.max(0, Math.min(100, Math.round(nextLevel)));
    setVol({ level: clamped, muted: clamped === 0 ? true : false });

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
        onClick={(e) => {
          e.stopPropagation();
          void dockBridge.toggleMute().then(setVol);
        }}
        title={vol.muted ? 'Unmute' : 'Mute'}
      >
        <Icon size={compact ? 14 : 16} />
      </button>

      <div
        ref={trackRef}
        className="vol-track-hit"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          draggingRef.current = true;
          setDragging(true);
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
          commitLevel(levelFromClientX(e.clientX), true);
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
          setDragging(false);
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
