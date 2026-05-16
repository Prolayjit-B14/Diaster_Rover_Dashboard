import React from 'react';
import { Sliders, Save, Server } from 'lucide-react';
import { useIoT } from '../context/IoTContext';
import '../styles/pages.css';

export const Settings: React.FC = () => {
  const { status, wsUrl, sensors } = useIoT();

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-title">
          <h1>System Setup</h1>
          <p>Hardware calibration and link parameters</p>
        </div>
        <button className="btn-safe"><Save size={15} /> Save Config</button>
      </div>

      <div className="page-content grid-2" style={{ gap: '16px' }}>

        {/* LEFT: SYSTEM LINK */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="panel-padded">
            <div className="section-title"><Server size={15} /> Connection Link</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className="toggle-row" style={{ padding: '8px 0' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Main Robot (ESP32)</span>
                <span style={{ fontSize: '0.7rem', fontWeight: 800, color: status === 'connected' ? 'var(--safe)' : 'var(--danger)' }}>{status === 'connected' ? 'ONLINE' : 'OFFLINE'}</span>
              </div>
              <div className="toggle-row" style={{ padding: '8px 0' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>AI Vision (RPi4)</span>
                <span style={{ fontSize: '0.7rem', fontWeight: 800, color: sensors.status ? 'var(--safe)' : 'var(--danger)' }}>{sensors.status ? 'ACTIVE' : 'IDLE'}</span>
              </div>
              
              <div className="form-group" style={{ marginTop: '10px' }}>
                <label>Data Server (WebSocket)</label>
                <div style={{ fontSize: '0.78rem', fontFamily: 'monospace', color: 'var(--accent)', background: 'rgba(59,130,246,0.05)', padding: '8px', borderRadius: '4px', border: '1px solid rgba(59,130,246,0.1)' }}>{wsUrl || 'ws://---'}</div>
              </div>

              <div className="form-group">
                <label>Wireless Interface</label>
                <select defaultValue="wifi" style={{ padding: '8px' }}>
                  <option value="wifi">Primary WiFi</option>
                  <option value="gsm">GSM / 4G Backup</option>
                  <option value="lora">LoRa Long Range</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT: HARDWARE CONFIG */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="panel-padded">
            <div className="section-title"><Sliders size={15} /> Hardware Calibration</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label>Smoke Sensitivity</label>
                <input type="range" min="0" max="100" defaultValue="70" />
              </div>
              <div className="form-group">
                <label>Braking Distance (cm)</label>
                <input type="number" defaultValue="30" style={{ padding: '8px' }} />
              </div>
              <div className="form-group">
                <label>Movement Power (%)</label>
                <input type="range" min="0" max="100" defaultValue="80" />
              </div>
              <div className="form-group">
                <label>Kit Release Angle (°)</label>
                <input type="number" defaultValue="180" style={{ padding: '8px' }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
