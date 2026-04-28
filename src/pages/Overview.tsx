import React from 'react';
import { Activity, Battery, Wifi, AlertCircle, Map as MapIcon, Camera, List, WifiOff } from 'lucide-react';
import { useIoT } from '../context/IoTContext';
import './pages.css';

const fmt = (v: number | null, unit = '', decimals = 1) =>
  v != null ? `${v.toFixed(decimals)}${unit}` : '--';

export const Overview: React.FC = () => {
  const { sensors, status, lastUpdated } = useIoT();

  const robotStatus = sensors.status === 'nominal' ? 'NOMINAL'
    : sensors.status === 'warning' ? 'WARNING'
    : sensors.status === 'critical' ? 'CRITICAL'
    : status === 'connected' ? 'ONLINE' : 'OFFLINE';

  const robotStatusColor = sensors.status === 'nominal' ? 'var(--safe)'
    : sensors.status === 'warning' ? 'var(--warning)'
    : sensors.status === 'critical' ? 'var(--danger)'
    : status === 'connected' ? 'var(--safe)' : 'var(--text-dim)';

  const gasAlert = sensors.gas != null && sensors.gas > 70;
  const tempAlert = sensors.temp != null && sensors.temp > 50;

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-title">
          <h1>Mission Overview</h1>
          <p>
            Live sensor telemetry from robot hardware
            {lastUpdated && (
              <span style={{ marginLeft: 10, color: 'var(--text-dim)', fontSize: '0.7rem' }}>
                · Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <span className="badge" style={{
          padding: '5px 12px', fontSize: '0.7rem',
          background: status === 'connected' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
          color: status === 'connected' ? 'var(--safe)' : 'var(--danger)',
          border: `1px solid ${status === 'connected' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
        }}>
          {status === 'connected' ? '● IOT LIVE' : status === 'connecting' ? '◌ CONNECTING' : '○ NO SIGNAL'}
        </span>
      </div>

      <div className="page-content">

        {/* STAT CARDS */}
        <div className="grid-4" style={{ marginBottom: '16px' }}>
          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: `${robotStatusColor}20`, color: robotStatusColor }}>
              <Activity size={22} />
            </div>
            <div className="stat-card-info">
              <span className="stat-label">Robot Status</span>
              <span className="stat-value" style={{ color: robotStatusColor }}>{robotStatus}</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: 'rgba(37,99,235,0.12)', color: 'var(--accent)' }}>
              <Battery size={22} />
            </div>
            <div className="stat-card-info">
              <span className="stat-label">Battery</span>
              <span className="stat-value" style={{ color: sensors.battery != null && sensors.battery < 20 ? 'var(--danger)' : undefined }}>
                {fmt(sensors.battery, '%', 0)}
              </span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: gasAlert ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)', color: gasAlert ? 'var(--danger)' : 'var(--safe)' }}>
              <AlertCircle size={22} />
            </div>
            <div className="stat-card-info">
              <span className="stat-label">Gas / Smoke</span>
              <span className="stat-value" style={{ color: gasAlert ? 'var(--danger)' : undefined }}>
                {fmt(sensors.gas, '%', 0)}
              </span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--warning)' }}>
              <Wifi size={22} />
            </div>
            <div className="stat-card-info">
              <span className="stat-label">Signal (RSSI)</span>
              <span className="stat-value">{fmt(sensors.rssi, ' dBm', 0)}</span>
            </div>
          </div>
        </div>

        {/* MAP + CAMERA PREVIEWS */}
        <div className="grid-2" style={{ marginBottom: '16px' }}>
          <div className="panel" style={{ height: '240px' }}>
            <div className="panel-title" style={{ background: 'rgba(37,99,235,0.07)', borderBottomColor: 'rgba(37,99,235,0.18)' }}>
              <MapIcon size={13} style={{ color: 'var(--accent)' }} />
              <span style={{ color: 'var(--accent)' }}>Tactical Map</span>
              {sensors.lat != null && (
                <span style={{ marginLeft: 'auto', fontSize: '0.65rem', color: 'var(--text-dim)', fontFamily: 'monospace' }}>
                  {sensors.lat.toFixed(5)}, {sensors.lng?.toFixed(5)}
                </span>
              )}
            </div>
            <div style={{ height: 'calc(240px - 41px)', background: 'radial-gradient(ellipse at 40% 60%, rgba(37,99,235,0.08) 0%, #0d0f14 70%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '10px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(37,99,235,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(37,99,235,0.05) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
              <MapIcon size={32} style={{ color: 'var(--accent)', opacity: 0.2 }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', zIndex: 1 }}>Open Map page for live tracking</span>
            </div>
          </div>

          <div className="panel" style={{ height: '240px', background: '#050505' }}>
            <div className="panel-title" style={{ background: 'rgba(239,68,68,0.07)', borderBottomColor: 'rgba(239,68,68,0.18)' }}>
              <Camera size={13} style={{ color: 'var(--danger)' }} />
              <span style={{ color: 'var(--danger)' }}>Live Camera</span>
              <span className="badge badge-danger" style={{ marginLeft: 'auto' }}>● LIVE</span>
            </div>
            <div style={{ height: 'calc(240px - 41px)', background: 'radial-gradient(ellipse at 60% 40%, rgba(239,68,68,0.07) 0%, #050505 70%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '10px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(239,68,68,0.025) 3px, rgba(239,68,68,0.025) 4px)' }} />
              <Camera size={32} style={{ color: 'var(--danger)', opacity: 0.2 }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', zIndex: 1 }}>Open Camera page for AI detection</span>
            </div>
          </div>
        </div>

        {/* LIVE SENSOR SUMMARY */}
        <div className="panel">
          <div className="panel-title">
            <List size={13} />
            <span>Live Sensor Readings</span>
            {status !== 'connected' && (
              <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--danger)', fontSize: '0.7rem' }}>
                <WifiOff size={12} /> Hardware disconnected
              </span>
            )}
          </div>
          <div className="panel-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              {[
                { label: 'Temperature', value: fmt(sensors.temp, '°C'), alert: tempAlert },
                { label: 'Humidity', value: fmt(sensors.humidity, '%', 0) },
                { label: 'Gas / Smoke', value: fmt(sensors.gas, '%', 0), alert: gasAlert },
                { label: 'Obstacle Dist', value: fmt(sensors.distance, ' cm', 0) },
                { label: 'Vibration', value: fmt(sensors.vibration, 'g', 3) },
                { label: 'Water Level', value: sensors.water != null ? (sensors.water > 0 ? 'DETECTED' : 'CLEAR') : '--', alert: sensors.water != null && sensors.water > 0 },
              ].map(({ label, value, alert }) => (
                <div key={label} style={{ padding: '12px', background: 'var(--bg-surface)', borderRadius: '8px', border: `1px solid ${alert ? 'rgba(239,68,68,0.3)' : 'var(--border)'}` }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }}>{label}</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: alert ? 'var(--danger)' : 'var(--text-main)' }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
