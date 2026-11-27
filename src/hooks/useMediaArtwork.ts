import { useEffect, useState } from 'react';
import type { MediaInfo } from '../types';

const MAX_ARTWORK_CACHE = 100;
const artworkCache = new Map<string, string | null>();

function cacheArtwork(key: string, url: string | null): void {
  if (artworkCache.has(key)) artworkCache.delete(key);
  artworkCache.set(key, url);
  if (artworkCache.size > MAX_ARTWORK_CACHE) {
    const oldest = artworkCache.keys().next().value;
    if (oldest !== undefined) artworkCache.delete(oldest);
  }
}

export function useMediaArtwork(media: MediaInfo | null): string | null {
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
  const trackKey = media?.title ? `${media.artist} - ${media.title}` : '';

  useEffect(() => {
    if (!media?.title) {
      setArtworkUrl(null);
      return;
    }
    if (artworkCache.has(trackKey)) {
      setArtworkUrl(artworkCache.get(trackKey) ?? null);
      return;
    }

    // Don't keep showing the previous track's cover while the new one loads
    setArtworkUrl(null);
    let cancelled = false;
    const ac = new AbortController();
    const query = [media.artist, media.title].filter(Boolean).join(' ');
    fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`, {
      signal: ac.signal
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { results?: { artworkUrl100?: string }[] } | null) => {
        if (cancelled) return;
        const art = data?.results?.[0]?.artworkUrl100?.replace('100x100', '300x300') ?? null;
        cacheArtwork(trackKey, art);
        setArtworkUrl(art);
      })
      .catch(() => {
        if (!cancelled) setArtworkUrl(null);
      });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [trackKey, media?.title, media?.artist]);

  return artworkUrl;
}
