import { MicVocal, Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { dockBridge } from '../../hooks/useDockBridge';
import { useMediaArtwork } from '../../hooks/useMediaArtwork';
import { VolumeSlider } from '../VolumeSlider';
import { IslandLyrics } from '../IslandLyrics';
import { PlaybackTimeline } from '../PlaybackTimeline';
import { useActiveLine, useLyrics, useLyricsPref, usePlaybackClock } from '../../hooks/useLyrics';
import { t } from '../../i18n';
import type { Language, MediaInfo } from '../../types';

interface Props {
  lang: Language;
  media: MediaInfo | null;
  onRefreshMedia: () => void;
}

export function MediaPopover({ lang, media, onRefreshMedia }: Props) {
  const dict = t(lang);
  const artworkUrl = useMediaArtwork(media);
  const [lyricsOn, toggleLyrics] = useLyricsPref();
  const lyrics = useLyrics(media, lyricsOn);
  const clock = usePlaybackClock(media);
  const activeLine = useActiveLine(lyrics.status === 'ready' ? lyrics.lyrics.synced : null, clock);

  const send = async (cmd: 'playPause' | 'next' | 'previous') => {
    await dockBridge.sendMediaCommand(cmd);
    setTimeout(onRefreshMedia, 250);
  };

  return (
    <div className="stack-md">
      <div className="card row-between" style={{ padding: 16 }}>
        <div className="row-gap" style={{ minWidth: 0, flex: 1 }}>
          {artworkUrl ? (
            <img
              src={artworkUrl}
              alt={media?.title ?? ''}
              style={{
                width: 48,
                height: 48,
                borderRadius: 10,
                objectFit: 'cover',
                flexShrink: 0,
                border: '1px solid var(--border-hairline)'
              }}
            />
          ) : (
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 10,
                background: 'var(--art-bg)',
                color: 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <Music size={21} />
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {media?.title || dict.nothingPlaying}
            </div>
            <div className="muted-sm">
              {media?.artist || (media?.appId ? media.appId.split('!')[0] : 'Spotify / YouTube / Media')}
            </div>
          </div>
        </div>

        <div className="row-gap">
          <button className="btn btn-icon" onClick={() => void send('previous')} title="Previous">
            <SkipBack size={15} />
          </button>
          <button
            className="btn btn-primary btn-icon"
            style={{ width: 38, height: 38 }}
            onClick={() => void send('playPause')}
            title="Play / Pause"
          >
            {media?.status === 'Playing' ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button className="btn btn-icon" onClick={() => void send('next')} title="Next">
            <SkipForward size={15} />
          </button>
        </div>
      </div>

      {media && (
        <div className="card stack-sm" style={{ padding: '10px 14px 12px' }}>
          <div className="row-between">
            <div className="muted-sm" style={{ fontWeight: 600 }}>
              {dict.lyrics}
            </div>
            <button
              className={`island-mini-action ${lyricsOn ? 'is-on' : ''}`}
              aria-label={dict.lyrics}
              aria-pressed={lyricsOn}
              onClick={toggleLyrics}
              title={dict.lyrics}
            >
              <MicVocal size={14} />
            </button>
          </div>
          {lyricsOn && (
            <IslandLyrics
              state={lyrics}
              active={activeLine}
              dict={dict}
              className="in-popover"
            />
          )}
          <PlaybackTimeline clock={clock} endSec={media.endSec ?? 0} />
        </div>
      )}

      <div className="card stack-sm" style={{ padding: '10px 14px' }}>
        <div className="muted-sm" style={{ fontWeight: 600 }}>{dict.volume}</div>
        <VolumeSlider />
      </div>
    </div>
  );
}
