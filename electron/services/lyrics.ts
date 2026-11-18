import type { LyricLine, LyricsResult } from '../../src/types';

// Lyrics come from LRCLIB (https://lrclib.net): free, no API key, and most entries carry
// time-synced LRC lines. Only the track title, artist, album and duration are sent.
const API = 'https://lrclib.net/api';
const USER_AGENT = 'AuraBar/1.0 (desktop taskbar)';
const REQUEST_TIMEOUT_MS = 8000;
const CACHE_LIMIT = 120;
// A failed lookup (network down) is retried after this long; a definite "no lyrics" is kept
const RETRY_AFTER_MS = 60_000;

interface LrclibTrack {
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

interface CacheEntry {
  result: LyricsResult | null;
  failed: boolean;
  at: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<LyricsResult | null>>();

// "Song (Official Video) [4K]" -> "Song"; "Song - Remastered 2011" -> "Song"
function cleanTitle(title: string): string {
  return title
    .replace(/\s*[([](?:official|lyric|lyrics|audio|video|visuali[sz]er|hd|4k|mv|m\/v|explicit|clean|live)[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+(?:remaster(?:ed)?|\d{4} remaster|radio edit|single version|mono|stereo).*$/i, '')
    .replace(/\s*\|\s*.*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// YouTube channels often appear as "Artist - Topic" or "ArtistVEVO"
function cleanArtist(artist: string): string {
  return artist
    .replace(/\s*-\s*topic$/i, '')
    .replace(/vevo$/i, '')
    .replace(/\s*(?:,|&|feat\.?|ft\.?|x)\s.*$/i, '')
    .trim();
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  const stampRe = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps: number[] = [];
    let match: RegExpExecArray | null;
    let lastIndex = 0;
    stampRe.lastIndex = 0;
    while ((match = stampRe.exec(raw)) !== null) {
      if (match.index !== lastIndex) break;
      const frac = match[3] ? Number(match[3].padEnd(3, '0')) : 0;
      stamps.push(Number(match[1]) * 60_000 + Number(match[2]) * 1000 + frac);
      lastIndex = stampRe.lastIndex;
    }
    if (stamps.length === 0) continue;
    const text = raw.slice(lastIndex).trim();
    for (const timeMs of stamps) lines.push({ timeMs, text });
  }
  lines.sort((a, b) => a.timeMs - b.timeMs);
  return lines;
}

function toResult(track: LrclibTrack): LyricsResult | null {
  if (track.instrumental) return { synced: null, plain: null, instrumental: true };
  const synced = track.syncedLyrics ? parseLrc(track.syncedLyrics) : [];
  const plain = track.plainLyrics
    ? track.plainLyrics.split(/\r?\n/).map((l) => l.trim())
    : [];
  if (synced.length === 0 && plain.every((l) => !l)) return null;
  return {
    synced: synced.length > 0 ? synced : null,
    plain: plain.length > 0 ? plain : null,
    instrumental: false
  };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`lrclib ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function score(track: LrclibTrack, title: string, artist: string, durationSec: number): number {
  let s = 0;
  if (track.syncedLyrics) s += 4;
  if (normalize(track.trackName ?? '') === normalize(title)) s += 3;
  const a = normalize(track.artistName ?? '');
  const want = normalize(artist);
  if (want && (a === want || a.includes(want) || want.includes(a))) s += 3;
  if (durationSec > 0 && typeof track.duration === 'number') {
    const diff = Math.abs(track.duration - durationSec);
    if (diff <= 2) s += 4;
    else if (diff <= 6) s += 1;
    else if (diff > 20) s -= 6;
  }
  return s;
}

async function search(title: string, artist: string, durationSec: number): Promise<LrclibTrack | null> {
  const params = new URLSearchParams({ track_name: title });
  if (artist) params.set('artist_name', artist);
  const list = await fetchJson<LrclibTrack[]>(`${API}/search?${params.toString()}`);
  if (!list || list.length === 0) return null;
  let best: LrclibTrack | null = null;
  let bestScore = -Infinity;
  for (const track of list.slice(0, 20)) {
    if (!track.syncedLyrics && !track.plainLyrics && !track.instrumental) continue;
    const s = score(track, title, artist, durationSec);
    if (s > bestScore) {
      best = track;
      bestScore = s;
    }
  }
  // Below this the match is more likely a different song than the right one
  return bestScore >= 3 ? best : null;
}

async function lookup(
  rawTitle: string,
  rawArtist: string,
  album: string,
  durationSec: number
): Promise<LyricsResult | null> {
  const title = cleanTitle(rawTitle) || rawTitle.trim();
  const artist = cleanArtist(rawArtist);

  // 1) Exact signature match (fast, precise when the player reports a real duration)
  if (artist && durationSec > 0) {
    const params = new URLSearchParams({
      track_name: title,
      artist_name: artist,
      duration: String(Math.round(durationSec))
    });
    if (album) params.set('album_name', album);
    const exact = await fetchJson<LrclibTrack>(`${API}/get?${params.toString()}`);
    const r = exact ? toResult(exact) : null;
    if (r) return r;
  }

  // 2) Fuzzy search by title + artist
  const found = await search(title, artist, durationSec);
  if (found) return toResult(found);

  // 3) Browser tabs: the title is often "Artist - Song" while "artist" is the channel name
  const dash = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) {
    const fromTitle = await search(cleanTitle(dash[2]), cleanArtist(dash[1]), durationSec);
    if (fromTitle) return toResult(fromTitle);
  }
  return null;
}

export function getLyrics(
  title: string,
  artist: string,
  album: string,
  durationSec: number
): Promise<LyricsResult | null> {
  if (!title?.trim()) return Promise.resolve(null);
  const key = `${normalize(artist)}|${normalize(title)}|${Math.round(durationSec / 3)}`;
  const cached = cache.get(key);
  if (cached && (!cached.failed || Date.now() - cached.at < RETRY_AFTER_MS)) {
    return Promise.resolve(cached.result);
  }
  const pending = inFlight.get(key);
  if (pending) return pending;

  const p = lookup(title, artist ?? '', album ?? '', durationSec || 0)
    .then((result) => {
      cache.set(key, { result, failed: false, at: Date.now() });
      return result;
    })
    .catch(() => {
      cache.set(key, { result: null, failed: true, at: Date.now() });
      return null;
    })
    .finally(() => {
      inFlight.delete(key);
      if (cache.size > CACHE_LIMIT) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
    });
  inFlight.set(key, p);
  return p;
}
