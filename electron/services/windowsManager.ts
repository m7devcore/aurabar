import { execFile, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, dialog, shell } from 'electron';
import type { BrowserWindow } from 'electron';
import type {
  BackgroundApp,
  InstalledApp,
  NetworkInfo,
  PinnedApp,
  RunningWindow
} from '../../src/types';
import { win32Daemon } from './win32Daemon';

const iconCache = new Map<string, string>();
const winIconCache = new Map<string, string>();
// Targets with no extractable icon; retried after a while since a failure can also be a
// transient daemon timeout (e.g. while it is still compiling at startup)
const iconMissAt = new Map<string, number>();
const ICON_MISS_RETRY_MS = 60000;

function resolveKnownSystemPath(target: string): string | null {
  const lower = target.trim().toLowerCase();
  if (fs.existsSync(target)) return target;
  const winDir = process.env.WINDIR || 'C:\\Windows';
  if (lower === 'explorer.exe') return path.join(winDir, 'explorer.exe');
  if (lower === 'calc.exe') return path.join(winDir, 'System32', 'calc.exe');
  if (lower === 'notepad.exe') return path.join(winDir, 'System32', 'notepad.exe');
  if (lower === 'cmd.exe') return path.join(winDir, 'System32', 'cmd.exe');
  if (lower === 'wt.exe') {
    const wt = path.join(
      process.env.LOCALAPPDATA || '',
      'Microsoft',
      'WindowsApps',
      'wt.exe'
    );
    if (fs.existsSync(wt)) return wt;
  }
  if (lower === 'code') {
    const codeUser = path.join(
      process.env.LOCALAPPDATA || '',
      'Programs',
      'Microsoft VS Code',
      'Code.exe'
    );
    if (fs.existsSync(codeUser)) return codeUser;
    const codeGlobal = 'C:\\Program Files\\Microsoft VS Code\\Code.exe';
    if (fs.existsSync(codeGlobal)) return codeGlobal;
  }
  return null;
}

export async function getIconDataUrl(target: string): Promise<string | undefined> {
  if (!target || /^https?:\/\//i.test(target) || /^ms-settings:/i.test(target)) {
    return undefined;
  }
  const key = target.toLowerCase();
  if (iconCache.has(key)) return iconCache.get(key);
  const missAt = iconMissAt.get(key);
  if (missAt !== undefined && Date.now() - missAt < ICON_MISS_RETRY_MS) return undefined;

  let resolved = resolveKnownSystemPath(target) ?? target;

  // Prefer the shortcut's underlying .ico or .exe target so icons render cleanly without shortcut arrows
  if (resolved.toLowerCase().endsWith('.lnk')) {
    try {
      const link = shell.readShortcutLink(resolved);
      if (link.icon && fs.existsSync(link.icon) && !link.icon.toLowerCase().endsWith('.dll')) {
        resolved = link.icon;
      } else if (
        link.target &&
        fs.existsSync(link.target) &&
        path.basename(link.target).toLowerCase() !== 'update.exe'
      ) {
        resolved = link.target;
      }
    } catch {
      // Keep .lnk path if readShortcutLink fails
    }
  }

  // Primary: native Windows Shell SHGetFileInfo (works for .lnk, .exe, .ico, WindowsApps, and folders)
  const shellIcon = await win32Daemon.send(`ICON ${resolved}`);
  if (shellIcon.startsWith('data:image/png;base64,')) {
    iconCache.set(key, shellIcon);
    return shellIcon;
  }

  // Fallback to original .lnk path if resolved target failed
  if (resolved !== target) {
    const lnkIcon = await win32Daemon.send(`ICON ${target}`);
    if (lnkIcon.startsWith('data:image/png;base64,')) {
      iconCache.set(key, lnkIcon);
      return lnkIcon;
    }
  }

  // Final fallback: Electron app.getFileIcon
  try {
    const img = await app.getFileIcon(resolved, { size: 'normal' });
    if (!img.isEmpty()) {
      const url = img.toDataURL();
      iconCache.set(key, url);
      return url;
    }
  } catch {
    // Ignore fallback failure
  }
  if (iconMissAt.size > 500) iconMissAt.clear();
  iconMissAt.set(key, Date.now());
  return undefined;
}

export function resolveExeName(target: string): string | undefined {
  const trimmed = target.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed) || /^ms-settings:/i.test(trimmed)) {
    return undefined;
  }
  const lower = trimmed.toLowerCase();
  if (lower === 'wt.exe') return 'windowsterminal';
  if (lower === 'calc.exe') return 'calculatorapp';
  if (lower.endsWith('.lnk')) {
    try {
      const link = shell.readShortcutLink(trimmed);
      if (link.target) {
        return path.basename(link.target).replace(/\.exe$/i, '').toLowerCase();
      }
    } catch {
      // Fallback to shortcut name
    }
  }
  return path.basename(trimmed).replace(/\.(exe|lnk|bat|cmd)$/i, '').toLowerCase();
}

