import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bell,
  ChevronUp,
  Clock,
  ExternalLink,
  FolderOpen,
  Gauge,
  Music,
  Pause,
  Pin,
  PinOff,
  Play,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  Wrench,
  X,
  Zap
} from 'lucide-react';
import { dockBridge } from '../hooks/useDockBridge';
import { useMediaArtwork } from '../hooks/useMediaArtwork';
import { useDockFit } from '../hooks/useDockFit';
import { useLyricsPref } from '../hooks/useLyrics';
import { InlineMusicText } from './InlineMusicText';
import { t } from '../i18n';
import type {
  ActivePanel,
  AppConfig,
  AudioAppSession,
  BackgroundApp,
  MediaInfo,
  UpdateInfo,
  NetworkInfo,
  PinnedApp,
  RunningWindow,
  SystemStats,
  VolumeInfo
} from '../types';
import { AppIconGlyph } from './IconMapper';
import {
  ControlCenterFlyout,
  prefetchControlCenterStatus,
  type ControlCenterView
} from './ControlCenterFlyout';
import { WindowPeek } from './WindowPeek';
import {
  BatteryIcon,
  GlobeLangIcon,
  SearchIcon,
  SettingsIcon,
  StartIcon,
  VolumeIcon,
  WifiIcon
} from './PremiumIcons';

const RUNNING_ORDER_KEY = 'aurabar.runningOrder';
const LEARNED_PROCS_KEY = 'aurabar.learnedProcs';

const GENERIC_LAUNCHER_EXES = new Set([
  'update',
  'launcher',
  'bootstrapper',
  'setup',
  'stub',
  'installer',
  'updater'
]);

function normalizeAppToken(s?: string): string {
  if (!s) return '';
  return s.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, '');
}

function readLearnedProcs(): Record<string, string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(LEARNED_PROCS_KEY) ?? '{}');
    const out: Record<string, string> = {};
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'string' && v.trim()) out[k] = v.toLowerCase();
      }
    }
    return out;
  } catch {
    return {};
  }
}

function pinnedMatchesWindow(
  app: PinnedApp,
  w: RunningWindow,
  learnedProc?: string
): boolean {
  if (app.kind === 'group') return false;

  // 1) Official Windows AppUserModelID / Store AUMID match (covers Store, Electron, Squirrel, PWAs)
  const appId =
    app.appId?.toLowerCase() ??
    (app.target?.toLowerCase().startsWith('shell:appsfolder\\')
      ? app.target.slice('shell:appsfolder\\'.length).toLowerCase()
      : undefined);
  if (appId) {
    if (w.appId?.toLowerCase() === appId || w.aumid?.toLowerCase() === appId) return true;
  }

  const wProc = w.processName.toLowerCase();

  // 2) Auto-learned process binding (for .url Steam/Epic games & multi-stage launchers)
  if (learnedProc && wProc === learnedProc) return true;

  // 3) Exact exeName match (ignoring generic Squirrel/launcher stubs like Update.exe)
  const exe = app.exeName?.toLowerCase();
  if (exe && !GENERIC_LAUNCHER_EXES.has(exe) && wProc === exe) return true;

  // 4) Specific install directory match (e.g. Launcher.exe -> Binaries\Win64\Game-Win64-Shipping.exe)
  if (app.installDir && w.executablePath) {
    const wExe = w.executablePath.replace(/\//g, '\\').toLowerCase();
    const dir = app.installDir.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
    if (dir && wExe.startsWith(`${dir}\\`)) return true;
  }

  // 5) Normalized name match ONLY when the pin has no concrete exe/appId (e.g. .url game shortcuts)
  if (!appId && (!exe || GENERIC_LAUNCHER_EXES.has(exe))) {
    const appTok = normalizeAppToken(app.name);
    if (appTok.length >= 4) {
      const procTok = normalizeAppToken(w.processName);
      const dispTok = normalizeAppToken(w.displayName);
      const titleTok = normalizeAppToken(w.title);
      if (
        (procTok && (procTok === appTok || procTok.startsWith(appTok))) ||
        (dispTok && (dispTok === appTok || dispTok.includes(appTok))) ||
        (titleTok && titleTok === appTok)
      ) {
        return true;
      }
    }
  }

  return false;
}

// Where the user dropped each open, unpinned app: `anchors[key]` is how many pinned apps come
// before it, `order` ranks apps that share the same anchor
interface RunningLayout {
  order: string[];
  anchors: Record<string, number>;
}

function readRunningOrder(): RunningLayout {
  try {
    const raw = JSON.parse(window.localStorage.getItem(RUNNING_ORDER_KEY) ?? '{}');
    const order = Array.isArray(raw?.order)
      ? raw.order.filter((k: unknown): k is string => typeof k === 'string')
      : [];
    const anchors: Record<string, number> = {};
    if (raw?.anchors && typeof raw.anchors === 'object') {
      for (const [k, v] of Object.entries(raw.anchors)) {
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) anchors[k] = Math.floor(v);
      }
    }
    return { order, anchors };
  } catch {
    return { order: [], anchors: {} };
  }
}

interface CtxMenuState {
  x: number;
  anchorOffset?: number;
  kind: 'pinned' | 'running' | 'bg' | 'tray' | 'network' | 'volume' | 'clock';
  pinned?: PinnedApp;
  pinnedIndex?: number;
  running?: RunningWindow;
  bg?: BackgroundApp;
}

function ctxKeyOf(payload: Omit<CtxMenuState, 'x'>): string {
  if (payload.kind === 'pinned') return `pinned:${payload.pinned?.id ?? ''}`;
  if (payload.kind === 'running') return `running:${payload.running?.hwnd ?? payload.running?.pid ?? ''}`;
  if (payload.kind === 'bg') return `bg:${payload.bg?.pid ?? ''}`;
  return payload.kind;
}

interface TooltipState {
  label: string;
  x: number;
}

type DragPayload =
  | { kind: 'pinned'; item: PinnedApp }
  | { kind: 'folder-child'; folderId: string; item: PinnedApp }
  | { kind: 'running'; win: RunningWindow; item: PinnedApp };

interface PointerDragState {
  payload: DragPayload;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean; // becomes true once pointer moves >= 11px
}

interface DragSlotSnapshot {
  stripTop: number;
  stripBottom: number;
  stripLeft: number;
  stripRight: number;
  step: number;
  origIndex: number; // >= 0 for pinned, -1 for folder-child / running
  slots: Array<{ id: string; x: number; isGroup: boolean }>;
}

interface LiveDragPlan {
  gapIndex: number | null;
  mergeTargetId: string | null;
}

interface Props {
  isSecondary?: boolean;
  updateInfo: UpdateInfo | null;
  config: AppConfig;
  activePanel: ActivePanel;
  stats: SystemStats;
  media: MediaInfo | null;
  runningWindows: RunningWindow[];
  kbdLang: string;
  now: Date;
  onTogglePanel: (panel: ActivePanel) => void;
  onSavePinnedApps: (apps: PinnedApp[]) => void;
  onRefreshMedia: () => void;
  onRefreshWindows: () => void;
  onSwitchKbdLang: () => void;
}

