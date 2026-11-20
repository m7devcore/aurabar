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

function stripQuotes(s: string): string {
  return s.trim().replace(/^"+|"+$/g, '');
}

function isProtocolUri(s: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[a-z]:[\\/]/i.test(s);
}

function spawnDetached(command: string, args: string[], cwd?: string): boolean {
  try {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}

interface StartAppEntry {
  Name: string;
  AppID: string;
}

let cachedStartApps: StartAppEntry[] | null = null;
let cachedStartAppsAt = 0;
let startAppsInFlight: Promise<StartAppEntry[]> | null = null;
const INSTALLED_APPS_TTL_MS = 180_000;

function getStartAppsList(): Promise<StartAppEntry[]> {
  if (cachedStartApps && Date.now() - cachedStartAppsAt < INSTALLED_APPS_TTL_MS) {
    return Promise.resolve(cachedStartApps);
  }
  if (startAppsInFlight) return startAppsInFlight;
  startAppsInFlight = new Promise<StartAppEntry[]>((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); Get-StartApps | ConvertTo-Json -Compress'
      ],
      { timeout: 6000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout) {
          resolve([]);
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim()) as StartAppEntry | StartAppEntry[];
          const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
          cachedStartApps = list.filter((x) => x && typeof x.Name === 'string' && typeof x.AppID === 'string');
          cachedStartAppsAt = Date.now();
          resolve(cachedStartApps);
        } catch {
          resolve([]);
        }
      }
    );
  }).finally(() => {
    startAppsInFlight = null;
  });
  return startAppsInFlight;
}

function parseWindowsAppsPackage(filePath: string): { pkgRoot: string; pfn: string; relExe: string } | null {
  const m = /^([a-z]:[\\/]+program files[\\/]+windowsapps[\\/]+([^\\/]+))(?:[\\/](.*))?$/i.exec(filePath);
  if (!m) return null;
  const pkgRoot = m[1];
  const fullName = m[2];
  const relExe = (m[3] || '').replace(/\//g, '\\').toLowerCase();
  const parts = fullName.split('_');
  if (parts.length < 2) return null;
  const pfn = `${parts[0]}_${parts[parts.length - 1]}`;
  return { pkgRoot, pfn, relExe };
}

function resolveWindowsAppsAumidSync(filePath: string): string | null {
  const info = parseWindowsAppsPackage(filePath);
  if (!info) return null;
  const manifestPath = path.join(info.pkgRoot, 'AppxManifest.xml');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const xml = fs.readFileSync(manifestPath, 'utf-8');
    const appTags = xml.match(/<Application\b[^>]*>/gi) ?? [];
    let firstId: string | null = null;
    const baseName = path.basename(info.relExe).toLowerCase();
    for (const tag of appTags) {
      const idMatch = /\bId\s*=\s*"([^"]+)"/i.exec(tag);
      if (!idMatch) continue;
      const appId = idMatch[1];
      if (!firstId) firstId = appId;
      const exeMatch = /\bExecutable\s*=\s*"([^"]+)"/i.exec(tag);
      if (exeMatch && info.relExe) {
        const tagExe = exeMatch[1].replace(/\//g, '\\').toLowerCase();
        if (tagExe === info.relExe || path.basename(tagExe) === baseName) {
          return `${info.pfn}!${appId}`;
        }
      }
    }
    if (firstId) return `${info.pfn}!${firstId}`;
  } catch {
    // Ignore unreadable manifests
  }
  return null;
}

async function resolveWindowsAppsAumidAsync(filePath: string): Promise<string | null> {
  const sync = resolveWindowsAppsAumidSync(filePath);
  if (sync) return sync;
  const info = parseWindowsAppsPackage(filePath);
  if (!info) return null;
  const apps = await getStartAppsList();
  const prefix = `${info.pfn.toLowerCase()}!`;
  const match = apps.find((a) => a.AppID.toLowerCase().startsWith(prefix));
  return match ? match.AppID : null;
}

function isLocalWindowsAppsAlias(filePath: string): boolean {
  return /[\\/]appdata[\\/]local[\\/]microsoft[\\/]windowsapps[\\/][^\\/]+\.exe$/i.test(filePath);
}

