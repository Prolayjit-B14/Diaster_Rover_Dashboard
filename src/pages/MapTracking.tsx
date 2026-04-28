import React from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker } from 'react-leaflet';
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
const droneIcon = createIcon('#f59e0b');
const victimIcon = createIcon('#10b981');

export const MapTracking: React.FC = () => {
  const { sensors } = useIoT();
  const robotPos: [number, number] = sensors.lat != null && sensors.lng != null 
    ? [sensors.lat, sensors.lng] 
    : [34.0522, -118.2437];
  const dronePos: [number, number] = [34.0528, -118.2445];

  return (
    <div className="page-shell">
      <div className="page-header">
        <div className="page-title">
          <h1>Live Map & Tactical Tracking</h1>
          <p>Real-time location data for all active assets</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn-filter active">Robot Path</button>
          <button className="btn-filter active">Drone View</button>
          <button className="btn-filter active">Hazards</button>
          <button className="btn-filter active">Victims</button>
        </div>
      </div>

      <div className="page-content" style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border)' }}>
        <MapContainer center={robotPos} zoom={17} style={{ height: '100%', width: '100%' }} zoomControl={false}>
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://carto.com/">Carto</a>'
          />
          <Marker position={robotPos} icon={robotIcon}><Popup>Robot Unit-01: Online</Popup></Marker>
          <Marker position={dronePos} icon={droneIcon}><Popup>Recon Drone: Active</Popup></Marker>
          <Marker position={[34.0530, -118.2430]} icon={victimIcon}><Popup>Victim V1: Critical</Popup></Marker>
          <CircleMarker center={[34.0525, -118.2432]} radius={40} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.15 }} />
          <Polyline positions={[[34.0515, -118.2440], [34.0520, -118.2438], robotPos]} pathOptions={{ color: '#2563eb', weight: 3, dashArray: '10 10' }} />
        </MapContainer>

        <div className="map-legend">
          <div className="legend-item"><div className="legend-dot" style={{ background: '#2563eb' }} /><span>Rescue Robot</span></div>
          <div className="legend-item"><div className="legend-dot" style={{ background: '#f59e0b' }} /><span>Recon Drone</span></div>
          <div className="legend-item"><div className="legend-dot" style={{ background: '#10b981' }} /><span>Confirmed Victim</span></div>
          <div className="legend-item"><div className="legend-dot" style={{ background: '#ef4444', opacity: 0.6 }} /><span>Danger Zone</span></div>
        </div>
      </div>
    </div>
  );
};
