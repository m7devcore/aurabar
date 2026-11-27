import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LyricsState } from '../hooks/useLyrics';
import type { Translations as Dictionary } from '../i18n';

interface Props {
  state: LyricsState;
  /** Index of the line being sung (from useActiveLine) */
  active: number;
  dict: Dictionary;
  className?: string;
}

/**
 * Lyrics panel for the expanded island. Synced lyrics glide so the current line stays centred;
 * unsynced lyrics are a quiet scrollable column.
 */
export function IslandLyrics({ state, active, dict, className = '' }: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [offset, setOffset] = useState(0);
  // The first placement (panel just opened, lyrics just loaded) snaps instead of scrolling
  const [animate, setAnimate] = useState(false);

  const synced = state.status === 'ready' ? state.lyrics.synced : null;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!synced || !viewport) return;
    const el = lineRefs.current[Math.max(0, active)];
    if (!el) return;
    setOffset(el.offsetTop + el.offsetHeight / 2 - viewport.clientHeight / 2);
  }, [synced, active]);

  useEffect(() => {
    setAnimate(false);
    if (!synced) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setAnimate(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [synced]);

  if (state.status !== 'ready') {
    const label =
      state.status === 'loading' ? dict.lyricsLoading : state.status === 'none' ? dict.noLyrics : '';
    return (
      <div className={`island-lyrics is-empty ${className}`}>
        <span className={state.status === 'loading' ? 'lyrics-shimmer' : ''}>{label}</span>
      </div>
    );
  }

  if (state.lyrics.instrumental) {
    return (
      <div className={`island-lyrics is-empty ${className}`}>
        <span>♪ {dict.instrumental} ♪</span>
      </div>
    );
  }

  if (!synced) {
    return (
      <div className={`island-lyrics is-plain ${className}`} ref={viewportRef}>
        {(state.lyrics.plain ?? []).map((line, i) =>
          line ? (
            <div key={i} className="lyric-line" dir="auto">
              {line}
            </div>
          ) : (
            <div key={i} className="lyric-gap" />
          )
        )}
      </div>
    );
  }

  return (
    <div className={`island-lyrics ${className}`} ref={viewportRef}>
      <div
        className={`lyrics-track ${animate ? '' : 'no-anim'}`}
        style={{ transform: `translate3d(0, ${-offset}px, 0)` }}
      >
        {synced.map((line, i) => (
          <div
            key={`${line.timeMs}-${i}`}
            ref={(el) => {
              lineRefs.current[i] = el;
            }}
            className={`lyric-line ${i === active ? 'active' : ''} ${i < active ? 'past' : ''}`}
            dir="auto"
          >
            {line.text || '♪'}
          </div>
        ))}
      </div>
    </div>
  );
}
