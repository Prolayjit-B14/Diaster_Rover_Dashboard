import React, { useState } from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Target, Lightbulb, Bell, Zap, Terminal, ZapOff } from 'lucide-react';
import { useIoT } from '../context/IoTContext';
import '../styles/pages.css';

const fmt = (v: number | null, unit = '', d = 1) => v != null ? `${v.toFixed(d)}${unit}` : '---';

export const ManualControl: React.FC = () => {
  const [speed, setSpeed] = useState(65);
  const [activeDir, setActiveDir] = useState<string | null>(null);
  const [ledOn, setLedOn] = useState(false);
  const [buzzerOn, setBuzzerOn] = useState(false);
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

  const emergencyStop = () => {
    setActiveDir(null);
    sendCommand({ cmd: 'STOP' });
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-title">
          <h1>Remote Control</h1>
          <p>Manual drive and first aid deployment</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontWeight: 700, color: sensors.battery != null && sensors.battery < 20 ? 'var(--danger)' : 'var(--safe)' }}>
            <Zap size={14} /> {fmt(sensors.battery, '%', 0)} Power
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', fontWeight: 700, color: canSend ? 'var(--safe)' : 'var(--danger)' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'currentColor' }} />
            {canSend ? 'CONNECTED' : 'DISCONNECTED'}
          </div>
        </div>
      </div>

      {!canSend && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', padding: '10px 16px', marginBottom: '16px', fontSize: '0.8rem', color: 'var(--danger)' }}>
          ⚠ Robot offline. Check hardware connection.
        </div>
      )}

      <div className="page-content grid-2" style={{ gap: '16px' }}>

        {/* LEFT: D-PAD + SPEED + E-STOP */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="panel-padded" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px', flex: 1, justifyContent: 'center' }}>

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
                <span style={{ color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Drive Power</span>
                <b style={{ color: 'var(--accent)' }}>{speed}%</b>
              </div>
              <input type="range" min="0" max="100" value={speed} onChange={e => setSpeed(+e.target.value)} style={{ width: '100%', accentColor: 'var(--accent)' }} />
            </div>

            <button className="btn-estop" onClick={emergencyStop}><ZapOff size={22} /> EMERGENCY STOP</button>
          </div>

          <div className="grid-2" style={{ gap: '16px' }}>
            <div className="panel-padded">
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '6px' }}>Current Speed</div>
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
            <div className="section-title"><Zap size={15} /> Quick Actions</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button 
                className="btn-danger" 
                style={{ width: '100%', padding: '14px', justifyContent: 'center', fontWeight: 800, letterSpacing: '1px' }}
                onClick={() => sendCommand({ cmd: 'DROP_KIT' })}
                disabled={sensors.dropKit === 'dropped'}
              >
                <Zap size={16} /> {sensors.dropKit === 'dropped' ? 'KIT DROPPED' : 'DROP FIRST AID'}
              </button>

              <div style={{ height: '8px' }} />

              <div className="toggle-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Lightbulb size={16} style={{ color: ledOn ? 'var(--warning)' : undefined }} /> Robot Lights
                </div>
                <label className="switch">
                  <input type="checkbox" checked={ledOn} onChange={toggleLed} />
                  <span className="slider"></span>
                </label>
              </div>
              <div className="toggle-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Bell size={16} style={{ color: buzzerOn ? 'var(--warning)' : undefined }} /> Alarm Sound
                </div>
                <label className="switch">
                  <input type="checkbox" checked={buzzerOn} onChange={toggleBuzzer} />
                  <span className="slider"></span>
                </label>
              </div>
            </div>
          </div>

          <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="panel-title"><Terminal size={14} /><span>Activity Log</span></div>
            <div className="panel-scroll" style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.8 }}>
              <div style={{ color: 'var(--text-dim)' }}>Waiting for robot actions...</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
