import { useEffect, useRef, useState } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { dockBridge } from '../hooks/useDockBridge';
import type { AudioAppSession, VolumeInfo } from '../types';

interface Props {
  compact?: boolean;
  surface?: 'dock' | 'island';
  /** When set (e.g. active SMTC media appId), controls only that app's WASAPI audio session. */
  targetAppId?: string;
  onTargetAppChange?: (appName: string | null) => void;
}

const APP_ID_ALIASES: Record<string, string[]> = {
  '308046b0af4a39cb': ['firefox'],
  'microsoft.zunemusic': ['microsoft.media.player', 'mediaplayer', 'music.ui'],
  'microsoft.windowsmediaplayer': ['wmplayer', 'mediaplayer'],
  'appleinc.applemusicwin': ['applemusic', 'amplibraryagent']
};

function findMatchingAudioSession(
  sessions: AudioAppSession[],
  appId?: string
): AudioAppSession | null {
  if (!appId) return null;
  const raw = appId.trim().toLowerCase();
  if (!raw) return null;

  const [beforeBang, afterBang = ''] = raw.split('!');
  const pkgBase = beforeBang.replace(/_[a-z0-9]{10,}$/i, '').replace(/\.exe$/i, '');
  const tokens = new Set<string>();
  const addToken = (t: string) => {
    const clean = t.trim().replace(/\.exe$/i, '');
    if (clean.length >= 2 && clean !== 'app' && clean !== 'com' && clean !== 'microsoft') {
      tokens.add(clean);
    }
  };

  addToken(pkgBase);
  for (const part of pkgBase.split('.')) addToken(part);
  if (afterBang) {
    addToken(afterBang);
    for (const part of afterBang.split('.')) addToken(part);
  }
  for (const [key, aliases] of Object.entries(APP_ID_ALIASES)) {
    if (raw.includes(key)) {
      for (const alias of aliases) addToken(alias);
    }
  }

  let best: AudioAppSession | null = null;
  let bestScore = 0;

  for (const s of sessions) {
    if (s.isSystem) continue;
    const sid = s.id.toLowerCase();
    const sname = s.name.toLowerCase();
    const sexe = (s.exePath || '').toLowerCase();
    const exeFile = sexe.split(/[\\/]/).pop()?.replace(/\.exe$/i, '') ?? '';

    let score = 0;
    if (tokens.has(sid) || (exeFile && tokens.has(exeFile))) {
      score = Math.max(score, 100);
    }
    if (pkgBase.length >= 4 && sexe.includes(pkgBase)) {
      score = Math.max(score, 95);
    }
    if (sid.length >= 3 && raw.includes(sid)) {
      score = Math.max(score, 85);
    }
    if (exeFile.length >= 3 && raw.includes(exeFile)) {
      score = Math.max(score, 85);
    }
    for (const tok of tokens) {
      if (tok.length >= 3 && (sname.includes(tok) || sid.includes(tok))) {
        score = Math.max(score, 65);
      }
    }

    if (score >= 65) {
      if (s.active) score += 10;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
  }

  return best;
}

export function VolumeSlider({
  compact = false,
  surface = 'dock',
  targetAppId,
  onTargetAppChange
}: Props) {
  const [vol, setVol] = useState<VolumeInfo>({ level: 65, muted: false });
  const [dragging, setDragging] = useState(false);
  const [targetSession, setTargetSession] = useState<{ id: string; name: string } | null>(null);
  const targetSessionRef = useRef<{ id: string; name: string } | null>(null);
  const onTargetChangeRef = useRef(onTargetAppChange);
  onTargetChangeRef.current = onTargetAppChange;
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const lockUntilRef = useRef(0);
  const lastSendRef = useRef(0);
  const pendingRef = useRef<number | null>(null);

  const setSurfaceInteractive = (interactive: boolean) => {
    if (surface === 'island') {
      dockBridge.setIslandInteractive(interactive);
    } else {
      dockBridge.setDockInteractive(interactive);
    }
  };

  useEffect(() => {
    let alive = true;
    let paused = false;
    // Allow immediate resync when the active media app switches
    lockUntilRef.current = 0;
    const stopSusp = dockBridge.onSuspended((s) => {
      paused = s;
    });
    const updateTarget = (next: { id: string; name: string } | null) => {
      const prev = targetSessionRef.current;
      if (prev?.id === next?.id && prev?.name === next?.name) return;
      targetSessionRef.current = next;
      setTargetSession(next);
      onTargetChangeRef.current?.(next?.name ?? null);
    };
    const sync = async () => {
      if (paused || draggingRef.current || Date.now() < lockUntilRef.current) return;
      if (targetAppId) {
        const sessions = await dockBridge.getAudioSessions();
        if (!alive || draggingRef.current || Date.now() < lockUntilRef.current) return;
        const matched = findMatchingAudioSession(sessions, targetAppId);
        if (matched) {
          updateTarget({ id: matched.id, name: matched.name });
          setVol((prev) =>
            prev.level === matched.volume && prev.muted === matched.muted
              ? prev
              : { level: matched.volume, muted: matched.muted }
          );
          return;
        }
      }
      updateTarget(null);
      const next = await dockBridge.getVolume();
      if (alive && !draggingRef.current && Date.now() >= lockUntilRef.current) {
        setVol((prev) => (prev.level === next.level && prev.muted === next.muted ? prev : next));
      }
    };
    void sync();
    const id = setInterval(() => void sync(), 1200);
    return () => {
      alive = false;
      stopSusp();
      clearInterval(id);
      if (pendingRef.current) {
        window.clearTimeout(pendingRef.current);
        pendingRef.current = null;
      }
      if (draggingRef.current) {
        draggingRef.current = false;
        setSurfaceInteractive(false);
      }
    };
  }, [surface, targetAppId]);

  const sendVolume = (clamped: number) => {
    const sess = targetSessionRef.current;
    if (sess) {
      void dockBridge.setAudioSessionVolume(sess.id, clamped);
    } else {
      void dockBridge.setVolume(clamped);
    }
  };

  const commitLevel = (nextLevel: number, force = false) => {
    const clamped = Math.max(0, Math.min(100, Math.round(nextLevel)));
    lockUntilRef.current = Date.now() + 900;
    setVol({ level: clamped, muted: clamped === 0 });

    const now = performance.now();
    if (force || now - lastSendRef.current >= 36) {
      lastSendRef.current = now;
      if (pendingRef.current) {
        window.clearTimeout(pendingRef.current);
        pendingRef.current = null;
      }
      sendVolume(clamped);
    } else {
      if (pendingRef.current) window.clearTimeout(pendingRef.current);
      pendingRef.current = window.setTimeout(() => {
        pendingRef.current = null;
        lastSendRef.current = performance.now();
        sendVolume(clamped);
      }, 36);
    }
  };

  const levelFromClientX = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return vol.level;
    const rect = el.getBoundingClientRect();
    const ratio = (clientX - rect.left) / Math.max(1, rect.width);
    return Math.max(0, Math.min(100, Math.round(ratio * 100)));
  };

  const effectiveLevel = vol.muted ? 0 : vol.level;
  const Icon = vol.muted || vol.level === 0 ? VolumeX : vol.level < 50 ? Volume1 : Volume2;
  const sliderLabel = targetSession ? `${targetSession.name} Volume` : 'Master Volume';
  const sliderTitle = targetSession
    ? `${targetSession.name} — ${effectiveLevel}%`
    : `${effectiveLevel}%`;

  return (
    <div
      className={`vol-slider-row ${compact ? 'compact' : ''} ${dragging ? 'is-dragging' : ''} ${
        vol.muted ? 'is-muted' : ''
      }`}
      onWheel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY < 0 ? 4 : -4;
        commitLevel((vol.muted ? 0 : vol.level) + delta, true);
      }}
    >
      <button
        type="button"
        className="vol-mute-btn"
        aria-label={
          targetSession
            ? `${vol.muted ? 'Unmute' : 'Mute'} ${targetSession.name}`
            : vol.muted
              ? 'Unmute volume'
              : 'Mute volume'
        }
        aria-pressed={vol.muted}
        onClick={(e) => {
          e.stopPropagation();
          lockUntilRef.current = Date.now() + 900;
          const sess = targetSessionRef.current;
          if (sess) {
            setVol((prev) => ({ ...prev, muted: !prev.muted }));
            void dockBridge.toggleAudioSessionMute(sess.id);
          } else {
            void dockBridge.toggleMute().then(setVol);
          }
        }}
        title={
          targetSession
            ? `${vol.muted ? 'Unmute' : 'Mute'} ${targetSession.name}`
            : vol.muted
              ? 'Unmute'
              : 'Mute'
        }
      >
        <Icon size={compact ? 14 : 16} />
      </button>

      <div
        ref={trackRef}
        dir="ltr"
        role="slider"
        tabIndex={0}
        aria-label={sliderLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={effectiveLevel}
        aria-valuetext={`${effectiveLevel}%`}
        title={sliderTitle}
        className="vol-track-hit"
        onKeyDown={(e) => {
          const step = e.key === 'PageUp' ? 10 : e.key === 'PageDown' ? -10 : 2;
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'PageUp') {
            e.preventDefault();
            commitLevel((vol.muted ? 0 : vol.level) + step, true);
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'PageDown') {
            e.preventDefault();
            commitLevel((vol.muted ? 0 : vol.level) - Math.abs(step), true);
          } else if (e.key === 'Home') {
            e.preventDefault();
            commitLevel(0, true);
          } else if (e.key === 'End') {
            e.preventDefault();
            commitLevel(100, true);
          }
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          draggingRef.current = true;
          setDragging(true);
          setSurfaceInteractive(true);
          commitLevel(levelFromClientX(e.clientX), true);
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          e.stopPropagation();
          commitLevel(levelFromClientX(e.clientX), false);
        }}
        onPointerUp={(e) => {
          if (!draggingRef.current) return;
          e.stopPropagation();
          draggingRef.current = false;
          setDragging(false);
          setSurfaceInteractive(false);
          commitLevel(levelFromClientX(e.clientX), true);
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
          setDragging(false);
          setSurfaceInteractive(false);
        }}
      >
        <div className="vol-track-bg">
          <div className="vol-track-fill" style={{ width: `${effectiveLevel}%` }} />
          <div className="vol-thumb" style={{ left: `${effectiveLevel}%` }} />
        </div>
      </div>

      <span className="vol-pct tabular">{effectiveLevel}%</span>
    </div>
  );
}
