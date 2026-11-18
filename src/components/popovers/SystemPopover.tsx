import { Activity, Lock, Settings2 } from 'lucide-react';
import { dockBridge } from '../../hooks/useDockBridge';
import { VolumeSlider } from '../VolumeSlider';
import { t } from '../../i18n';
import type { Language, SystemStats } from '../../types';

interface Props {
  lang: Language;
  stats: SystemStats;
  cpuHistory: number[];
  ramHistory: number[];
}

function DualTelemetryChart({ cpu, ram }: { cpu: number[]; ram: number[] }) {
  const width = 460;
  const height = 74;

  const toPoints = (series: number[]) =>
    (series.length > 1 ? series : [0, 0])
      .map((v, i, arr) => {
        const x = (i / (arr.length - 1)) * width;
        const y = height - (Math.max(0, Math.min(100, v)) / 100) * (height - 10) - 5;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <line x1="0" y1={height * 0.25} x2={width} y2={height * 0.25} stroke="var(--rule)" strokeWidth="1" />
      <line x1="0" y1={height * 0.55} x2={width} y2={height * 0.55} stroke="var(--rule)" strokeWidth="1" />
      <line x1="0" y1={height * 0.85} x2={width} y2={height * 0.85} stroke="var(--rule)" strokeWidth="1" />
      <polyline
        fill="none"
        stroke="var(--text-faint)"
        strokeWidth="1.5"
        strokeDasharray="3 3"
        points={toPoints(ram)}
      />
      <polyline
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={toPoints(cpu)}
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
      {/* Divided KPI strip: typography + 1px rules, zero icon boxes */}
      <div className="telemetry-strip">
        <div className="telemetry-cell">
          <span className="telemetry-label">{dict.cpu}</span>
          <span className="telemetry-value tabular">{stats.cpuPercent}%</span>
          <span className="telemetry-sub">{stats.hostname}</span>
        </div>

        <div className="telemetry-cell">
          <span className="telemetry-label">{dict.ram}</span>
          <span className="telemetry-value tabular">{stats.ramPercent}%</span>
          <span className="telemetry-sub tabular">
            {stats.ramUsedGb} / {stats.ramTotalGb} GB
          </span>
        </div>

        <div className="telemetry-cell">
          <span className="telemetry-label">{dict.disk}</span>
          <span className="telemetry-value tabular">
            {stats.diskFreeGb !== null ? `${stats.diskFreeGb} GB` : '—'}
          </span>
          <span className="telemetry-sub tabular">
            {stats.diskUsedPercent !== null ? `${stats.diskUsedPercent}% used` : 'Free'}
          </span>
        </div>

        <div className="telemetry-cell">
          <span className="telemetry-label">{dict.battery}</span>
          <span className="telemetry-value tabular">
            {stats.batteryPercent !== null ? `${stats.batteryPercent}%` : 'AC'}
          </span>
          <span className="telemetry-sub">
            {stats.batteryPercent === null
              ? 'Desktop'
              : stats.batteryCharging
                ? 'Charging'
                : 'On battery'}
          </span>
        </div>

        <div className="telemetry-cell">
          <span className="telemetry-label">{dict.uptime}</span>
          <span className="telemetry-value tabular">{formatUptime(stats.uptimeSeconds)}</span>
          <span className="telemetry-sub">Session</span>
        </div>
      </div>

      {/* Single clean dual-series load trend */}
      <div className="chart-panel">
        <div className="row-between">
          <span className="telemetry-label" style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
            Processor &amp; Memory Load
          </span>
          <div className="row-gap" style={{ gap: 14, fontSize: 11.5, color: 'var(--text-muted)' }}>
            <span className="row-gap" style={{ gap: 5 }}>
              <span style={{ width: 10, height: 2, background: 'var(--accent)', display: 'inline-block' }} />
              {dict.cpu}
            </span>
            <span className="row-gap" style={{ gap: 5 }}>
              <span
                style={{
                  width: 10,
                  height: 0,
                  borderTop: '2px dashed var(--text-faint)',
                  display: 'inline-block'
                }}
              />
              {dict.ram}
            </span>
          </div>
        </div>
        <DualTelemetryChart cpu={cpuHistory} ram={ramHistory} />
      </div>

      <div className="chart-panel" style={{ padding: '10px 14px' }}>
        <div className="row-between">
          <span className="telemetry-label" style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
            {dict.volume}
          </span>
          <div className="row-gap">
            <button className="btn" onClick={() => void dockBridge.systemAction('taskmgr')}>
              <Activity size={13} /> Task Manager
            </button>
            <button className="btn" onClick={() => void dockBridge.systemAction('settings')}>
              <Settings2 size={13} /> Settings
            </button>
            <button className="btn" onClick={() => void dockBridge.systemAction('lock')}>
              <Lock size={13} /> Lock
            </button>
          </div>
        </div>
        <VolumeSlider />
      </div>
    </div>
  );
}
