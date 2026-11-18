import { useEffect, useState } from 'react';
import type { MediaInfo } from '../types';

const artworkCache = new Map<string, string | null>();

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
    const query = [media.artist, media.title].filter(Boolean).join(' ');
    fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { results?: { artworkUrl100?: string }[] } | null) => {
        if (cancelled) return;
        const art = data?.results?.[0]?.artworkUrl100?.replace('100x100', '300x300') ?? null;
        artworkCache.set(trackKey, art);
        setArtworkUrl(art);
      })
      .catch(() => {
        if (!cancelled) setArtworkUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [trackKey, media?.title, media?.artist]);

  return artworkUrl;
}
