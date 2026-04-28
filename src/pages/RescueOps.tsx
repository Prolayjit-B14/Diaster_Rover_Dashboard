import React from 'react';
import { Users, Crosshair, History, Navigation } from 'lucide-react';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import L from 'leaflet';
import { useIoT } from '../context/IoTContext';
import './pages.css';

const createIcon = (color: string) => new L.DivIcon({
  className: '',
  html: `<div style="background:${color};width:12px;height:12px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 6px ${color}"></div>`,
  iconSize: [12, 12], iconAnchor: [6, 6]
});

const robotIcon = createIcon('#2563eb');

export const RescueOps: React.FC = () => {
  const { sensors, status } = useIoT();
  const robotPos: [number, number] = sensors.lat != null && sensors.lng != null 
    ? [sensors.lat, sensors.lng] 
    : [22.5726, 88.3639];

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-title">
          <h1>Rescue Center</h1>
          <p>Kolkata Sector · Live Tracking</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
            <span className={`badge ${sensors.dropKit === 'dropped' ? 'badge-danger' : 'badge-safe'}`}>
                {sensors.dropKit === 'dropped' ? 'KIT DEPLOYED' : 'KIT READY (SERVO)'}
            </span>
            <span className="badge badge-safe" style={{ padding: '6px 14px', fontSize: '0.75rem' }}>● MISSION ACTIVE</span>
        </div>
      </div>

      <div className="page-content" style={{ display: 'grid', gridTemplateColumns: '270px 1fr 250px', gap: '16px', minHeight: 0 }}>

        {/* AI DETECTION LIST */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="panel-title"><Users size={14} /><span>RPi4 AI Detections (0)</span></div>
          <div className="panel-scroll">
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.8rem' }}>
              {status === 'connected' ? 'Waiting for RPi4 AI human detection...' : 'Hardware offline.'}
            </div>
          </div>
        </div>

        {/* TACTICAL MAP */}
        <div className="panel" style={{ position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: '12px', right: '12px', zIndex: 1000, display: 'flex', gap: '8px' }}>
            <div style={{ padding: '6px 12px', background: 'rgba(0,0,0,0.8)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '0.65rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Navigation size={12} color="var(--accent)" />
                {sensors.lat != null ? `${sensors.lat.toFixed(5)}, ${sensors.lng?.toFixed(5)}` : 'WAITING FOR GPS...'}
            </div>
            <button className="btn-safe" style={{ fontSize: '0.75rem', padding: '8px 12px' }}>
              <Crosshair size={14} /> Center Robot
            </button>
          </div>
          <MapContainer center={robotPos} zoom={18} style={{ height: '100%', width: '100%' }} zoomControl={false}>
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
            {sensors.lat != null && <Marker position={robotPos} icon={robotIcon} />}
          </MapContainer>
        </div>

        {/* MISSION LOG */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="panel-title"><History size={14} /><span>Mission Log</span></div>
          <div className="panel-scroll">
             <div style={{ padding: '10px', color: 'var(--text-dim)', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                {status === 'connected' ? '> TRPD_INIT_OK\n> WAITING_FOR_DATA...' : '> LINK_ERROR\n> SYSTEM_OFFLINE'}
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};
