import { useCallback, useEffect, useRef, useState } from 'react';
import { dockBridge } from './useDockBridge';
import type { LyricLine, LyricsResult, MediaInfo } from '../types';

export type LyricsState =
  | { status: 'off' | 'idle' | 'loading' | 'none' }
  | { status: 'ready'; lyrics: LyricsResult };

/** Fetches lyrics for the current track (cached in the main process) while `enabled`. */
export function useLyrics(media: MediaInfo | null, enabled: boolean): LyricsState {
  const [state, setState] = useState<LyricsState>({ status: 'idle' });
  const title = media?.title ?? '';
  const artist = media?.artist ?? '';
  const album = media?.album ?? '';
  const endSec = media?.endSec ?? 0;

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'off' });
      return;
    }
    if (!title) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    void dockBridge
      .getLyrics(title, artist, album, endSec)
      .then((lyrics) => {
        if (cancelled) return;
        setState(lyrics ? { status: 'ready', lyrics } : { status: 'none' });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'none' });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, title, artist, album, endSec]);

  return state;
}

/* ---------------- Lyrics on/off preference (shared by the island and dock windows) ---------------- */

const LYRICS_PREF_KEY = 'glassy.lyrics';

function readLyricsPref(): boolean {
  try {
    return window.localStorage.getItem(LYRICS_PREF_KEY) !== '0';
  } catch {
    return true;
  }
}

export function useLyricsPref(): [boolean, () => void] {
  const [on, setOn] = useState<boolean>(readLyricsPref);
  useEffect(() => {
    // The other window flipped it
    const onStorage = (e: StorageEvent) => {
      if (e.key === LYRICS_PREF_KEY) setOn(e.newValue !== '0');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const toggle = useCallback(() => {
    setOn((prev) => {
      try {
        window.localStorage.setItem(LYRICS_PREF_KEY, prev ? '0' : '1');
      } catch {
        // Preference is a convenience only
      }
      return !prev;
    });
  }, []);
  return [on, toggle];
}

/* ---------------- Playback clock ---------------- */

/** Position in ms the player last reported, extrapolated to `now`. */
export function playbackPositionMs(media: MediaInfo | null, now = Date.now()): number {
  if (!media) return 0;
  const base = media.posMs ?? (media.posSec ?? 0) * 1000;
  const elapsed = media.status === 'Playing' && media.posAt ? Math.max(0, now - media.posAt) : 0;
  const endMs = (media.endSec ?? 0) * 1000;
  const pos = base + elapsed;
  return endMs > 0 ? Math.min(pos, endMs) : pos;
}

// Readings closer than this to the running clock are treated as noise, so the clock never
// stutters backwards/forwards on every poll; anything bigger is a real seek
const RESYNC_THRESHOLD_MS = 700;

export interface PlaybackClock {
  /** Current position in ms; cheap, call it every frame. */
  now: () => number;
  playing: boolean;
  /** Bumps whenever the clock jumps (seek, track change, play/pause). */
  epoch: number;
}

export function usePlaybackClock(media: MediaInfo | null): PlaybackClock {
  const anchor = useRef({ posMs: 0, at: 0, playing: false, endMs: 0, track: '' });
  const [epoch, setEpoch] = useState(0);

  const track = media ? `${media.artist}|${media.title}` : '';
  const playing = media?.status === 'Playing';
  const endMs = (media?.endSec ?? 0) * 1000;

  const read = useCallback(() => {
    const a = anchor.current;
    const pos = a.posMs + (a.playing ? performance.now() - a.at : 0);
    return a.endMs > 0 ? Math.min(Math.max(0, pos), a.endMs) : Math.max(0, pos);
  }, []);

  useEffect(() => {
    const a = anchor.current;
    const reported = playbackPositionMs(media);
    const changed =
      a.track !== track ||
      a.playing !== playing ||
      a.endMs !== endMs ||
      Math.abs(reported - read()) > RESYNC_THRESHOLD_MS;
    if (!changed) return;
    anchor.current = { posMs: reported, at: performance.now(), playing, endMs, track };
    setEpoch((e) => e + 1);
    // posMs/posAt identify a new reading; other media fields do not affect the clock
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, playing, endMs, media?.posMs, media?.posAt]);

  return { now: read, playing, epoch };
}

/* ---------------- Active line ---------------- */

// Lines appear slightly early so the text is readable as the singer starts it
const LEAD_MS = 150;

export function activeLineIndex(lines: LyricLine[], posMs: number): number {
  const target = posMs + LEAD_MS;
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].timeMs <= target) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Index of the line being sung. Instead of polling, it sleeps until the exact moment the next
 * line starts, so React re-renders once per line and the switch lands on time.
 */
export function useActiveLine(lines: LyricLine[] | null, clock: PlaybackClock): number {
  const [index, setIndex] = useState(-1);
  const { now, playing, epoch } = clock;

  useEffect(() => {
    if (!lines || lines.length === 0) {
      setIndex(-1);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const step = () => {
      const pos = now();
      const idx = activeLineIndex(lines, pos);
      setIndex(idx);
      if (!playing) return;
      const next = lines[idx + 1];
      if (!next) return;
      const wait = next.timeMs - LEAD_MS - pos;
      timer = setTimeout(step, Math.max(16, Math.min(wait + 4, 5000)));
    };
    step();
    return () => clearTimeout(timer);
  }, [lines, now, playing, epoch]);

  return index;
}

/**
 * Drives an element every animation frame without React: `onFrame` receives the position and
 * writes to the DOM directly. Runs only while playing (one paint when paused).
 */
export function usePlaybackFrame(clock: PlaybackClock, onFrame: (posMs: number) => void): void {
  const cb = useRef(onFrame);
  cb.current = onFrame;
  const { now, playing, epoch } = clock;

  useEffect(() => {
    cb.current(now());
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      cb.current(now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [now, playing, epoch]);
}
