import { useState, useEffect } from 'react';
import './App.css';
import './pages/pages.css';

import {
  LayoutDashboard, Map as MapIcon, Video, BarChart3,
  Gamepad2, LifeBuoy, Settings as SettingsIcon,
  Activity, Drone as DroneIcon,
  Clock, Cpu, Menu, X, Wifi, WifiOff, Loader
} from 'lucide-react';

import { IoTProvider, useIoT } from './context/IoTContext';

// Pages
import { Overview } from './pages/Overview.tsx';
import { MapTracking } from './pages/MapTracking.tsx';
import { CameraAI } from './pages/CameraAI.tsx';
import { Analytics } from './pages/Analytics.tsx';
import { ManualControl } from './pages/ManualControl.tsx';
import { RescueOps } from './pages/RescueOps.tsx';
import { Settings } from './pages/Settings.tsx';

type ViewType = 'overview' | 'map' | 'camera' | 'analytics' | 'control' | 'rescue' | 'settings';

function AppShell() {
  const [activeView, setActiveView] = useState<ViewType>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [time, setTime] = useState(new Date());
  const { status, sensors } = useIoT();

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const navSections = [
    {
      label: 'Monitoring',
      items: [
        { id: 'overview', label: 'Dashboard', icon: <LayoutDashboard size={22} /> },
        { id: 'map', label: 'Tactical Map', icon: <MapIcon size={22} /> },
        { id: 'camera', label: 'AI Video Feed', icon: <Video size={22} /> },
        { id: 'analytics', label: 'Sensor Data', icon: <BarChart3 size={22} /> },
      ]
    },
    {
      label: 'Operations',
      items: [
        { id: 'control', label: 'Manual Control', icon: <Gamepad2 size={22} /> },
        { id: 'rescue', label: 'Rescue Ops', icon: <LifeBuoy size={22} /> },
      ]
    },
    {
      label: 'System',
      items: [
        { id: 'settings', label: 'Settings', icon: <SettingsIcon size={22} /> },
      ]
    }
  ];

  const handleRipple = (e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const ripple = document.createElement('span');
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
    ripple.classList.add('ripple');
    el.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  };

  // Connection status styling
  const connColor = status === 'connected' ? 'var(--safe)'
    : status === 'connecting' ? 'var(--warning)'
    : 'var(--danger)';
  const ConnIcon = status === 'connected' ? Wifi
    : status === 'connecting' ? Loader
    : WifiOff;

  return (
    <div className="app-layout">

      {/* SIDEBAR */}
      <aside className={`app-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="logo-main">DRR CONTROL<span className="logo-badge">Live</span></div>
          <div className="logo-sub">Search &amp; Rescue Div.</div>
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)}><X size={20} /></button>
        </div>

        <nav className="sidebar-nav">
          {navSections.map((section) => (
            <div key={section.label}>
              {section.items.map((item) => (
                <div
                  key={item.id}
                  className={`nav-item ${activeView === item.id ? 'active' : ''}`}
                  title={item.label}
                  onClick={(e) => { handleRipple(e); setTimeout(() => setActiveView(item.id as ViewType), 200); }}
                >
                  {item.icon}
                </div>
              ))}
            </div>
          ))}
          <div className="nav-item sidebar-close-tactical" title="Close Menu"
            onClick={(e) => { handleRipple(e); setSidebarOpen(false); }}>
            <X size={22} color="var(--danger)" />
          </div>
        </nav>

        <div className="sidebar-footer">
          <div className="health-container">
            <div className="health-stat-group">
              <div className="health-label">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Cpu size={12} /> CPU
                </div>
                <span>{sensors.cpu != null ? `${sensors.cpu}%` : '--'}</span>
              </div>
              <div className="health-bar-bg">
                <div className="health-fill" style={{ width: sensors.cpu != null ? `${sensors.cpu}%` : '0%' }} />
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* TOP BAR */}
      <header className="app-topbar">
        <div className="topbar-left">
          <button className="hamburger-btn" onClick={(e) => { handleRipple(e); setSidebarOpen(!sidebarOpen); }}>
            <Menu size={20} />
          </button>

          {/* LIVE IOT CONNECTION STATUS */}
          <div className="telemetry-badge" style={{ color: connColor, gap: '6px' }}>
            <ConnIcon size={13} style={status === 'connecting' ? { animation: 'spin 1s linear infinite' } : {}} />
            <span style={{ color: connColor }}>
              {status === 'connected' ? 'IOT LIVE'
                : status === 'connecting' ? 'CONNECTING'
                : 'NO SIGNAL'}
            </span>
          </div>

          <div className="telemetry-badge hide-mobile">
            <DroneIcon size={14} color="var(--accent)" />
            DRONE <span>RECON</span>
          </div>
        </div>

        <div className="topbar-center">
          <div className="minimal-alert-strip">
            <div className="alert-tag">⚠ STATUS</div>
            <div className="alert-track">
              <span className="alert-msg-scroll">
                {status === 'connected' ? (
                  <>
                    SYSTEM ONLINE &nbsp;•&nbsp; 
                    {sensors.status === 'nominal' ? 'ALL SYSTEMS NOMINAL' : sensors.status?.toUpperCase()} &nbsp;•&nbsp;
                    {sensors.gas != null && sensors.gas > 70 && <span style={{ color: 'var(--danger)' }}>GAS ALERT DETECTED &nbsp;•&nbsp;</span>}
                    {sensors.temp != null && sensors.temp > 50 && <span style={{ color: 'var(--danger)' }}>HIGH TEMPERATURE WARNING &nbsp;•&nbsp;</span>}
                    {sensors.battery != null && sensors.battery < 20 && <span style={{ color: 'var(--danger)' }}>LOW BATTERY &nbsp;•&nbsp;</span>}
                    TELEMETRY ACTIVE &nbsp;•&nbsp;
                  </>
                ) : (
                  'WAITING FOR HARDWARE CONNECTION...'
                )}
              </span>
            </div>
          </div>
        </div>

        <div className="topbar-right">
          <div className="live-clock hide-mobile">
            <Clock size={12} style={{ marginRight: 6, display: 'inline' }} />
            {time.toLocaleTimeString([], { hour12: false })}
          </div>
          <div className="latency-info">
            <Activity size={12} />
            {sensors.rssi != null ? `${sensors.rssi} dBm` : '--'}
          </div>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className={`app-main ${sidebarOpen ? 'scaled' : ''}`}>
        <div className="app-page-container">
          {activeView === 'overview'  && <Overview />}
          {activeView === 'map'       && <MapTracking />}
          {activeView === 'camera'    && <CameraAI />}
          {activeView === 'analytics' && <Analytics />}
          {activeView === 'control'   && <ManualControl />}
          {activeView === 'rescue'    && <RescueOps />}
          {activeView === 'settings'  && <Settings />}
        </div>
      </main>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function App() {
  return (
    <IoTProvider>
      <AppShell />
    </IoTProvider>
  );
}

export default App;