function resolveSquirrelTarget(
  filePath: string
): { updateExe?: string; processStart: string; newestExe?: string; parentDir: string } | null {
  const m = /^(.*)[\\/]app-[0-9]+(?:\.[0-9]+)*[\\/]([^\\/]+\.exe)$/i.exec(filePath);
  if (!m) return null;
  const parentDir = m[1];
  const exeName = m[2];
  const updateCandidate = path.join(parentDir, 'Update.exe');
  const updateExe = fs.existsSync(updateCandidate) ? updateCandidate : undefined;

  let newestExe: string | undefined;
  try {
    const dirs = fs
      .readdirSync(parentDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^app-[0-9]+/i.test(d.name))
      .map((d) => d.name)
      .sort((a, b) => {
        const pa = a.slice(4).split('.').map(Number);
        const pb = b.slice(4).split('.').map(Number);
        const len = Math.max(pa.length, pb.length);
        for (let i = 0; i < len; i++) {
          const diff = (pb[i] || 0) - (pa[i] || 0);
          if (diff !== 0) return diff;
        }
        return 0;
      });
    for (const dir of dirs) {
      const candidate = path.join(parentDir, dir, exeName);
      if (fs.existsSync(candidate)) {
        newestExe = candidate;
        break;
      }
    }
  } catch {
    // Ignore unreadable parent dir
  }

  return { updateExe, processStart: exeName, newestExe, parentDir };
}

function readUrlShortcut(filePath: string): { url?: string; iconFile?: string } {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const url = /^\s*URL\s*=\s*(.+)$/im.exec(raw)?.[1]?.trim();
    const iconFile = /^\s*IconFile\s*=\s*(.+)$/im.exec(raw)?.[1]?.trim();
    return { url, iconFile };
  } catch {
    return {};
  }
}

function resolveKnownSystemPath(target: string): string | null {
  const cleaned = stripQuotes(target);
  const lower = cleaned.toLowerCase();
  if (fs.existsSync(cleaned)) return cleaned;
  const winDir = process.env.WINDIR || 'C:\\Windows';
  if (lower === 'explorer.exe' || lower === 'explorer') return path.join(winDir, 'explorer.exe');
  if (lower === 'calc.exe' || lower === 'calc') return path.join(winDir, 'System32', 'calc.exe');
  if (lower === 'notepad.exe' || lower === 'notepad') return path.join(winDir, 'System32', 'notepad.exe');
  if (lower === 'cmd.exe' || lower === 'cmd') return path.join(winDir, 'System32', 'cmd.exe');
  if (lower === 'powershell.exe' || lower === 'powershell') {
    return path.join(winDir, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  }
  if (lower === 'mspaint.exe' || lower === 'mspaint') return path.join(winDir, 'System32', 'mspaint.exe');
  if (lower === 'taskmgr.exe' || lower === 'taskmgr') return path.join(winDir, 'System32', 'Taskmgr.exe');
  if (lower === 'wt.exe' || lower === 'wt') {
    const wt = path.join(
      process.env.LOCALAPPDATA || '',
      'Microsoft',
      'WindowsApps',
      'wt.exe'
    );
    if (fs.existsSync(wt)) return wt;
  }
  if (lower === 'code' || lower === 'code.exe') {
    const candidates = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
      'C:\\Program Files\\Microsoft VS Code\\Code.exe',
      'C:\\Program Files (x86)\\Microsoft VS Code\\Code.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code Insiders', 'Code - Insiders.exe')
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }
  return null;
}

