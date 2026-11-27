import { useRef, useState } from 'react';
import {
  Camera,
  File as FileIcon,
  Folder,
  FolderOpen,
  GripHorizontal,
  Inbox,
  Mic,
  MicOff,
  Plus,
  Trash2,
  X
} from 'lucide-react';
import { dockBridge } from '../../hooks/useDockBridge';
import { formatFileSize } from '../../hooks/useShelfItems';
import { t } from '../../i18n';
import type { Language, PrivacyStatus, ShelfItem } from '../../types';

interface Props {
  lang: Language;
  privacy: PrivacyStatus;
  shelfItems: ShelfItem[];
  onToggleMicMute: () => void;
  onAddFiles: () => Promise<number>;
  onRemoveItem: (path: string) => void;
  onClearAll: () => void;
  onIngestDrop: (dt: DataTransfer) => Promise<number>;
}

export function NotchNookPopover({
  lang,
  privacy,
  shelfItems,
  onToggleMicMute,
  onAddFiles,
  onRemoveItem,
  onClearAll,
  onIngestDrop
}: Props) {
  const dict = t(lang);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  const micLabel = privacy.micApps.length > 0 ? privacy.micApps.join(', ') : dict.nookMicActive;
  const camLabel = privacy.camApps.length > 0 ? privacy.camApps.join(', ') : dict.nookCamActive;

  return (
    <div
      className={`nook-popover-wrap ${isDragOver ? 'is-drag-over' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragDepthRef.current += 1;
        setIsDragOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setIsDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        dragDepthRef.current = 0;
        setIsDragOver(false);
        void onIngestDrop(e.dataTransfer);
      }}
    >
      {/* Privacy & Quick Global Mic Mute Bar */}
      {(privacy.hasMic || privacy.micActive || privacy.camActive) && (
        <div className="nook-popover-privacy">
          {privacy.hasMic && (
            <button
              type="button"
              className={`nook-privacy-chip ${
                privacy.micMuted ? 'is-muted' : privacy.micActive ? 'is-mic' : ''
              }`}
              onClick={onToggleMicMute}
              title={privacy.micMuted ? dict.nookUnmuteMic : dict.nookMuteMic}
            >
              {privacy.micActive && (
                <span className={`privacy-dot ${privacy.micMuted ? 'muted' : 'mic'}`} />
              )}
              {privacy.micMuted ? <MicOff size={12} /> : <Mic size={12} />}
              <span className="nook-privacy-text">
                {privacy.micMuted
                  ? dict.nookMicMuted
                  : privacy.micActive
                    ? micLabel
                    : dict.nookMuteMic}
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

      {/* Drop Tray */}
      <div className={`nook-tray-panel ${isDragOver ? 'is-drag-over' : ''}`}>
        {shelfItems.length === 0 ? (
          <div className="nook-empty-drop" onClick={() => void onAddFiles()}>
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
            <div className="nook-files-grid nook-popover-grid">
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
                  onClick={() => void dockBridge.openShelfItem(item.path)}
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
                        onRemoveItem(item.path);
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
                onClick={() => void onAddFiles()}
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
                onClick={onClearAll}
                title={dict.nookClearAll}
              >
                <Trash2 size={12} />
                <span>{dict.nookClearAll}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
