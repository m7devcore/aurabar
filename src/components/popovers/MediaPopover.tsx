import { Music, Pause, Play, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react';
import { dockBridge } from '../../hooks/useDockBridge';
import { t } from '../../i18n';
import type { Language, MediaInfo } from '../../types';

interface Props {
  lang: Language;
  media: MediaInfo | null;
  onRefreshMedia: () => void;
}

export function MediaPopover({ lang, media, onRefreshMedia }: Props) {
  const dict = t(lang);

  const send = async (cmd: 'playPause' | 'next' | 'previous') => {
    await dockBridge.sendMediaCommand(cmd);
    setTimeout(onRefreshMedia, 250);
  };

  return (
    <div className="stack-md">
      <div className="card row-between" style={{ padding: 16 }}>
        <div className="row-gap" style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <Music size={20} />
          </div>
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

      <div className="card row-between">
        <span className="muted-sm">{dict.volume}</span>
        <div className="row-gap">
          <button className="btn" onClick={() => void dockBridge.adjustVolume('down')}>
            <Volume1 size={14} /> Vol -
          </button>
          <button className="btn" onClick={() => void dockBridge.adjustVolume('mute')}>
            <VolumeX size={14} /> Mute
          </button>
          <button className="btn" onClick={() => void dockBridge.adjustVolume('up')}>
            <Volume2 size={14} /> Vol +
          </button>
        </div>
      </div>
    </div>
  );
}