export function DockBar({
  isSecondary = false,
  updateInfo,
  config,
  activePanel,
  stats,
  media,
  runningWindows,
  kbdLang,
  now,
  onTogglePanel,
  onSavePinnedApps,
  onRefreshMedia,
  onRefreshWindows,
  onSwitchKbdLang
}: Props) {
  const { settings, pinnedApps } = config;
  const dict = t(settings.language);
  const mediaArtworkUrl = useMediaArtwork(media);
  const [lyricsOn] = useLyricsPref();
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [openFolder, setOpenFolder] = useState<{ id: string; x: number } | null>(null);
  const [ccFlyout, setCcFlyout] = useState<{ x: number; view: ControlCenterView } | null>(null);
  const [overflowTray, setOverflowTray] = useState<{ x: number } | null>(null);
  const [backgroundApps, setBackgroundApps] = useState<BackgroundApp[]>([]);
  const [audioSessions, setAudioSessions] = useState<AudioAppSession[]>([]);
  const [hoveredOverflowLabel, setHoveredOverflowLabel] = useState<string | null>(null);
  const [trayVol, setTrayVol] = useState<VolumeInfo>({ level: 70, muted: false });
  const volDraggingRef = useRef(false);
  const volLockUntilRef = useRef(0);
  const [netInfo, setNetInfo] = useState<NetworkInfo>({ connected: true, kind: 'wifi' });
  const [dragOverExternal, setDragOverExternal] = useState(false);
  const [pointerDrag, setPointerDrag] = useState<PointerDragState | null>(null);
  const [liveDrag, setLiveDrag] = useState<LiveDragPlan | null>(null);
  const [justDropped, setJustDropped] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [folderNameDraft, setFolderNameDraft] = useState<string | null>(null);
  // Hover preview of an app's open windows; key is `pin:<id>` or `proc:<process name>`
  const [peek, setPeek] = useState<{ key: string; x: number } | null>(null);
  const peekRef = useRef<HTMLDivElement | null>(null);
  const peekOpenTimerRef = useRef<number | null>(null);
  const peekCloseTimerRef = useRef<number | null>(null);
  const pointerTrailRef = useRef<{ x: number; y: number; t: number }[]>([]);

  const stripRef = useRef<HTMLDivElement | null>(null);
  const dockBarRef = useRef<HTMLDivElement | null>(null);
  // Shrinks icons / tightens the music pill / scrolls the strip so a crowded dock never overlaps
  useDockFit(dockBarRef, stripRef, [
    settings.compactMode,
    settings.musicPosition,
    settings.showOpenWindowsInBar
  ]);
  const folderPopoverRef = useRef<HTMLDivElement | null>(null);
  const ccFlyoutRef = useRef<HTMLDivElement | null>(null);
  const ccClusterRef = useRef<HTMLDivElement | null>(null);
  const overflowBtnRef = useRef<HTMLButtonElement | null>(null);
  const overflowPopoverRef = useRef<HTMLDivElement | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);
  const ctxJustClosedRef = useRef<{ key: string; at: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const waveCacheRef = useRef<{
    scrollLeft: number;
    items: Array<{ btn: HTMLButtonElement; centerX: number }>;
  } | null>(null);
  const suppressNextClickRef = useRef(false);
  const runDragRef = useRef(false);
  const [runningLayout, setRunningLayout] = useState<RunningLayout>(readRunningOrder);
  const [learnedProcs, setLearnedProcs] = useState<Record<string, string>>(readLearnedProcs);
  const pendingLaunchRef = useRef<{
    pinnedId: string;
    appName: string;
    at: number;
    baselineHwnds: Set<string>;
  } | null>(null);
  const dragCandidateRef = useRef<PointerDragState | null>(null);
  const dragSnapshotRef = useRef<DragSlotSnapshot | null>(null);
  const liveDragRef = useRef<LiveDragPlan | null>(null);
  const dragGhostRef = useRef<HTMLDivElement | null>(null);
  const openOverlaysRef = useRef({ ctxMenu, openFolder, ccFlyout, overflowTray, peek });
  openOverlaysRef.current = { ctxMenu, openFolder, ccFlyout, overflowTray, peek };

  const activeFolderObj = openFolder
    ? pinnedApps.find((p) => p.id === openFolder.id && p.kind === 'group') ?? null
    : null;

  useEffect(() => {
    setFolderNameDraft(null);
  }, [openFolder?.id]);

  const commitFolderName = () => {
    if (!activeFolderObj || folderNameDraft === null) return;
    const nextName = folderNameDraft.trim() || activeFolderObj.name;
    setFolderNameDraft(null);
    if (nextName === activeFolderObj.name) return;
    onSavePinnedApps(
      pinnedApps.map((p) => (p.id === activeFolderObj.id ? { ...p, name: nextName } : p))
    );
  };

  // Sync running app order & learned exe mappings live across primary and secondary monitors
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === RUNNING_ORDER_KEY) {
        setRunningLayout(readRunningOrder());
      } else if (e.key === LEARNED_PROCS_KEY) {
        setLearnedProcs(readLearnedProcs());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Clear any open flyout/peek/menu when suspended for fullscreen on ANY display
  useEffect(() => {
    return dockBridge.onSuspended((s) => {
      if (!s) return;
      setPeek(null);
      setCtxMenu(null);
      setOpenFolder(null);
      setCcFlyout(null);
      setOverflowTray(null);
    });
  }, []);

  // Live sync tray Volume + Wi-Fi/Network state cleanly (primary monitor only, paused when hidden)
  useEffect(() => {
    if (isSecondary) return;
    let alive = true;
    let paused = false;
    const stopSusp = dockBridge.onSuspended((s) => {
      paused = s;
    });
    const pollTray = async () => {
      if (paused) return;
      const [v, n] = await Promise.all([dockBridge.getVolume(), dockBridge.getNetworkInfo()]);
      if (!alive) return;
      if (!volDraggingRef.current && Date.now() >= volLockUntilRef.current) {
        setTrayVol((prev) => (prev.level === v.level && prev.muted === v.muted ? prev : v));
      }
      setNetInfo((prev) =>
        prev.connected === n.connected &&
        prev.kind === n.kind &&
        prev.ssid === n.ssid &&
        prev.signalPercent === n.signalPercent
          ? prev
          : n
      );
    };
    void pollTray();
    const id = setInterval(() => void pollTray(), ccFlyout ? 750 : 4000);
    return () => {
      alive = false;
      stopSusp();
      clearInterval(id);
    };
  }, [Boolean(ccFlyout), isSecondary]);

  // Lightweight audio session sync for dock sound badges & right-click mute (paused when suspended)
  useEffect(() => {
    let alive = true;
    let paused = false;
    const stopSusp = dockBridge.onSuspended((s) => {
      paused = s;
    });
    const pollAudio = async () => {
      if (paused) return;
      const list = await dockBridge.getAudioSessions();
      if (!alive) return;
      setAudioSessions((prev) => {
        if (
          prev.length === list.length &&
          prev.every(
            (p, i) =>
              p.id === list[i].id &&
              p.active === list[i].active &&
              p.muted === list[i].muted &&
              p.isSystem === list[i].isSystem
          )
        ) {
          return prev;
        }
        return list;
      });
    };
    void pollAudio();
    const id = setInterval(() => void pollAudio(), 4500);
    return () => {
      alive = false;
      stopSusp();
      clearInterval(id);
    };
  }, []);

  // Poll background/tray running apps when the overflow chevron popover is open
  useEffect(() => {
    if (!overflowTray) return;
    let alive = true;
    const pollBg = async () => {
      const list = await dockBridge.getBackgroundApps();
      if (alive) setBackgroundApps(list);
    };
    void pollBg();
    const id = setInterval(() => void pollBg(), 3500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [overflowTray]);

  const lastHitRectsKeyRef = useRef('');

  // Report exact interactive regions (with generous hover halo) to Main process
  useLayoutEffect(() => {
    const reportHitRects = () => {
      waveCacheRef.current = null;
      const rects: Array<{ left: number; top: number; right: number; bottom: number }> = [];
      const barEl = dockBarRef.current;
      if (barEl) {
        const r = barEl.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          rects.push({
            left: Math.floor(r.left - 12),
            top: Math.floor(r.top - 14),
            right: Math.ceil(r.right + 12),
            bottom: Math.ceil(r.bottom + 24)
          });
        }
      }

      const pushOverlay = (el: HTMLElement | null) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          rects.push({
            left: Math.floor(r.left - 8),
            top: Math.floor(r.top - 8),
            right: Math.ceil(r.right + 8),
            bottom: Math.ceil(r.bottom + 14)
          });
        }
      };

      pushOverlay(folderPopoverRef.current);
      pushOverlay(ccFlyoutRef.current);
      pushOverlay(overflowPopoverRef.current);
      pushOverlay(ctxMenuRef.current);
      pushOverlay(peekRef.current);
      const popoverEl = document.querySelector<HTMLElement>('.popover-card');
      pushOverlay(popoverEl);

      const sig = rects.map((rc) => `${rc.left},${rc.top},${rc.right},${rc.bottom}`).join(';');
      if (sig === lastHitRectsKeyRef.current) return;
      lastHitRectsKeyRef.current = sig;
      dockBridge.setHitRects('dock', rects);
    };

    reportHitRects();
    // Overlays rise in with a transform; measure again once the animation has settled
    const settleTimer = window.setTimeout(reportHitRects, 220);
    const onAnimEnd = (e: AnimationEvent) => {
      if ((e.target as HTMLElement).matches?.('.window-peek, .folder-popover, .control-center-flyout, .tray-overflow-popover, .taskbar-ctx-menu, .popover-card')) {
        reportHitRects();
      }
    };
    document.addEventListener('animationend', onAnimEnd);
    window.addEventListener('resize', reportHitRects);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(reportHitRects) : null;
    if (ro) {
      if (dockBarRef.current) ro.observe(dockBarRef.current);
      if (folderPopoverRef.current) ro.observe(folderPopoverRef.current);
      if (ccFlyoutRef.current) ro.observe(ccFlyoutRef.current);
      if (overflowPopoverRef.current) ro.observe(overflowPopoverRef.current);
      if (ctxMenuRef.current) ro.observe(ctxMenuRef.current);
      if (peekRef.current) ro.observe(peekRef.current);
    }
    return () => {
      ro?.disconnect();
      window.clearTimeout(settleTimer);
      document.removeEventListener('animationend', onAnimEnd);
      window.removeEventListener('resize', reportHitRects);
    };
  }, [
    activePanel,
    activeFolderObj?.id,
    activeFolderObj?.children?.length,
    ccFlyout?.view,
    overflowTray,
    backgroundApps.length,
    ctxMenu,
    peek?.key,
    peek?.x,
    pinnedApps.length,
    runningWindows.length,
    settings.position,
    settings.compactMode,
    settings.musicPosition,
    settings.showOpenWindowsInBar
  ]);

  // Close context menu, Control Center flyout, overflow tray, or folder on Esc, blur, or click outside
  useEffect(() => {
    const dismissAll = () => {
      const ov = openOverlaysRef.current;
      const wasDragging = Boolean(dragCandidateRef.current?.active);
      if (ov.peek) {
        dockBridge.stopWindowPeek();
        dockBridge.clearLiveThumbs();
        setPeek(null);
      }
      if (ov.ctxMenu) setCtxMenu(null);
      if (ov.openFolder) setOpenFolder(null);
      if (ov.ccFlyout) setCcFlyout(null);
      if (ov.overflowTray) setOverflowTray(null);
      if (dragCandidateRef.current || dragSnapshotRef.current || liveDragRef.current) {
        dragCandidateRef.current = null;
        dragSnapshotRef.current = null;
        liveDragRef.current = null;
        if (wasDragging) dockBridge.setDockInteractive(false);
        setPointerDrag(null);
        setLiveDrag(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissAll();
    };
    const onBlur = () => dismissAll();
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const ov = openOverlaysRef.current;
      if (ov.ctxMenu && !target.closest('.taskbar-ctx-menu')) {
        if (e.button === 2) {
          ctxJustClosedRef.current = { key: ctxKeyOf(ov.ctxMenu), at: Date.now() };
        }
        setCtxMenu(null);
      }
      if (ov.peek && !target.closest('.window-peek') && !target.closest('.dock-app-btn')) {
        setPeek(null);
      }
      if (ov.openFolder && !target.closest('.folder-popover') && !target.closest('.dock-app-btn')) {
        // Blur first so an in-progress folder rename commits before the input unmounts
        (document.activeElement as HTMLElement | null)?.blur?.();
        setOpenFolder(null);
      }
      if (ov.ccFlyout && !target.closest('.control-center-flyout') && !target.closest('.cc-trigger-btn')) {
        setCcFlyout(null);
      }
      if (
        ov.overflowTray &&
        !target.closest('.tray-overflow-popover') &&
        !target.closest('.tray-overflow-btn') &&
        !target.closest('.taskbar-ctx-menu')
      ) {
        setOverflowTray(null);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    window.addEventListener('mousedown', onDocMouseDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('mousedown', onDocMouseDown);
    };
  }, []);

  // Imperative pointer-drag start: ZERO React state update until pointer moves >= 11px!
  const dragActionsRef = useRef<{
    pinnedApps: PinnedApp[];
    applyWaveAtClientX: (x: number | null) => void;
    executeLiveDrop: (
      payload: DragPayload,
      plan: LiveDragPlan,
      snapshot: DragSlotSnapshot | null
    ) => void;
    removeChildFromFolder: (folderId: string, childId: string, ejectToBar: boolean) => void;
    pinRunningApp: (win: RunningWindow) => void;
  } | null>(null);

  const beginPointerDrag = (payload: DragPayload, startX: number, startY: number) => {
    dragCandidateRef.current = {
      payload,
      startX,
      startY,
      x: startX,
      y: startY,
      active: false
    };
  };

  useEffect(() => {
    const captureSnapshot = (payload: DragPayload): DragSlotSnapshot | null => {
      const strip = stripRef.current;
      if (!strip) return null;
      const stripRect = strip.getBoundingClientRect();
      const appsList = dragActionsRef.current?.pinnedApps ?? [];
      const btns = Array.from(strip.querySelectorAll<HTMLButtonElement>('[data-pinned-id]'));

      // Clear any inline wave transform before measuring unshifted static slot centers
      btns.forEach((b) => {
        b.style.transform = '';
      });

      const slots = btns.map((btn) => {
        const r = btn.getBoundingClientRect();
        const id = btn.dataset.pinnedId!;
        const app = appsList.find((p) => p.id === id);
        return {
          id,
          x: r.left + r.width / 2,
          isGroup: app?.kind === 'group'
        };
      });

      const step = slots.length >= 2 ? Math.max(32, slots[1].x - slots[0].x) : 44;
      const origIndex =
        payload.kind === 'pinned' ? appsList.findIndex((p) => p.id === payload.item.id) : -1;

      return {
        stripTop: stripRect.top,
        stripBottom: stripRect.bottom,
        stripLeft: slots.length > 0 ? slots[0].x - step * 0.8 : stripRect.left,
        stripRight:
          slots.length > 0 ? slots[slots.length - 1].x + step * 1.1 : stripRect.right,
        step,
        origIndex,
        slots
      };
    };

    const computeLivePlan = (
      snap: DragSlotSnapshot | null,
      payload: DragPayload,
      clientX: number,
      clientY: number,
      prevPlan: LiveDragPlan | null
    ): LiveDragPlan => {
      if (!snap) return { gapIndex: null, mergeTargetId: null };
      const { slots, origIndex, step, stripTop, stripBottom, stripLeft, stripRight } = snap;
      const n = slots.length;

      const insideY = clientY >= stripTop - 38 && clientY <= stripBottom + 32;
      const insideX = clientX >= stripLeft - 24 && clientX <= stripRight + 24;
      if (!insideY || !insideX) {
        return {
          gapIndex: origIndex >= 0 ? origIndex : null,
          mergeTargetId: null
        };
      }

      if (n === 0) return { gapIndex: 0, mergeTargetId: null };

      const sourceIsGroup = payload.kind === 'pinned' && payload.item.kind === 'group';

      // Case 1: Reordering an existing pinned item live across N slots
      if (origIndex >= 0) {
        const curGap = prevPlan?.gapIndex ?? origIndex;
        const otherSlots = slots.filter((_, idx) => idx !== origIndex);

        // Find closest fixed slot index k in [0 .. n-1]
        let k = 0;
        let bestDist = Infinity;
        for (let i = 0; i < n; i++) {
          const d = Math.abs(clientX - slots[i].x);
          if (d < bestDist) {
            bestDist = d;
            k = i;
          }
        }

        if (k === curGap) {
          return { gapIndex: curGap, mergeTargetId: null };
        }

        // Visual occupant currently sitting at slot k under curGap ordering
        const occIdx = k < curGap ? k : k - 1;
        const occ = otherSlots[occIdx];
        if (!occ) return { gapIndex: k, mergeTargetId: null };

        const dx = clientX - slots[k].x;
        const canMerge = !sourceIsGroup;
        const mergeHalf = canMerge ? 10 : 0;

        if (curGap < k) {
          // Moving right into slot k
          if (k - curGap > 1 || dx > mergeHalf) {
            return { gapIndex: k, mergeTargetId: null };
          }
          if (canMerge && dx >= -11 && dx <= mergeHalf) {
            return { gapIndex: curGap, mergeTargetId: occ.id };
          }
          return prevPlan ?? { gapIndex: curGap, mergeTargetId: null };
        } else {
          // Moving left into slot k
          if (curGap - k > 1 || dx < -mergeHalf) {
            return { gapIndex: k, mergeTargetId: null };
          }
          if (canMerge && dx <= 11 && dx >= -mergeHalf) {
            return { gapIndex: curGap, mergeTargetId: occ.id };
          }
          return prevPlan ?? { gapIndex: curGap, mergeTargetId: null };
        }
      }

      // Case 2: Dragging folder child or unpinned running app into the pinned strip
      if (clientX < slots[0].x - step * 0.35) {
        return { gapIndex: 0, mergeTargetId: null };
      }
      if (clientX > slots[n - 1].x + step * 0.35) {
        return { gapIndex: n, mergeTargetId: null };
      }

      let k = 0;
      let bestDist = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.abs(clientX - slots[i].x);
        if (d < bestDist) {
          bestDist = d;
          k = i;
        }
      }
      const slot = slots[k];
      const canMerge = !(payload.kind === 'folder-child' && payload.folderId === slot.id);
      const dx = clientX - slot.x;
      if (canMerge && Math.abs(dx) <= 10) {
        return { gapIndex: null, mergeTargetId: slot.id };
      }
      return { gapIndex: dx >= 0 ? k + 1 : k, mergeTargetId: null };
    };

    const onMove = (e: PointerEvent) => {
      const candidate = dragCandidateRef.current;
      if (!candidate) return;

      const dx = e.clientX - candidate.startX;
      const dy = e.clientY - candidate.startY;
      const dist = Math.hypot(dx, dy);

      if (!candidate.active && dist < 11) return;

      if (!candidate.active) {
        candidate.active = true;
        candidate.x = e.clientX;
        candidate.y = e.clientY;
        setPeek(null);
        dockBridge.setDockInteractive(true);
        dragActionsRef.current?.applyWaveAtClientX(null);
        setTooltip(null);
        dragSnapshotRef.current = captureSnapshot(candidate.payload);
        const initialPlan: LiveDragPlan = {
          gapIndex:
            dragSnapshotRef.current && dragSnapshotRef.current.origIndex >= 0
              ? dragSnapshotRef.current.origIndex
              : null,
          mergeTargetId: null
        };
        liveDragRef.current = initialPlan;
        setLiveDrag(initialPlan);
        setPointerDrag({ ...candidate });
      } else {
        candidate.x = e.clientX;
        candidate.y = e.clientY;
        if (dragGhostRef.current) {
          dragGhostRef.current.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0) translate(-50%, -50%) scale(1.12)`;
        }
      }

      const prevPlan = liveDragRef.current;
      const nextPlan = computeLivePlan(
        dragSnapshotRef.current,
        candidate.payload,
        e.clientX,
        e.clientY,
        prevPlan
      );
      if (
        !prevPlan ||
        prevPlan.gapIndex !== nextPlan.gapIndex ||
        prevPlan.mergeTargetId !== nextPlan.mergeTargetId
      ) {
        liveDragRef.current = nextPlan;
        setLiveDrag(nextPlan);
      }
    };

    const onUp = (e: PointerEvent) => {
      const candidate = dragCandidateRef.current;
      if (!candidate) return;
      dragCandidateRef.current = null;

      if (candidate.active) {
        suppressNextClickRef.current = true;
        setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 80);

        const actions = dragActionsRef.current;
        const snap = dragSnapshotRef.current;
        const finalPlan =
          liveDragRef.current ??
          computeLivePlan(snap, candidate.payload, e.clientX, e.clientY, liveDragRef.current);

        dragSnapshotRef.current = null;
        liveDragRef.current = null;

        if (actions && (finalPlan.mergeTargetId || finalPlan.gapIndex !== null)) {
          setJustDropped(true);
          setTimeout(() => setJustDropped(false), 50);
          actions.executeLiveDrop(candidate.payload, finalPlan, snap);
        } else if (actions) {
          const barRect = dockBarRef.current?.getBoundingClientRect();
          const insideBar =
            barRect &&
            e.clientX >= barRect.left &&
            e.clientX <= barRect.right &&
            e.clientY >= barRect.top - 24 &&
            e.clientY <= barRect.bottom + 12;

          if (insideBar) {
            if (candidate.payload.kind === 'folder-child') {
              actions.removeChildFromFolder(
                candidate.payload.folderId,
                candidate.payload.item.id,
                true
              );
            } else if (candidate.payload.kind === 'running') {
              actions.pinRunningApp(candidate.payload.win);
            }
          }
        }
        dockBridge.setDockInteractive(false);
        setPointerDrag(null);
        setLiveDrag(null);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  // Invalidate cached button centers whenever dock items or strip layout inputs change
  useEffect(() => {
    waveCacheRef.current = null;
  }, [
    pinnedApps,
    runningWindows,
    settings.compactMode,
    settings.musicPosition,
    settings.showOpenWindowsInBar
  ]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const applyWaveAtClientX = (clientX: number | null) => {
    const strip = stripRef.current;
    if (!strip || runDragRef.current) return;

    if (
      clientX === null ||
      settings.dockMagnification === false ||
      dragCandidateRef.current?.active ||
      pointerDrag?.active
    ) {
      const cached = waveCacheRef.current?.items;
      if (cached) {
        for (let i = 0; i < cached.length; i++) {
          if (cached[i].btn.style.transform) cached[i].btn.style.transform = '';
        }
      } else {
        const buttons = strip.querySelectorAll<HTMLButtonElement>('.dock-app-btn');
        for (let i = 0; i < buttons.length; i++) {
          if (buttons[i].style.transform) buttons[i].style.transform = '';
        }
      }
      waveCacheRef.current = null;
      return;
    }

    // Measure all button centers in a single read pass (zero style writes interleaved)
    if (!waveCacheRef.current) {
      const buttons = strip.querySelectorAll<HTMLButtonElement>('.dock-app-btn');
      const items: Array<{ btn: HTMLButtonElement; centerX: number }> = [];
      for (let i = 0; i < buttons.length; i++) {
        const btn = buttons[i];
        const rect = btn.getBoundingClientRect();
        items.push({ btn, centerX: rect.left + rect.width / 2 });
      }
      waveCacheRef.current = { scrollLeft: strip.scrollLeft, items };
    }

    const cache = waveCacheRef.current;
    const scrollDelta = strip.scrollLeft - cache.scrollLeft;
    const dir = settings.position === 'top' ? 1 : -1;

    // Pure write pass: zero DOM queries or layout reads inside the loop
    for (let i = 0; i < cache.items.length; i++) {
      const { btn, centerX } = cache.items[i];
      const dist = Math.abs(clientX - (centerX - scrollDelta));
      if (dist > 170) {
        if (btn.style.transform) btn.style.transform = '';
        continue;
      }
      const influence = Math.exp(-(dist * dist) / (2 * 48 * 48));
      const scale = 1 + 0.28 * influence;
      const liftY = dir * 9 * influence;

      btn.style.transform = `translateY(${liftY.toFixed(1)}px) scale(${scale.toFixed(3)})`;
    }
  };

  useEffect(() => {
    if (settings.dockMagnification === false) {
      applyWaveAtClientX(null);
    }
  }, [settings.dockMagnification]);

  const handleStripMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (settings.dockMagnification === false) return;
    if (dragCandidateRef.current?.active || pointerDrag?.active) return;
    const x = e.clientX;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => applyWaveAtClientX(x));
  };

  const handleStripMouseLeave = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    applyWaveAtClientX(null);
    setTooltip(null);
  };

  // Too many apps even at the smallest icon size: the strip scrolls, so the wheel moves it
  const handleStripWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!dockBarRef.current?.hasAttribute('data-scroll')) return;
    e.currentTarget.scrollLeft += e.deltaY + e.deltaX;
  };

  const showTooltipFor = (e: React.MouseEvent<HTMLElement>, label: string) => {
    if (pointerDrag?.active || openFolder) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ label, x: rect.left + rect.width / 2 });
  };

  const timeStr = now.toLocaleTimeString(settings.language === 'ar' ? 'ar-EG' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit'
  });
  const dateStr = now.toLocaleDateString(settings.language === 'ar' ? 'ar-EG' : 'en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });

  const toggle = (panel: ActivePanel) => {
    closePeekNow();
    setCtxMenu(null);
    setOpenFolder(null);
    setCcFlyout(null);
    setOverflowTray(null);
    setTooltip(null);
    onTogglePanel(activePanel === panel ? null : panel);
  };

  const toggleControlCenter = (targetView: ControlCenterView = 'main', forceOpen = false) => {
    closePeekNow();
    setCtxMenu(null);
    setOpenFolder(null);
    setOverflowTray(null);
    setTooltip(null);
    if (ccFlyout && !forceOpen && ccFlyout.view === targetView) {
      setCcFlyout(null);
      return;
    }
    onTogglePanel(null);
    const rect = ccClusterRef.current?.getBoundingClientRect();
    const centerX = rect ? rect.left + rect.width / 2 : window.innerWidth - 200;
    setCcFlyout({ x: centerX, view: targetView });
  };

  // Warm the background-apps list while the pointer is still travelling to the arrow, so the
  // popover opens already filled instead of populating after the click
  const lastBgFetchRef = useRef(0);
  const prefetchBackgroundApps = () => {
    const now = Date.now();
    if (now - lastBgFetchRef.current < 2500) return;
    lastBgFetchRef.current = now;
    void dockBridge.getBackgroundApps().then(setBackgroundApps);
  };

  const toggleOverflowTray = () => {
    closePeekNow();
    setCtxMenu(null);
    setOpenFolder(null);
    setCcFlyout(null);
    setTooltip(null);
    setHoveredOverflowLabel(null);
    if (overflowTray) {
      setOverflowTray(null);
      return;
    }
    onTogglePanel(null);
    prefetchBackgroundApps();
    onRefreshWindows();
    const rect = overflowBtnRef.current?.getBoundingClientRect();
    const centerX = rect ? rect.left + rect.width / 2 : window.innerWidth - 320;
    setOverflowTray({ x: centerX });
  };

  const quickMedia = async (cmd: 'playPause' | 'next' | 'previous') => {
    await dockBridge.sendMediaCommand(cmd);
    setTimeout(onRefreshMedia, 250);
  };

  const allLeafPinnedApps: PinnedApp[] = [];
  const pinnedExeNames = new Set<string>();
  for (const p of pinnedApps) {
    if (p.kind === 'group' && p.children) {
      for (const c of p.children) {
        allLeafPinnedApps.push(c);
        if (c.exeName) pinnedExeNames.add(c.exeName.toLowerCase());
      }
    } else {
      allLeafPinnedApps.push(p);
      if (p.exeName) pinnedExeNames.add(p.exeName.toLowerCase());
    }
  }

  const windowsForPinned = (app: PinnedApp): RunningWindow[] => {
    if (app.kind === 'group') return [];
    const learned = learnedProcs[app.id];
    return runningWindows.filter((w) => pinnedMatchesWindow(app, w, learned));
  };

  const findWindowForPinned = (app: PinnedApp): RunningWindow | undefined => {
    const matches = windowsForPinned(app);
    return matches.find((w) => w.isActive) ?? matches[0];
  };

  const windowsForProcess = (processName?: string): RunningWindow[] => {
    if (!processName) return [];
    const target = processName.toLowerCase();
    return runningWindows.filter((w) => w.processName.toLowerCase() === target);
  };

  // Auto-learn the running process for launcher/.url shortcuts (e.g. Steam/Epic games)
  // when clicking the pinned icon spawns a brand-new unclaimed window shortly afterward.
  useEffect(() => {
    const pending = pendingLaunchRef.current;
    if (!pending) return;
    if (Date.now() - pending.at > 22_000) {
      pendingLaunchRef.current = null;
      return;
    }
    const freshUnclaimed = runningWindows.filter((w) => {
      const key = w.hwnd ?? `${w.pid}`;
      if (pending.baselineHwnds.has(key)) return false;
      return !allLeafPinnedApps.some(
        (p) => p.id !== pending.pinnedId && pinnedMatchesWindow(p, w, learnedProcs[p.id])
      );
    });
    if (freshUnclaimed.length === 0) return;

    const appTok = normalizeAppToken(pending.appName);
    const chosen =
      freshUnclaimed.find((w) => {
        if (appTok.length < 3) return false;
        const t = normalizeAppToken(`${w.displayName ?? ''} ${w.title} ${w.processName}`);
        return t.includes(appTok);
      }) ?? (freshUnclaimed.length === 1 && Date.now() - pending.at <= 14_000 ? freshUnclaimed[0] : undefined);

    if (!chosen) return;
    const proc = chosen.processName.toLowerCase();
    pendingLaunchRef.current = null;
    setLearnedProcs((prev) => {
      if (prev[pending.pinnedId] === proc) return prev;
      const next = { ...prev, [pending.pinnedId]: proc };
      try {
        window.localStorage.setItem(LEARNED_PROCS_KEY, JSON.stringify(next));
      } catch {
        // Best effort persistence
      }
      return next;
    });
  }, [runningWindows]);

  const launchOrWakePinned = async (app: PinnedApp) => {
    const woken = await dockBridge.wakeHiddenApp(
      learnedProcs[app.id] ?? app.exeName,
      app.installDir
    );
    if (woken) {
      setTimeout(onRefreshWindows, 120);
      return;
    }
    const exe = app.exeName?.toLowerCase();
    if (!app.appId && (!exe || GENERIC_LAUNCHER_EXES.has(exe))) {
      pendingLaunchRef.current = {
        pinnedId: app.id,
        appName: app.name,
        at: Date.now(),
        baselineHwnds: new Set(runningWindows.map((w) => w.hwnd ?? `${w.pid}`))
      };
    }
    await dockBridge.launchTarget(app.target);
  };

  const clearPeekTimers = () => {
    if (peekOpenTimerRef.current) window.clearTimeout(peekOpenTimerRef.current);
    if (peekCloseTimerRef.current) window.clearTimeout(peekCloseTimerRef.current);
    peekOpenTimerRef.current = null;
    peekCloseTimerRef.current = null;
  };

  function closePeekNow() {
    clearPeekTimers();
    dockBridge.stopWindowPeek();
    dockBridge.clearLiveThumbs();
    setPeek(null);
  }

  // Is the pointer travelling from the dock toward the open preview? Moving diagonally up to a
  // card crosses neighbouring icons, which must not steal the preview on the way.
  const isAimingAtPeek = (): boolean => {
    const el = peekRef.current;
    const trail = pointerTrailRef.current;
    if (!el || trail.length < 2) return false;
    const last = trail[trail.length - 1];
    const first = trail.find((p) => last.t - p.t <= 260) ?? trail[0];
    const dy = last.y - first.y;
    const towardPeek = settings.position === 'bottom' ? dy < -1 : dy > 1;
    if (!towardPeek) return false;
    const r = el.getBoundingClientRect();
    // Project the motion onto the preview's edge and accept it if it lands on (or near) it
    const edgeY = settings.position === 'bottom' ? r.bottom : r.top;
    const dx = last.x - first.x;
    const t = dy !== 0 ? (edgeY - last.y) / dy : 0;
    const hitX = last.x + dx * Math.max(0, t);
    return hitX >= r.left - 24 && hitX <= r.right + 24;
  };

  const openPeek = (key: string, el: HTMLElement, immediate = false) => {
    if (dragCandidateRef.current?.active || ctxMenu || activePanel || openFolder || ccFlyout || overflowTray) {
      clearPeekTimers();
      return;
    }
    const rect = el.getBoundingClientRect();
    const next = { key, x: rect.left + rect.width / 2 };
    if (immediate) {
      clearPeekTimers();
      setTooltip(null);
      setPeek(next);
      return;
    }
    if (peek) {
      if (peek.key === key) {
        clearPeekTimers();
        return;
      }
      // Resting on another icon switches to it after a short intent delay, like Windows. When
      // the pointer is only passing over it on the way up to the cards, wait much longer: it
      // will have left (cancelling this) or entered the preview long before.
      const delay = isAimingAtPeek() ? 520 : 160;
      // Still on the dock: the preview stays until the pointer leaves this icon too
      clearPeekTimers();
      const switchTo = () => {
        // Still heading for the cards: look again shortly instead of switching under the pointer
        if (isAimingAtPeek()) {
          peekOpenTimerRef.current = window.setTimeout(switchTo, 120);
          return;
        }
        peekOpenTimerRef.current = null;
        if (peekCloseTimerRef.current) window.clearTimeout(peekCloseTimerRef.current);
        peekCloseTimerRef.current = null;
        setTooltip(null);
        setPeek(next);
      };
      peekOpenTimerRef.current = window.setTimeout(switchTo, delay);
      return;
    }
    clearPeekTimers();
    peekOpenTimerRef.current = window.setTimeout(() => {
      peekOpenTimerRef.current = null;
      setTooltip(null);
      setPeek(next);
    }, 420);
  };

  const schedulePeekClose = () => {
    if (peekOpenTimerRef.current) window.clearTimeout(peekOpenTimerRef.current);
    peekOpenTimerRef.current = null;
    if (peekCloseTimerRef.current) window.clearTimeout(peekCloseTimerRef.current);
    peekCloseTimerRef.current = window.setTimeout(() => {
      peekCloseTimerRef.current = null;
      setPeek(null);
    }, 380);
  };

  // Pointer is on the preview: keep it, and drop any switch queued while crossing other icons
  const cancelPeekClose = () => {
    clearPeekTimers();
  };

  useEffect(() => () => clearPeekTimers(), []);

  // Recent pointer positions, only needed while a preview is open
  useEffect(() => {
    if (!peek) {
      pointerTrailRef.current = [];
      return;
    }
    const onMove = (e: MouseEvent) => {
      const now = performance.now();
      const trail = pointerTrailRef.current;
      trail.push({ x: e.clientX, y: e.clientY, t: now });
      while (trail.length > 2 && now - trail[0].t > 320) trail.shift();
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  }, [Boolean(peek)]);

  const findWindowForGroup = (children?: PinnedApp[]): RunningWindow | undefined => {
    if (!children) return undefined;
    for (const c of children) {
      const m = findWindowForPinned(c);
      if (m) return m;
    }
    return undefined;
  };

  const barWindows: RunningWindow[] = [];
  const seenProcs = new Set<string>();
  for (const w of runningWindows) {
    const procKey = w.processName.toLowerCase();
    const claimedByPinned = allLeafPinnedApps.some((p) =>
      pinnedMatchesWindow(p, w, learnedProcs[p.id])
    );
    if (claimedByPinned) continue;
    if (!seenProcs.has(procKey)) {
      seenProcs.add(procKey);
      barWindows.push(w);
    }
  }
  // Order the user gave open, unpinned apps by dragging them; new ones keep arrival order
  const orderOf = (w: RunningWindow) => {
    const i = runningLayout.order.indexOf(w.processName.toLowerCase());
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  // Flex `order` of an unpinned app: pinned app i sits at (i+1)*1000, so an app dropped after p
  // pinned apps lands just before pinned app p. Apps never moved stay after all pinned ones.
  const runningSlotOrder = (w: RunningWindow) => {
    const key = w.processName.toLowerCase();
    const anchor = Math.min(runningLayout.anchors[key] ?? pinnedApps.length, pinnedApps.length);
    return anchor * 1000 + 1 + Math.min(900, Math.max(0, runningLayout.order.indexOf(key)));
  };
  barWindows.sort((a, b) => {
    const d = orderOf(a) - orderOf(b);
    return d === 0 ? 0 : d < 0 ? -1 : 1;
  });

  // Drag an open, unpinned app anywhere along the strip, between pinned apps or other open ones.
  // It only moves: dragging never pins it (right-click > Pin to taskbar does that).
  const beginRunningDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const strip = stripRef.current;
    if (!strip) return;
    const btn = e.currentTarget;
    // Slots in on-screen order, because unpinned apps can sit between pinned ones
    const items = Array.from(strip.querySelectorAll<HTMLElement>('[data-pinned-id], [data-run-key]'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { el, center: r.left + r.width / 2, run: el.dataset.runKey ?? null };
      })
      .sort((x, y) => x.center - y.center);
    const from = items.findIndex((it) => it.el === btn);
    if (from === -1 || items.length < 2) return;
    const centers = items.map((it) => it.center);
    const step = Math.abs(from > 0 ? centers[from] - centers[from - 1] : centers[1] - centers[0]);
    const startX = e.clientX;
    const startY = e.clientY;
    let active = false;
    let to = from;

    const clearInline = () => {
      for (const it of items) {
        it.el.style.transform = '';
        it.el.style.transition = '';
        it.el.style.zIndex = '';
      }
      strip.classList.remove('is-run-dragging');
    };

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!active) {
        if (Math.hypot(dx, dy) < 11) return;
        active = true;
        runDragRef.current = true;
        closePeekNow();
        setTooltip(null);
        dockBridge.setDockInteractive(true);
        strip.classList.add('is-run-dragging');
      }
      const limit = step * 0.4;
      const minDx = centers[0] - centers[from] - limit;
      const maxDx = centers[centers.length - 1] - centers[from] + limit;
      const cdx = Math.max(minDx, Math.min(maxDx, dx));
      btn.style.transition = 'none';
      btn.style.zIndex = '8';
      btn.style.transform = `translateX(${cdx}px) scale(1.08)`;

      const dragCenter = centers[from] + cdx;
      let best = 0;
      for (let i = 1; i < centers.length; i += 1) {
        if (Math.abs(centers[i] - dragCenter) < Math.abs(centers[best] - dragCenter)) best = i;
      }
      to = best;
      items.forEach((it, i) => {
        if (i === from) return;
        let shift = 0;
        if (from < to && i > from && i <= to) shift = -step;
        else if (from > to && i >= to && i < from) shift = step;
        it.el.style.transform = shift ? `translateX(${shift}px)` : '';
      });
    };

    const finish = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      if (!active) return;
      runDragRef.current = false;
      suppressNextClickRef.current = true;
      setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 80);
      dockBridge.setDockInteractive(false);
      // Drop the inline offsets and reorder in the same frame so nothing visibly snaps back
      setJustDropped(true);
      setTimeout(() => setJustDropped(false), 50);
      clearInline();
      if (to === from) return;
      const next = items.slice();
      next.splice(to, 0, next.splice(from, 1)[0]);
      const anchors = { ...runningLayout.anchors };
      const runKeys: string[] = [];
      let pinnedBefore = 0;
      for (const it of next) {
        if (it.run === null) {
          pinnedBefore += 1;
        } else {
          anchors[it.run] = pinnedBefore;
          runKeys.push(it.run);
        }
      }
      const order = [...runKeys, ...runningLayout.order.filter((k) => !runKeys.includes(k))].slice(0, 60);
      const layout: RunningLayout = { order, anchors };
      setRunningLayout(layout);
      try {
        window.localStorage.setItem(RUNNING_ORDER_KEY, JSON.stringify(layout));
      } catch {
        // The order is a convenience only
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  const openContextMenu = (
    e: React.MouseEvent,
    payload: Omit<CtxMenuState, 'x'>,
    opts?: { preserveOverflow?: boolean; aboveTrigger?: boolean }
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const nextKey = ctxKeyOf(payload);
    const closed = ctxJustClosedRef.current;
    ctxJustClosedRef.current = null;
    if (closed && Date.now() - closed.at < 450 && (closed.key === nextKey || nextKey === 'tray')) {
      return;
    }
    if (ctxMenu && (ctxKeyOf(ctxMenu) === nextKey || nextKey === 'tray')) {
      setCtxMenu(null);
      return;
    }
    closePeekNow();
    setTooltip(null);
    setOpenFolder(null);
    setCcFlyout(null);
    if (!opts?.preserveOverflow) setOverflowTray(null);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const anchorX = rect.width > 240 ? e.clientX : rect.left;
    const menuWidth =
      payload.kind === 'network' || payload.kind === 'volume' || payload.kind === 'clock'
        ? 256
        : 196;
    const clampedX = Math.max(8, Math.min(window.innerWidth - menuWidth, anchorX));
    const anchorOffset = opts?.aboveTrigger
      ? settings.position === 'bottom'
        ? Math.min(350, Math.max(65, Math.round(window.innerHeight - rect.top + 6)))
        : Math.min(350, Math.max(65, Math.round(rect.bottom + 6)))
      : undefined;
    setCtxMenu({ ...payload, x: clampedX, anchorOffset });
    if (payload.kind === 'pinned' || payload.kind === 'running' || payload.kind === 'bg') {
      void dockBridge.getAudioSessions().then(setAudioSessions);
    }
  };

  const winToPinned = (win: RunningWindow): PinnedApp | null => {
    const target = win.aumid ? `shell:AppsFolder\\${win.aumid}` : win.executablePath;
    if (!target) return null;
    if (!win.aumid && win.processName.toLowerCase() === 'applicationframehost') return null;
    return {
      id: `pin-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name: win.displayName || win.processName,
      target,
      kind: 'app',
      icon: 'app',
      color: '#4CB3F0',
      iconDataUrl: win.iconDataUrl,
      exeName: win.processName.toLowerCase(),
      appId: (win.appId || win.aumid)?.toLowerCase()
    };
  };

  const pinRunningApp = (win: RunningWindow) => {
    const next = winToPinned(win);
    if (!next) return;
    if (pinnedExeNames.has(win.processName.toLowerCase())) return;
    onSavePinnedApps([...pinnedApps, next]);
  };

  const pinBackgroundApp = (bg: BackgroundApp) => {
    const target = bg.aumid ? `shell:AppsFolder\\${bg.aumid}` : bg.executablePath;
    if (!target || pinnedExeNames.has(bg.processName.toLowerCase())) return;
    const next: PinnedApp = {
      id: `pin-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name: bg.displayName || bg.processName,
      target,
      kind: 'app',
      icon: 'app',
      color: '#4CB3F0',
      iconDataUrl: bg.iconDataUrl,
      exeName: bg.processName.toLowerCase(),
      appId: bg.aumid?.toLowerCase()
    };
    onSavePinnedApps([...pinnedApps, next]);
  };

  // Real Windows system tray icons (matching Windows 11's hidden-icons overflow)
  const overflowBgApps = backgroundApps;
  const overflowTotalCount = overflowBgApps.length;

  const movePinned = (index: number, delta: -1 | 1) => {
    const targetIdx = index + delta;
    if (targetIdx < 0 || targetIdx >= pinnedApps.length) return;
    const copy = [...pinnedApps];
    const [item] = copy.splice(index, 1);
    copy.splice(targetIdx, 0, item);
    onSavePinnedApps(copy);
  };

  const normalizeAppsList = (list: PinnedApp[]): PinnedApp[] =>
    list.flatMap((item) => {
      if (item.kind !== 'group') return [item];
      const kids = item.children ?? [];
      if (kids.length === 0) return [];
      if (kids.length === 1) return [kids[0]];
      return [{ ...item, children: kids }];
    });

  const removeChildFromFolder = (folderId: string, childId: string, ejectToBar: boolean) => {
    const folder = pinnedApps.find((p) => p.id === folderId);
    const child = folder?.children?.find((c) => c.id === childId);
    if (!folder || !child) return;

    const updated = pinnedApps.map((p) =>
      p.id === folderId ? { ...p, children: (p.children ?? []).filter((c) => c.id !== childId) } : p
    );
    const normalized = normalizeAppsList(updated);
    if (ejectToBar) {
      const folderIdx = normalized.findIndex((p) => p.id === folderId);
      const insertAt = folderIdx === -1 ? normalized.length : folderIdx + 1;
      normalized.splice(insertAt, 0, child);
    }
    // Keep folder open if it still exists with >= 2 items, otherwise close
    if (!normalized.some((p) => p.id === folderId && p.kind === 'group')) {
      setOpenFolder(null);
    }
    onSavePinnedApps(normalized);
  };

  const executePinnedDrop = (
    payload: DragPayload,
    targetId: string,
    zone: 'before' | 'after' | 'merge'
  ) => {
    let incoming: PinnedApp | null = null;
    let working = [...pinnedApps];

    if (payload.kind === 'pinned') {
      if (payload.item.id === targetId) return;
      const idx = working.findIndex((p) => p.id === payload.item.id);
      if (idx === -1) return;
      incoming = working[idx];
      working.splice(idx, 1);
    } else if (payload.kind === 'folder-child') {
      if (payload.folderId === targetId && zone === 'merge') return;
      incoming = payload.item;
      working = working.map((p) =>
        p.id === payload.folderId
          ? { ...p, children: (p.children ?? []).filter((c) => c.id !== payload.item.id) }
          : p
      );
      working = normalizeAppsList(working);
      if (!working.some((p) => p.id === payload.folderId && p.kind === 'group')) {
        setOpenFolder(null);
      }
    } else if (payload.kind === 'running') {
      incoming = winToPinned(payload.win);
    }

    if (!incoming) return;

    const targetIdx = working.findIndex((p) => p.id === targetId);
    if (targetIdx === -1) {
      onSavePinnedApps([...working, incoming]);
      return;
    }

    const targetItem = working[targetIdx];

    if (zone === 'merge' && incoming.kind !== 'group') {
      if (targetItem.kind === 'group') {
        working[targetIdx] = {
          ...targetItem,
          children: [...(targetItem.children ?? []), incoming]
        };
      } else {
        working[targetIdx] = {
          id: `grp-${Date.now()}`,
          name: settings.language === 'ar' ? 'مجلد' : 'Apps',
          target: '',
          kind: 'group',
          icon: 'folder',
          color: '#4CB3F0',
          children: [targetItem, incoming]
        };
      }
      onSavePinnedApps(normalizeAppsList(working));
      return;
    }

    const insertIdx = zone === 'after' ? targetIdx + 1 : targetIdx;
    working.splice(insertIdx, 0, incoming);
    onSavePinnedApps(normalizeAppsList(working));
  };

  const executeLiveDrop = (
    payload: DragPayload,
    plan: LiveDragPlan,
    snapshot: DragSlotSnapshot | null
  ) => {
    if (plan.mergeTargetId) {
      executePinnedDrop(payload, plan.mergeTargetId, 'merge');
      return;
    }
    if (plan.gapIndex === null) return;

    let working = [...pinnedApps];
    if (payload.kind === 'pinned') {
      const origIdx = snapshot?.origIndex ?? working.findIndex((p) => p.id === payload.item.id);
      if (origIdx === -1 || origIdx === plan.gapIndex) return;
      const [moved] = working.splice(origIdx, 1);
      const bounded = Math.max(0, Math.min(working.length, plan.gapIndex));
      working.splice(bounded, 0, moved);
      onSavePinnedApps(normalizeAppsList(working));
      return;
    }

    if (payload.kind === 'folder-child') {
      working = working.map((p) =>
        p.id === payload.folderId
          ? { ...p, children: (p.children ?? []).filter((c) => c.id !== payload.item.id) }
          : p
      );
      working = normalizeAppsList(working);
      if (!working.some((p) => p.id === payload.folderId && p.kind === 'group')) {
        setOpenFolder(null);
      }
      const bounded = Math.max(0, Math.min(working.length, plan.gapIndex));
      working.splice(bounded, 0, payload.item);
      onSavePinnedApps(working);
      return;
    }

    if (payload.kind === 'running') {
      const incoming = winToPinned(payload.win);
      if (!incoming) return;
      const bounded = Math.max(0, Math.min(working.length, plan.gapIndex));
      working.splice(bounded, 0, incoming);
      onSavePinnedApps(working);
    }
  };

  dragActionsRef.current = {
    pinnedApps,
    applyWaveAtClientX,
    executeLiveDrop,
    removeChildFromFolder,
    pinRunningApp
  };

  const handleExternalDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverExternal(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const added: PinnedApp[] = [];
    for (const file of files) {
      const filePath = dockBridge.getPathForFile(file);
      if (!filePath) continue;
      if (pinnedApps.some((p) => p.target.toLowerCase() === filePath.toLowerCase())) continue;
      const app = await dockBridge.createPinnedFromPath(filePath);
      if (app) added.push(app);
    }
    if (added.length > 0) {
      onSavePinnedApps([...pinnedApps, ...added]);
    }
  };

  const findAudioSessionForProc = (procName?: string | null): AudioAppSession | undefined => {
    if (!procName) return undefined;
    const key = procName.replace(/\.exe$/i, '').toLowerCase();
    if (!key) return undefined;
    return audioSessions.find((s) => !s.isSystem && s.id.toLowerCase() === key);
  };

  const findAudioSessionForPinned = (
    app: PinnedApp,
    matchedWin?: RunningWindow
  ): AudioAppSession | undefined => {
    if (app.kind === 'group') return undefined;
    return (
      findAudioSessionForProc(matchedWin?.processName) ??
      findAudioSessionForProc(app.exeName) ??
      findAudioSessionForProc(learnedProcs[app.id])
    );
  };

  const toggleAppAudioMute = (sessionId: string) => {
    setAudioSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, muted: !s.muted } : s))
    );
    void dockBridge.toggleAudioSessionMute(sessionId);
  };

  const renderAppThumb = (app: PinnedApp, size = 21) => {
    if (app.iconDataUrl) {
      return (
        <img
          className="app-icon-img"
          src={app.iconDataUrl}
          alt={app.name}
          draggable={false}
          style={{ width: size, height: size }}
        />
      );
    }
    return <AppIconGlyph name={app.icon} color={app.color} size={Math.max(14, size - 4)} />;
  };

  // Resolved live from runningWindows so cards appear/disappear as windows open and close
  let peekData: { windows: RunningWindow[]; name: string; iconUrl?: string } | null = null;
  if (peek) {
    if (peek.key.startsWith('pin:')) {
      const app = pinnedApps.find((p) => p.id === peek.key.slice(4));
      if (app && app.kind !== 'group') {
        peekData = { windows: windowsForPinned(app), name: app.name, iconUrl: app.iconDataUrl };
      }
    } else {
      const wins = windowsForProcess(peek.key.slice(5));
      peekData = { windows: wins, name: wins[0]?.processName ?? '', iconUrl: wins[0]?.iconDataUrl };
    }
    if (peekData && peekData.windows.length === 0) peekData = null;
  }

  return (
    <>
      {pointerDrag?.active && (
        <div
          ref={dragGhostRef}
          className="drag-ghost"
          style={{
            transform: `translate3d(${pointerDrag.x}px, ${pointerDrag.y}px, 0) translate(-50%, -50%) scale(1.12)`
          }}
        >
          {renderAppThumb(pointerDrag.payload.item, 22)}
        </div>
      )}

      {tooltip &&
        !peek &&
        !ctxMenu &&
        !activePanel &&
        !activeFolderObj &&
        !overflowTray &&
        !ccFlyout &&
        !pointerDrag?.active && (
        <div
          className="dock-tooltip"
          style={{
            left: Math.max(76, Math.min(window.innerWidth - 76, tooltip.x)),
            ...(settings.position === 'bottom' ? { bottom: 68 } : { top: 68 })
          }}
        >
          {tooltip.label}
        </div>
      )}

      {peekData && peek && (
        <WindowPeek
          ref={peekRef}
          windows={peekData.windows}
          appName={peekData.name}
          appIconUrl={peekData.iconUrl}
          media={media}
          x={peek.x}
          position={settings.position}
          lang={settings.language}
          onMouseEnter={cancelPeekClose}
          onMouseLeave={schedulePeekClose}
          onRefreshMedia={onRefreshMedia}
          onActivate={(win) => {
            // Dispatch FOCUS *before* unmounting WindowPeek so FOCUS reaches Win32Bridge first
            // (ActivateWindow already clears live peek & thumbs synchronously in one shot).
            void dockBridge.activateWindow(win.pid, win.hwnd).then((ok) => {
              setTimeout(onRefreshWindows, 80);
              if (!ok) void dockBridge.openApp(win.pid, win.executablePath);
            });
            clearPeekTimers();
            setPeek(null);
          }}
          onCloseWindow={(win) => {
            if (!win.hwnd) return;
            void dockBridge.closeWindow(win.hwnd).then(() => {
              setTimeout(onRefreshWindows, 150);
              setTimeout(onRefreshWindows, 500);
            });
          }}
        />
      )}

      {/* Open Taskbar Folder Popover */}
      {activeFolderObj && openFolder && (
        <div
          ref={folderPopoverRef}
          className="folder-popover"
          style={{
            left: Math.round(Math.max(12, Math.min(window.innerWidth - 280, openFolder.x - 134))),
            ...(settings.position === 'bottom' ? { bottom: 65 } : { top: 65 })
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <input
            className="folder-title-input"
            dir="auto"
            value={folderNameDraft ?? activeFolderObj.name}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => setFolderNameDraft(e.target.value)}
            onFocus={() => void dockBridge.setPopoverOpen(true)}
            onBlur={() => {
              commitFolderName();
              // Focusing the input pinned the window interactive; release it so the transparent
              // canvas around the dock goes back to click-through
              if (!activePanel) void dockBridge.setPopoverOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            title={settings.language === 'ar' ? 'اضغط لإعادة التسمية' : 'Click to rename folder'}
          />

          <div className="folder-apps-grid">
            {(activeFolderObj.children ?? []).map((child) => {
              const matchedWin = findWindowForPinned(child);
              return (
                <div
                  key={child.id}
                  className="folder-app-tile"
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    if ((e.target as HTMLElement).closest('.folder-app-eject')) return;
                    beginPointerDrag(
                      { kind: 'folder-child', folderId: activeFolderObj.id, item: child },
                      e.clientX,
                      e.clientY
                    );
                  }}
                  onClick={(e) => {
                    if (suppressNextClickRef.current) return;
                    e.stopPropagation();
                    setOpenFolder(null);
                    if (matchedWin && !e.shiftKey) {
                      void dockBridge.focusWindow(matchedWin.pid, matchedWin.hwnd).then((ok) => {
                        setTimeout(onRefreshWindows, 120);
                        if (!ok) void launchOrWakePinned(child);
                      });
                    } else if (e.shiftKey) {
                      void dockBridge.launchTarget(child.target);
                    } else {
                      void launchOrWakePinned(child);
                    }
                  }}
                >
                  <button
                    type="button"
                    className="folder-app-eject"
                    title="Move back to taskbar"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeChildFromFolder(activeFolderObj.id, child.id, true);
                    }}
                  >
                    <X size={10} />
                  </button>
                  {renderAppThumb(child, 28)}
                  <span className="folder-app-tile-label">{child.name}</span>
                  {matchedWin && (
                    <span
                      className={`running-dot ${
                        matchedWin.isActive ? 'active' : matchedWin.isMinimized ? 'minimized' : ''
                      }`}
                      style={{ bottom: 2 }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Glassy Quick Settings / Control Center Flyout */}
      {ccFlyout && (
        <ControlCenterFlyout
          ref={ccFlyoutRef}
          x={ccFlyout.x}
          position={settings.position}
          lang={settings.language}
          view={ccFlyout.view}
          onChangeView={(nextView) =>
            setCcFlyout((prev) => (prev ? { ...prev, view: nextView } : null))
          }
          netInfo={netInfo}
          trayVol={trayVol}
          onVolumeChange={(v) => {
            volLockUntilRef.current = Date.now() + 900;
            setTrayVol(v);
          }}
          onVolumeDragChange={(dragging) => {
            volDraggingRef.current = dragging;
            if (!dragging) volLockUntilRef.current = Date.now() + 900;
          }}
          stats={stats}
          kbdLang={kbdLang}
          onSwitchKbdLang={onSwitchKbdLang}
          onOpenPanel={toggle}
          onClose={() => setCcFlyout(null)}
        />
      )}

      {/* Hidden / Running Apps Tray Overflow Popover */}
      {overflowTray && (
        <div
          ref={overflowPopoverRef}
          className="tray-overflow-popover"
          style={{
            left: Math.round(Math.max(12, Math.min(window.innerWidth - 256, overflowTray.x - 116))),
            ...(settings.position === 'bottom' ? { bottom: 65 } : { top: 65 })
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <div className="tray-overflow-header">
            <span className="tray-overflow-title">
              {settings.language === 'ar' ? 'الأيقونات المخفية' : 'Hidden icons'}
            </span>
            <span className="tray-overflow-count tabular">{overflowTotalCount}</span>
          </div>

          {overflowTotalCount === 0 ? (
            <div className="tray-overflow-empty">
              {settings.language === 'ar' ? 'لا توجد أيقونات مخفية' : 'No hidden tray icons'}
            </div>
          ) : (
            <div className="tray-overflow-grid">
              {overflowBgApps.map((bg) => {
                const bgExeLow = bg.executablePath.toLowerCase();
                const bgProcLow = bg.processName.toLowerCase();
                const openWin = runningWindows.find(
                  (w) =>
                    (w.executablePath && w.executablePath.toLowerCase() === bgExeLow) ||
                    w.processName.toLowerCase() === bgProcLow
                );
                const isOpen = Boolean(openWin);
                return (
                  <button
                    key={`ov-bg-${bg.pid}`}
                    type="button"
                    className="tray-overflow-tile"
                    aria-label={bg.displayName || bg.processName}
                    onMouseEnter={() => setHoveredOverflowLabel(bg.displayName || bg.processName)}
                    onMouseLeave={() => setHoveredOverflowLabel(null)}
                    onClick={() => {
                      setCtxMenu(null);
                      setOverflowTray(null);
                      if (openWin?.hwnd) {
                        void dockBridge.activateWindow(openWin.pid, openWin.hwnd).then(() => {
                          setTimeout(onRefreshWindows, 140);
                        });
                      } else {
                        void dockBridge.openApp(bg.pid, bg.executablePath).then(() => {
                          setTimeout(onRefreshWindows, 260);
                        });
                      }
                    }}
                    onContextMenu={(e) =>
                      openContextMenu(
                        e,
                        { kind: 'bg', bg },
                        { preserveOverflow: true, aboveTrigger: true }
                      )
                    }
                  >
                    {bg.iconDataUrl ? (
                      <img
                        className="app-icon-img"
                        src={bg.iconDataUrl}
                        alt={bg.displayName}
                        draggable={false}
                        style={{ width: 20, height: 20 }}
                      />
                    ) : (
                      <AppIconGlyph name="app" color="var(--text-muted)" size={17} />
                    )}
                    <span
                      className={`tray-overflow-dot ${isOpen ? 'window' : 'bg'}`}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>
          )}

          <div className="tray-overflow-caption">
            {hoveredOverflowLabel ??
              (settings.language === 'ar'
                ? 'اضغط للفتح · كلك يمين للخيارات'
                : 'Click to open · Right-click for options')}
          </div>
        </div>
      )}

      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="taskbar-ctx-menu"
          style={{
            left: ctxMenu.x,
            ...(settings.position === 'bottom'
              ? { bottom: ctxMenu.anchorOffset ?? 65 }
              : { top: ctxMenu.anchorOffset ?? 65 })
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {ctxMenu.kind === 'tray' && (
            <>
              <button
                className="taskbar-ctx-item"
                onClick={() => {
                  setCtxMenu(null);
                  void dockBridge.systemAction('taskmgr');
                }}
              >
                <Activity size={14} style={{ color: 'var(--accent)' }} />
                <span>{settings.language === 'ar' ? 'مدير المهام' : 'Task Manager'}</span>
              </button>
              {!isSecondary && (
                <button
                  className="taskbar-ctx-item"
                  onClick={() => {
                    setCtxMenu(null);
                    toggle('settings');
                  }}
                >
                  <SettingsIcon />
                  <span>{settings.language === 'ar' ? 'إعدادات الشريط' : 'Taskbar settings'}</span>
                </button>
              )}
            </>
          )}
          {ctxMenu.kind === 'network' && (
            <>
              <button
                className="taskbar-ctx-item"
                onClick={() => {
                  setCtxMenu(null);
                  void dockBridge.systemAction('network-troubleshoot');
                }}
              >
                <Wrench size={14} />
                <span>
                  {settings.language === 'ar' ? 'تشخيص مشاكل الشبكة' : 'Diagnose network problems'}
                </span>
              </button>
              <button
                className="taskbar-ctx-item"
                onClick={() => {
                  setCtxMenu(null);
                  void dockBridge.systemAction('network-speedtest');
                }}
              >
                <Gauge size={14} />
                <span>
                  {settings.language === 'ar' ? 'اختبار سرعة الإنترنت' : 'Perform speed test'}
                </span>
              </button>
              <button
                className="taskbar-ctx-item"
                onClick={() => {
                  setCtxMenu(null);
                  void dockBridge.systemAction('network-settings');
                }}
              >
                <SettingsIcon />
                <span>
                  {settings.language === 'ar'
                    ? 'إعدادات الشبكة والإنترنت'
                    : 'Network and Internet settings'}
                </span>
              </button>
            </>
          )}
          {ctxMenu.kind === 'volume' && (
            <>
              <button
                className="taskbar-ctx-item"
                onClick={() => {
                  setCtxMenu(null);
                  void dockBridge.systemAction('sound-troubleshoot');
                }}
              >
                <Wrench size={14} />
                <span>
                  {settings.language === 'ar'
                    ? 'استكشاف مشاكل الصوت وإصلاحها'
                    : 'Troubleshoot sound problems'}
                </span>
              </button>
              <button
                className="taskbar-ctx-item"
                onClick={() => {
                  setCtxMenu(null);
                  toggleControlCenter('audio', true);
                }}
              >
                <SlidersHorizontal size={14} style={{ color: 'var(--accent)' }} />
                <span>
                  {settings.language === 'ar' ? 'فتح مازج الصوت' : 'Open volume mixer'}
                </span>
              </button>
              <button
                className="taskbar-ctx-item"
                onClick={() => {
                  setCtxMenu(null);
                  void dockBridge.systemAction('sound-settings');
                }}
              >
                <SettingsIcon />
                <span>{settings.language === 'ar' ? 'إعدادات الصوت' : 'Sound settings'}</span>
              </button>
            </>
          )}
          {ctxMenu.kind === 'clock' && (
            <>
              <button
                className="taskbar-ctx-item"
                onClick={() => {
                  setCtxMenu(null);
                  void dockBridge.systemAction('date-time-settings');
                }}
              >
                <Clock size={14} />
                <span>
                  {settings.language === 'ar' ? 'ضبط التاريخ والوقت' : 'Adjust date and time'}
                </span>
              </button>
              <button
                className="taskbar-ctx-item"
                onClick={() => {
                  setCtxMenu(null);
                  void dockBridge.systemAction('notifications-settings');
                }}
              >
                <Bell size={14} />
                <span>
                  {settings.language === 'ar' ? 'إعدادات الإشعارات' : 'Notifications settings'}
                </span>
              </button>
            </>
          )}
          {ctxMenu.kind === 'running' && ctxMenu.running && (
            <>
              <button
                className="taskbar-ctx-item"
                onClick={() => {
                  const targetWin = ctxMenu.running!;
                  setCtxMenu(null);
                  setOverflowTray(null);
                  void dockBridge.openApp(targetWin.pid, targetWin.executablePath).then(() => {
                    setTimeout(onRefreshWindows, 120);
                  });
                }}
              >
                <Zap size={14} style={{ color: 'var(--accent)' }} />
                <span>{settings.language === 'ar' ? 'فتح / إظهار' : 'Open / Focus'}</span>
              </button>
              {(ctxMenu.running.aumid || ctxMenu.running.executablePath) &&
                !pinnedExeNames.has(ctxMenu.running.processName.toLowerCase()) && (
                  <button
                    className="taskbar-ctx-item"
                    onClick={() => {
                      pinRunningApp(ctxMenu.running!);
                      setCtxMenu(null);
                    }}
                  >
                    <Pin size={14} style={{ color: 'var(--accent)' }} />
                    <span>{settings.language === 'ar' ? 'تثبيت في الشريط' : 'Pin to taskbar'}</span>
                  </button>
                )}
              {(ctxMenu.running.aumid || ctxMenu.running.executablePath) && (
                <button
                  className="taskbar-ctx-item"
                  onClick={() => {
                    const r = ctxMenu.running!;
                    const target = r.aumid ? `shell:AppsFolder\\${r.aumid}` : r.executablePath!;
                    void dockBridge.launchTarget(target);
                    setCtxMenu(null);
                    setOverflowTray(null);
                  }}
                >
                  <ExternalLink size={14} />
                  <span>{settings.language === 'ar' ? 'فتح نافذة جديدة' : 'Open new window'}</span>
                </button>
              )}
              {(() => {
                const sess = findAudioSessionForProc(ctxMenu.running!.processName);
                if (!sess) return null;
                return (
                  <button
                    className="taskbar-ctx-item"
                    onClick={() => {
                      toggleAppAudioMute(sess.id);
                      setCtxMenu(null);
                    }}
                  >
                    {sess.muted ? <Volume2 size={14} style={{ color: 'var(--accent)' }} /> : <VolumeX size={14} />}
                    <span>
                      {sess.muted
                        ? settings.language === 'ar'
                          ? 'إلغاء كتم التطبيق'
                          : 'Unmute app'
                        : settings.language === 'ar'
                          ? 'كتم التطبيق'
                          : 'Mute app'}
                    </span>
                  </button>
                );
              })()}
              {ctxMenu.running.hwnd && (
                <button
                  className="taskbar-ctx-item"
                  onClick={() => {
                    const hwnd = ctxMenu.running!.hwnd!;
                    setCtxMenu(null);
                    void dockBridge.closeWindow(hwnd).then(() => {
                      setTimeout(() => {
                        onRefreshWindows();
                        void dockBridge.getBackgroundApps().then(setBackgroundApps);
                      }, 120);
                      setTimeout(() => {
                        onRefreshWindows();
                        void dockBridge.getBackgroundApps().then(setBackgroundApps);
                      }, 460);
                    });
                  }}
                >
                  <X size={14} />
                  <span>{settings.language === 'ar' ? 'إغلاق النافذة' : 'Close window'}</span>
                </button>
              )}
              <button
                className="taskbar-ctx-item danger"
                onClick={() => {
                  const { pid, executablePath } = ctxMenu.running!;
                  setCtxMenu(null);
                  void dockBridge.quitProcess(pid, executablePath).then(() => {
                    onRefreshWindows();
                    void dockBridge.getBackgroundApps().then(setBackgroundApps);
                  });
                }}
              >
                <X size={14} />
                <span>{settings.language === 'ar' ? 'إغلاق نهائي (إنهاء المهمة)' : 'End task (Force close)'}</span>
              </button>
            </>
          )}

          {ctxMenu.kind === 'bg' && ctxMenu.bg && (
            <>
              <button
                className="taskbar-ctx-item"
                onClick={() => {
                  const targetBg = ctxMenu.bg!;
                  setCtxMenu(null);
                  setOverflowTray(null);
                  const bgExeLow = targetBg.executablePath.toLowerCase();
                  const bgProcLow = targetBg.processName.toLowerCase();
                  const openWin = runningWindows.find(
                    (w) =>
                      (w.executablePath && w.executablePath.toLowerCase() === bgExeLow) ||
                      w.processName.toLowerCase() === bgProcLow
                  );
                  if (openWin?.hwnd) {
                    void dockBridge.activateWindow(openWin.pid, openWin.hwnd).then(() => {
                      setTimeout(onRefreshWindows, 140);
                    });
                  } else {
                    void dockBridge.openApp(targetBg.pid, targetBg.executablePath).then(() => {
                      setTimeout(onRefreshWindows, 260);
                    });
                  }
                }}
              >
                <ExternalLink size={14} style={{ color: 'var(--accent)' }} />
                <span>{settings.language === 'ar' ? 'فتح' : 'Open'}</span>
              </button>
              {!pinnedExeNames.has(ctxMenu.bg.processName.toLowerCase()) && (
                <button
                  className="taskbar-ctx-item"
                  onClick={() => {
                    pinBackgroundApp(ctxMenu.bg!);
                    setCtxMenu(null);
                  }}
                >
                  <Pin size={14} />
                  <span>{settings.language === 'ar' ? 'تثبيت في الشريط' : 'Pin to taskbar'}</span>
                </button>
              )}
              {(() => {
                const sess = findAudioSessionForProc(ctxMenu.bg!.processName);
                if (!sess) return null;
                return (
                  <button
                    className="taskbar-ctx-item"
                    onClick={() => {
                      toggleAppAudioMute(sess.id);
                      setCtxMenu(null);
                    }}
                  >
                    {sess.muted ? <Volume2 size={14} style={{ color: 'var(--accent)' }} /> : <VolumeX size={14} />}
                    <span>
                      {sess.muted
                        ? settings.language === 'ar'
                          ? 'إلغاء كتم التطبيق'
                          : 'Unmute app'
                        : settings.language === 'ar'
                          ? 'كتم التطبيق'
                          : 'Mute app'}
                    </span>
                  </button>
                );
              })()}
              <button
                className="taskbar-ctx-item danger"
                onClick={() => {
                  const { pid, executablePath } = ctxMenu.bg!;
                  setCtxMenu(null);
                  void dockBridge.quitProcess(pid, executablePath).then(() => {
                    onRefreshWindows();
                    void dockBridge.getBackgroundApps().then(setBackgroundApps);
                  });
                }}
              >
                <X size={14} />
                <span>{settings.language === 'ar' ? 'إغلاق نهائي (إنهاء المهمة)' : 'End task (Close app)'}</span>
              </button>
            </>
          )}

          {ctxMenu.kind === 'pinned' && ctxMenu.pinned && ctxMenu.pinnedIndex !== undefined && (
            <>
              {ctxMenu.pinned.kind === 'group' ? (
                <button
                  className="taskbar-ctx-item"
                  onClick={() => {
                    const kids = ctxMenu.pinned!.children ?? [];
                    const copy = [...pinnedApps];
                    copy.splice(ctxMenu.pinnedIndex!, 1, ...kids);
                    onSavePinnedApps(copy);
                    setCtxMenu(null);
                  }}
                >
                  <FolderOpen size={14} />
                  <span>{settings.language === 'ar' ? 'فك المجلد' : 'Ungroup folder'}</span>
                </button>
              ) : (
                <button
                  className="taskbar-ctx-item"
                  onClick={() => {
                    void dockBridge.launchTarget(ctxMenu.pinned!.target);
                    setCtxMenu(null);
                  }}
                >
                  <ExternalLink size={14} />
                  <span>{settings.language === 'ar' ? 'فتح نافذة جديدة' : 'Open new window'}</span>
                </button>
              )}

              {ctxMenu.pinned.kind !== 'group' && (() => {
                const matched = findWindowForPinned(ctxMenu.pinned!);
                const sess = findAudioSessionForPinned(ctxMenu.pinned!, matched);
                if (!sess) return null;
                return (
                  <button
                    className="taskbar-ctx-item"
                    onClick={() => {
                      toggleAppAudioMute(sess.id);
                      setCtxMenu(null);
                    }}
                  >
                    {sess.muted ? <Volume2 size={14} style={{ color: 'var(--accent)' }} /> : <VolumeX size={14} />}
                    <span>
                      {sess.muted
                        ? settings.language === 'ar'
                          ? 'إلغاء كتم التطبيق'
                          : 'Unmute app'
                        : settings.language === 'ar'
                          ? 'كتم التطبيق'
                          : 'Mute app'}
                    </span>
                  </button>
                );
              })()}

              {ctxMenu.pinnedIndex > 0 && (
                <button
                  className="taskbar-ctx-item"
                  onClick={() => {
                    movePinned(ctxMenu.pinnedIndex!, -1);
                    setCtxMenu(null);
                  }}
                >
                  <ArrowLeft size={14} />
                  <span>{settings.language === 'ar' ? 'تحريك لليسار' : 'Move left'}</span>
                </button>
              )}
              {ctxMenu.pinnedIndex < pinnedApps.length - 1 && (
                <button
                  className="taskbar-ctx-item"
                  onClick={() => {
                    movePinned(ctxMenu.pinnedIndex!, 1);
                    setCtxMenu(null);
                  }}
                >
                  <ArrowRight size={14} />
                  <span>{settings.language === 'ar' ? 'تحريك لليمين' : 'Move right'}</span>
                </button>
              )}
              <button
                className="taskbar-ctx-item danger"
                onClick={() => {
                  onSavePinnedApps(pinnedApps.filter((p) => p.id !== ctxMenu.pinned!.id));
                  setCtxMenu(null);
                }}
              >
                <PinOff size={14} />
                <span>
                  {ctxMenu.pinned.kind === 'group'
                    ? settings.language === 'ar'
                      ? 'حذف المجلد'
                      : 'Remove folder'
                    : settings.language === 'ar'
                      ? 'إلغاء التثبيت'
                      : 'Unpin from taskbar'}
                </span>
              </button>
            </>
          )}
        </div>
      )}

      <div
        ref={dockBarRef}
        className={`dock-bar ${isSecondary ? 'secondary' : ''} ${settings.compactMode ? 'compact' : ''} ${
          dragOverExternal ? 'drag-over' : ''
        }`}
        onMouseLeave={handleStripMouseLeave}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('.dock-app-btn')) return;
          openContextMenu(e, { kind: 'tray' });
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOverExternal(true);
        }}
        onDragLeave={() => setDragOverExternal(false)}
        onDrop={(e) => void handleExternalDrop(e)}
      >
        {/* Left Inline Music Player when musicPosition === 'taskbar' (primary monitor only) */}
        {!isSecondary && settings.musicPosition === 'taskbar' && (
          <>
            <div
              className={`inline-music-pill ${activePanel === 'media' ? 'active' : ''} ${
                media?.status === 'Playing' ? 'playing' : ''
              }`}
            >
              <button
                className="inline-music-trigger"
                onClick={() => toggle('media')}
                onMouseEnter={(e) =>
                  showTooltipFor(
                    e,
                    media?.title
                      ? `${media.title}${media.artist ? ` — ${media.artist}` : ''}`
                      : dict.media
                  )
                }
                onMouseLeave={() => setTooltip(null)}
              >
                {mediaArtworkUrl ? (
                  <img
                    className="inline-music-art"
                    src={mediaArtworkUrl}
                    alt={media?.title ?? ''}
                    draggable={false}
                  />
                ) : (
                  <div className="inline-music-art">
                    <Music size={13} />
                  </div>
                )}

                <InlineMusicText
                  media={media}
                  lyricsOn={lyricsOn}
                  idleLabel={dict.nothingPlaying}
                />

                {media?.status === 'Playing' && (
                  <span className="inline-eq eq-playing" aria-hidden="true">
                    <span className="eq-bar" />
                    <span className="eq-bar" />
                    <span className="eq-bar" />
                  </span>
                )}
              </button>

              <button
                className="media-mini-btn"
                aria-label={settings.language === 'ar' ? 'السابق' : 'Previous'}
                onClick={() => void quickMedia('previous')}
                onMouseEnter={(e) =>
                  showTooltipFor(e, settings.language === 'ar' ? 'السابق' : 'Previous')
                }
                onMouseLeave={() => setTooltip(null)}
              >
                <SkipBack size={12} />
              </button>
              <button
                className="media-mini-btn play"
                aria-label={
                  media?.status === 'Playing'
                    ? settings.language === 'ar'
                      ? 'إيقاف مؤقت'
                      : 'Pause'
                    : settings.language === 'ar'
                      ? 'تشغيل'
                      : 'Play'
                }
                onClick={() => void quickMedia('playPause')}
                onMouseEnter={(e) =>
                  showTooltipFor(
                    e,
                    media?.status === 'Playing'
                      ? settings.language === 'ar'
                        ? 'إيقاف مؤقت'
                        : 'Pause'
                      : settings.language === 'ar'
                        ? 'تشغيل'
                        : 'Play'
                  )
                }
                onMouseLeave={() => setTooltip(null)}
              >
                {media?.status === 'Playing' ? <Pause size={12} /> : <Play size={12} />}
              </button>
              <button
                className="media-mini-btn"
                aria-label={settings.language === 'ar' ? 'التالي' : 'Next'}
                onClick={() => void quickMedia('next')}
                onMouseEnter={(e) =>
                  showTooltipFor(e, settings.language === 'ar' ? 'التالي' : 'Next')
                }
                onMouseLeave={() => setTooltip(null)}
              >
                <SkipForward size={12} />
              </button>
            </div>
            <div className="dock-divider" />
          </>
        )}

        {/* Center Slot: Start + Search + Pinned Apps / Folders + Open Windows */}
        {(() => {
          const isLiveDragging = Boolean(pointerDrag?.active);
          const slotStep = dragSnapshotRef.current?.step ?? (settings.compactMode ? 39 : 44);
          const draggedPinnedId =
            isLiveDragging && pointerDrag?.payload.kind === 'pinned'
              ? pointerDrag.payload.item.id
              : null;
          const origDraggedIndex =
            draggedPinnedId !== null ? pinnedApps.findIndex((p) => p.id === draggedPinnedId) : -1;
          const isExternalInsertGap =
            isLiveDragging &&
            draggedPinnedId === null &&
            liveDrag?.gapIndex !== null &&
            liveDrag?.gapIndex !== undefined;

          return (
            <div
              ref={stripRef}
              className={`dock-apps-strip ${isLiveDragging ? 'is-live-dragging' : ''} ${
                justDropped ? 'no-transform-transition' : ''
              } ${settings.dockMagnification === false ? 'no-wave' : ''}`}
              style={
                isExternalInsertGap
                  ? { paddingRight: slotStep, transition: 'padding-right 0.2s cubic-bezier(0.22, 1, 0.36, 1)' }
                  : undefined
              }
              onMouseMove={handleStripMouseMove}
              onMouseLeave={handleStripMouseLeave}
              onWheel={handleStripWheel}
            >
              <button
                className="dock-app-btn"
                style={{ background: 'transparent' }}
                onClick={() => void dockBridge.systemAction('start')}
                onMouseEnter={(e) => showTooltipFor(e, 'Start')}
              >
                <StartIcon />
              </button>

              {!isSecondary && (
                <button
                  className={`dock-app-btn ${activePanel === 'apps' ? 'active' : ''}`}
                  onClick={() => toggle('apps')}
                  onMouseEnter={(e) => showTooltipFor(e, dict.apps)}
                  style={
                    activePanel === 'apps'
                      ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)' }
                      : undefined
                  }
                >
                  <SearchIcon />
                </button>
              )}

              {pinnedApps.map((app, index) => {
                const isGroup = app.kind === 'group';
                const matchedWin = isGroup
                  ? findWindowForGroup(app.children)
                  : findWindowForPinned(app);
                const isMergeTarget = isLiveDragging && liveDrag?.mergeTargetId === app.id;
                const isBeingDragged = origDraggedIndex === index;
                const appWindows = isGroup ? [] : windowsForPinned(app);
                const peekKey = `pin:${app.id}`;

                let shiftPx = 0;
                if (isLiveDragging) {
                  if (origDraggedIndex >= 0 && !isBeingDragged) {
                    const gap = liveDrag?.gapIndex ?? origDraggedIndex;
                    if (index > origDraggedIndex && index <= gap) shiftPx = -slotStep;
                    else if (index < origDraggedIndex && index >= gap) shiftPx = slotStep;
                  } else if (isExternalInsertGap && index >= liveDrag!.gapIndex!) {
                    shiftPx = slotStep;
                  }
                }

                const liveTransform =
                  isLiveDragging && (shiftPx !== 0 || isMergeTarget)
                    ? `${shiftPx !== 0 ? `translateX(${shiftPx}px)` : ''} ${
                        isMergeTarget ? 'scale(1.14)' : ''
                      }`.trim()
                    : undefined;

                return (
                  <button
                    key={app.id}
                    data-pinned-id={app.id}
                    className={`dock-app-btn ${isMergeTarget ? 'drop-merge' : ''}`}
                    style={{
                      ...(matchedWin?.isActive
                        ? { background: 'var(--chip-hover)', borderColor: 'var(--border-hairline)' }
                        : {}),
                      ...(liveTransform ? { transform: liveTransform } : {}),
                      ...(isBeingDragged ? { opacity: 0, pointerEvents: 'none' } : {}),
                      order: (index + 1) * 1000
                    }}
                    onPointerDown={(e) => {
                      if (e.button === 1 && !isGroup) {
                        e.preventDefault();
                        e.stopPropagation();
                        closePeekNow();
                        setTooltip(null);
                        void dockBridge.launchTarget(app.target);
                        return;
                      }
                      if (e.button !== 0) return;
                      beginPointerDrag({ kind: 'pinned', item: app }, e.clientX, e.clientY);
                    }}
                    onMouseEnter={(e) => {
                      if (appWindows.length > 0) {
                        openPeek(peekKey, e.currentTarget);
                        return;
                      }
                      if (peek) closePeekNow();
                      showTooltipFor(
                        e,
                        isGroup ? `${app.name} (${app.children?.length ?? 0})` : app.name
                      );
                    }}
                    onMouseLeave={() => {
                      if (appWindows.length > 0) schedulePeekClose();
                    }}
                    onContextMenu={(e) =>
                      openContextMenu(e, { kind: 'pinned', pinned: app, pinnedIndex: index })
                    }
                    onClick={(e) => {
                      if (suppressNextClickRef.current) return;
                      e.stopPropagation();
                      setCtxMenu(null);
                      setTooltip(null);
                      if (isGroup) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const centerX = rect.left + rect.width / 2;
                        setCcFlyout(null);
                        if (openFolder?.id === app.id) {
                          setOpenFolder(null);
                        } else {
                          onTogglePanel(null);
                          setOpenFolder({ id: app.id, x: centerX });
                        }
                        return;
                      }
                      setOpenFolder(null);
                      setCcFlyout(null);
                      // Several windows: show them to pick from instead of guessing one (Windows 11)
                      if (appWindows.length > 1 && !e.shiftKey) {
                        if (peek?.key === peekKey) closePeekNow();
                        else openPeek(peekKey, e.currentTarget, true);
                        return;
                      }
                      closePeekNow();
                      if (matchedWin && !e.shiftKey) {
                        void dockBridge.focusWindow(matchedWin.pid, matchedWin.hwnd).then((ok) => {
                          setTimeout(onRefreshWindows, 80);
                          // Only launch if the window literally closed/disappeared ('gone')
                          if (!ok) void launchOrWakePinned(app);
                        });
                      } else if (e.shiftKey) {
                        void dockBridge.launchTarget(app.target);
                      } else {
                        void launchOrWakePinned(app);
                      }
                    }}
                  >
                    {isGroup ? (
                      <div className="dock-folder-mini-grid">
                        {(app.children ?? []).slice(0, 4).map((child) =>
                          child.iconDataUrl ? (
                            <img
                              key={child.id}
                              className="dock-folder-mini-img"
                              src={child.iconDataUrl}
                              alt={child.name}
                              draggable={false}
                            />
                          ) : (
                            <AppIconGlyph key={child.id} name={child.icon} color={child.color} size={9} />
                          )
                        )}
                      </div>
                    ) : (
                      renderAppThumb(app, 21)
                    )}

                    {matchedWin && (
                      <span
                        className={`running-dot ${
                          matchedWin.isActive ? 'active' : matchedWin.isMinimized ? 'minimized' : ''
                        } ${appWindows.length > 1 ? 'multi' : ''}`}
                      />
                    )}
                    {(() => {
                      const sess = findAudioSessionForPinned(app, matchedWin);
                      if (!sess || (!sess.active && !sess.muted)) return null;
                      return (
                        <span
                          className={`dock-audio-badge ${sess.muted ? 'is-muted' : 'is-playing'}`}
                          aria-hidden="true"
                        >
                          {sess.muted ? <VolumeX size={8} strokeWidth={2.4} /> : <Volume2 size={8} strokeWidth={2.4} />}
                        </span>
                      );
                    })()}
                  </button>
                );
              })}

              {settings.showOpenWindowsInBar && barWindows.length > 0 && (
                <>
                  {barWindows.map((win) => {
                    const procWindows = windowsForProcess(win.processName);
                    const procActive = procWindows.find((w) => w.isActive);
                    const peekKey = `proc:${win.processName.toLowerCase()}`;
                    const isDraggedRunning =
                      isLiveDragging &&
                      pointerDrag?.payload.kind === 'running' &&
                      pointerDrag.payload.win.pid === win.pid &&
                      pointerDrag.payload.win.hwnd === win.hwnd;
                    return (
                      <button
                        key={win.hwnd ?? win.pid}
                        className="dock-app-btn"
                        style={{
                          ...(procActive
                            ? { background: 'var(--chip-hover)', borderColor: 'var(--border-hairline)' }
                            : {}),
                          ...(isExternalInsertGap
                            ? { transform: `translateX(${slotStep}px)` }
                            : {}),
                          ...(isDraggedRunning ? { opacity: 0.28 } : {}),
                          order: runningSlotOrder(win)
                        }}
                        data-run-key={win.processName.toLowerCase()}
                        onPointerDown={(e) => {
                          if (e.button === 1) {
                            const target = win.aumid
                              ? `shell:AppsFolder\\${win.aumid}`
                              : win.executablePath;
                            if (target) {
                              e.preventDefault();
                              e.stopPropagation();
                              closePeekNow();
                              setTooltip(null);
                              void dockBridge.launchTarget(target);
                            }
                            return;
                          }
                          beginRunningDrag(e);
                        }}
                        onMouseEnter={(e) => openPeek(peekKey, e.currentTarget)}
                        onMouseLeave={schedulePeekClose}
                        onContextMenu={(e) => openContextMenu(e, { kind: 'running', running: procActive ?? win })}
                        onClick={(e) => {
                          if (suppressNextClickRef.current) return;
                          setCtxMenu(null);
                          setOpenFolder(null);
                          setTooltip(null);
                          if (procWindows.length > 1) {
                            if (peek?.key === peekKey) closePeekNow();
                            else openPeek(peekKey, e.currentTarget, true);
                            return;
                          }
                          closePeekNow();
                          void dockBridge.focusWindow(win.pid, win.hwnd).then((ok) => {
                            setTimeout(onRefreshWindows, 80);
                            if (!ok) void dockBridge.openApp(win.pid, win.executablePath);
                          });
                        }}
                      >
                    {win.iconDataUrl ? (
                      <img
                        className="app-icon-img"
                        src={win.iconDataUrl}
                        alt={win.processName}
                        draggable={false}
                      />
                    ) : (
                      <AppIconGlyph name="app" color="var(--accent)" size={16} />
                    )}
                    <span
                      className={`running-dot ${
                        procActive ? 'active' : procWindows.every((w) => w.isMinimized) ? 'minimized' : ''
                      } ${procWindows.length > 1 ? 'multi' : ''}`}
                    />
                    {(() => {
                      const sess = findAudioSessionForProc(win.processName);
                      if (!sess || (!sess.active && !sess.muted)) return null;
                      return (
                        <span
                          className={`dock-audio-badge ${sess.muted ? 'is-muted' : 'is-playing'}`}
                          aria-hidden="true"
                        >
                          {sess.muted ? <VolumeX size={8} strokeWidth={2.4} /> : <Volume2 size={8} strokeWidth={2.4} />}
                        </span>
                      );
                    })()}
                  </button>
                );
              })}
                </>
              )}
            </div>
          );
        })()}

        <div className="dock-divider" />

        {/* Right Slot: Full Control Tray on primary monitor; clean Clock + Show Desktop on secondary */}
        <div className="dock-right-tray">
          {!isSecondary && (
            <>
              <button
                ref={overflowBtnRef}
                type="button"
                className={`tray-overflow-btn ${overflowTray ? 'active' : ''}`}
                aria-label={settings.language === 'ar' ? 'إظهار الأيقونات المخفية' : 'Show hidden icons'}
                aria-expanded={Boolean(overflowTray)}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleOverflowTray();
                }}
                onContextMenu={(e) => openContextMenu(e, { kind: 'tray' })}
                onMouseEnter={(e) => {
                  prefetchBackgroundApps();
                  showTooltipFor(
                    e,
                    settings.language === 'ar' ? 'الأيقونات المخفية' : 'Hidden icons'
                  );
                }}
                onMouseLeave={() => setTooltip(null)}
              >
                <ChevronUp
                  size={14}
                  strokeWidth={2}
                  className="tray-overflow-chevron"
                  style={
                    settings.position === 'top' && !overflowTray
                      ? { transform: 'rotate(180deg)' }
                      : settings.position === 'top' && overflowTray
                        ? { transform: 'rotate(0deg)' }
                        : undefined
                  }
                />
              </button>

              <button
                className="tray-lang-pill tabular"
                aria-label={`Switch Keyboard Language (${kbdLang})`}
                onClick={onSwitchKbdLang}
                onMouseEnter={(e) =>
                  showTooltipFor(
                    e,
                    settings.language === 'ar'
                      ? `تبديل لغة الكيبورد (${kbdLang})`
                      : `Keyboard language (${kbdLang})`
                  )
                }
                onMouseLeave={() => setTooltip(null)}
              >
                <GlobeLangIcon />
                <span>{kbdLang}</span>
              </button>

              <div
                ref={ccClusterRef}
                className={`tray-control-cluster ${ccFlyout ? 'open' : ''}`}
                onMouseEnter={prefetchControlCenterStatus}
              >
                <button
                  className={`tray-cluster-btn cc-trigger-btn ${ccFlyout ? 'active' : ''}`}
                  aria-label="Wi-Fi and Control Center"
                  aria-expanded={Boolean(ccFlyout)}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleControlCenter();
                  }}
                  onContextMenu={(e) => openContextMenu(e, { kind: 'network' })}
                  onMouseEnter={(e) =>
                    showTooltipFor(
                      e,
                      netInfo.connected
                        ? netInfo.kind === 'ethernet'
                          ? settings.language === 'ar'
                            ? 'اتصال سلكي (Ethernet)'
                            : 'Ethernet connected'
                          : `${netInfo.ssid ?? (settings.language === 'ar' ? 'متصل' : 'Connected')}${
                              netInfo.signalPercent !== undefined ? ` (${netInfo.signalPercent}%)` : ''
                            }`
                        : settings.language === 'ar'
                          ? 'غير متصل بالإنترنت'
                          : 'Not connected'
                    )
                  }
                  onMouseLeave={() => setTooltip(null)}
                >
                  <WifiIcon
                    connected={netInfo.connected}
                    signalPercent={netInfo.signalPercent}
                    kind={netInfo.kind}
                  />
                  {netInfo.connected && <span className="tray-wifi-dot" />}
                </button>

                <span className="tray-cluster-sep" aria-hidden="true" />

                <button
                  className={`tray-cluster-btn cc-trigger-btn ${ccFlyout ? 'active' : ''}`}
                  aria-label={`${dict.volume}: ${trayVol.muted ? 'Muted' : `${trayVol.level}%`}`}
                  aria-expanded={Boolean(ccFlyout)}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleControlCenter();
                  }}
                  onContextMenu={(e) => openContextMenu(e, { kind: 'volume' })}
                  onMouseEnter={(e) =>
                    showTooltipFor(
                      e,
                      `${dict.volume}: ${
                        trayVol.muted
                          ? settings.language === 'ar'
                            ? 'مكتوم'
                            : 'Muted'
                          : `${trayVol.level}%`
                      }`
                    )
                  }
                  onMouseLeave={() => setTooltip(null)}
                  onWheel={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const delta = e.deltaY < 0 ? 4 : -4;
                    const nextLevel = Math.max(0, Math.min(100, (trayVol.muted ? 0 : trayVol.level) + delta));
                    volLockUntilRef.current = Date.now() + 900;
                    setTrayVol({ level: nextLevel, muted: nextLevel === 0 });
                    setTooltip((prev) =>
                      prev
                        ? {
                            ...prev,
                            label: `${dict.volume}: ${
                              nextLevel === 0
                                ? settings.language === 'ar'
                                  ? 'مكتوم'
                                  : 'Muted'
                                : `${nextLevel}%`
                            }`
                          }
                        : prev
                    );
                    void dockBridge.setVolume(nextLevel).then((v) => {
                      if (!volDraggingRef.current) setTrayVol(v);
                    });
                  }}
                >
                  <VolumeIcon level={trayVol.level} muted={trayVol.muted} />
                  <span className="tray-vol-pct tabular">
                    {trayVol.muted ? '0%' : `${trayVol.level}%`}
                  </span>
                </button>

                {stats.batteryPercent !== null && (
                  <>
                    <span className="tray-cluster-sep" aria-hidden="true" />
                    <button
                      className={`tray-cluster-btn cc-trigger-btn tabular ${ccFlyout ? 'active' : ''}`}
                      aria-label={`${dict.battery}: ${stats.batteryPercent}%`}
                      aria-expanded={Boolean(ccFlyout)}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleControlCenter();
                      }}
                      onMouseEnter={(e) =>
                        showTooltipFor(
                          e,
                          `${dict.battery}: ${stats.batteryPercent}%${
                            stats.batteryCharging
                              ? settings.language === 'ar'
                                ? ' · يشحن'
                                : ' · Charging'
                              : ''
                          }`
                        )
                      }
                      onMouseLeave={() => setTooltip(null)}
                    >
                      <BatteryIcon percent={stats.batteryPercent} charging={stats.batteryCharging} />
                      <span>{stats.batteryPercent}%</span>
                    </button>
                  </>
                )}
              </div>
            </>
          )}

          <button
            className={`tray-clock-btn tabular ${activePanel === 'calendar' ? 'active' : ''}`}
            aria-label={dict.calendar}
            aria-expanded={activePanel === 'calendar'}
            onClick={() => toggle('calendar')}
            onContextMenu={(e) => openContextMenu(e, { kind: 'clock' })}
            onMouseEnter={(e) => showTooltipFor(e, dict.calendar)}
            onMouseLeave={() => setTooltip(null)}
          >
            <span className="tray-clock-time">{timeStr}</span>
            <span className="tray-clock-date">{dateStr}</span>
          </button>

          {!isSecondary && (
            <button
              className="tray-settings-btn"
              aria-label={dict.settings}
              aria-expanded={activePanel === 'settings'}
              onClick={() => toggle('settings')}
              onMouseEnter={(e) => showTooltipFor(e, dict.settings)}
              onMouseLeave={() => setTooltip(null)}
              style={
                activePanel === 'settings'
                  ? { background: 'var(--surface-hover)', color: 'var(--text-primary)' }
                  : undefined
              }
            >
              <SettingsIcon />
              {(updateInfo?.state === 'ready' || updateInfo?.state === 'downloading') && (
                <span
                  className={`update-dot ${updateInfo.state === 'downloading' ? 'busy' : ''}`}
                  aria-hidden="true"
                />
              )}
            </button>
          )}

          <button
            className="show-desktop-sliver"
            aria-label={settings.language === 'ar' ? 'إظهار سطح المكتب' : 'Show Desktop'}
            onClick={() => void dockBridge.systemAction('desktop')}
            onMouseEnter={(e) =>
              showTooltipFor(e, settings.language === 'ar' ? 'إظهار سطح المكتب' : 'Show Desktop')
            }
            onMouseLeave={() => setTooltip(null)}
          />
        </div>
      </div>
    </>
  );
}
