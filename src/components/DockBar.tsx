import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  FolderOpen,
  Music,
  Pause,
  Pin,
  PinOff,
  Play,
  SkipBack,
  SkipForward,
  X
} from 'lucide-react';
import { dockBridge } from '../hooks/useDockBridge';
import { useMediaArtwork } from '../hooks/useMediaArtwork';
import { t } from '../i18n';
import type {
  ActivePanel,
  AppConfig,
  MediaInfo,
  PinnedApp,
  RunningWindow,
  SystemStats
} from '../types';
import { AppIconGlyph } from './IconMapper';
import {
  BatteryIcon,
  SearchIcon,
  SettingsIcon,
  StartIcon,
  VolumeIcon,
  WifiIcon
} from './PremiumIcons';

interface CtxMenuState {
  x: number;
  kind: 'pinned' | 'running';
  pinned?: PinnedApp;
  pinnedIndex?: number;
  running?: RunningWindow;
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
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [openFolder, setOpenFolder] = useState<{ id: string; x: number } | null>(null);
  const [dragOverExternal, setDragOverExternal] = useState(false);
  const [pointerDrag, setPointerDrag] = useState<PointerDragState | null>(null);
  const [liveDrag, setLiveDrag] = useState<LiveDragPlan | null>(null);
  const [justDropped, setJustDropped] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const stripRef = useRef<HTMLDivElement | null>(null);
  const dockBarRef = useRef<HTMLDivElement | null>(null);
  const folderPopoverRef = useRef<HTMLDivElement | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const suppressNextClickRef = useRef(false);
  const dragCandidateRef = useRef<PointerDragState | null>(null);
  const dragSnapshotRef = useRef<DragSlotSnapshot | null>(null);
  const liveDragRef = useRef<LiveDragPlan | null>(null);

  const activeFolderObj = openFolder
    ? pinnedApps.find((p) => p.id === openFolder.id && p.kind === 'group') ?? null
    : null;

  // Report exact interactive regions (with generous hover halo) to Main process
  useLayoutEffect(() => {
    const reportHitRects = () => {
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
      pushOverlay(ctxMenuRef.current);
      const popoverEl = document.querySelector<HTMLElement>('.popover-card');
      pushOverlay(popoverEl);

      dockBridge.setHitRects('dock', rects);
    };

    reportHitRects();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(reportHitRects) : null;
    if (ro) {
      if (dockBarRef.current) ro.observe(dockBarRef.current);
      if (folderPopoverRef.current) ro.observe(folderPopoverRef.current);
      if (ctxMenuRef.current) ro.observe(ctxMenuRef.current);
    }
    return () => ro?.disconnect();
  }, [
    activePanel,
    activeFolderObj?.id,
    activeFolderObj?.children?.length,
    ctxMenu,
    pinnedApps.length,
    runningWindows.length,
    settings.position,
    settings.compactMode,
    settings.musicPosition,
    settings.showOpenWindowsInBar
  ]);