let cachedInstalledApps: InstalledApp[] | null = null;

function collectShortcutsRecursive(dir: string, out: { name: string; fullPath: string }[], depth = 0): void {
  if (depth > 3 || !fs.existsSync(dir)) return;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (/^(Accessibility|Administrative Tools|System Tools|Windows PowerShell|Startup)$/i.test(entry.name)) {
          continue;
        }
        collectShortcutsRecursive(fullPath, out, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lnk')) {
        const base = entry.name.replace(/\.lnk$/i, '');
        if (/(uninstall|documentation|help|readme|website|release notes|manual|license|repair)/i.test(base)) {
          continue;
        }
        out.push({ name: base, fullPath });
      }
    }
  } catch {
    // Ignore restricted folders
  }
}

export async function listInstalledApps(): Promise<InstalledApp[]> {
  if (cachedInstalledApps) return cachedInstalledApps;

  const roots = [
    path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  ];

  const found: { name: string; fullPath: string }[] = [];
  for (const r of roots) {
    collectShortcutsRecursive(r, found);
  }

  const deduped = new Map<string, { name: string; fullPath: string }>();
  for (const item of found) {
    const key = item.name.toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }

  // Return the full list so search covers every app; icons are fetched lazily by the renderer
  // for the rows it actually shows (extracting hundreds up front stalls the daemon queue)
  const sorted = Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name));
  const apps: InstalledApp[] = sorted.map((item) => ({
    name: item.name,
    target: item.fullPath,
    exeName: resolveExeName(item.fullPath),
    iconDataUrl: iconCache.get(item.fullPath.toLowerCase())
  }));

  cachedInstalledApps = apps;
  return apps;
}

export async function createPinnedAppFromPath(filePath: string): Promise<PinnedApp | null> {
  const clean = filePath.trim();
  if (!clean || !fs.existsSync(clean)) return null;
  const isDir = fs.statSync(clean).isDirectory();
  const base = path.basename(clean).replace(/\.(exe|lnk|bat|cmd)$/i, '');
  const iconDataUrl = isDir ? undefined : await getIconDataUrl(clean);
  return {
    id: `pin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: base || clean,
    target: clean,
    kind: isDir ? 'folder' : 'app',
    icon: isDir ? 'folder' : 'app',
    color: isDir ? '#F59E0B' : '#38BDF8',
    iconDataUrl,
    exeName: isDir ? undefined : resolveExeName(clean)
  };
}

export async function importTaskbarPinnedApps(): Promise<PinnedApp[]> {
  const folder = path.join(
    process.env.APPDATA || '',
    'Microsoft',
    'Internet Explorer',
    'Quick Launch',
    'User Pinned',
    'TaskBar'
  );
  if (!fs.existsSync(folder)) return [];

  try {
    const files = fs
      .readdirSync(folder)
      .filter((f) => f.toLowerCase().endsWith('.lnk'))
      .slice(0, 12);

    const results = await Promise.all(
      files.map(async (file, idx) => {
        const fullPath = path.join(folder, file);
        const name = file.replace(/\.lnk$/i, '');
        const iconDataUrl = await getIconDataUrl(fullPath);
        return {
          id: `winpin-${idx}-${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
          name,
          target: fullPath,
          kind: 'app' as const,
          icon: 'app',
          color: '#38BDF8',
          iconDataUrl,
          exeName: resolveExeName(fullPath)
        };
      })
    );
    return results;
  } catch {
    return [];
  }
}

export async function listRunningWindows(): Promise<RunningWindow[]> {
  const raw = await win32Daemon.send('LIST');
  if (!raw || !raw.startsWith('[')) return [];
  try {
    const parsed = JSON.parse(raw) as RunningWindow[];
    const enriched = await Promise.all(
      parsed.map(async (w) => {
        let iconDataUrl = w.executablePath ? await getIconDataUrl(w.executablePath) : undefined;
        if (!iconDataUrl && w.hwnd) {
          if (winIconCache.has(w.hwnd)) {
            iconDataUrl = winIconCache.get(w.hwnd) || undefined;
          } else {
            const winIcon = await win32Daemon.send(`WINICON ${w.hwnd}`);
            const valid = winIcon.startsWith('data:image/png;base64,') ? winIcon : '';
            if (winIconCache.size > 200) winIconCache.clear();
            winIconCache.set(w.hwnd, valid);
            iconDataUrl = valid || undefined;
          }
        }
        return { ...w, iconDataUrl };
      })
    );
    return enriched;
  } catch {
    return [];
  }
}

