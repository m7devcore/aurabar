import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { nativeImage } from 'electron';
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
$asStreamMethod = ([System.IO.WindowsRuntimeStreamExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsStream' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IRandomAccessStream' })[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  if (-not $netTask.Wait(2000)) { throw 'timeout' }
  $netTask.Result
}
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime] | Out-Null
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$lastThumbSig = ''
$lastTrackKey = ''
$thumbChecksLeft = 0
$pollCount = 0
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line -eq 'EXIT') { break }
  $parts = $line.Split(' ')
  $id = $parts[0]
  if ($parts.Length -ge 3 -and $parts[1] -eq 'SEEK') {
    $ok = '0'
    try {
      $session = $mgr.GetCurrentSession()
      if ($null -ne $session) {
        $reqTicks = [long]$parts[2]
        if ($reqTicks -lt 0) { $reqTicks = 0 }
        $tl = $session.GetTimelineProperties()
        $maxTicks = [long]$tl.EndTime.Ticks
        if ($maxTicks -gt 0 -and $reqTicks -gt $maxTicks) { $reqTicks = $maxTicks }
        $res = Await ($session.TryChangePlaybackPositionAsync($reqTicks)) ([bool])
        if ($res) { $ok = '1' }
      }
    } catch {
      $ok = '0'
    }
    [Console]::Out.WriteLine("$id $ok")
    [Console]::Out.Flush()
    continue
  }
  $out = ''
  $pollCount++
  try {
    $session = $mgr.GetCurrentSession()
    if ($null -ne $session) {
      $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $playback = $session.GetPlaybackInfo()
      $timeline = $session.GetTimelineProperties()
      $updated = 0
      try { $updated = $timeline.LastUpdatedTime.ToUnixTimeMilliseconds() } catch { $updated = 0 }
      $trackKey = ($session.SourceAppUserModelId + '|' + $props.Title + '|' + $props.Artist)
      if ($trackKey -ne $lastTrackKey) {
        $lastTrackKey = $trackKey
        $thumbChecksLeft = 6
      }
      $thumbSig = $lastThumbSig
      $thumbB64 = $null
      $shouldReadThumb = ($thumbChecksLeft -gt 0 -or $lastThumbSig -eq '' -or ($pollCount % 6 -eq 0))
      if ($shouldReadThumb) {
        if ($thumbChecksLeft -gt 0) { $thumbChecksLeft-- }
        $thumbSig = ''
        try {
          if ($null -ne $props.Thumbnail -and $null -ne $asStreamMethod) {
            $st = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
            if ($null -ne $st) {
              $ns = $asStreamMethod.Invoke($null, @($st))
              $ms = [System.IO.MemoryStream]::new()
              try {
                $ns.CopyTo($ms)
                $bytes = $ms.ToArray()
              } finally {
                $ms.Dispose()
                $ns.Dispose()
              }
              $len = $bytes.Length
              if ($len -gt 32 -and $len -le 3145728) {
                $mid = [Math]::Max(0, [int]($len / 2) - 12)
                $tail = [Math]::Max(0, $len - 24)
                $thumbSig = ([string]$len + ':' + [Convert]::ToBase64String($bytes, 0, [Math]::Min(24, $len)) + ':' + [Convert]::ToBase64String($bytes, $mid, [Math]::Min(24, $len - $mid)) + ':' + [Convert]::ToBase64String($bytes, $tail, [Math]::Min(24, $len - $tail)))
                if ($thumbSig -ne $lastThumbSig) {
                  $lastThumbSig = $thumbSig
                  $thumbB64 = [Convert]::ToBase64String($bytes)
                }
              }
            }
          } else {
            $lastThumbSig = ''
          }
        } catch {
          $thumbSig = ''
          $thumbB64 = $null
        }
      }
      $payload = [ordered]@{
        title = $props.Title
        artist = $props.Artist
        album = $props.AlbumTitle
        appId = $session.SourceAppUserModelId
        status = $playback.PlaybackStatus.ToString()
        posSec = [int]$timeline.Position.TotalSeconds
        endSec = [int]$timeline.EndTime.TotalSeconds
        posMs = [long]$timeline.Position.TotalMilliseconds
        posAt = $updated
        thumbSig = $thumbSig
      }
      if ($null -ne $thumbB64) { $payload['thumbB64'] = $thumbB64 }
      $out = [PSCustomObject]$payload | ConvertTo-Json -Compress
    } else {
      $lastThumbSig = ''
      $lastTrackKey = ''
      $thumbChecksLeft = 0
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
const RESULT_TTL_MS = 250;
const RESPAWN_BACKOFF_MS = 30000;

let worker: ChildProcessByStdio<Writable, Readable, null> | null = null;
let workerBuffer = '';
let workerSpawnedAt = 0;
let consecutiveTimeouts = 0;
let nextRequestId = 1;
let lastSpawnFailedAt = 0;
const pendingRequests = new Map<number, (line: string) => void>();

let inFlight: Promise<MediaInfo | null> | null = null;
let lastResult: MediaInfo | null = null;
let lastResultAt = 0;
let lastThumbSig = '';
let lastThumbDataUrl: string | undefined;

function resetThumbCache(): void {
  lastThumbSig = '';
  lastThumbDataUrl = undefined;
}

function encodeThumbnailDataUrl(thumbB64: string): string | undefined {
  try {
    const raw = Buffer.from(thumbB64, 'base64');
    if (raw.length < 32) return undefined;
    const img = nativeImage.createFromBuffer(raw);
    if (!img.isEmpty()) {
      const { width, height } = img.getSize();
      const maxDim = 192;
      const resized =
        width > maxDim || height > maxDim
          ? width >= height
            ? img.resize({ width: maxDim, quality: 'good' })
            : img.resize({ height: maxDim, quality: 'good' })
          : img;
      const jpg = resized.toJPEG(88);
      if (jpg.length > 0) {
        return `data:image/jpeg;base64,${jpg.toString('base64')}`;
      }
      return resized.toDataURL();
    }
    // Fallback if nativeImage could not decode (e.g. WebP on older Electron): sniff magic bytes
    let mime = 'image/jpeg';
    if (raw[0] === 0x89 && raw[1] === 0x50 && raw[2] === 0x4e && raw[3] === 0x47) {
      mime = 'image/png';
    } else if (raw[0] === 0x52 && raw[1] === 0x49 && raw[2] === 0x46 && raw[3] === 0x46) {
      mime = 'image/webp';
    }
    return `data:${mime};base64,${thumbB64}`;
  } catch {
    return undefined;
  }
}

function killStalledWorker(proc: ChildProcessByStdio<Writable, Readable, null>): void {
  if (worker !== proc) return;
  worker = null;
  workerBuffer = '';
  consecutiveTimeouts = 0;
  resetThumbCache();
  const waiters = Array.from(pendingRequests.values());
  pendingRequests.clear();
  for (const resolve of waiters) resolve('');
  try {
    proc.kill();
  } catch {
    // Ignore kill errors
  }
}

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
  workerSpawnedAt = spawnedAt;
  consecutiveTimeouts = 0;

  proc.stdin.on('error', () => undefined);
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk: string) => {
    if (worker !== proc) return;
    workerBuffer += chunk;
    let idx = workerBuffer.indexOf('\n');
    while (idx !== -1) {
      const line = workerBuffer.slice(0, idx).replace(/\r$/, '');
      workerBuffer = workerBuffer.slice(idx + 1);
      const sp = line.indexOf(' ');
      const id = Number(sp === -1 ? line : line.slice(0, sp));
      const resolve = pendingRequests.get(id);
      if (resolve) {
        consecutiveTimeouts = 0;
        pendingRequests.delete(id);
        resolve(sp === -1 ? '' : line.slice(sp + 1));
      }
      idx = workerBuffer.indexOf('\n');
    }
  });
  proc.on('exit', () => {
    if (worker !== proc) return;
    worker = null;
    workerBuffer = '';
    consecutiveTimeouts = 0;
    resetThumbCache();
    // A worker that dies right away (e.g. WinRT media API unavailable) should not be respawned
    // on every poll
    if (Date.now() - spawnedAt < 5000) lastSpawnFailedAt = Date.now();
    const waiters = Array.from(pendingRequests.values());
    pendingRequests.clear();
    for (const resolve of waiters) resolve('');
  });
  return proc;
}

