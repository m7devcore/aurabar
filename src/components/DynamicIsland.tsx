import { useLayoutEffect, useRef } from 'react';
import { ChevronUp, MicVocal, Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { dockBridge } from '../hooks/useDockBridge';
import { useMediaArtwork } from '../hooks/useMediaArtwork';
import { VolumeSlider } from './VolumeSlider';
import { IslandLyrics } from './IslandLyrics';
import { PlaybackTimeline } from './PlaybackTimeline';
import { useActiveLine, useLyrics, useLyricsPref, usePlaybackClock } from '../hooks/useLyrics';
import { t } from '../i18n';
import type { Language, MediaInfo } from '../types';

interface Props {
  lang: Language;
  media: MediaInfo | null;
  expanded: boolean;
  onToggleExpand: (next: boolean) => void;
  onRefreshMedia: () => void;
}

function cleanSourceLabel(appId?: string): string | null {
  if (!appId) return null;
  // Format examples:
  // "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" -> "Spotify"
  // "Chrome" / "msedge.exe" / "Brave" -> "Chrome" / "Msedge" / "Brave"
  const parts = appId.split('!');
  if (parts.length > 1 && parts[1] && !/^app$/i.test(parts[1])) {
    const tail = parts[1].replace(/\.exe$/i, '').trim();
    if (tail) return tail.length > 20 ? `${tail.slice(0, 18)}…` : tail;
  }
  const head = parts[0]
    .replace(/\.exe$/i, '')
    .replace(/_[a-z0-9]{10,}$/i, '')
    .split('.')
    .pop()
    ?.replace(/Music$/i, '')
    .trim();
  if (!head) return null;
  return head.length > 20 ? `${head.slice(0, 18)}…` : head;
}

export function DynamicIsland({ lang, media, expanded, onToggleExpand, onRefreshMedia }: Props) {
  const dict = t(lang);
  const artworkUrl = useMediaArtwork(media);
  const [lyricsOn, toggleLyrics] = useLyricsPref();
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
  }, [expanded, media?.title, artworkUrl, Boolean(media), lyricsOn]);

  const isPlaying = media?.status === 'Playing';
  const lyrics = useLyrics(media, lyricsOn);
  const syncedLines = lyrics.status === 'ready' ? lyrics.lyrics.synced : null;
  const clock = usePlaybackClock(media);
  const activeLine = useActiveLine(syncedLines, clock);

  // Compact island: the current lyric line takes over the text row while it is being sung
  const compactLine = syncedLines && isPlaying && !expanded ? syncedLines[activeLine] : undefined;
  const compactLyric = compactLine?.text
    ? { key: `${activeLine}-${compactLine.timeMs}`, text: compactLine.text }
    : null;
  const showLyricsPanel = expanded && lyricsOn && Boolean(media) && lyrics.status !== 'off';

  const sendCmd = async (cmd: 'playPause' | 'next' | 'previous') => {
    await dockBridge.sendMediaCommand(cmd);
    setTimeout(onRefreshMedia, 250);
  };

  const endSec = media?.endSec ?? 0;
  const sourceLabel = cleanSourceLabel(media?.appId);
  const isIdle = !media && !expanded;

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
        className={`dynamic-island ${expanded ? 'expanded' : ''} ${isPlaying ? 'is-playing' : ''} ${
          isIdle ? 'is-idle' : ''
        } ${showLyricsPanel ? 'with-lyrics' : ''} ${compactLyric ? 'has-lyric' : ''}`}
        onClick={() => {
          if (!expanded) onToggleExpand(true);
        }}
        title={
          !expanded ? (media ? `${media.title} — ${media.artist}` : dict.islandIdle) : undefined
        }
      >
        {!expanded ? (
          <div className="island-compact-row">
            {artworkUrl ? (
              <img className="island-art-sm" src={artworkUrl} alt={media?.title ?? ''} />
            ) : (
              <div className="island-art-sm">
                <Music size={13} />
              </div>
            )}

            {compactLyric ? (
              <div className="island-compact-text">
                <span key={compactLyric.key} className="island-compact-lyric" dir="auto">
                  {compactLyric.text}
                </span>
              </div>
            ) : (
              <div className="island-compact-text">
                <span className="island-compact-title" dir="auto">
                  {media?.title || dict.islandIdle}
                </span>
                {media?.artist && (
                  <span className="island-compact-artist" dir="auto">
                    {media.artist}
                  </span>
                )}
              </div>
            )}

            {media && (
              <button
                className={`island-eq-btn ${isPlaying ? 'eq-playing' : ''}`}
                aria-label={isPlaying ? dict.pause : dict.play}
                aria-pressed={isPlaying}
                onClick={(e) => {
                  e.stopPropagation();
                  void sendCmd('playPause');
                }}
                title={isPlaying ? dict.pause : dict.play}
              >
                <span className="eq-bar" />
                <span className="eq-bar" />
                <span className="eq-bar" />
                <span className="eq-bar" />
              </button>
            )}
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
                  <div className="island-expanded-title" dir="auto">
                    {media?.title || dict.islandIdle}
                  </div>
                  <div className="island-expanded-artist" dir="auto">
                    {media?.artist || dict.islandHint}
                  </div>
                  {sourceLabel && <span className="island-source-badge">{sourceLabel}</span>}
                </div>
              </div>

              <div className="island-top-actions">
                {media && (
                  <button
                    className={`island-mini-action ${lyricsOn ? 'is-on' : ''}`}
                    aria-label={dict.lyrics}
                    aria-pressed={lyricsOn}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLyrics();
                    }}
                    title={dict.lyrics}
                  >
                    <MicVocal size={14} />
                  </button>
                )}
                <button
                  className="island-mini-action"
                  aria-label={dict.collapse}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleExpand(false);
                  }}
                  title={dict.collapse}
                >
                  <ChevronUp size={15} />
                </button>
              </div>
            </div>

            {showLyricsPanel && <IslandLyrics state={lyrics} active={activeLine} dict={dict} />}

            <PlaybackTimeline clock={clock} endSec={endSec} />

            <div className="row-between" style={{ justifyContent: 'center', gap: 18 }}>
              <button
                className="island-ctrl-btn"
                aria-label={dict.previousTrack}
                onClick={() => void sendCmd('previous')}
                title={dict.previousTrack}
              >
                <SkipBack size={17} />
              </button>

              <button
                className="island-play-btn"
                aria-label={isPlaying ? dict.pause : dict.play}
                aria-pressed={isPlaying}
                onClick={() => void sendCmd('playPause')}
                title={isPlaying ? dict.pause : dict.play}
              >
                {isPlaying ? (
                  <Pause size={20} fill="currentColor" />
                ) : (
                  <Play size={20} fill="currentColor" />
                )}
              </button>

              <button
                className="island-ctrl-btn"
                aria-label={dict.nextTrack}
                onClick={() => void sendCmd('next')}
                title={dict.nextTrack}
              >
                <SkipForward size={17} />
              </button>
            </div>

            <VolumeSlider compact />
          </div>
        )}
      </div>
    </div>
  );
}
