import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, AreaChart, Area, ReferenceLine
} from 'recharts';
import { Thermometer, Waves, Activity, Ruler, Flame, Table as TableIcon, Download } from 'lucide-react';
import { useIoT } from '../context/IoTContext';
import './pages.css';

const fmt = (v: number | null, unit = '', d = 1) => v != null ? `${v.toFixed(d)}${unit}` : '--';

const tooltipStyle = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  fontSize: '0.78rem',
};

export const Analytics: React.FC = () => {
  const { sensors, history, status } = useIoT();

  const gasAlert = sensors.gas != null && sensors.gas > 70;
  const tempAlert = sensors.temp != null && sensors.temp > 50;

  // Format history timestamps for chart labels
  const chartData = history.map(p => ({
    ...p,
    label: new Date(p.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  }));

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-title">
          <h1>Sensor Data &amp; Trend Analytics</h1>
          <p>Real-time hardware telemetry — {history.length} readings buffered</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn-primary" onClick={() => {
            const csv = ['ts,gas,temp,humidity,distance,vibration',
              ...history.map(p => `${p.ts},${p.gas ?? ''},${p.temp ?? ''},${p.humidity ?? ''},${p.distance ?? ''},${p.vibration ?? ''}`)
            ].join('\n');
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
            a.download = `sensor_data_${Date.now()}.csv`;
            a.click();
          }}>
            <Download size={15} /> Export CSV
          </button>
        </div>
      </div>

      <div className="page-content" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* LIVE SENSOR SUMMARY */}
        <div className="grid-5">
          <div className="sensor-card">
            <div className="s-label"><Flame size={13} /> Gas / Smoke</div>
            <div className={`s-value ${gasAlert ? 'danger' : ''}`}>{fmt(sensors.gas, '%', 0)}</div>
            <div className={`s-status ${gasAlert ? 'danger' : 'safe'}`}>{gasAlert ? 'CRITICAL' : sensors.gas != null ? 'NORMAL' : 'NO DATA'}</div>
          </div>
          <div className="sensor-card">
            <div className="s-label"><Thermometer size={13} /> Temperature</div>
            <div className={`s-value ${tempAlert ? 'warning' : ''}`}>{fmt(sensors.temp, '°C')}</div>
            <div className={`s-status ${tempAlert ? 'danger' : 'safe'}`}>{tempAlert ? 'ELEVATED' : sensors.temp != null ? 'NORMAL' : 'NO DATA'}</div>
          </div>
          <div className="sensor-card">
            <div className="s-label"><Activity size={13} /> Vibration</div>
            <div className="s-value">{fmt(sensors.vibration, 'g', 3)}</div>
            <div className="s-status safe">{sensors.vibration != null ? 'LIVE' : 'NO DATA'}</div>
          </div>
          <div className="sensor-card">
            <div className="s-label"><Waves size={13} /> Water Level</div>
            <div className={`s-value ${sensors.water ? 'danger' : 'safe'}`}>
              {sensors.water != null ? (sensors.water > 0 ? 'DETECTED' : 'CLEAR') : '--'}
            </div>
            <div className={`s-status ${sensors.water ? 'danger' : 'safe'}`}>
              {sensors.water != null ? (sensors.water > 0 ? 'ALERT' : 'SAFE') : 'NO DATA'}
            </div>
          </div>
          <div className="sensor-card">
            <div className="s-label"><Ruler size={13} /> Obstacle</div>
            <div className="s-value">{fmt(sensors.distance, 'cm', 0)}</div>
            <div className="s-status safe">{sensors.distance != null ? (sensors.distance < 30 ? 'CLOSE' : 'CLEAR') : 'NO DATA'}</div>
          </div>
        </div>

        {/* CHARTS — only render when there is real data */}
        {chartData.length === 0 ? (
          <div className="panel" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dim)' }}>
            {status === 'connected'
              ? 'Waiting for sensor data from hardware...'
              : 'Hardware disconnected — connect via WebSocket to see live charts'}
          </div>
        ) : (
          <div className="grid-2">
            <div className="chart-panel">
              <div className="chart-header">Gas &amp; Smoke Intensity</div>
              <div style={{ height: '190px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" hide />
                    <YAxis stroke="var(--text-dim)" tick={{ fontSize: 10 }} domain={[0, 100]} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <ReferenceLine y={70} stroke="var(--danger)" strokeDasharray="4 4" label={{ value: 'CRITICAL', fill: 'var(--danger)', fontSize: 10 }} />
                    <Line type="monotone" dataKey="gas" stroke="var(--danger)" strokeWidth={2} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="chart-panel">
              <div className="chart-header">Temperature &amp; Humidity</div>
              <div style={{ height: '190px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" hide />
                    <YAxis stroke="var(--text-dim)" tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Area type="monotone" dataKey="temp" stroke="var(--warning)" fill="rgba(245,158,11,0.08)" strokeWidth={2} connectNulls />
                    <Area type="monotone" dataKey="humidity" stroke="var(--accent)" fill="rgba(37,99,235,0.08)" strokeWidth={2} connectNulls />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* RAW DATA TABLE — last 10 readings */}
        <div className="panel">
          <div className="panel-title">
            <TableIcon size={14} />
            <span>Raw Telemetry Stream (last {Math.min(history.length, 10)})</span>
          </div>
          {history.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
              No data yet — waiting for hardware
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Gas (%)</th>
                  <th>Temp (°C)</th>
                  <th>Humidity (%)</th>
                  <th>Dist (cm)</th>
                  <th>Vibration (g)</th>
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().slice(0, 10).map((p, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      {new Date(p.ts).toLocaleTimeString()}
                    </td>
                    <td style={{ color: p.gas != null && p.gas > 70 ? 'var(--danger)' : undefined }}>{fmt(p.gas, '', 0)}</td>
                    <td style={{ color: p.temp != null && p.temp > 50 ? 'var(--warning)' : undefined }}>{fmt(p.temp)}</td>
                    <td>{fmt(p.humidity, '', 0)}</td>
                    <td>{fmt(p.distance, '', 0)}</td>
                    <td>{fmt(p.vibration, '', 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
