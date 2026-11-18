import os from 'node:os';
import { execFile } from 'node:child_process';
import type { SystemStats } from '../../src/types';

let prevIdle = 0;
let prevTotal = 0;

function readCpuUsage(): number {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq;
  }

  if (prevTotal === 0) {
    prevIdle = idle;
    prevTotal = total;
    return 0;
  }

  const idleDiff = idle - prevIdle;
  const totalDiff = total - prevTotal;
  prevIdle = idle;
  prevTotal = total;

  if (totalDiff <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((totalDiff - idleDiff) / totalDiff) * 100)));
}

interface SlowHardwareInfo {
  batteryPercent: number | null;
  batteryCharging: boolean | null;
  diskUsedPercent: number | null;
  diskFreeGb: number | null;
  diskTotalGb: number | null;
}

let cachedHardware: SlowHardwareInfo = {
  batteryPercent: null,
  batteryCharging: null,
  diskUsedPercent: null,
  diskFreeGb: null,
  diskTotalGb: null
};
let lastHardwarePoll = 0;
let hardwarePolling = false;

function pollSlowHardware(): void {
  if (hardwarePolling) return;
  const now = Date.now();
  if (now - lastHardwarePoll < 15000) return;

  hardwarePolling = true;
  lastHardwarePoll = now;

  const psScript = `
    $bat = Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1 EstimatedChargeRemaining, BatteryStatus
    $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='C:'" -ErrorAction SilentlyContinue | Select-Object -First 1 Size, FreeSpace
    [PSCustomObject]@{
      batPct = if ($bat) { $bat.EstimatedChargeRemaining } else { $null }
      batStatus = if ($bat) { $bat.BatteryStatus } else { $null }
      diskSize = if ($disk) { $disk.Size } else { $null }
      diskFree = if ($disk) { $disk.FreeSpace } else { $null }
    } | ConvertTo-Json -Compress
  `;

  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', psScript],
    { timeout: 3500 },
    (err, stdout) => {
      hardwarePolling = false;
      if (err || !stdout.trim()) return;
      try {
        const data = JSON.parse(stdout.trim()) as {
          batPct: number | null;
          batStatus: number | null;
          diskSize: number | null;
          diskFree: number | null;
        };
        const diskTotalGb = data.diskSize ? +(data.diskSize / 1073741824).toFixed(1) : null;
        const diskFreeGb = data.diskFree ? +(data.diskFree / 1073741824).toFixed(1) : null;
        const diskUsedPercent =
          data.diskSize && data.diskFree !== null
            ? Math.round(((data.diskSize - data.diskFree) / data.diskSize) * 100)
            : null;
        // BatteryStatus 2 = AC / Charging, 6/7/8/9 = charging states
        const batteryCharging =
          data.batStatus !== null ? [2, 6, 7, 8, 9].includes(data.batStatus) : null;

        cachedHardware = {
          batteryPercent: data.batPct,
          batteryCharging,
          diskUsedPercent,
          diskFreeGb,
          diskTotalGb
        };
      } catch {
        // Ignore transient parse failures
      }
    }
  );
}

export function getSystemStats(): SystemStats {
  pollSlowHardware();

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  return {
    cpuPercent: readCpuUsage(),
    ramPercent: Math.round((usedMem / totalMem) * 100),
    ramUsedGb: +(usedMem / 1073741824).toFixed(1),
    ramTotalGb: +(totalMem / 1073741824).toFixed(1),
    uptimeSeconds: Math.floor(os.uptime()),
    batteryPercent: cachedHardware.batteryPercent,
    batteryCharging: cachedHardware.batteryCharging,
    diskUsedPercent: cachedHardware.diskUsedPercent,
    diskFreeGb: cachedHardware.diskFreeGb,
    diskTotalGb: cachedHardware.diskTotalGb,
    hostname: os.hostname()
  };
}
