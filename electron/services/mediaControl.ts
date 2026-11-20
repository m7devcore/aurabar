import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import type { MediaInfo } from '../../src/types';
import { win32Daemon } from './win32Daemon';

// A single long-lived PowerShell host loads the WinRT media projection once and answers
// "<id>" lines with "<id> <json>". Spawning a fresh PowerShell per poll (both the dock and the
// island poll every 1.5-2.5s) cost a full process start + WinRT load each time.
function buildMediaWorkerScript(parentPid: number): string {
  return `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$parentPid = ${parentPid}
if ($parentPid -gt 4) {
  $wd = [PowerShell]::Create()
  $null = $wd.AddScript({
    param($ppid)
    try {
      $p = [System.Diagnostics.Process]::GetProcessById($ppid)
      $p.WaitForExit()
    } catch {}
    [Environment]::Exit(0)
  }).AddArgument($parentPid)
  $null = $wd.BeginInvoke()
}
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  if (-not $netTask.Wait(2000)) { throw 'timeout' }
  $netTask.Result
}
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
while ($true) {
  $id = [Console]::In.ReadLine()
  if ($null -eq $id -or $id -eq 'EXIT') { break }
  $out = ''
  try {
    $session = $mgr.GetCurrentSession()
    if ($null -ne $session) {
      $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $playback = $session.GetPlaybackInfo()
      $timeline = $session.GetTimelineProperties()
      $updated = 0
      try { $updated = $timeline.LastUpdatedTime.ToUnixTimeMilliseconds() } catch { $updated = 0 }
      $out = [PSCustomObject]@{
        title = $props.Title
        artist = $props.Artist
        album = $props.AlbumTitle
        appId = $session.SourceAppUserModelId
        status = $playback.PlaybackStatus.ToString()
        posSec = [int]$timeline.Position.TotalSeconds
        endSec = [int]$timeline.EndTime.TotalSeconds
        posMs = [long]$timeline.Position.TotalMilliseconds
        posAt = $updated
      } | ConvertTo-Json -Compress
    }
  } catch {
    $out = ''
  }
  [Console]::Out.WriteLine("$id $out")
  [Console]::Out.Flush()
}
[Environment]::Exit(0)
`;
}

const REQUEST_TIMEOUT_MS = 4000;
const RESULT_TTL_MS = 600;
const RESPAWN_BACKOFF_MS = 30000;

let worker: ChildProcessByStdio<Writable, Readable, null> | null = null;
let workerBuffer = '';
let nextRequestId = 1;
let lastSpawnFailedAt = 0;
const pendingRequests = new Map<number, (line: string) => void>();

let inFlight: Promise<MediaInfo | null> | null = null;
let lastResult: MediaInfo | null = null;
let lastResultAt = 0;

function ensureWorker(): ChildProcessByStdio<Writable, Readable, null> | null {
  if (worker && !worker.killed) return worker;
  if (Date.now() - lastSpawnFailedAt < RESPAWN_BACKOFF_MS) return null;

  const encoded = Buffer.from(buildMediaWorkerScript(process.pid), 'utf16le').toString('base64');
  const spawnedAt = Date.now();
  const proc = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }
  );
  worker = proc;
  workerBuffer = '';

  proc.stdin.on('error', () => undefined);
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk: string) => {
    workerBuffer += chunk;
    let idx = workerBuffer.indexOf('\n');
    while (idx !== -1) {
      const line = workerBuffer.slice(0, idx).replace(/\r$/, '');
      workerBuffer = workerBuffer.slice(idx + 1);
      const sp = line.indexOf(' ');
      const id = Number(sp === -1 ? line : line.slice(0, sp));
      const resolve = pendingRequests.get(id);
      if (resolve) {
        pendingRequests.delete(id);
        resolve(sp === -1 ? '' : line.slice(sp + 1));
      }
      idx = workerBuffer.indexOf('\n');
    }
  });
  proc.on('exit', () => {
    if (worker !== proc) return;
    worker = null;
    // A worker that dies right away (e.g. WinRT media API unavailable) should not be respawned
    // on every poll
    if (Date.now() - spawnedAt < 5000) lastSpawnFailedAt = Date.now();
    const waiters = Array.from(pendingRequests.values());
    pendingRequests.clear();
    for (const resolve of waiters) resolve('');
  });
  return proc;
}

