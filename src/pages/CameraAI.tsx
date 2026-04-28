import React from 'react';
import { Camera, Video, Square, Moon, Image as ImageIcon, List, Download } from 'lucide-react';
import { useIoT } from '../context/IoTContext';
import cameraFeedImage from '../assets/camera-feed.png';
import './pages.css';

export const CameraAI: React.FC = () => {
  const { sensors } = useIoT();

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-title">
          <h1>Live Camera & AI Detection</h1>
          <p>Computer vision analysis of Raspberry Pi Cam v2 feed</p>
        </div>
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Latency: <b style={{ color: sensors.rssi != null ? 'var(--safe)' : 'var(--text-dim)' }}>
              {sensors.rssi != null ? '32ms' : '--'}
            </b>
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            FPS: <b style={{ color: sensors.status != null ? 'var(--accent)' : 'var(--text-dim)' }}>
              {sensors.status != null ? '24.5' : '--'}
            </b>
          </div>
        </div>
      </div>

      <div className="page-content" style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: '16px', minHeight: 0 }}>

        {/* MAIN FEED */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', minHeight: 0 }}>
          <div style={{ flex: 1, background: '#000', borderRadius: '12px', border: '1px solid var(--border)', position: 'relative', overflow: 'hidden', minHeight: 0 }}>
            <img src={cameraFeedImage} style={{ width: '100%', height: '100%', objectFit: 'contain', opacity: sensors.status ? 1 : 0.3 }} alt="Live Stream" />

            {!sensors.status && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontSize: '0.85rem' }}>
                    Waiting for camera stream...
                </div>
            )}

            {/* AI BOUNDING BOXES (Removed fake human/fire boxes) */}

            {/* CONTROLS */}
            <div style={{ position: 'absolute', bottom: '12px', left: '12px', display: 'flex', gap: '8px' }}>
              <button className="btn-icon"><Camera size={16} /></button>
              <button className="btn-icon"><Video size={16} /></button>
              <button className="btn-icon danger"><Square size={16} /></button>
              <button className="btn-icon"><Moon size={16} /></button>
            </div>

            {/* LIVE BADGE */}
            <div style={{ position: 'absolute', top: '12px', left: '12px' }}>
              <span className="badge badge-danger">● LIVE</span>
            </div>
          </div>

          {/* SNAPSHOT GALLERY */}
          <div className="panel" style={{ height: '100px', display: 'flex', gap: '12px', padding: '12px', overflowX: 'auto', flexShrink: 0 }}>
            <div style={{ minWidth: '90px', height: '100%', border: '2px dashed var(--border)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', cursor: 'pointer' }}>
              <ImageIcon size={20} />
            </div>
            <div style={{ minWidth: '130px', height: '100%', background: '#1a1a1a', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', border: '1px solid var(--border)', fontSize: '0.65rem' }}>
              No snapshots
            </div>
          </div>
        </div>

        {/* DETECTION LOG */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="panel-title"><List size={14} /><span>AI Detection Log</span></div>

          <div className="panel-scroll">
             <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.78rem' }}>
                No active AI detections.
             </div>
          </div>

          <div style={{ padding: '12px', borderTop: '1px solid var(--border)' }}>
            <button className="btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
              <Download size={15} /> Export History
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