function queryWorker(payload?: string): Promise<string> {
  return new Promise((resolve) => {
    const proc = ensureWorker();
    if (!proc) {
      resolve('');
      return;
    }
    const id = nextRequestId++;
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      // Only treat as hung after cold PowerShell+WinRT startup has had time to settle
      if (worker === proc && Date.now() - workerSpawnedAt > 6500) {
        consecutiveTimeouts += 1;
        if (consecutiveTimeouts >= 2) {
          killStalledWorker(proc);
        }
      }
      resolve('');
    }, REQUEST_TIMEOUT_MS);
    pendingRequests.set(id, (line) => {
      clearTimeout(timer);
      resolve(line);
    });
    try {
      proc.stdin.write(payload ? `${id} ${payload}\n` : `${id}\n`);
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

interface RawMediaPayload extends Partial<MediaInfo> {
  thumbSig?: string;
  thumbB64?: string;
}

function parseMedia(stdout: string): MediaInfo | null {
  if (!stdout.trim()) return null;
  try {
    const receivedAt = Date.now();
    const raw = JSON.parse(stdout.trim()) as RawMediaPayload;
    if (!raw.title && !raw.artist) return null;
    const status =
      raw.status === 'Playing' || raw.status === 'Paused' || raw.status === 'Closed'
        ? raw.status
        : 'Unknown';

    const sig = typeof raw.thumbSig === 'string' ? raw.thumbSig : '';
    let thumbnailDataUrl: string | undefined;
    if (!sig) {
      resetThumbCache();
    } else if (typeof raw.thumbB64 === 'string' && raw.thumbB64.length > 0) {
      thumbnailDataUrl = encodeThumbnailDataUrl(raw.thumbB64);
      lastThumbSig = sig;
      lastThumbDataUrl = thumbnailDataUrl;
    } else if (sig === lastThumbSig && lastThumbDataUrl) {
      thumbnailDataUrl = lastThumbDataUrl;
    }

    return {
      title: raw.title ?? 'Unknown Title',
      artist: raw.artist ?? '',
      appId: raw.appId ?? '',
      status,
      posSec: typeof raw.posSec === 'number' ? raw.posSec : 0,
      endSec: typeof raw.endSec === 'number' ? raw.endSec : 0,
      album: typeof raw.album === 'string' ? raw.album : '',
      posMs: typeof raw.posMs === 'number' ? raw.posMs : (raw.posSec ?? 0) * 1000,
      posAt: sanePosAt(raw, receivedAt),
      thumbnailDataUrl
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

export async function seekMediaPosition(positionSec: number): Promise<boolean> {
  if (!Number.isFinite(positionSec) || positionSec < 0) return false;
  const ticks = Math.max(0, Math.round(positionSec * 10_000_000));
  const res = await queryWorker(`SEEK ${ticks}`);
  lastResultAt = 0;
  return res.trim() === '1';
}