// 'failed' / 'false' mean the window could not be brought forward (or is gone), so the caller may
// open the app instead. A timeout (empty reply) is not a failure: the toggle may well have happened.
function toggleSucceeded(reply: string): boolean {
  return reply === '' || reply === 'focused' || reply === 'minimized';
}

export async function focusWindowByPid(_pid: number, hwnd?: string): Promise<boolean> {
  if (hwnd && /^\d+$/.test(hwnd)) {
    return toggleSucceeded(await win32Daemon.send(`TOGGLE ${hwnd}`));
  }
  const windows = await listRunningWindows();
  const match = windows.find((w) => w.pid === _pid);
  if (match?.hwnd) {
    return toggleSucceeded(await win32Daemon.send(`TOGGLE ${match.hwnd}`));
  }
  return false;
}

// Hover prefetch and the click that follows ask within a second or two; share one scan
let bgInFlight: Promise<BackgroundApp[]> | null = null;
let bgCache: { at: number; apps: BackgroundApp[] } | null = null;
const BG_TTL_MS = 1200;

export function listBackgroundApps(): Promise<BackgroundApp[]> {
  if (bgCache && Date.now() - bgCache.at < BG_TTL_MS) return Promise.resolve(bgCache.apps);
  if (bgInFlight) return bgInFlight;
  bgInFlight = scanBackgroundApps()
    .then((apps) => {
      bgCache = { at: Date.now(), apps };
      return apps;
    })
    .finally(() => {
      bgInFlight = null;
    });
  return bgInFlight;
}

async function scanBackgroundApps(): Promise<BackgroundApp[]> {
  const raw = await win32Daemon.send('LIST_BG');
  if (!raw || !raw.startsWith('[')) return [];
  try {
    const parsed = JSON.parse(raw) as BackgroundApp[];
    const enriched = await Promise.all(
      parsed.map(async (item) => ({
        ...item,
        iconDataUrl: item.executablePath ? await getIconDataUrl(item.executablePath) : undefined
      }))
    );
    return enriched.sort((a, b) => a.displayName.localeCompare(b.displayName));
  } catch {
    return [];
  }
}

// Previews are requested while hovering and refreshed while the peek stays open; a short cache
// keeps quick hover-in/hover-out from re-rendering the same window over and over
const thumbCache = new Map<string, { url: string; at: number }>();
const THUMB_TTL_MS = 1500;

export async function getWindowThumbnail(hwnd: string): Promise<string | undefined> {
  if (!hwnd || !/^\d+$/.test(hwnd)) return undefined;
  const cached = thumbCache.get(hwnd);
  if (cached && Date.now() - cached.at < THUMB_TTL_MS) return cached.url || undefined;
  const res = await win32Daemon.send(`THUMB ${hwnd} 400 240`);
  const url = res.startsWith('data:image/') ? res : '';
  if (thumbCache.size > 60) thumbCache.clear();
  thumbCache.set(hwnd, { url, at: Date.now() });
  return url || undefined;
}

export async function closeWindowByHwnd(hwnd: string): Promise<boolean> {
  if (!hwnd || !/^\d+$/.test(hwnd)) return false;
  const res = await win32Daemon.send(`CLOSE_WIN ${hwnd}`);
  return res === 'ok';
}

