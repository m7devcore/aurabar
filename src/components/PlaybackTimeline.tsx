import { useRef, useState } from 'react';
import { usePlaybackFrame, type PlaybackClock } from '../hooks/useLyrics';

function formatTime(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface Props {
  clock: PlaybackClock;
  endSec: number;
  onSeek?: (seconds: number) => void;
}

/** Progress bar + clock painted every frame straight to the DOM, with tactile click & drag scrubbing. */
export function PlaybackTimeline({ clock, endSec, onSeek }: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const lastSecond = useRef(-1);
  const lastPaintedPosMs = useRef(0);
  const draggingRef = useRef(false);
  const dragRatioRef = useRef(0);
  const optimisticRef = useRef<{ posMs: number; until: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const canSeek = Boolean(onSeek) && endSec > 0;

  const paintRatio = (ratio: number, posMs: number) => {
    const clamped = Math.min(1, Math.max(0, ratio));
    lastPaintedPosMs.current = posMs;
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${clamped.toFixed(5)})`;
    if (thumbRef.current) thumbRef.current.style.left = `${(clamped * 100).toFixed(3)}%`;
    const second = Math.floor(posMs / 1000);
    if (second !== lastSecond.current && timeRef.current) {
      lastSecond.current = second;
      timeRef.current.textContent = formatTime(second);
    }
  };

  usePlaybackFrame(clock, (posMs) => {
    if (draggingRef.current) return;
    const opt = optimisticRef.current;
    if (opt) {
      if (Date.now() < opt.until && Math.abs(posMs - opt.posMs) > 1500) {
        const ratio = endSec > 0 ? opt.posMs / (endSec * 1000) : 0;
        paintRatio(ratio, opt.posMs);
        return;
      }
      optimisticRef.current = null;
    }
    const progress = endSec > 0 ? Math.min(1, Math.max(0, posMs / (endSec * 1000))) : 0;
    paintRatio(progress, posMs);
  });

  const ratioFromClientX = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const commitSeek = (ratio: number) => {
    if (!canSeek || !onSeek) return;
    const targetSec = Math.max(0, Math.min(endSec, ratio * endSec));
    const targetMs = targetSec * 1000;
    optimisticRef.current = { posMs: targetMs, until: Date.now() + 850 };
    paintRatio(ratio, targetMs);
    onSeek(targetSec);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canSeek || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    const ratio = ratioFromClientX(e.clientX);
    dragRatioRef.current = ratio;
    paintRatio(ratio, ratio * endSec * 1000);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || !canSeek) return;
    e.stopPropagation();
    const ratio = ratioFromClientX(e.clientX);
    dragRatioRef.current = ratio;
    paintRatio(ratio, ratio * endSec * 1000);
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    if (!draggingRef.current) return;
    e.stopPropagation();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if capture already released
      }
    }
    draggingRef.current = false;
    setDragging(false);
    if (commit) {
      commitSeek(dragRatioRef.current);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!canSeek) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.key === 'ArrowRight' ? 5 : -5;
      const curSec = lastPaintedPosMs.current / 1000;
      const nextRatio = Math.min(1, Math.max(0, (curSec + delta) / endSec));
      commitSeek(nextRatio);
    }
  };

  return (
    <div className="stack-sm" style={{ gap: 2 }}>
      <div
        ref={trackRef}
        dir="ltr"
        role={canSeek ? 'slider' : undefined}
        tabIndex={canSeek ? 0 : undefined}
        aria-label="Seek track position"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, Math.floor(endSec))}
        aria-valuenow={Math.max(0, Math.floor(lastPaintedPosMs.current / 1000))}
        className={`island-timeline-hit ${canSeek ? 'is-seekable' : ''} ${dragging ? 'is-dragging' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => finishDrag(e, true)}
        onPointerCancel={(e) => finishDrag(e, false)}
        onKeyDown={handleKeyDown}
      >
        <div className="island-timeline-track">
          <div ref={fillRef} className="island-timeline-fill" />
        </div>
        {canSeek && <div ref={thumbRef} className="island-timeline-thumb" />}
      </div>
      <div className="row-between tabular" dir="ltr" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        <span ref={timeRef}>0:00</span>
        <span>{endSec > 0 ? formatTime(endSec) : '--:--'}</span>
      </div>
    </div>
  );
}