function queryWorker(): Promise<string> {
  return new Promise((resolve) => {
    const proc = ensureWorker();
    if (!proc) {
      resolve('');
      return;
    }
    const id = nextRequestId++;
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      resolve('');
    }, REQUEST_TIMEOUT_MS);
    pendingRequests.set(id, (line) => {
      clearTimeout(timer);
      resolve(line);
    });
    try {
      proc.stdin.write(`${id}\n`);
    } catch {
      pendingRequests.delete(id);
      clearTimeout(timer);
      resolve('');
    }
  });
}

// Players that never fill LastUpdatedTime report year 1, and a few report the future; fall
// back to "now" so the renderer's extrapolation stays sane
function sanePosAt(raw: Partial<MediaInfo>, receivedAt: number): number {
  const at = typeof raw.posAt === 'number' ? raw.posAt : 0;
  if (at < 946684800000 || at > receivedAt + 2000) return receivedAt;
  const endMs = (raw.endSec ?? 0) * 1000;
  const posMs = typeof raw.posMs === 'number' ? raw.posMs : 0;
  // Extrapolating from a stale stamp would run past the end of the track
  if (endMs > 0 && raw.status === 'Playing' && posMs + (receivedAt - at) > endMs + 3000) {
    return receivedAt;
  }
  return at;
}

function parseMedia(stdout: string): MediaInfo | null {
  if (!stdout.trim()) return null;
  try {
    const receivedAt = Date.now();
    const raw = JSON.parse(stdout.trim()) as Partial<MediaInfo>;
    if (!raw.title && !raw.artist) return null;
    const status =
      raw.status === 'Playing' || raw.status === 'Paused' || raw.status === 'Closed'
        ? raw.status
        : 'Unknown';
    return {
      title: raw.title ?? 'Unknown Title',
      artist: raw.artist ?? '',
      appId: raw.appId ?? '',
      status,
      posSec: typeof raw.posSec === 'number' ? raw.posSec : 0,
      endSec: typeof raw.endSec === 'number' ? raw.endSec : 0,
      album: typeof raw.album === 'string' ? raw.album : '',
      posMs: typeof raw.posMs === 'number' ? raw.posMs : (raw.posSec ?? 0) * 1000,
      posAt: sanePosAt(raw, receivedAt)
    };
  } catch {
    return null;
  }
}

export function getCurrentMedia(): Promise<MediaInfo | null> {
  // The dock and island poll independently; share one in-flight query and a short-lived result
  if (Date.now() - lastResultAt < RESULT_TTL_MS) return Promise.resolve(lastResult);
  if (inFlight) return inFlight;
  inFlight = queryWorker()
    .then(parseMedia)
    .then((info) => {
      lastResult = info;
      lastResultAt = Date.now();
      return info;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

export function stopMediaWorker(): void {
  const proc = worker;
  worker = null;
  if (!proc) return;
  try {
    proc.stdin.write('EXIT\n');
    proc.stdin.end();
  } catch {
    try {
      proc.kill();
    } catch {
      // Ignore shutdown errors
    }
  }
}

export async function sendMediaCommand(command: 'playPause' | 'next' | 'previous'): Promise<void> {
  const cmd =
    command === 'playPause'
      ? 'MEDIA_PLAYPAUSE'
      : command === 'next'
        ? 'MEDIA_NEXT'
        : 'MEDIA_PREV';
  await win32Daemon.send(cmd);
  // Invalidate so the follow-up refresh reflects the new play state instead of the cached one
  lastResultAt = 0;
}