export async function openAppByPid(pid: number, executablePath?: string): Promise<boolean> {
  if (Number.isInteger(pid) && pid > 4) {
    const res = await win32Daemon.send(`OPEN_APP ${pid}`);
    if (res === 'focused') return true;
    if (res.startsWith('aumid:')) {
      const aumid = res.slice(6).trim();
      if (aumid) {
        const child = spawn('explorer.exe', [`shell:AppsFolder\\${aumid}`], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        child.unref();
        return true;
      }
    }
    const candidateExe = res.startsWith('exe:') ? res.slice(4).trim() : executablePath;
    if (candidateExe) {
      // Handle tray helper binaries whose interactive UI lives in the parent binary (e.g. LGHUB)
      if (/\\lghub_system_tray\.exe$/i.test(candidateExe)) {
        const parentUi = path.resolve(path.dirname(candidateExe), '..', 'lghub.exe');
        if (fs.existsSync(parentUi)) return launchTarget(parentUi);
      }
      return launchTarget(candidateExe);
    }
  }
  return executablePath ? launchTarget(executablePath) : false;
}

function runTaskkillDetached(args: string[]): void {
  try {
    execFile('taskkill.exe', args, { timeout: 1500, windowsHide: true }, () => undefined);
  } catch {
    // Best-effort process tree sweep
  }
}

export async function quitAppByPid(pid: number, executablePath?: string): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 4) return false;
  const res = await win32Daemon.send(`KILL_APP ${pid}`);
  const pidList: string[] = res.startsWith('pids:')
    ? res
        .slice(5)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => /^\d+$/.test(s))
    : [String(pid)];

  if (pidList.length > 0) {
    const pidArgs: string[] = ['/F', '/T'];
    for (const id of pidList) {
      pidArgs.push('/PID', id);
    }
    runTaskkillDetached(pidArgs);
  }

  // Background image sweep only for non-system user executables
  if (
    executablePath &&
    !executablePath.toLowerCase().startsWith('c:\\windows\\') &&
    !/^(cmd|powershell|pwsh|conhost|explorer|node|python)\.exe$/i.test(path.basename(executablePath))
  ) {
    const img = path.basename(executablePath);
    if (img.toLowerCase().endsWith('.exe')) {
      runTaskkillDetached(['/F', '/T', '/IM', img]);
    }
  }

  return res.startsWith('pids:') || pidList.length > 0;
}

