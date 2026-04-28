import React, { useState } from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Target, Lightbulb, Bell, Zap, Radio, Terminal, ZapOff } from 'lucide-react';
import { useIoT } from '../context/IoTContext';
import './pages.css';

const fmt = (v: number | null, unit = '', d = 1) => v != null ? `${v.toFixed(d)}${unit}` : '--';

export const ManualControl: React.FC = () => {
  const [speed, setSpeed] = useState(65);
  const [activeDir, setActiveDir] = useState<string | null>(null);
  const [ledOn, setLedOn] = useState(false);
  const [buzzerOn, setBuzzerOn] = useState(false);
  const [beaconOn, setBeaconOn] = useState(false);
  const { sensors, sendCommand, status } = useIoT();

  const canSend = status === 'connected';

  const move = (dir: 'FORWARD' | 'BACKWARD' | 'LEFT' | 'RIGHT') => {
    setActiveDir(dir);
    sendCommand({ cmd: 'MOVE', dir, speed });
  };

  const stop = () => {
    setActiveDir(null);
    sendCommand({ cmd: 'STOP' });
  };

  const toggleLed = () => {
    const next = !ledOn;
    setLedOn(next);
    sendCommand({ cmd: next ? 'LED_ON' : 'LED_OFF' });
  };

  const toggleBuzzer = () => {
    const next = !buzzerOn;
    setBuzzerOn(next);
    sendCommand({ cmd: next ? 'BUZZER_ON' : 'BUZZER_OFF' });
  };

  const toggleBeacon = () => {
    const next = !beaconOn;
    setBeaconOn(next);
    sendCommand({ cmd: next ? 'BEACON_ON' : 'BEACON_OFF' });
  };

  const emergencyStop = () => {
    setActiveDir(null);
    sendCommand({ cmd: 'STOP' });
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-title">
          <h1>Manual Control</h1>
          <p>Direct hardware override — robot movement and actuator control</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontWeight: 700, color: canSend ? 'var(--safe)' : 'var(--danger)' }}>
          <Zap size={14} />
          {canSend ? `RSSI: ${fmt(sensors.rssi, ' dBm', 0)}` : 'DISCONNECTED'}
        </div>
      </div>

      {!canSend && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', padding: '10px 16px', marginBottom: '16px', fontSize: '0.8rem', color: 'var(--danger)' }}>
          ⚠ Hardware not connected — commands will not be sent. Set VITE_WS_URL in .env to your robot's IP.
        </div>
      )}

      <div className="page-content grid-2" style={{ gap: '16px' }}>

        {/* LEFT: D-PAD + SPEED + E-STOP */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="panel-padded" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>

            {/* D-PAD */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 76px)', gridTemplateRows: 'repeat(3, 76px)', gap: '8px' }}>
              <div />
              <button className={`ctrl-btn ${activeDir === 'FORWARD' ? 'active' : ''}`}
                onMouseDown={() => move('FORWARD')} onMouseUp={stop} onMouseLeave={stop}>
                <ArrowUp size={28} />
              </button>
              <div />
              <button className={`ctrl-btn ${activeDir === 'LEFT' ? 'active' : ''}`}
                onMouseDown={() => move('LEFT')} onMouseUp={stop} onMouseLeave={stop}>
                <ArrowLeft size={28} />
              </button>
              <div className="ctrl-center"><Target size={28} /></div>
              <button className={`ctrl-btn ${activeDir === 'RIGHT' ? 'active' : ''}`}
                onMouseDown={() => move('RIGHT')} onMouseUp={stop} onMouseLeave={stop}>
                <ArrowRight size={28} />
              </button>
              <div />
              <button className={`ctrl-btn ${activeDir === 'BACKWARD' ? 'active' : ''}`}
                onMouseDown={() => move('BACKWARD')} onMouseUp={stop} onMouseLeave={stop}>
                <ArrowDown size={28} />
              </button>
              <div />
            </div>

            {/* MOTOR POWER */}
            <div style={{ width: '100%', maxWidth: '280px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.75rem' }}>
                <span style={{ color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Motor Power</span>
                <b style={{ color: 'var(--accent)' }}>{speed}%</b>
              </div>
              <input type="range" min="0" max="100" value={speed} onChange={e => setSpeed(+e.target.value)} style={{ width: '100%', accentColor: 'var(--accent)' }} />
            </div>

            <button className="btn-estop" onClick={emergencyStop}><ZapOff size={22} /> EMERGENCY STOP</button>
          </div>

          {/* LIVE TELEMETRY FROM HARDWARE */}
          <div className="grid-2" style={{ gap: '16px' }}>
            <div className="panel-padded">
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '6px' }}>Robot Speed</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800 }}>{fmt(sensors.speed, ' m/s')}</div>
            </div>
            <div className="panel-padded">
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '6px' }}>Obstacle Dist</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: sensors.distance != null && sensors.distance < 30 ? 'var(--danger)' : 'var(--warning)' }}>
                {fmt(sensors.distance, ' cm', 0)}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: HARDWARE TOGGLES + COMMAND LOG */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="panel-padded">
            <div className="section-title"><Zap size={15} /> Hardware Toggles</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className="toggle-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Lightbulb size={16} style={{ color: ledOn ? 'var(--warning)' : undefined }} /> LED Floodlight
                </div>
                <label className="switch">
                  <input type="checkbox" checked={ledOn} onChange={toggleLed} />
                  <span className="slider"></span>
                </label>
              </div>
              <div className="toggle-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Bell size={16} style={{ color: buzzerOn ? 'var(--warning)' : undefined }} /> Alarm Buzzer
                </div>
                <label className="switch">
                  <input type="checkbox" checked={buzzerOn} onChange={toggleBuzzer} />
                  <span className="slider"></span>
                </label>
              </div>
              <div className="toggle-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Radio size={16} style={{ color: beaconOn ? 'var(--danger)' : undefined }} /> SOS Beacon
                </div>
                <label className="switch">
                  <input type="checkbox" checked={beaconOn} onChange={toggleBeacon} />
                  <span className="slider"></span>
                </label>
              </div>
            </div>
          </div>

          {/* ADDITIONAL LIVE SENSORS */}
          <div className="panel-padded">
            <div className="section-title"><Zap size={15} /> Live Sensor Readings</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {[
                { label: 'Gas', value: fmt(sensors.gas, '%', 0), alert: sensors.gas != null && sensors.gas > 70 },
                { label: 'Temperature', value: fmt(sensors.temp, '°C'), alert: sensors.temp != null && sensors.temp > 50 },
                { label: 'Humidity', value: fmt(sensors.humidity, '%', 0) },
                { label: 'Battery', value: fmt(sensors.battery, '%', 0), alert: sensors.battery != null && sensors.battery < 20 },
              ].map(({ label, value, alert }) => (
                <div key={label} style={{ padding: '10px 12px', background: 'var(--bg-surface)', borderRadius: '8px', border: `1px solid ${alert ? 'rgba(239,68,68,0.3)' : 'var(--border)'}` }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '2px' }}>{label}</div>
                  <div style={{ fontSize: '1rem', fontWeight: 800, color: alert ? 'var(--danger)' : 'var(--text-main)' }}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* COMMAND LOG */}
          <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="panel-title"><Terminal size={14} /><span>Command Log</span></div>
            <div className="panel-scroll" style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.8 }}>
              <div style={{ color: 'var(--text-dim)' }}>Commands sent to robot appear here...</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
