import React from 'react';
import { Activity, Battery, Wifi, AlertCircle, Map as MapIcon, Camera, List } from 'lucide-react';
import { useIoT } from '../context/IoTContext';
import '../styles/pages.css';

const fmt = (v: number | null, unit = '', decimals = 1) =>
  v != null ? `${v.toFixed(decimals)}${unit}` : '---';

export const Overview: React.FC<{ onNavigate?: (view: any) => void }> = ({ onNavigate }) => {
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
  const flameAlert = sensors.flame === true;

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-title">
          <h1>Mission Overview</h1>
          <p>
            Station: Kolkata · Live Robot Stats
            {lastUpdated && (
              <span style={{ marginLeft: 10, color: 'var(--text-dim)', fontSize: '0.7rem' }}>
                · Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <span className="badge" style={{ background: 'rgba(59,130,246,0.1)', color: 'var(--accent)', border: '1px solid rgba(59,130,246,0.2)' }}>
            Robot Unit
          </span>
          <span className="badge" style={{
            padding: '5px 12px', fontSize: '0.7rem',
            background: status === 'connected' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
            color: status === 'connected' ? 'var(--safe)' : 'var(--danger)',
            border: `1px solid ${status === 'connected' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
          }}>
            {status === 'connected' ? '● ONLINE' : status === 'connecting' ? '◌ CONNECTING' : '○ DISCONNECTED'}
          </span>
        </div>
      </div>

      <div className="page-content">

        {/* STAT CARDS */}
        <div className="grid-4" style={{ marginBottom: '16px' }}>
          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: `${robotStatusColor}20`, color: robotStatusColor }}>
              <Activity size={22} />
            </div>
            <div className="stat-card-info">
              <span className="stat-label">Health</span>
              <span className="stat-value" style={{ color: robotStatusColor }}>{robotStatus}</span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: 'rgba(37,99,235,0.12)', color: 'var(--accent)' }}>
              <Battery size={22} />
            </div>
            <div className="stat-card-info">
              <span className="stat-label">Battery Power</span>
              <span className="stat-value" style={{ color: sensors.battery != null && sensors.battery < 20 ? 'var(--danger)' : undefined }}>
                {fmt(sensors.battery, '%', 0)}
              </span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: gasAlert || flameAlert ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)', color: gasAlert || flameAlert ? 'var(--danger)' : 'var(--safe)' }}>
              <AlertCircle size={22} />
            </div>
            <div className="stat-card-info">
              <span className="stat-label">Fire / Smoke</span>
              <span className="stat-value" style={{ color: flameAlert || gasAlert ? 'var(--danger)' : undefined }}>
                {flameAlert ? 'DANGER!' : gasAlert ? 'SMOKE' : 'SAFE'}
              </span>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-card-icon" style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--warning)' }}>
              <Wifi size={22} />
            </div>
            <div className="stat-card-info">
              <span className="stat-label">Signal</span>
              <span className="stat-value">{status === 'connected' ? 'STRONG' : 'NONE'}</span>
            </div>
          </div>
        </div>

        {/* MAP + CAMERA PREVIEWS */}
        <div className="grid-2" style={{ marginBottom: '16px' }}>
          <div className="panel" 
            style={{ height: '240px', cursor: 'pointer', transition: 'transform 0.2s' }}
            onClick={() => onNavigate?.('map')}
          >
            <div className="panel-title" style={{ background: 'rgba(37,99,235,0.07)', borderBottomColor: 'rgba(37,99,235,0.18)' }}>
              <MapIcon size={13} style={{ color: 'var(--accent)' }} />
              <span style={{ color: 'var(--accent)' }}>Live Map</span>
            </div>
            <div style={{ height: 'calc(240px - 41px)', background: '#0d0f14', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '10px', position: 'relative', overflow: 'hidden' }}>
              <MapIcon size={32} style={{ color: 'var(--accent)', opacity: 0.2 }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', zIndex: 1 }}>Click to expand tracking</span>
            </div>
          </div>

          <div className="panel" 
            style={{ height: '240px', background: '#050505', cursor: 'pointer', transition: 'transform 0.2s' }}
            onClick={() => onNavigate?.('camera')}
          >
            <div className="panel-title" style={{ background: 'rgba(239,68,68,0.07)', borderBottomColor: 'rgba(239,68,68,0.18)' }}>
              <Camera size={13} style={{ color: 'var(--danger)' }} />
              <span style={{ color: 'var(--danger)' }}>Camera View</span>
            </div>
            <div style={{ height: 'calc(240px - 41px)', background: '#050505', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '10px', position: 'relative', overflow: 'hidden' }}>
              <Camera size={32} style={{ color: 'var(--danger)', opacity: 0.2 }} />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', zIndex: 1 }}>Click for AI detection feed</span>
            </div>
          </div>
        </div>

        {/* LIVE SENSOR SUMMARY */}
        <div className="panel">
          <div className="panel-title">
            <List size={13} />
            <span>Robot Sensor Stats</span>
          </div>
          <div className="panel-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              {[
                { label: 'Temperature', value: fmt(sensors.temp, '°C'), alert: tempAlert },
                { label: 'Humidity', value: fmt(sensors.humidity, '%', 0) },
                { label: 'Smoke / Gas', value: fmt(sensors.gas, '%', 0), alert: gasAlert },
                { label: 'Obstacle Distance', value: fmt(sensors.distance, ' cm', 0) },
                { label: 'Ground Shaking', value: fmt(sensors.vibration, 'g', 3) },
                { label: 'Fire Detection', value: sensors.flame ? 'FIRE!' : 'NONE', alert: sensors.flame },
                { label: 'People Nearby', value: sensors.motion ? 'YES' : 'NO', alert: sensors.motion },
                { label: 'GPS Connected', value: sensors.lat != null ? 'YES' : 'NO' },
              ].map(({ label, value, alert }) => (
                <div key={label} style={{ padding: '12px', background: 'var(--bg-surface)', borderRadius: '8px', border: `1px solid ${alert ? 'rgba(239,68,68,0.3)' : 'var(--border)'}` }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }}>{label}</div>
                  <div style={{ fontSize: '1rem', fontWeight: 800, color: alert ? 'var(--danger)' : 'var(--text-main)' }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
