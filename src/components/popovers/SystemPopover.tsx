import { Activity, BatteryCharging, HardDrive, Lock, Settings2, Volume2, VolumeX, Volume1 } from 'lucide-react';
import { dockBridge } from '../../hooks/useDockBridge';
import { t } from '../../i18n';
import type { Language, SystemStats } from '../../types';

interface Props {
  lang: Language;
  stats: SystemStats;
  cpuHistory: number[];
  ramHistory: number[];
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const width = 180;
  const height = 42;
  const points = (data.length > 1 ? data : [0, 0])
    .map((v, i, arr) => {
      const x = (i / (arr.length - 1)) * width;
      const y = height - (Math.max(0, Math.min(100, v)) / 100) * (height - 6) - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

function formatUptime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

export function SystemPopover({ lang, stats, cpuHistory, ramHistory }: Props) {
  const dict = t(lang);

  return (
    <div className="stack-md">
      <div className="grid-2">
        <div className="card stack-sm">
          <div className="row-between">
            <span className="muted-sm">{dict.cpu}</span>
            <span className="metric-value tabular" style={{ color: 'var(--accent)' }}>
              {stats.cpuPercent}%
            </span>
          </div>
          <Sparkline data={cpuHistory} color="var(--accent)" />
        </div>

        <div className="card stack-sm">
          <div className="row-between">
            <span className="muted-sm">
              {dict.ram} ({stats.ramUsedGb} / {stats.ramTotalGb} GB)
            </span>
            <span className="metric-value tabular" style={{ color: 'var(--emerald)' }}>
              {stats.ramPercent}%
            </span>
          </div>
          <Sparkline data={ramHistory} color="var(--emerald)" />
        </div>
      </div>

      <div className="grid-3">
        <div className="card stack-sm">
          <div className="row-gap muted-sm">
            <HardDrive size={14} />
            <span>{dict.disk}</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600 }} className="tabular">
            {stats.diskFreeGb !== null ? `${stats.diskFreeGb} GB free` : '—'}
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${stats.diskUsedPercent ?? 0}%` }} />
          </div>
        </div>

        <div className="card stack-sm">
          <div className="row-gap muted-sm">
            <BatteryCharging size={14} />
            <span>{dict.battery}</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600 }} className="tabular">
            {stats.batteryPercent !== null
              ? `${stats.batteryPercent}% ${stats.batteryCharging ? '⚡' : ''}`
              : 'AC Desktop'}
          </div>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{
                width: `${stats.batteryPercent ?? 100}%`,
                background: 'var(--emerald)'
              }}
            />
          </div>
        </div>

        <div className="card stack-sm">
          <div className="row-gap muted-sm">
            <Activity size={14} />
            <span>{dict.uptime}</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600 }} className="tabular">
            {formatUptime(stats.uptimeSeconds)}
          </div>
          <div className="muted-sm">{stats.hostname}</div>
        </div>
      </div>

      <div className="row-between">
        <div className="row-gap">
          <span className="muted-sm">{dict.volume}:</span>
          <button className="btn" onClick={() => void dockBridge.adjustVolume('down')}>
            <Volume1 size={14} /> -
          </button>
          <button className="btn" onClick={() => void dockBridge.adjustVolume('mute')}>
            <VolumeX size={14} /> Mute
          </button>
          <button className="btn" onClick={() => void dockBridge.adjustVolume('up')}>
            <Volume2 size={14} /> +
          </button>
        </div>

        <div className="row-gap">
          <button className="btn" onClick={() => void dockBridge.systemAction('taskmgr')}>
            <Activity size={14} /> Task Mgr
          </button>
          <button className="btn" onClick={() => void dockBridge.systemAction('settings')}>
            <Settings2 size={14} /> Settings
          </button>
          <button className="btn" onClick={() => void dockBridge.systemAction('lock')}>
            <Lock size={14} /> Lock
          </button>
        </div>
      </div>
    </div>
  );
}
