import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Camera,
  ChevronUp,
  File as FileIcon,
  Folder,
  FolderOpen,
  GripHorizontal,
  Inbox,
  Mic,
  MicOff,
  MicVocal,
  Music,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  Trash2,
  X
} from 'lucide-react';
import { dockBridge } from '../hooks/useDockBridge';
import { useMediaArtwork } from '../hooks/useMediaArtwork';
import { formatFileSize, useShelfItems } from '../hooks/useShelfItems';
import { VolumeSlider } from './VolumeSlider';
import { IslandLyrics } from './IslandLyrics';
import { PlaybackTimeline } from './PlaybackTimeline';
import { BatteryIcon, BrightnessIcon, GlobeLangIcon, VolumeIcon } from './PremiumIcons';
import { useActiveLine, useLyrics, useLyricsPref, usePlaybackClock } from '../hooks/useLyrics';
import { t } from '../i18n';
import type { HudEvent, Language, MediaInfo, PrivacyStatus } from '../types';

interface Props {
  lang: Language;
  media: MediaInfo | null;
  musicInIsland: boolean;
  notchNookEnabled: boolean;
  privacy: PrivacyStatus;
  hudEvent?: HudEvent | null;
  expanded: boolean;
  autoHideIdle?: boolean;
  onToggleExpand: (next: boolean) => void;
  onRefreshMedia: () => void;
  onToggleMicMute: () => void;
}