  // Close context menu or folder on Esc, blur, or click on empty background
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCtxMenu(null);
        setOpenFolder(null);
        dragCandidateRef.current = null;
        dragSnapshotRef.current = null;
        liveDragRef.current = null;
        dockBridge.setDockInteractive(false);
        setPointerDrag(null);
        setLiveDrag(null);
      }
    };
    const onBlur = () => {
      setCtxMenu(null);
      setOpenFolder(null);
      dragCandidateRef.current = null;
      dragSnapshotRef.current = null;
      liveDragRef.current = null;
      dockBridge.setDockInteractive(false);
      setPointerDrag(null);
      setLiveDrag(null);
    };
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (ctxMenu && !target.closest('.taskbar-ctx-menu')) {
        setCtxMenu(null);
      }
      if (openFolder && !target.closest('.folder-popover') && !target.closest('.dock-app-btn')) {
        setOpenFolder(null);
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
  }, [ctxMenu, openFolder]);

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
        dockBridge.setDockInteractive(true);
        dragActionsRef.current?.applyWaveAtClientX(null);
        setTooltip(null);
        dragSnapshotRef.current = captureSnapshot(candidate.payload);
        liveDragRef.current = {
          gapIndex:
            dragSnapshotRef.current && dragSnapshotRef.current.origIndex >= 0
              ? dragSnapshotRef.current.origIndex
              : null,
          mergeTargetId: null
        };
      }

      candidate.x = e.clientX;
      candidate.y = e.clientY;
      const nextPlan = computeLivePlan(
        dragSnapshotRef.current,
        candidate.payload,
        e.clientX,
        e.clientY,
        liveDragRef.current
      );
      liveDragRef.current = nextPlan;
      setLiveDrag(nextPlan);
      setPointerDrag({ ...candidate });
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

  const applyWaveAtClientX = (clientX: number | null) => {
    const strip = stripRef.current;
    if (!strip) return;
    const buttons = strip.querySelectorAll<HTMLButtonElement>('.dock-app-btn');
    const dir = settings.position === 'top' ? 1 : -1;

    buttons.forEach((btn) => {
      if (clientX === null || pointerDrag?.active) {
        btn.style.transform = '';
        return;
      }
      const rect = btn.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const dist = Math.abs(clientX - center);
      const influence = Math.exp(-(dist * dist) / (2 * 48 * 48));
      const scale = 1 + 0.28 * influence;
      const liftY = dir * 9 * influence;

      btn.style.transform = `translateY(${liftY.toFixed(1)}px) scale(${scale.toFixed(3)})`;
    });
  };

  const handleStripMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
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
    year: 'numeric',
    month: 'numeric',
    day: 'numeric'
  });

  const toggle = (panel: ActivePanel) => {
    setCtxMenu(null);
    setOpenFolder(null);
    setTooltip(null);
    onTogglePanel(activePanel === panel ? null : panel);
  };

  const quickMedia = async (cmd: 'playPause' | 'next' | 'previous') => {
    await dockBridge.sendMediaCommand(cmd);
    setTimeout(onRefreshMedia, 250);
  };

  const pinnedExeNames = new Set<string>();
  for (const p of pinnedApps) {
    if (p.kind === 'group' && p.children) {
      for (const c of p.children) {
        if (c.exeName) pinnedExeNames.add(c.exeName.toLowerCase());
      }
    } else if (p.exeName) {
      pinnedExeNames.add(p.exeName.toLowerCase());
    }
  }

  const findWindowForPinned = (exeName?: string): RunningWindow | undefined => {
    if (!exeName) return undefined;
    const target = exeName.toLowerCase();
    const matches = runningWindows.filter((w) => w.processName.toLowerCase() === target);
    return matches.find((w) => w.isActive) ?? matches[0];
  };

  const findWindowForGroup = (children?: PinnedApp[]): RunningWindow | undefined => {
    if (!children) return undefined;
    for (const c of children) {
      const m = findWindowForPinned(c.exeName);
      if (m) return m;
    }
    return undefined;
  };

  const barWindows: RunningWindow[] = [];
  const seenProcs = new Set<string>();
  for (const w of runningWindows) {
    const procKey = w.processName.toLowerCase();
    if (pinnedExeNames.has(procKey)) continue;
    if (!seenProcs.has(procKey)) {
      seenProcs.add(procKey);
      barWindows.push(w);
    }
  }

  const openContextMenu = (e: React.MouseEvent, payload: Omit<CtxMenuState, 'x'>) => {
    e.preventDefault();
    e.stopPropagation();
    setTooltip(null);
    setOpenFolder(null);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const clampedX = Math.max(8, Math.min(window.innerWidth - 196, rect.left));
    setCtxMenu({ ...payload, x: clampedX });
  };

  const winToPinned = (win: RunningWindow): PinnedApp | null => {
    if (!win.executablePath) return null;
    return {
      id: `pin-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name: win.processName,
      target: win.executablePath,
      kind: 'app',
      icon: 'app',
      color: '#60A5FA',
      iconDataUrl: win.iconDataUrl,
      exeName: win.processName.toLowerCase()
    };
  };

  const pinRunningApp = (win: RunningWindow) => {
    const next = winToPinned(win);
    if (!next) return;
    if (pinnedExeNames.has(win.processName.toLowerCase())) return;
    onSavePinnedApps([...pinnedApps, next]);
  };

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
          color: '#60A5FA',
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

  return (
    <>
      {pointerDrag?.active && (
        <div
          className="drag-ghost"
          style={{ left: pointerDrag.x, top: pointerDrag.y }}
        >
          {renderAppThumb(pointerDrag.payload.item, 22)}
        </div>
      )}

      {tooltip && !ctxMenu && !activePanel && !activeFolderObj && !pointerDrag?.active && (
        <div
          className="dock-tooltip"
          style={{
            left: Math.max(60, Math.min(window.innerWidth - 60, tooltip.x)),
            ...(settings.position === 'bottom' ? { bottom: 64 } : { top: 64 })
          }}
        >
          {tooltip.label}
        </div>
      )}

      {/* Open Taskbar Folder Popover */}
      {activeFolderObj && openFolder && (
        <div
          ref={folderPopoverRef}
          className="folder-popover"
          style={{
            left: Math.max(144, Math.min(window.innerWidth - 144, openFolder.x)),
            ...(settings.position === 'bottom' ? { bottom: 60 } : { top: 60 })
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            className="folder-title-input"
            value={activeFolderObj.name}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const nextName = e.target.value;
              onSavePinnedApps(
                pinnedApps.map((p) => (p.id === activeFolderObj.id ? { ...p, name: nextName } : p))
              );
            }}
            onFocus={() => void dockBridge.setPopoverOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            title="Click to rename folder"
          />

          <div className="folder-apps-grid">
            {(activeFolderObj.children ?? []).map((child) => {
              const matchedWin = findWindowForPinned(child.exeName);
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
                      void dockBridge.focusWindow(matchedWin.pid, matchedWin.hwnd).then(() => {
                        setTimeout(onRefreshWindows, 120);
                      });
                    } else {
                      void dockBridge.launchTarget(child.target);
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

      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="taskbar-ctx-menu"
          style={{
            left: ctxMenu.x,
            ...(settings.position === 'bottom' ? { bottom: 60 } : { top: 60 })
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {ctxMenu.kind === 'running' && ctxMenu.running && (
            <>
              {ctxMenu.running.executablePath && (
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
              {ctxMenu.running.executablePath && (
                <button
                  className="taskbar-ctx-item"
                  onClick={() => {
                    void dockBridge.launchTarget(ctxMenu.running!.executablePath!);
                    setCtxMenu(null);
                  }}
                >
                  <ExternalLink size={14} />
                  <span>{settings.language === 'ar' ? 'فتح نافذة جديدة' : 'Open new window'}</span>
                </button>
              )}
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
        className={`dock-bar ${settings.compactMode ? 'compact' : ''} ${
          dragOverExternal ? 'drag-over' : ''
        }`}
        onMouseLeave={handleStripMouseLeave}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOverExternal(true);
        }}
        onDragLeave={() => setDragOverExternal(false)}
        onDrop={(e) => void handleExternalDrop(e)}
      >
        {/* Left Inline Music Player when musicPosition === 'taskbar' */}
        {settings.musicPosition === 'taskbar' && (
          <>
            <div
              className={`inline-music-pill ${activePanel === 'media' ? 'active' : ''} ${
                media?.status === 'Playing' ? 'playing' : ''
              }`}
            >
              <button
                className="inline-music-trigger"
                onClick={() => toggle('media')}
                title={media?.title ? `${media.title}${media.artist ? ` — ${media.artist}` : ''}` : dict.media}
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

                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 124
                    }}
                  >
                    {media?.title || dict.nothingPlaying}
                  </div>
                  {media?.artist && (
                    <div
                      style={{
                        fontSize: 10.5,
                        color: 'var(--text-muted)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 124
                      }}
                    >
                      {media.artist}
                    </div>
                  )}
                </div>

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
                onClick={() => void quickMedia('previous')}
                title="Previous"
              >
                <SkipBack size={12} />
              </button>
              <button
                className="media-mini-btn play"
                onClick={() => void quickMedia('playPause')}
                title="Play / Pause"
              >
                {media?.status === 'Playing' ? <Pause size={12} /> : <Play size={12} />}
              </button>
              <button
                className="media-mini-btn"
                onClick={() => void quickMedia('next')}
                title="Next"
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
              }`}
              style={
                isExternalInsertGap
                  ? { paddingRight: slotStep, transition: 'padding-right 0.2s cubic-bezier(0.22, 1, 0.36, 1)' }
                  : undefined
              }
              onMouseMove={handleStripMouseMove}
              onMouseLeave={handleStripMouseLeave}
            >
              <button
                className="dock-app-btn"
                style={{ background: 'transparent' }}
                onClick={() => void dockBridge.systemAction('start')}
                onMouseEnter={(e) => showTooltipFor(e, 'Start')}
              >
                <StartIcon />
              </button>

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

              {pinnedApps.map((app, index) => {
                const isGroup = app.kind === 'group';
                const matchedWin = isGroup
                  ? findWindowForGroup(app.children)
                  : findWindowForPinned(app.exeName);
                const isMergeTarget = isLiveDragging && liveDrag?.mergeTargetId === app.id;
                const isBeingDragged = origDraggedIndex === index;

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
                      ...(isBeingDragged ? { opacity: 0, pointerEvents: 'none' } : {})
                    }}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      beginPointerDrag({ kind: 'pinned', item: app }, e.clientX, e.clientY);
                    }}
                    onMouseEnter={(e) =>
                      showTooltipFor(
                        e,
                        isGroup
                          ? `${app.name} (${app.children?.length ?? 0})`
                          : matchedWin
                            ? `${app.name} — ${matchedWin.title}`
                            : app.name
                      )
                    }
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
                        if (openFolder?.id === app.id) {
                          setOpenFolder(null);
                        } else {
                          onTogglePanel(null);
                          setOpenFolder({ id: app.id, x: centerX });
                        }
                        return;
                      }
                      setOpenFolder(null);
                      if (matchedWin && !e.shiftKey) {
                        void dockBridge.focusWindow(matchedWin.pid, matchedWin.hwnd).then(() => {
                          setTimeout(onRefreshWindows, 120);
                        });
                      } else {
                        void dockBridge.launchTarget(app.target);
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
                        }`}
                      />
                    )}
                  </button>
                );
              })}

              {settings.showOpenWindowsInBar && barWindows.length > 0 && (
                <>
                  {barWindows.map((win) => {
                    const asPinned = winToPinned(win);
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
                          ...(win.isActive
                            ? { background: 'var(--chip-hover)', borderColor: 'var(--border-hairline)' }
                            : {}),
                          ...(isExternalInsertGap
                            ? { transform: `translateX(${slotStep}px)` }
                            : {}),
                          ...(isDraggedRunning ? { opacity: 0.28 } : {})
                        }}
                        onPointerDown={(e) => {
                          if (e.button !== 0 || !asPinned) return;
                          beginPointerDrag({ kind: 'running', win, item: asPinned }, e.clientX, e.clientY);
                        }}
                        onMouseEnter={(e) => showTooltipFor(e, `${win.processName} — ${win.title}`)}
                        onContextMenu={(e) => openContextMenu(e, { kind: 'running', running: win })}
                        onClick={() => {
                          if (suppressNextClickRef.current) return;
                          setCtxMenu(null);
                          setOpenFolder(null);
                          setTooltip(null);
                          void dockBridge.focusWindow(win.pid, win.hwnd).then(() => {
                            setTimeout(onRefreshWindows, 120);
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
                        win.isActive ? 'active' : win.isMinimized ? 'minimized' : ''
                      }`}
                    />
                  </button>
                );
              })}
                </>
              )}
            </div>
          );
        })()}

        <div className="dock-divider" />

        {/* Right Slot: Premium Windows System Tray */}
        <div className="dock-right-tray">
          <button
            className="tray-chip tabular"
            onClick={onSwitchKbdLang}
            title="Switch Keyboard Language"
          >
            {kbdLang}
          </button>

          <button
            className="tray-chip"
            onClick={() => void dockBridge.systemAction('quicksettings')}
            title="Wi-Fi & Quick Settings"
          >
            <WifiIcon />
          </button>

          <button
            className="tray-chip"
            onClick={() => toggle('system')}
            title={dict.system}
          >
            <VolumeIcon />
          </button>

          {stats.batteryPercent !== null && (
            <button
              className="tray-chip tabular"
              onClick={() => toggle('system')}
              title={`${dict.battery}: ${stats.batteryPercent}%`}
            >
              <BatteryIcon percent={stats.batteryPercent} charging={stats.batteryCharging} />
              <span style={{ fontSize: 11.5 }}>{stats.batteryPercent}%</span>
            </button>
          )}

          <button
            className={`tray-clock-btn tabular ${activePanel === 'calendar' ? 'active' : ''}`}
            onClick={() => toggle('calendar')}
            title={dict.calendar}
          >
            <span style={{ fontSize: 12, fontWeight: 600 }}>{timeStr}</span>
            <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{dateStr}</span>
          </button>

          <button
            className="app-icon-btn"
            onClick={() => toggle('settings')}
            title={dict.settings}
            style={
              activePanel === 'settings'
                ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)' }
                : undefined
            }
          >
            <SettingsIcon />
          </button>

          <button
            className="show-desktop-sliver"
            onClick={() => void dockBridge.systemAction('desktop')}
            title="Show Desktop"
          />
        </div>
      </div>
    </>
  );
}
