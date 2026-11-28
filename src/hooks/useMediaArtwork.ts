import { useEffect, useState } from 'react';
import type { MediaInfo } from '../types';

const MAX_ARTWORK_CACHE = 100;
const artworkCache = new Map<string, string | null>();

interface ItunesTrack {
  trackName?: string;
  artistName?: string;
  artworkUrl100?: string;
}

function cacheArtwork(key: string, url: string | null): void {
  if (artworkCache.has(key)) artworkCache.delete(key);
  artworkCache.set(key, url);
  if (artworkCache.size > MAX_ARTWORK_CACHE) {
    const oldest = artworkCache.keys().next().value;
    if (oldest !== undefined) artworkCache.delete(oldest);
  }
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickBestItunesArt(results: ItunesTrack[], title: string, artist: string): string | null {
  const normTitle = normalize(title);
  const normArtist = normalize(artist);
  if (!normTitle) return null;
  const artistTokens = normArtist.split(' ').filter((w) => w.length >= 2);
  const titleTokens = normTitle.split(' ').filter((w) => w.length >= 2);

  for (const item of results) {
    if (!item.artworkUrl100) continue;
    const candTitle = normalize(item.trackName ?? '');
    const candArtist = normalize(item.artistName ?? '');
    const titleMatches =
      candTitle === normTitle ||
      candTitle.includes(normTitle) ||
      normTitle.includes(candTitle) ||
      (titleTokens.length >= 2 &&
        titleTokens.filter((w) => candTitle.includes(w)).length >= Math.ceil(titleTokens.length * 0.7));
    if (!titleMatches) continue;

    if (artistTokens.length > 0) {
      const artistMatches =
        candArtist.includes(normArtist) ||
        normArtist.includes(candArtist) ||
        artistTokens.some((w) => candArtist.includes(w));
      if (!artistMatches) continue;
    }
    return item.artworkUrl100.replace('100x100', '300x300');
  }
  return null;
}

export function useMediaArtwork(media: MediaInfo | null): string | null {
  const smtcThumb = media?.thumbnailDataUrl ?? null;
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const trackKey = media?.title ? `${media.artist} - ${media.title}` : '';

  useEffect(() => {
    // Prefer the exact native SMTC artwork from Spotify / YouTube / browsers — no guesswork
    if (smtcThumb) {
      setFallbackUrl(null);
      return;
    }
    if (!media?.title) {
      setFallbackUrl(null);
      return;
    }
    if (artworkCache.has(trackKey)) {
      setFallbackUrl(artworkCache.get(trackKey) ?? null);
      return;
    }

    // Don't keep showing the previous track's cover while the new one loads
    setFallbackUrl(null);
    let cancelled = false;
    const ac = new AbortController();
    const query = [media.artist, media.title].filter(Boolean).join(' ');
    fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=5`, {
      signal: ac.signal
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { results?: ItunesTrack[] } | null) => {
        if (cancelled) return;
        const art = data?.results ? pickBestItunesArt(data.results, media.title, media.artist) : null;
        cacheArtwork(trackKey, art);
        setFallbackUrl(art);
      })
      .catch(() => {
        if (!cancelled) setFallbackUrl(null);
      });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [smtcThumb, trackKey, media?.title, media?.artist]);

  return smtcThumb ?? fallbackUrl;
}
