import React from 'react';
import { Camera, Video, Square, Moon, Image as ImageIcon, List, Download } from 'lucide-react';
import { useIoT } from '../context/IoTContext';
import cameraFeedImage from '../assets/camera-feed.png';
import '../styles/pages.css';

export const CameraAI: React.FC = () => {
  const { sensors, status } = useIoT();

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-title">
          <h1>Vision AI &amp; Surveillance</h1>
          <p>RPi4 Main Stream + ESP32-CAM Detection</p>
        </div>
        <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Stream Latency: <b style={{ color: 'var(--text-dim)' }}>
              ---
            </b>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            AI Load (RPi4): <b style={{ color: sensors.cpu != null ? 'var(--accent)' : 'var(--text-dim)' }}>
              {sensors.cpu != null ? `${sensors.cpu}%` : '---'}
            </b>
          </div>
        </div>
      </div>

      <div className="page-content" style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '16px', minHeight: 0 }}>

        {/* MAIN FEED (RPi4) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minHeight: 0 }}>
          <div style={{ flex: 1, background: '#000', borderRadius: '12px', border: '1px solid var(--border)', position: 'relative', overflow: 'hidden', minHeight: 0 }}>
            <img src={cameraFeedImage} style={{ width: '100%', height: '100%', objectFit: 'contain', opacity: status === 'connected' ? 1 : 0.2 }} alt="Live Stream" />

            {status !== 'connected' && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                    Waiting for RPi4 camera stream...
                </div>
            )}

            {/* CONTROLS */}
            <div style={{ position: 'absolute', bottom: '12px', left: '12px', display: 'flex', gap: '8px' }}>
              <button className="btn-icon" title="Capture Snapshot"><Camera size={16} /></button>
              <button className="btn-icon" title="Record Clip"><Video size={16} /></button>
              <button className="btn-icon danger" title="Stop Stream"><Square size={16} /></button>
              <button className="btn-icon" title="Night Vision"><Moon size={16} /></button>
            </div>

            {/* LIVE BADGE */}
            <div style={{ position: 'absolute', top: '12px', left: '12px', display: 'flex', gap: '8px' }}>
              <span className={`badge ${status === 'connected' ? 'badge-danger' : 'badge-offline'}`}>
                  {status === 'connected' ? '● RPi4 LIVE' : '○ RPi4 OFFLINE'}
              </span>
              <span className="badge" style={{ background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  {status === 'connected' ? '720p HD' : '---'}
              </span>
            </div>
          </div>

          {/* SECONDARY FEEDS (ESP32-CAM) */}
          <div className="panel" style={{ height: '140px', display: 'flex', gap: '16px', padding: '16px', flexShrink: 0 }}>
            <div style={{ width: '180px', height: '100%', background: '#111', borderRadius: '8px', border: '1px solid var(--border)', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: '0.6rem', textAlign: 'center', padding: '10px' }}>
                    ESP32-CAM Detection Node
                </div>
                <div style={{ position: 'absolute', top: '6px', left: '6px' }}>
                    <span style={{ fontSize: '0.55rem', fontWeight: 800, color: 'var(--text-dim)' }}>NODE_01</span>
                </div>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4px' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700 }}>Snapshot Gallery</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>No recent detections from Pi-Cam or ESP32-Cam.</div>
                <button className="btn-primary" style={{ marginTop: '8px', padding: '6px 12px', fontSize: '0.65rem' }}>
                    <ImageIcon size={12} /> Browse Archive
                </button>
            </div>
          </div>
        </div>

        {/* AI DETECTION LOG */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="panel-title"><List size={14} /><span>AI Event Log (RPi4)</span></div>

          <div className="panel-scroll">
             <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.78rem' }}>
                {status === 'connected' ? 'Monitoring for human/hazard signatures...' : 'Connect hardware to start AI analysis.'}
             </div>
          </div>

          <div style={{ padding: '12px', borderTop: '1px solid var(--border)' }}>
            <button className="btn-safe" style={{ width: '100%', justifyContent: 'center', fontSize: '0.75rem' }}>
              <Download size={15} /> Export Detection Report
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
