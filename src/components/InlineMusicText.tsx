import { useActiveLine, useLyrics, usePlaybackClock } from '../hooks/useLyrics';
import type { MediaInfo } from '../types';

interface Props {
  media: MediaInfo | null;
  lyricsOn: boolean;
  idleLabel: string;
}

/**
 * Text column of the taskbar music pill: title/artist, or the line being sung while synced
 * lyrics are available. Its width is fixed while lyrics are on so the dock never shifts as
 * lines come and go.
 */
export function InlineMusicText({ media, lyricsOn, idleLabel }: Props) {
  const lyrics = useLyrics(media, lyricsOn);
  const synced = lyrics.status === 'ready' ? lyrics.lyrics.synced : null;
  const clock = usePlaybackClock(media);
  const active = useActiveLine(synced, clock);
  const line = synced && clock.playing ? synced[active] : undefined;

  return (
    <div className={`inline-music-text ${lyricsOn && media ? 'fixed' : ''}`}>
      {line?.text ? (
        <div key={`${active}-${line.timeMs}`} className="inline-music-lyric" dir="auto">
          {line.text}
        </div>
      ) : (
        <>
          <div className="inline-music-title" dir="auto">
            {media?.title || idleLabel}
          </div>
          {media?.artist && (
            <div className="inline-music-artist" dir="auto">
              {media.artist}
            </div>
          )}
        </>
      )}
    </div>
  );
}
