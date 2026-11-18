import { Music, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { dockBridge } from '../../hooks/useDockBridge';
import { useMediaArtwork } from '../../hooks/useMediaArtwork';
import { VolumeSlider } from '../VolumeSlider';
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
                borderRadius: 12,
                objectFit: 'cover',
                flexShrink: 0,
                border: '1px solid var(--border-hairline)',
                boxShadow: '0 6px 18px var(--island-glow)'
              }}
            />
          ) : (
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: 'var(--art-grad)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                boxShadow: '0 6px 18px var(--island-glow)'
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

      <div className="card stack-sm" style={{ padding: '10px 14px' }}>
        <div className="muted-sm" style={{ fontWeight: 600 }}>{dict.volume}</div>
        <VolumeSlider />
      </div>
    </div>
  );
}
