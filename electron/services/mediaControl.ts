import { execFile } from 'node:child_process';
import type { MediaInfo } from '../../src/types';
import { win32Daemon } from './win32Daemon';

export function getCurrentMedia(): Promise<MediaInfo | null> {
  return new Promise((resolve) => {
    const ps = `
      Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
      $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
      function Await($WinRtTask, $ResultType) {
        $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
        $netTask = $asTask.Invoke($null, @($WinRtTask))
        $netTask.Wait(-1) | Out-Null
        $netTask.Result
      }
      [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
      $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
      $session = $mgr.GetCurrentSession()
      if ($null -eq $session) { exit 0 }
      $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $playback = $session.GetPlaybackInfo()
      $timeline = $session.GetTimelineProperties()
      [PSCustomObject]@{
        title = $props.Title
        artist = $props.Artist
        appId = $session.SourceAppUserModelId
        status = $playback.PlaybackStatus.ToString()
        posSec = [int]$timeline.Position.TotalSeconds
        endSec = [int]$timeline.EndTime.TotalSeconds
      } | ConvertTo-Json -Compress
    `;

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { timeout: 3000 },
      (err, stdout) => {
        if (err || !stdout.trim()) {
          resolve(null);
          return;
        }
        try {
          const raw = JSON.parse(stdout.trim()) as Partial<MediaInfo>;
          if (!raw.title && !raw.artist) {
            resolve(null);
            return;
          }
          const status =
            raw.status === 'Playing' || raw.status === 'Paused' || raw.status === 'Closed'
              ? raw.status
              : 'Unknown';
          resolve({
            title: raw.title ?? 'Unknown Title',
            artist: raw.artist ?? '',
            appId: raw.appId ?? '',
            status,
            posSec: typeof raw.posSec === 'number' ? raw.posSec : 0,
            endSec: typeof raw.endSec === 'number' ? raw.endSec : 0
          });
        } catch {
          resolve(null);
        }
      }
    );
  });
}

export async function sendMediaCommand(command: 'playPause' | 'next' | 'previous'): Promise<void> {
  const cmd =
    command === 'playPause'
      ? 'MEDIA_PLAYPAUSE'
      : command === 'next'
        ? 'MEDIA_NEXT'
        : 'MEDIA_PREV';
  await win32Daemon.send(cmd);
}
