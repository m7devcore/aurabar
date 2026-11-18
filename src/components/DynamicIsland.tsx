import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ChevronUp,
  Music,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2
} from 'lucide-react';
import { dockBridge } from '../hooks/useDockBridge';
import type { MediaInfo } from '../types';

interface Props {
  media: MediaInfo | null;
  expanded: boolean;
  onToggleExpand: (next: boolean) => void;
  onRefreshMedia: () => void;
}

const artworkCache = new Map<string, string | null>();

function formatTime(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function DynamicIsland({
  media,
  expanded,
  onToggleExpand,
  onRefreshMedia
}: Props) {
  const [artworkUrl, setArtworkUrl] = useState<string | null>(null);
  const [livePosSec, setLivePosSec] = useState<number>(0);
  const islandRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const report = () => {
      const el = islandRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      dockBridge.setHitRects('island', [
        {
          left: Math.floor(r.left - 10),
          top: 0,
          right: Math.ceil(r.right + 10),
          bottom: Math.ceil(r.bottom + 12)
        }
      ]);
    };
    report();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(report) : null;
    if (ro && islandRef.current) ro.observe(islandRef.current);
    return () => ro?.disconnect();
  }, [expanded, media?.title, artworkUrl]);

  const trackKey = media ? `${media.artist} - ${media.title}` : '';
  const isPlaying = media?.status === 'Playing';

  useEffect(() => {
    setLivePosSec(media?.posSec ?? 0);
  }, [media?.posSec, trackKey]);

  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      setLivePosSec((prev) => {
        const end = media?.endSec ?? 0;
        if (end > 0 && prev >= end) return end;
        return prev + 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [isPlaying, media?.endSec]);

  useEffect(() => {
    if (!media?.title) {
      setArtworkUrl(null);
      return;
    }
    if (artworkCache.has(trackKey)) {
      setArtworkUrl(artworkCache.get(trackKey) ?? null);
      return;
    }

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

  const sendCmd = async (cmd: 'playPause' | 'next' | 'previous') => {
    await dockBridge.sendMediaCommand(cmd);
    setTimeout(onRefreshMedia, 250);
  };

  const endSec = media?.endSec ?? 0;
  const pct = endSec > 0 ? Math.min(100, Math.round((livePosSec / endSec) * 100)) : 0;

  return (
    <div
      className="island-shell"
      onClick={(e) => {
        if (e.target === e.currentTarget && expanded) {
          onToggleExpand(false);
        }
      }}
    >
      <div
        ref={islandRef}
        className={`dynamic-island ${expanded ? 'expanded' : ''}`}
        onClick={() => {
          if (!expanded) onToggleExpand(true);
        }}
        title={!expanded ? (media ? `${media.title} — ${media.artist}` : 'AuraBar Music Island') : undefined}
      >
        {!expanded ? (
          <div className="island-compact-row">
            {artworkUrl ? (
              <img className="island-art-sm" src={artworkUrl} alt={media?.title ?? ''} />
            ) : (
              <div className="island-art-sm">
                <Music size={13} color="#ffffff" />
              </div>
            )}

            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {media?.title || 'No Media Playing'}
              </span>
              {media?.artist && (
                <span
                  style={{
                    fontSize: 11.5,
                    color: '#94a3b8',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flexShrink: 1
                  }}
                >
                  {media.artist}
                </span>
              )}
            </div>

            <button
              className={`island-eq-btn ${isPlaying ? 'eq-playing' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                void sendCmd('playPause');
              }}
              title={isPlaying ? 'Pause' : 'Play'}
            >
              <span className="eq-bar" style={{ background: isPlaying ? '#34d399' : '#64748b' }} />
              <span className="eq-bar" style={{ background: isPlaying ? '#38bdf8' : '#64748b' }} />
              <span className="eq-bar" style={{ background: isPlaying ? '#a78bfa' : '#64748b' }} />
              <span className="eq-bar" style={{ background: isPlaying ? '#34d399' : '#64748b' }} />
            </button>
          </div>
        ) : (
          <div className="island-expanded-body">
            <div className="row-between" style={{ alignItems: 'flex-start' }}>
              <div className="row-gap" style={{ minWidth: 0, flex: 1, gap: 12 }}>
                {artworkUrl ? (
                  <img className="island-art-lg" src={artworkUrl} alt={media?.title ?? ''} />
                ) : (
                  <div className="island-art-lg">
                    <Music size={24} color="#ffffff" />
                  </div>
                )}

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 14.5,
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {media?.title || 'Nothing Playing'}
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: '#94a3b8',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      marginTop: 2
                    }}
                  >
                    {media?.artist || 'Start Spotify, YouTube, or any media'}
                  </div>
                </div>
              </div>

              <button
                className="island-mini-action"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand(false);
                }}
                title="Collapse"
              >
                <ChevronUp size={15} />
              </button>
            </div>

            <div className="stack-sm" style={{ gap: 5 }}>
              <div className="island-timeline-track">
                <div className="island-timeline-fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="row-between tabular" style={{ fontSize: 11, color: '#94a3b8' }}>
                <span>{formatTime(livePosSec)}</span>
                <span>{endSec > 0 ? formatTime(endSec) : '--:--'}</span>
              </div>
            </div>

            <div className="row-between" style={{ padding: '0 6px' }}>
              <button
                className="island-ctrl-btn"
                onClick={() => void dockBridge.adjustVolume('down')}
                title="Volume Down"
              >
                <Volume1 size={16} />
              </button>

              <button
                className="island-ctrl-btn"
                onClick={() => void sendCmd('previous')}
                title="Previous Track"
              >
                <SkipBack size={17} />
              </button>

              <button
                className="island-play-btn"
                onClick={() => void sendCmd('playPause')}
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause size={20} fill="#050507" /> : <Play size={20} fill="#050507" />}
              </button>

              <button
                className="island-ctrl-btn"
                onClick={() => void sendCmd('next')}
                title="Next Track"
              >
                <SkipForward size={17} />
              </button>

              <button
                className="island-ctrl-btn"
                onClick={() => void dockBridge.adjustVolume('up')}
                title="Volume Up"
              >
                <Volume2 size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
