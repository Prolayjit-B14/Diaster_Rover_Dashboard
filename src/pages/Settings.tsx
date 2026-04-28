import React from 'react';
import { Wifi, Shield, Bell, Sliders, Save, Server } from 'lucide-react';
import { useIoT } from '../context/IoTContext';
import './pages.css';

export const Settings: React.FC = () => {
  const { status, wsUrl, sensors } = useIoT();

  const connColor = status === 'connected' ? 'var(--safe)'
    : status === 'connecting' ? 'var(--warning)'
    : 'var(--danger)';

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-title">
          <h1>System Configuration</h1>
          <p>Robot hardware and communication parameters</p>
        </div>
        <button className="btn-safe"><Save size={15} /> Save Changes</button>
      </div>

      <div className="page-content grid-2" style={{ gap: '16px' }}>

        {/* LEFT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* CONNECTION STATUS */}
          <div className="panel-padded">
            <div className="section-title"><Server size={15} /> IoT Connection</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'var(--bg-surface)', borderRadius: '8px', border: `1px solid ${connColor}30` }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>WebSocket Status</span>
                <span style={{ fontSize: '0.78rem', fontWeight: 800, color: connColor, textTransform: 'uppercase' }}>{status}</span>
              </div>
              <div style={{ padding: '10px 12px', background: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }}>Connected URL</div>
                <div style={{ fontSize: '0.78rem', fontFamily: 'monospace', color: 'var(--accent)' }}>{wsUrl}</div>
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
                To change the robot IP: edit <code style={{ background: 'var(--bg-surface)', padding: '1px 5px', borderRadius: '3px' }}>VITE_WS_URL</code> in <code style={{ background: 'var(--bg-surface)', padding: '1px 5px', borderRadius: '3px' }}>.env</code> and restart the dev server.
              </div>

              {/* LIVE HARDWARE INFO */}
              {status === 'connected' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                  {[
                    { label: 'RSSI', value: sensors.rssi != null ? `${sensors.rssi} dBm` : '--' },
                    { label: 'CPU Load', value: sensors.cpu != null ? `${sensors.cpu}%` : '--' },
                    { label: 'Battery', value: sensors.battery != null ? `${sensors.battery}%` : '--' },
                    { label: 'Speed', value: sensors.speed != null ? `${sensors.speed.toFixed(1)} m/s` : '--' },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ padding: '8px 10px', background: 'var(--bg-surface)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
                      <div style={{ fontSize: '0.9rem', fontWeight: 800 }}>{value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* COMMUNICATION */}
          <div className="panel-padded">
            <div className="section-title"><Wifi size={15} /> Communication Link</div>
            <div className="form-group">
              <label>Primary Protocol</label>
              <select defaultValue="lora">
                <option value="lora">LoRa (Long Range RF)</option>
                <option value="wifi">WiFi (Local Mesh)</option>
                <option value="gsm">GSM (LTE Fallback)</option>
              </select>
            </div>
            <div className="form-group">
              <label>Telemetry Rate (Hz)</label>
              <input type="number" defaultValue="10" />
            </div>
            <div className="form-group">
              <label>Base Station IP</label>
              <input type="text" defaultValue="192.168.1.100" />
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* SENSOR THRESHOLDS */}
          <div className="panel-padded">
            <div className="section-title"><Bell size={15} /> Sensor Alert Thresholds</div>
            <div className="form-group">
              <label>Gas / Smoke Critical Level (%)</label>
              <input type="range" min="0" max="100" defaultValue="70" />
            </div>
            <div className="form-group">
              <label>Temperature Warning (°C)</label>
              <input type="number" defaultValue="50" />
            </div>
            <div className="form-group">
              <label>Obstacle Auto-Stop Distance (cm)</label>
              <input type="number" defaultValue="30" />
            </div>
          </div>

          {/* OPERATION MODE */}
          <div className="panel-padded">
            <div className="section-title"><Shield size={15} /> Operation Mode</div>
            <div className="form-group">
              <label>Drive Mode</label>
              <div className="btn-mode-group">
                <button className="btn-mode active">Manual</button>
                <button className="btn-mode">Semi-Auto</button>
                <button className="btn-mode">Autonomous</button>
              </div>
            </div>
            <div className="form-group" style={{ marginTop: '8px' }}>
              <label>Safety Overrides</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div className="toggle-row">
                  <span>Auto-Stop on Obstacle</span>
                  <label className="switch"><input type="checkbox" defaultChecked /><span className="slider"></span></label>
                </div>
                <div className="toggle-row">
                  <span>Auto-Stop on Gas Critical</span>
                  <label className="switch"><input type="checkbox" defaultChecked /><span className="slider"></span></label>
                </div>
              </div>
            </div>
          </div>

          {/* MOTOR / HARDWARE */}
          <div className="panel-padded">
            <div className="section-title"><Sliders size={15} /> Motor &amp; Hardware</div>
            <div className="form-group">
              <label>Max Motor Speed (%)</label>
              <input type="range" min="0" max="100" defaultValue="80" />
            </div>
            <div className="form-group">
              <label>Camera Resolution</label>
              <select defaultValue="720">
                <option value="480">480p (Low Latency)</option>
                <option value="720">720p (Balanced)</option>
                <option value="1080">1080p (High Quality)</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