export async function getIconDataUrl(target: string): Promise<string | undefined> {
  const cleaned = stripQuotes(target || '');
  if (!cleaned) return undefined;
  const isShellPath = /^shell:/i.test(cleaned);
  if (!isShellPath && isProtocolUri(cleaned)) {
    return undefined;
  }
  const key = cleaned.toLowerCase();
  if (iconCache.has(key)) return iconCache.get(key);
  const missAt = iconMissAt.get(key);
  if (missAt !== undefined && Date.now() - missAt < ICON_MISS_RETRY_MS) return undefined;

  let resolved = isShellPath ? cleaned : resolveKnownSystemPath(cleaned) ?? cleaned;

  // If a Squirrel app auto-updated and deleted the old app-<ver> folder, pull the icon from the newest one
  if (!isShellPath && !fs.existsSync(resolved)) {
    const sq = resolveSquirrelTarget(resolved);
    if (sq?.newestExe) resolved = sq.newestExe;
  }

  // .url shortcuts (e.g. Steam games) often declare IconFile= pointing to their real .ico/.exe
  if (!isShellPath && resolved.toLowerCase().endsWith('.url')) {
    const { iconFile } = readUrlShortcut(resolved);
    if (iconFile && fs.existsSync(iconFile)) {
      resolved = iconFile;
    }
  }

  // Prefer the shortcut's underlying .ico or .exe target so icons render cleanly without shortcut arrows
  if (!isShellPath && resolved.toLowerCase().endsWith('.lnk')) {
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

  // Primary: native Windows Shell SHGetFileInfo (works for .lnk, .exe, .ico, shell:AppsFolder, and folders)
  const shellIcon = await win32Daemon.send(`ICON ${resolved}`);
  if (shellIcon.startsWith('data:image/png;base64,')) {
    iconCache.set(key, shellIcon);
    return shellIcon;
  }

  // Fallback to original .lnk/.url path if resolved target failed
  if (resolved !== cleaned) {
    const origIcon = await win32Daemon.send(`ICON ${cleaned}`);
    if (origIcon.startsWith('data:image/png;base64,')) {
      iconCache.set(key, origIcon);
      return origIcon;
    }
  }

  // For WindowsApps paths, fall back to shell:AppsFolder\<AUMID> icon extraction
  if (!isShellPath && parseWindowsAppsPackage(cleaned)) {
    const aumid = resolveWindowsAppsAumidSync(cleaned);
    if (aumid) {
      const appIcon = await win32Daemon.send(`ICON shell:AppsFolder\\${aumid}`);
      if (appIcon.startsWith('data:image/png;base64,')) {
        iconCache.set(key, appIcon);
        return appIcon;
      }
    }
  }

  // Final fallback: Electron app.getFileIcon (skip for virtual shell: paths)
  if (!isShellPath) {
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
  }
  if (iconMissAt.size > 500) iconMissAt.clear();
  iconMissAt.set(key, Date.now());
  return undefined;
}

const KNOWN_STORE_EXE_HINTS: Array<[RegExp, string]> = [
  [/windowscalculator/i, 'calculatorapp'],
  [/windowsterminal/i, 'windowsterminal'],
  [/whatsapp/i, 'whatsapp'],
  [/spotifymusic/i, 'spotify'],
  [/windows\.photos/i, 'photos'],
  [/windowscamera/i, 'windowscamera'],
  [/windowsnotepad/i, 'notepad'],
  [/^microsoft\.paint/i, 'mspaint'],
  [/screensketch/i, 'snippingtool'],
  [/gamingapp/i, 'xboxpcapp'],
  [/windowsstore/i, 'winstore.app'],
  [/windowsalarms/i, 'time'],
  [/claude/i, 'claude']
];

export function resolveExeName(target: string): string | undefined {
  const trimmed = stripQuotes(target);
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();

  if (lower.startsWith('shell:appsfolder\\')) {
    const aumid = trimmed.slice('shell:appsfolder\\'.length);
    for (const [re, exe] of KNOWN_STORE_EXE_HINTS) {
      if (re.test(aumid)) return exe;
    }
    const bangIdx = aumid.lastIndexOf('!');
    if (bangIdx !== -1) {
      const appId = aumid.slice(bangIdx + 1).replace(/\.exe$/i, '').toLowerCase();
      if (appId && appId !== 'app' && !appId.includes('.')) {
        return appId;
      }
    }
    return undefined;
  }

  if (isProtocolUri(trimmed) || lower.endsWith('.url')) {
    return undefined;
  }

  if (lower === 'wt.exe' || lower === 'wt') return 'windowsterminal';
  if (lower === 'calc.exe' || lower === 'calc') return 'calculatorapp';
  if (lower === 'code' || lower === 'code.exe') return 'code';

  if (lower.endsWith('.lnk')) {
    try {
      const link = shell.readShortcutLink(trimmed);
      if (link.target) {
        const base = path.basename(link.target).replace(/\.exe$/i, '').toLowerCase();
        // Squirrel shortcuts (Discord, Slack, Postman...) point to Update.exe --processStart <App>.exe
        if (base === 'update' && link.args) {
          const procMatch = /--processStart(?:=|\s+)"?([^"\s]+)"?/i.exec(link.args);
          if (procMatch?.[1]) {
            return path.basename(procMatch[1]).replace(/\.exe$/i, '').toLowerCase();
          }
        }
        if (base && base !== 'update') {
          return base;
        }
      }
    } catch {
      // Fallback to shortcut name
    }
  }
  return path.basename(trimmed).replace(/\.(exe|lnk|bat|cmd|url)$/i, '').toLowerCase();
}

