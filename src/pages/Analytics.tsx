import React from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, AreaChart, Area
} from 'recharts';
import { Thermometer, Activity, Ruler, Flame, Table as TableIcon, Download, Users, Navigation } from 'lucide-react';
import { useIoT } from '../context/IoTContext';
import '../styles/pages.css';

const fmt = (v: number | null, unit = '', d = 1) => v != null ? `${v.toFixed(d)}${unit}` : '---';

const tooltipStyle = {
  background: 'var(--bg-panel)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  fontSize: '0.78rem',
};

export const Analytics: React.FC = () => {
  const { sensors, history } = useIoT();

  const gasAlert = sensors.gas != null && sensors.gas > 70;
  const tempAlert = sensors.temp != null && sensors.temp > 50;
  const flameAlert = sensors.flame === true;

  // Format history timestamps for chart labels
  const chartData = history.map(p => ({
    ...p,
    label: new Date(p.ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  }));

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-title">
          <h1>Sensor History</h1>
          <p>Kolkata Station · Data from Robot</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn-primary" onClick={() => {
            const csv = ['ts,gas,temp,humidity,distance,vibration,flame,motion',
              ...history.map(p => `${p.ts},${p.gas ?? ''},${p.temp ?? ''},${p.humidity ?? ''},${p.distance ?? ''},${p.vibration ?? ''},${p.flame ?? ''},${p.motion ?? ''}`)
            ].join('\n');
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
            a.download = `robot_data_${Date.now()}.csv`;
            a.click();
          }}>
            <Download size={15} /> Save as CSV
          </button>
        </div>
      </div>

      <div className="page-content" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

        {/* LIVE SENSOR SUMMARY */}
        <div className="grid-4" style={{ marginBottom: '16px' }}>
          <div className="sensor-card">
            <div className="s-label"><Flame size={13} /> Smoke Detector</div>
            <div className={`s-value ${gasAlert ? 'danger' : ''}`}>{fmt(sensors.gas, '%', 0)}</div>
            <div className={`s-status ${gasAlert ? 'danger' : 'safe'}`}>{gasAlert ? 'DANGER' : sensors.gas != null ? 'NORMAL' : '--'}</div>
          </div>
          <div className="sensor-card">
            <div className="s-label"><Thermometer size={13} /> Temperature</div>
            <div className={`s-value ${tempAlert ? 'warning' : ''}`}>{fmt(sensors.temp, '°C')}</div>
            <div className={`s-status ${tempAlert ? 'danger' : 'safe'}`}>{tempAlert ? 'HIGH' : sensors.temp != null ? 'NORMAL' : '--'}</div>
          </div>
          <div className="sensor-card">
            <div className="s-label"><Activity size={13} /> Shaking Level</div>
            <div className="s-value">{fmt(sensors.vibration, 'g', 3)}</div>
            <div className="s-status safe">{sensors.vibration != null ? 'LIVE' : '--'}</div>
          </div>
          <div className="sensor-card">
            <div className="s-label"><Flame size={13} /> Fire Detector</div>
            <div className={`s-value ${flameAlert ? 'danger' : 'safe'}`}>
              {sensors.flame != null ? (sensors.flame ? 'FIRE!' : 'SAFE') : '--'}
            </div>
            <div className={`s-status ${flameAlert ? 'danger' : 'safe'}`}>
              {sensors.flame != null ? (sensors.flame ? 'ALERT' : 'NORMAL') : '--'}
            </div>
          </div>
          <div className="sensor-card">
            <div className="s-label"><Ruler size={13} /> Obstacle</div>
            <div className="s-value">{fmt(sensors.distance, 'cm', 0)}</div>
            <div className="s-status safe">{sensors.distance != null ? (sensors.distance < 30 ? 'CLOSE' : 'CLEAR') : '--'}</div>
          </div>
          <div className="sensor-card">
            <div className="s-label"><Activity size={13} /> Humidity</div>
            <div className="s-value">{fmt(sensors.humidity, '%', 0)}</div>
            <div className="s-status safe">{sensors.humidity != null ? 'NORMAL' : '--'}</div>
          </div>
          <div className="sensor-card">
            <div className="s-label"><Users size={13} /> People Nearby</div>
            <div className="s-value">{sensors.motion != null ? (sensors.motion ? 'YES' : 'NO') : '--'}</div>
            <div className="s-status safe">{sensors.motion != null ? (sensors.motion ? 'DETECTED' : 'CLEAR') : '--'}</div>
          </div>
          <div className="sensor-card">
            <div className="s-label"><Navigation size={13} /> GPS Status</div>
            <div className="s-value">{sensors.lat != null ? 'LOCKED' : 'SEARCHING'}</div>
            <div className="s-status safe">{sensors.lat != null ? 'FIXED' : 'WAITING'}</div>
          </div>
        </div>

        {/* CHARTS */}
        {chartData.length === 0 ? (
          <div className="panel" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-dim)' }}>
            {status === 'connected'
              ? 'Waiting for robot data...'
              : 'Robot offline — No data available'}
          </div>
        ) : (
          <div className="grid-2">
            <div className="chart-panel">
              <div className="chart-header">Smoke &amp; Temperature Levels</div>
              <div style={{ height: '190px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" hide />
                    <YAxis stroke="var(--text-dim)" tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line type="monotone" dataKey="gas" stroke="var(--danger)" strokeWidth={2} dot={false} name="Smoke" />
                    <Line type="monotone" dataKey="temp" stroke="var(--warning)" strokeWidth={2} dot={false} name="Temp" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="chart-panel">
              <div className="chart-header">Shaking &amp; Movement</div>
              <div style={{ height: '190px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" hide />
                    <YAxis stroke="var(--text-dim)" tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Area type="monotone" dataKey="vibration" stroke="var(--accent)" fill="rgba(37,99,235,0.08)" strokeWidth={2} name="Movement" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* RAW DATA TABLE */}
        <div className="panel">
          <div className="panel-title">
            <TableIcon size={14} />
            <span>Live Data Stream</span>
          </div>
          {history.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
              No data available yet.
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Smoke (%)</th>
                  <th>Temp (°C)</th>
                  <th>Shaking (g)</th>
                  <th>Distance (cm)</th>
                  <th>Fire</th>
                  <th>People</th>
                </tr>
              </thead>
              <tbody>
                {[...history].reverse().slice(0, 10).map((p, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                      {new Date(p.ts || Date.now()).toLocaleTimeString()}
                    </td>
                    <td style={{ color: p.gas != null && p.gas > 70 ? 'var(--danger)' : undefined }}>{fmt(p.gas, '', 0)}</td>
                    <td>{fmt(p.temp)}</td>
                    <td>{fmt(p.vibration, '', 3)}</td>
                    <td>{fmt(p.distance, '', 0)}</td>
                    <td style={{ color: p.flame ? 'var(--danger)' : 'var(--safe)' }}>{p.flame ? 'YES' : 'NO'}</td>
                    <td style={{ color: p.motion ? 'var(--accent)' : undefined }}>{p.motion ? 'YES' : 'NO'}</td>
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
