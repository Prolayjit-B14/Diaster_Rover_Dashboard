import React from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useIoT } from '../context/IoTContext';
import './pages.css';

const createIcon = (color: string) => new L.DivIcon({
  className: '',
  html: `<div style="background:${color};width:14px;height:14px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 8px ${color}"></div>`,
  iconSize: [14, 14], iconAnchor: [7, 7]
});

const robotIcon = createIcon('#2563eb');

export const MapTracking: React.FC = () => {
  const { sensors, status } = useIoT();
  const hasGps = sensors.lat != null && sensors.lng != null;
  const robotPos: [number, number] = hasGps 
    ? [sensors.lat!, sensors.lng!] 
    : [22.5726, 88.3639];

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-title">
          <h1>Live Map</h1>
          <p>Location Tracking · Kolkata Station</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <span className={`badge ${hasGps ? 'badge-safe' : 'badge-offline'}`}>
              {hasGps ? 'GPS FIXED' : 'WAITING FOR GPS...'}
          </span>
          <span className={`badge ${status === 'connected' ? 'badge-safe' : 'badge-offline'}`}>
              {status === 'connected' ? 'LINK ACTIVE' : 'LINK OFFLINE'}
          </span>
        </div>
      </div>

      <div className="page-content" style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border)' }}>
        <MapContainer center={robotPos} zoom={18} style={{ height: '100%', width: '100%' }} zoomControl={false}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
          {hasGps && (
            <Marker position={robotPos} icon={robotIcon}>
              <Popup>Robot Unit: {sensors.status?.toUpperCase() || 'ONLINE'}</Popup>
            </Marker>
          )}
        </MapContainer>

        <div className="map-legend">
          <div className="legend-item">
            <div className="legend-dot" style={{ background: '#2563eb' }} />
            <span>Rescue Robot (NEO-6M)</span>
          </div>
          {status !== 'connected' && (
            <div className="legend-item" style={{ color: 'var(--danger)', fontSize: '0.65rem', fontWeight: 700 }}>
              ⚠ HARDWARE DISCONNECTED
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