let cachedInstalledApps: InstalledApp[] | null = null;
let cachedInstalledAppsAt = 0;

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
      } else if (entry.isFile() && /\.(lnk|url)$/i.test(entry.name)) {
        const base = entry.name.replace(/\.(lnk|url)$/i, '');
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
  if (cachedInstalledApps && Date.now() - cachedInstalledAppsAt < INSTALLED_APPS_TTL_MS) {
    return cachedInstalledApps;
  }

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

  // Merge Microsoft Store / UWP / MSIX apps (WhatsApp, Spotify Store, Calculator, Photos, Terminal...)
  // which have no .lnk file in Start Menu\Programs and launch via shell:AppsFolder\<AUMID>
  const startApps = await getStartAppsList();
  for (const sa of startApps) {
    if (!sa.Name || !sa.AppID || !sa.AppID.includes('!')) continue;
    if (/(uninstall|help|readme|feedback hub|get started|tips)/i.test(sa.Name)) continue;
    const key = sa.Name.toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, { name: sa.Name, fullPath: `shell:AppsFolder\\${sa.AppID}` });
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
  cachedInstalledAppsAt = Date.now();
  return apps;
}

export async function createPinnedAppFromPath(filePath: string): Promise<PinnedApp | null> {
  const clean = stripQuotes(filePath);
  if (!clean || !fs.existsSync(clean)) return null;
  const isDir = fs.statSync(clean).isDirectory();
  const base = path.basename(clean).replace(/\.(exe|lnk|url|bat|cmd)$/i, '');
  let target = clean;
  if (!isDir && parseWindowsAppsPackage(clean)) {
    const aumid = await resolveWindowsAppsAumidAsync(clean);
    if (aumid) target = `shell:AppsFolder\\${aumid}`;
  }
  const iconDataUrl = isDir ? undefined : await getIconDataUrl(target);
  return {
    id: `pin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: base || clean,
    target,
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
        let iconDataUrl = w.aumid
          ? await getIconDataUrl(`shell:AppsFolder\\${w.aumid}`)
          : undefined;
        if (!iconDataUrl && w.executablePath) {
          iconDataUrl = await getIconDataUrl(w.executablePath);
        }
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
      parsed.map(async (item) => {
        let iconDataUrl = item.aumid
          ? await getIconDataUrl(`shell:AppsFolder\\${item.aumid}`)
          : undefined;
        if (!iconDataUrl && item.executablePath) {
          iconDataUrl = await getIconDataUrl(item.executablePath);
        }
        return { ...item, iconDataUrl };
      })
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
  const cleaned = stripQuotes(target);
  if (!cleaned) return false;

  // 1) Virtual shell targets (Microsoft Store / UWP / MSIX apps via shell:AppsFolder\<AUMID>)
  if (/^shell:/i.test(cleaned)) {
    return spawnDetached('explorer.exe', [cleaned]);
  }

  // 2) Any URL or custom protocol (https://, ms-settings:, steam://, discord://, spotify:, ...)
  if (isProtocolUri(cleaned)) {
    try {
      await shell.openExternal(cleaned);
      return true;
    } catch {
      return spawnDetached('explorer.exe', [cleaned]);
    }
  }

  // 3) Microsoft Store / MSIX executable inside C:\Program Files\WindowsApps\...
  // Windows blocks direct execution there with Access Denied; resolve its AUMID and open via shell:AppsFolder
  if (parseWindowsAppsPackage(cleaned)) {
    const aumid = await resolveWindowsAppsAumidAsync(cleaned);
    if (aumid) {
      return spawnDetached('explorer.exe', [`shell:AppsFolder\\${aumid}`]);
    }
  }

  // 4) .url Internet / Steam / Epic shortcuts
  if (cleaned.toLowerCase().endsWith('.url')) {
    const { url } = readUrlShortcut(cleaned);
    if (url) {
      try {
        await shell.openExternal(url);
        return true;
      } catch {
        // Fall through to explorer.exe
      }
    }
    return spawnDetached('explorer.exe', [cleaned]);
  }

  let resolved = resolveKnownSystemPath(cleaned) ?? cleaned;

  // 5) App Execution Aliases in %LOCALAPPDATA%\Microsoft\WindowsApps\*.exe (wt.exe, spotify.exe, whatsapp.exe...)
  if (isLocalWindowsAppsAlias(resolved)) {
    return spawnDetached('explorer.exe', [resolved]);
  }

  // 6) Squirrel auto-updating apps (Discord, Slack, Postman...) whose pinned app-<ver> folder was replaced
  const sq = resolveSquirrelTarget(resolved);
  if (sq && !fs.existsSync(resolved)) {
    if (sq.updateExe) {
      return spawnDetached(sq.updateExe, ['--processStart', sq.processStart], sq.parentDir);
    }
    if (sq.newestExe) {
      resolved = sq.newestExe;
    }
  }

  // 7) Regular filesystem paths (.exe, .lnk, folders, documents)
  if (resolved.includes('\\') || resolved.includes('/')) {
    const err = await shell.openPath(resolved);
    if (err === '') return true;

    // shell.openPath can fail on UAC-elevated apps, IDList-only Store .lnk shortcuts, or working-dir-sensitive apps.
    // explorer.exe delegates to the user's Shell cleanly (including UAC prompt & .lnk metadata).
    if (sq?.updateExe) {
      return spawnDetached(sq.updateExe, ['--processStart', sq.processStart], sq.parentDir);
    }
    return spawnDetached('explorer.exe', [resolved]);
  }

  // 8) Bare command name (fallback via cmd start)
  return spawnDetached('cmd.exe', ['/c', 'start', '""', resolved]);
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
      { name: 'Applications & Shortcuts', extensions: ['exe', 'lnk', 'url', 'bat', 'cmd'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  const chosen = result.filePaths[0];
  const base = chosen.split(/[\\/]/).pop() ?? chosen;
  const cleanName = base.replace(/\.(exe|lnk|url|bat|cmd)$/i, '');
  let targetPath = chosen;
  if (parseWindowsAppsPackage(chosen)) {
    const aumid = await resolveWindowsAppsAumidAsync(chosen);
    if (aumid) targetPath = `shell:AppsFolder\\${aumid}`;
  }
  const iconDataUrl = await getIconDataUrl(targetPath);
  return {
    path: targetPath,
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
let noWifiBackoffUntil = 0;

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
  // Desktops without a Wi-Fi adapter shouldn't spawn netsh every 3.5s; check Ethernet cheaply in-process
  if (now < noWifiBackoffUntil) {
    lastNetFetch = now;
    cachedNetInfo = hasActiveEthernetInterface()
      ? { connected: true, kind: 'ethernet' }
      : { connected: false, kind: 'offline' };
    return Promise.resolve(cachedNetInfo);
  }
  return new Promise((resolve) => {
    execFile(
      'netsh',
      ['wlan', 'show', 'interfaces'],
      { timeout: 1400, windowsHide: true },
      (err, stdout) => {
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
          if (/no wireless interface|wlansvc/i.test(stdout)) {
            noWifiBackoffUntil = Date.now() + 30_000;
          }
        } else if (err) {
          noWifiBackoffUntil = Date.now() + 30_000;
        }
        if (hasActiveEthernetInterface()) {
          cachedNetInfo = { connected: true, kind: 'ethernet' };
        } else {
          cachedNetInfo = { connected: false, kind: 'offline' };
        }
        resolve(cachedNetInfo);
      }
    );
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
      [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string lpClassName, string lpWindowName);
      [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
      public static void Restore() {
        string[] classes = new string[] { "Shell_TrayWnd", "Shell_SecondaryTrayWnd" };
        for (int i = 0; i < classes.Length; i++) {
          IntPtr h = IntPtr.Zero;
          while ((h = FindWindowEx(IntPtr.Zero, h, classes[i], null)) != IntPtr.Zero) {
            ShowWindow(h, 5);
            if (i == 0) {
              var abd = new APPBARDATA();
              abd.cbSize = Marshal.SizeOf(typeof(APPBARDATA));
              abd.hWnd = h;
              abd.lParam = IntPtr.Zero;
              SHAppBarMessage(10, ref abd);
            }
          }
        }
      }
    }
"@
    Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue | Out-Null
    [TaskbarRestore]::Restore()
  `;
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      timeout: 6000,
      windowsHide: true
    });
  } catch {
    // Best effort on exit
  }
}