function cleanSourceLabel(appId?: string): string | null {
  if (!appId) return null;
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

export function DynamicIsland({
  lang,
  media,
  musicInIsland,
  notchNookEnabled,
  privacy,
  hudEvent = null,
  expanded,
  autoHideIdle = false,
  onToggleExpand,
  onRefreshMedia,
  onToggleMicMute
}: Props) {
  const dict = t(lang);
  const effectiveMedia = musicInIsland ? media : null;
  const artworkUrl = useMediaArtwork(effectiveMedia);
  const [lyricsOn, toggleLyrics] = useLyricsPref();
  const {
    shelfItems,
    removeShelfItem,
    clearShelf,
    addFilesViaPicker: handleAddFiles,
    ingestDataTransfer
  } = useShelfItems(notchNookEnabled);
  const [activeTab, setActiveTab] = useState<'media' | 'tray'>(musicInIsland ? 'media' : 'tray');
  const [isDragOver, setIsDragOver] = useState(false);
  const [edgePeek, setEdgePeek] = useState(false);

  const islandRef = useRef<HTMLDivElement | null>(null);
  const dragDepthRef = useRef(0);
  const edgeTimerRef = useRef<number | null>(null);

  // Keep activeTab valid when settings change
  useEffect(() => {
    if (!musicInIsland && notchNookEnabled) {
      setActiveTab('tray');
    } else if (musicInIsland && !notchNookEnabled) {
      setActiveTab('media');
    }
  }, [musicInIsland, notchNookEnabled]);

  useEffect(() => {
    return () => {
      if (edgeTimerRef.current !== null) window.clearTimeout(edgeTimerRef.current);
    };
  }, []);

  const onToggleExpandRef = useRef(onToggleExpand);
  onToggleExpandRef.current = onToggleExpand;

  useEffect(() => {
    return dockBridge.onIslandOpenTray(() => {
      setActiveTab('tray');
      setEdgePeek(true);
      onToggleExpandRef.current(true);
    });
  }, []);

  const handleDropData = async (dt: DataTransfer) => {
    if (!notchNookEnabled) return;
    const addedCount = await ingestDataTransfer(dt);
    if (addedCount > 0) {
      setActiveTab('tray');
      if (!expanded) onToggleExpand(true);
    }
  };

  const hasPrivacyActivity = notchNookEnabled && (privacy.micActive || privacy.camActive);
  const hasParkedFiles = notchNookEnabled && shelfItems.length > 0;
  const showHud = Boolean(hudEvent) && !expanded;
  const hiddenIdle =
    autoHideIdle &&
    !effectiveMedia &&
    !expanded &&
    !hasPrivacyActivity &&
    !hasParkedFiles &&
    !showHud &&
    !isDragOver &&
    !edgePeek;

  useLayoutEffect(() => {
    const report = () => {
      if (hiddenIdle) {
        // Keep a razor-thin 8px top-center trigger strip when NotchNook is enabled so dragging a
        // file toward the top of the screen wakes the Drop Tray smoothly without blocking titlebars
        dockBridge.setHitRects(
          'island',
          notchNookEnabled ? [{ left: 120, top: 0, right: 360, bottom: 8 }] : []
        );
        return;
      }
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
  }, [
    expanded,
    effectiveMedia?.title,
    artworkUrl,
    Boolean(effectiveMedia),
    lyricsOn,
    hiddenIdle,
    notchNookEnabled,
    activeTab,
    shelfItems.length,
    hasPrivacyActivity,
    showHud,
    hudEvent?.kind,
    isDragOver
  ]);

  const isPlaying = effectiveMedia?.status === 'Playing';
  const lyrics = useLyrics(effectiveMedia, lyricsOn && activeTab === 'media');
  const syncedLines = lyrics.status === 'ready' ? lyrics.lyrics.synced : null;
  const clock = usePlaybackClock(effectiveMedia);
  const activeLine = useActiveLine(syncedLines, clock);

  const compactLine =
    syncedLines && isPlaying && !expanded ? syncedLines[activeLine] : undefined;
  const compactLyric = compactLine?.text
    ? { key: `${activeLine}-${compactLine.timeMs}`, text: compactLine.text }
    : null;
  const showLyricsPanel =
    expanded &&
    activeTab === 'media' &&
    lyricsOn &&
    Boolean(effectiveMedia) &&
    lyrics.status !== 'off';

  const sendCmd = async (cmd: 'playPause' | 'next' | 'previous') => {
    await dockBridge.sendMediaCommand(cmd);
    setTimeout(onRefreshMedia, 140);
    setTimeout(onRefreshMedia, 500);
    setTimeout(onRefreshMedia, 1000);
  };

  const endSec = effectiveMedia?.endSec ?? 0;
  const sourceLabel = cleanSourceLabel(effectiveMedia?.appId);
  const isIdle = !effectiveMedia && !expanded && !hasPrivacyActivity && !hasParkedFiles;
  const showTabBar = musicInIsland && notchNookEnabled;
  const isTrayView = activeTab === 'tray' && notchNookEnabled;

  const scheduleEdgeRelax = () => {
    if (edgeTimerRef.current !== null) window.clearTimeout(edgeTimerRef.current);
    edgeTimerRef.current = window.setTimeout(() => {
      edgeTimerRef.current = null;
      setEdgePeek(false);
    }, 900);
  };

  const onDragEnterZone = (e: React.DragEvent) => {
    if (!notchNookEnabled) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setIsDragOver(true);
    setEdgePeek(true);
    dockBridge.setIslandInteractive(true);
    setActiveTab('tray');
    if (!expanded) onToggleExpand(true);
  };

  const onDragOverZone = (e: React.DragEvent) => {
    if (!notchNookEnabled) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onDragLeaveZone = (e: React.DragEvent) => {
    if (!notchNookEnabled) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOver(false);
      dockBridge.setIslandInteractive(false);
    }
  };

  const onDropZone = (e: React.DragEvent) => {
    if (!notchNookEnabled) return;
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragOver(false);
    dockBridge.setIslandInteractive(false);
    void handleDropData(e.dataTransfer);
  };

  const micLabel = privacy.micApps.length > 0 ? privacy.micApps.join(', ') : dict.nookMicActive;
  const camLabel = privacy.camApps.length > 0 ? privacy.camApps.join(', ') : dict.nookCamActive;

  return (
    <div
      className="island-shell"
      onClick={(e) => {
        if (e.target === e.currentTarget && expanded) {
          onToggleExpand(false);
        }
      }}
    >
      {hiddenIdle && notchNookEnabled && (
        <div
          className="island-edge-trigger"
          onMouseEnter={() => {
            if (edgeTimerRef.current !== null) window.clearTimeout(edgeTimerRef.current);
            setEdgePeek(true);
          }}
          onDragEnter={onDragEnterZone}
          onDragOver={onDragOverZone}
        />
      )}

      <div
        ref={islandRef}
        className={`dynamic-island ${expanded ? 'expanded' : ''} ${
          showHud && hudEvent ? `is-hud-mode hud-${hudEvent.kind}` : ''
        } ${
          expanded && isTrayView ? 'is-tray-view' : ''
        } ${expanded && isTrayView && shelfItems.length > 4 ? 'is-tray-many' : ''} ${
          expanded && hasPrivacyActivity ? 'has-privacy-bar' : ''
        } ${
          isPlaying ? 'is-playing' : ''
        } ${isIdle && !showHud ? 'is-idle' : ''} ${
          !musicInIsland && !expanded && !showHud ? 'is-nook-only' : ''
        } ${
          hiddenIdle ? 'is-hidden-idle' : ''
        } ${showLyricsPanel ? 'with-lyrics' : ''} ${compactLyric && !showHud ? 'has-lyric' : ''} ${
          isDragOver ? 'is-drag-over' : ''
        }`}
        aria-hidden={hiddenIdle || undefined}
        onMouseLeave={() => {
          if (edgePeek && !expanded && !isDragOver) scheduleEdgeRelax();
        }}
        onDragEnter={onDragEnterZone}
        onDragOver={onDragOverZone}
        onDragLeave={onDragLeaveZone}
        onDrop={onDropZone}
        onClick={() => {
          if (!expanded) {
            if (!musicInIsland && notchNookEnabled) setActiveTab('tray');
            onToggleExpand(true);
          }
        }}
        title={
          !expanded
            ? effectiveMedia
              ? `${effectiveMedia.title} — ${effectiveMedia.artist}`
              : notchNookEnabled
                ? dict.nookDropTitle
                : dict.islandIdle
            : undefined
        }
      >
        {!expanded ? (
          showHud && hudEvent ? (
            <div className="island-hud-row" role="status" aria-live="polite">
              {hudEvent.kind === 'volume' && (
                <>
                  <span className={`island-hud-icon ${hudEvent.muted ? 'is-danger' : ''}`}>
                    <VolumeIcon level={hudEvent.level} muted={hudEvent.muted} />
                  </span>
                  <div className="island-hud-bar-track">
                    <div
                      className={`island-hud-bar-fill ${hudEvent.muted ? 'is-muted' : ''}`}
                      style={{
                        transform: `scaleX(${hudEvent.muted ? 0 : Math.max(0, Math.min(1, hudEvent.level / 100))})`
                      }}
                    />
                  </div>
                  <span className={`island-hud-val tabular ${hudEvent.muted ? 'is-danger' : ''}`}>
                    {hudEvent.muted ? dict.hudMuted : `${hudEvent.level}%`}
                  </span>
                </>
              )}

              {hudEvent.kind === 'brightness' && (
                <>
                  <span className="island-hud-icon">
                    <BrightnessIcon size={16} />
                  </span>
                  <div className="island-hud-bar-track">
                    <div
                      className="island-hud-bar-fill"
                      style={{
                        transform: `scaleX(${Math.max(0, Math.min(1, hudEvent.level / 100))})`
                      }}
                    />
                  </div>
                  <span className="island-hud-val tabular">{hudEvent.level}%</span>
                </>
              )}

              {hudEvent.kind === 'battery' && (
                <>
                  <span className="island-hud-icon">
                    <BatteryIcon percent={hudEvent.percent} charging={hudEvent.charging} />
                  </span>
                  <span
                    className={`island-hud-label ${
                      hudEvent.charging ? 'is-good' : hudEvent.low ? 'is-danger' : ''
                    }`}
                  >
                    {hudEvent.charging
                      ? dict.hudCharging
                      : hudEvent.low
                        ? dict.hudLowBattery
                        : dict.hudOnBattery}
                  </span>
                  <span className="island-hud-val tabular">{hudEvent.percent}%</span>
                </>
              )}

              {hudEvent.kind === 'keyboard' && (
                <>
                  <span className="island-hud-icon">
                    <GlobeLangIcon size={15} />
                  </span>
                  <span className="island-hud-label">
                    {hudEvent.code === 'AR'
                      ? 'العربية'
                      : hudEvent.code === 'EN'
                        ? 'English'
                        : hudEvent.code}
                  </span>
                  <span className="island-hud-kbd-pill tabular">{hudEvent.code}</span>
                </>
              )}
            </div>
          ) : (
          <div className="island-compact-row">
            {musicInIsland ? (
              <>
                {artworkUrl ? (
                  <img className="island-art-sm" src={artworkUrl} alt={effectiveMedia?.title ?? ''} />
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
                      {effectiveMedia?.title ||
                        (hasParkedFiles
                          ? dict.nookFilesCount.replace('{n}', String(shelfItems.length))
                          : dict.islandIdle)}
                    </span>
                    {effectiveMedia?.artist && (
                      <span className="island-compact-artist" dir="auto">
                        {effectiveMedia.artist}
                      </span>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className={`island-art-sm ${hasParkedFiles ? 'is-accent' : ''}`}>
                  <Inbox size={13} />
                </div>
                <div className="island-compact-text">
                  <span className="island-compact-title" dir="auto">
                    {hasParkedFiles
                      ? dict.nookFilesCount.replace('{n}', String(shelfItems.length))
                      : dict.nookDropTitle}
                  </span>
                </div>
              </>
            )}

            <div className="island-compact-indicators">
              {notchNookEnabled && privacy.camActive && (
                <span
                  className="privacy-pill is-cam"
                  title={`${dict.nookCamActive}: ${camLabel}`}
                  aria-label={`${dict.nookCamActive}: ${camLabel}`}
                >
                  <span className="privacy-dot cam" />
                  <Camera size={11} />
                </span>
              )}

              {notchNookEnabled && (privacy.micActive || privacy.micMuted) && (
                <button
                  type="button"
                  className={`privacy-pill is-mic ${privacy.micMuted ? 'is-muted' : ''}`}
                  title={
                    privacy.micMuted
                      ? `${dict.nookMicMuted}${privacy.micActive ? ` (${micLabel})` : ''} — ${dict.nookUnmuteMic}`
                      : `${dict.nookMicActive} (${micLabel}) — ${dict.nookMuteMic}`
                  }
                  aria-label={privacy.micMuted ? dict.nookUnmuteMic : dict.nookMuteMic}
                  aria-pressed={privacy.micMuted}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleMicMute();
                  }}
                >
                  <span className={`privacy-dot ${privacy.micMuted ? 'muted' : 'mic'}`} />
                  {privacy.micMuted ? <MicOff size={11} /> : <Mic size={11} />}
                </button>
              )}

              {musicInIsland && hasParkedFiles && (
                <button
                  type="button"
                  className="island-tray-badge"
                  title={`${dict.nookDropTitle} (${shelfItems.length})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveTab('tray');
                    onToggleExpand(true);
                  }}
                >
                  <Inbox size={11} />
                  <span className="tabular">{shelfItems.length}</span>
                </button>
              )}

              {effectiveMedia && (
                <button
                  type="button"
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
          </div>
          )
        ) : (
          <div className="island-expanded-body">
            {/* Top NotchNook Header Bar: Mode tabs + Mic Mute + Collapse */}
            <div className="nook-header">
              {showTabBar ? (
                <div className="nook-tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'media'}
                    className={`nook-tab ${activeTab === 'media' ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveTab('media');
                    }}
                  >
                    <Music size={12} />
                    <span>{dict.nookMediaTab}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'tray'}
                    className={`nook-tab ${activeTab === 'tray' ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveTab('tray');
                    }}
                  >
                    <Inbox size={12} />
                    <span>{dict.nookTrayTab}</span>
                    {shelfItems.length > 0 && (
                      <span className="nook-tab-count tabular">{shelfItems.length}</span>
                    )}
                  </button>
                </div>
              ) : (
                <div className="nook-heading-label">
                  {isTrayView ? <Inbox size={13} /> : <Music size={13} />}
                  <span>{isTrayView ? dict.nookDropTitle : dict.media}</span>
                </div>
              )}

              <div className="island-top-actions">
                {notchNookEnabled && privacy.hasMic && (
                  <button
                    type="button"
                    className={`island-mini-action ${
                      privacy.micMuted ? 'is-danger' : privacy.micActive ? 'is-live-mic' : ''
                    }`}
                    aria-label={privacy.micMuted ? dict.nookUnmuteMic : dict.nookMuteMic}
                    aria-pressed={privacy.micMuted}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleMicMute();
                    }}
                    title={privacy.micMuted ? dict.nookUnmuteMic : dict.nookMuteMic}
                  >
                    {privacy.micMuted ? <MicOff size={14} /> : <Mic size={14} />}
                  </button>
                )}

                {!isTrayView && effectiveMedia && (
                  <button
                    type="button"
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
                  type="button"
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

            {/* Live Privacy Banner when Mic or Camera is actively used by an app */}
            {hasPrivacyActivity && (
              <div className="nook-privacy-bar">
                {privacy.micActive && (
                  <button
                    type="button"
                    className={`nook-privacy-chip ${privacy.micMuted ? 'is-muted' : 'is-mic'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleMicMute();
                    }}
                    title={privacy.micMuted ? dict.nookUnmuteMic : dict.nookMuteMic}
                  >
                    <span className={`privacy-dot ${privacy.micMuted ? 'muted' : 'mic'}`} />
                    {privacy.micMuted ? <MicOff size={12} /> : <Mic size={12} />}
                    <span className="nook-privacy-text">
                      {privacy.micMuted ? dict.nookMicMuted : micLabel}
                    </span>
                  </button>
                )}
                {privacy.camActive && (
                  <div className="nook-privacy-chip is-cam">
                    <span className="privacy-dot cam" />
                    <Camera size={12} />
                    <span className="nook-privacy-text">{camLabel}</span>
                  </div>
                )}
              </div>
            )}

            {isTrayView ? (
              <div className={`nook-tray-panel ${isDragOver ? 'is-drag-over' : ''}`}>
                {shelfItems.length === 0 ? (
                  <div
                    className="nook-empty-drop"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleAddFiles();
                    }}
                  >
                    <div className="nook-empty-icon">
                      <Inbox size={20} />
                    </div>
                    <div className="nook-empty-title">
                      {isDragOver ? dict.nookDropHere : dict.nookDropTitle}
                    </div>
                    <div className="nook-empty-hint">{dict.nookDropHint}</div>
                  </div>
                ) : (
                  <>
                    <div className="nook-files-grid">
                      {shelfItems.map((item) => (
                        <div
                          key={item.id}
                          className="nook-file-card"
                          draggable
                          onDragStart={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            dockBridge.startShelfDrag([item.path], item.previewDataUrl);
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            void dockBridge.openShelfItem(item.path);
                          }}
                          title={`${item.name}${item.size ? ` (${formatFileSize(item.size)})` : ''}`}
                        >
                          <div className={`nook-file-thumb ${item.isImage ? 'is-img' : ''}`}>
                            {item.previewDataUrl ? (
                              <img src={item.previewDataUrl} alt={item.name} draggable={false} />
                            ) : item.isDir ? (
                              <Folder size={20} />
                            ) : (
                              <FileIcon size={18} />
                            )}
                          </div>
                          <div className="nook-file-name" dir="auto">
                            {item.name}
                          </div>
                          <div className="nook-file-actions">
                            <button
                              type="button"
                              className="nook-file-action-btn"
                              title={dict.nookReveal}
                              onClick={(e) => {
                                e.stopPropagation();
                                void dockBridge.revealShelfItem(item.path);
                              }}
                            >
                              <FolderOpen size={11} />
                            </button>
                            <button
                              type="button"
                              className="nook-file-action-btn is-remove"
                              title={dict.nookRemove}
                              onClick={(e) => {
                                e.stopPropagation();
                                removeShelfItem(item.path);
                              }}
                            >
                              <X size={11} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="nook-tray-footer">
                      <button
                        type="button"
                        className="nook-pill-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleAddFiles();
                        }}
                      >
                        <Plus size={12} />
                        <span>{dict.nookAddFiles}</span>
                      </button>

                      <button
                        type="button"
                        className="nook-pill-btn is-primary"
                        draggable
                        onDragStart={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          dockBridge.startShelfDrag(
                            shelfItems.map((i) => i.path),
                            shelfItems[0]?.previewDataUrl
                          );
                        }}
                        title={dict.nookDragAll}
                      >
                        <GripHorizontal size={12} />
                        <span>{dict.nookDragAll}</span>
                      </button>

                      <button
                        type="button"
                        className="nook-pill-btn is-danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          clearShelf();
                        }}
                        title={dict.nookClearAll}
                      >
                        <Trash2 size={12} />
                        <span>{dict.nookClearAll}</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="row-between" style={{ alignItems: 'flex-start' }}>
                  <div className="row-gap" style={{ minWidth: 0, flex: 1, gap: 12 }}>
                    {artworkUrl ? (
                      <img
                        className="island-art-lg"
                        src={artworkUrl}
                        alt={effectiveMedia?.title ?? ''}
                      />
                    ) : (
                      <div className="island-art-lg">
                        <Music size={24} color="#ffffff" />
                      </div>
                    )}

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="island-expanded-title" dir="auto">
                        {effectiveMedia?.title || dict.islandIdle}
                      </div>
                      <div className="island-expanded-artist" dir="auto">
                        {effectiveMedia?.artist || dict.islandHint}
                      </div>
                      {sourceLabel && <span className="island-source-badge">{sourceLabel}</span>}
                    </div>
                  </div>
                </div>

                {showLyricsPanel && (
                  <IslandLyrics state={lyrics} active={activeLine} dict={dict} />
                )}

                <PlaybackTimeline
                  clock={clock}
                  endSec={endSec}
                  onSeek={(sec) => {
                    void dockBridge.seekMedia(sec).then(() => {
                      setTimeout(onRefreshMedia, 120);
                      setTimeout(onRefreshMedia, 450);
                    });
                  }}
                />

                <div className="row-between" style={{ justifyContent: 'center', gap: 18 }}>
                  <button
                    type="button"
                    className="island-ctrl-btn"
                    aria-label={dict.previousTrack}
                    onClick={() => void sendCmd('previous')}
                    title={dict.previousTrack}
                  >
                    <SkipBack size={17} />
                  </button>

                  <button
                    type="button"
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
                    type="button"
                    className="island-ctrl-btn"
                    aria-label={dict.nextTrack}
                    onClick={() => void sendCmd('next')}
                    title={dict.nextTrack}
                  >
                    <SkipForward size={17} />
                  </button>
                </div>

                <VolumeSlider
                  compact
                  surface="island"
                  targetAppId={effectiveMedia?.appId}
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