export async function launchTarget(target: string): Promise<boolean> {
  const trimmed = target.trim();
  if (!trimmed) return false;

  if (/^https?:\/\//i.test(trimmed) || /^ms-settings:/i.test(trimmed)) {
    await shell.openExternal(trimmed);
    return true;
  }

  if (trimmed.includes('\\') || trimmed.includes('/')) {
    const err = await shell.openPath(trimmed);
    return err === '';
  }

  try {
    const child = spawn('cmd.exe', ['/c', 'start', '""', trimmed], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export async function pickExecutableOrFolder(
  win: BrowserWindow | null
): Promise<{
  path: string;
  name: string;
  kind: 'app' | 'folder';
  iconDataUrl?: string;
  exeName?: string;
} | null> {
  const result = await dialog.showOpenDialog(win ?? undefined!, {
    title: 'Select an Application or Shortcut',
    properties: ['openFile'],
    filters: [
      { name: 'Applications & Shortcuts', extensions: ['exe', 'lnk', 'bat', 'cmd'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  const chosen = result.filePaths[0];
  const base = chosen.split(/[\\/]/).pop() ?? chosen;
  const cleanName = base.replace(/\.(exe|lnk|bat|cmd)$/i, '');
  const iconDataUrl = await getIconDataUrl(chosen);
  return {
    path: chosen,
    name: cleanName,
    kind: 'app',
    iconDataUrl,
    exeName: resolveExeName(chosen)
  };
}

export function parseVolumeJson(raw: string): { level: number; muted: boolean } {
  try {
    const parsed = JSON.parse(raw) as { level?: number; muted?: boolean };
    return {
      level: typeof parsed.level === 'number' ? Math.max(0, Math.min(100, parsed.level)) : 50,
      muted: Boolean(parsed.muted)
    };
  } catch {
    return { level: 50, muted: false };
  }
}

export async function getSystemVolume(): Promise<{ level: number; muted: boolean }> {
  const res = await win32Daemon.send('VOL_GET');
  return parseVolumeJson(res);
}

export async function setSystemVolume(level: number): Promise<{ level: number; muted: boolean }> {
  const clamped = Math.max(0, Math.min(100, Math.round(level)));
  const res = await win32Daemon.send(`VOL_SET ${clamped}`);
  return parseVolumeJson(res);
}

export async function toggleSystemMute(): Promise<{ level: number; muted: boolean }> {
  const res = await win32Daemon.send('VOL_MUTE');
  return parseVolumeJson(res);
}

export async function adjustSystemVolume(action: 'up' | 'down' | 'mute'): Promise<void> {
  const cmd = action === 'mute' ? 'VOL_MUTE' : action === 'down' ? 'VOL_DOWN' : 'VOL_UP';
  await win32Daemon.send(cmd);
}

let cachedNetInfo: NetworkInfo = { connected: false, kind: 'offline' };
let lastNetFetch = 0;

function hasActiveEthernetInterface(): boolean {
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs || /loopback|vEthernet|WSL|VMware|VirtualBox|Pseudo/i.test(name)) continue;
    for (const a of addrs) {
      if (!a.internal && a.family === 'IPv4') return true;
    }
  }
  return false;
}

export function getNetworkInfo(): Promise<NetworkInfo> {
  const now = Date.now();
  if (now - lastNetFetch < 3500) {
    return Promise.resolve(cachedNetInfo);
  }
  return new Promise((resolve) => {
    execFile('netsh', ['wlan', 'show', 'interfaces'], { timeout: 1400 }, (err, stdout) => {
      lastNetFetch = Date.now();
      if (!err && stdout) {
        const stateMatch = /^\s*State\s*:\s*(.+)$/im.exec(stdout);
        const state = stateMatch?.[1]?.trim().toLowerCase() ?? '';
        if (state === 'connected') {
          const ssid = /^\s*SSID\s*:\s*(.+)$/im.exec(stdout)?.[1]?.trim();
          const sigRaw = /^\s*Signal\s*:\s*(\d+)%/im.exec(stdout)?.[1];
          const band = /^\s*Band\s*:\s*(.+)$/im.exec(stdout)?.[1]?.trim();
          cachedNetInfo = {
            connected: true,
            kind: 'wifi',
            ssid: ssid || 'Wi-Fi',
            signalPercent: sigRaw ? Number(sigRaw) : undefined,
            band: band || undefined
          };
          resolve(cachedNetInfo);
          return;
        }
      }
      if (hasActiveEthernetInterface()) {
        cachedNetInfo = { connected: true, kind: 'ethernet' };
      } else {
        cachedNetInfo = { connected: false, kind: 'offline' };
      }
      resolve(cachedNetInfo);
    });
  });
}

export function runQuickSystemAction(
  action: 'lock' | 'taskmgr' | 'settings' | 'start' | 'quicksettings' | 'desktop'
): void {
  if (action === 'lock') {
    execFile('rundll32.exe', ['user32.dll,LockWorkStation']);
  } else if (action === 'taskmgr') {
    spawn('cmd.exe', ['/c', 'start', 'taskmgr.exe'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }).unref();
  } else if (action === 'settings') {
    void shell.openExternal('ms-settings:');
  } else if (action === 'desktop') {
    void win32Daemon.send('DESKTOP');
  } else if (action === 'start') {
    void win32Daemon.send('START');
  } else if (action === 'quicksettings') {
    void win32Daemon.send('QUICK');
  }
}

export async function getKeyboardLayoutCode(): Promise<string> {
  const res = await win32Daemon.send('KBD_LANG');
  return res === 'AR' || res === 'EN' || res === 'FR' || res === 'DE' ? res : 'EN';
}

export async function switchKeyboardLayout(): Promise<void> {
  await win32Daemon.send('KBD_SWITCH');
}

export async function setWindowsTaskbarReplacement(
  enable: boolean,
  edge: 'top' | 'bottom' = 'bottom',
  reservePx = 52,
  screenBounds?: { x: number; y: number; width: number; height: number }
): Promise<void> {
  if (!enable) {
    await win32Daemon.send('TASKBAR_SHOW');
    return;
  }
  const b = screenBounds ?? { x: 0, y: 0, width: 1920, height: 1080 };
  const top = edge === 'top' ? b.y + reservePx : b.y;
  const bottom = edge === 'bottom' ? b.y + b.height - reservePx : b.y + b.height;
  await win32Daemon.send(`TASKBAR_HIDE ${b.x} ${top} ${b.x + b.width} ${bottom}`);
}

export function restoreWindowsTaskbarSync(): void {
  const ps = `
    $code = @"
    using System;
    using System.Runtime.InteropServices;
    public class TaskbarRestore {
      [StructLayout(LayoutKind.Sequential)]
      public struct RECT { public int left, top, right, bottom; }
      [StructLayout(LayoutKind.Sequential)]
      public struct APPBARDATA {
        public int cbSize;
        public IntPtr hWnd;
        public uint uCallbackMessage;
        public uint uEdge;
        public RECT rc;
        public IntPtr lParam;
      }
      [DllImport("shell32.dll")] public static extern uint SHAppBarMessage(uint dwMessage, ref APPBARDATA pData);
      [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
      [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
      public static void Restore() {
        var tray = FindWindow("Shell_TrayWnd", null);
        if (tray != IntPtr.Zero) {
          ShowWindow(tray, 5);
          var abd = new APPBARDATA();
          abd.cbSize = Marshal.SizeOf(typeof(APPBARDATA));
          abd.hWnd = tray;
          abd.lParam = IntPtr.Zero;
          SHAppBarMessage(10, ref abd);
        }
        var sec = FindWindow("Shell_SecondaryTrayWnd", null);
        if (sec != IntPtr.Zero) {
          ShowWindow(sec, 5);
        }
      }
    }
"@
    Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue | Out-Null
    [TaskbarRestore]::Restore()
  `;
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      timeout: 6000
    });
  } catch {
    // Best effort on exit
  }
}
