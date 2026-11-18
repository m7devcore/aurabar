import { useRef } from 'react';
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
}

/** Progress bar + clock painted every frame straight to the DOM, so it glides instead of ticking. */
export function PlaybackTimeline({ clock, endSec }: Props) {
  const fillRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const lastSecond = useRef(-1);

  usePlaybackFrame(clock, (posMs) => {
    const progress = endSec > 0 ? Math.min(1, Math.max(0, posMs / (endSec * 1000))) : 0;
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${progress.toFixed(5)})`;
    const second = Math.floor(posMs / 1000);
    if (second !== lastSecond.current && timeRef.current) {
      lastSecond.current = second;
      timeRef.current.textContent = formatTime(second);
    }
  });

  return (
    <div className="stack-sm" style={{ gap: 5 }}>
      <div className="island-timeline-track">
        <div ref={fillRef} className="island-timeline-fill" />
      </div>
      <div className="row-between tabular" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        <span ref={timeRef}>0:00</span>
        <span>{endSec > 0 ? formatTime(endSec) : '--:--'}</span>
      </div>
    </div>
  );
}
