import React from 'react';
import { Users, Crosshair, History } from 'lucide-react';
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
  const { sensors } = useIoT();
  const robotPos: [number, number] = sensors.lat != null && sensors.lng != null 
    ? [sensors.lat, sensors.lng] 
    : [34.0522, -118.2437]; // Fallback to last known or default

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-title">
          <h1>Rescue Operations</h1>
          <p>Victim tracking, robot routing, and field coordination</p>
        </div>
        <span className="badge badge-safe" style={{ padding: '6px 14px', fontSize: '0.75rem' }}>● MISSION ACTIVE</span>
      </div>

      <div className="page-content" style={{ display: 'grid', gridTemplateColumns: '270px 1fr 250px', gap: '16px', minHeight: 0 }}>

        {/* VICTIM LIST */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="panel-title"><Users size={14} /><span>Detected Victims (0)</span></div>
          <div className="panel-scroll">
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.8rem' }}>
              No victims detected by AI in current sector.
            </div>
          </div>
        </div>

        {/* TACTICAL MAP */}
        <div className="panel" style={{ position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: '12px', right: '12px', zIndex: 1000 }}>
            <button className="btn-safe" style={{ fontSize: '0.75rem', padding: '8px 12px' }}>
              <Crosshair size={14} /> Recalculate Route
            </button>
          </div>
          <MapContainer center={robotPos} zoom={18} style={{ height: '100%', width: '100%' }} zoomControl={false}>
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
            <Marker position={robotPos} icon={robotIcon} />
            {/* Victims would be mapped here from real AI detection data in the future */}
          </MapContainer>
        </div>

        {/* MISSION LOG */}
        <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="panel-title"><History size={14} /><span>Mission Log</span></div>
          <div className="panel-scroll">
             <div style={{ padding: '10px', color: 'var(--text-dim)', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                Waiting for mission events...
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};
