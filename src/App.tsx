import { useState, useEffect } from 'react';
import './styles/App.css';
import './styles/pages.css';

import {
  LayoutDashboard, Map as MapIcon, Video, BarChart3,
  Gamepad2, LifeBuoy, Settings as SettingsIcon,
  Menu, X, Wifi, WifiOff, Loader, Activity
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
        { id: 'map', label: 'Live Map', icon: <MapIcon size={22} /> },
        { id: 'camera', label: 'AI Camera', icon: <Video size={22} /> },
        { id: 'analytics', label: 'Data History', icon: <BarChart3 size={22} /> },
      ]
    },
    {
      label: 'Control',
      items: [
        { id: 'control', label: 'Remote Drive', icon: <Gamepad2 size={22} /> },
        { id: 'rescue', label: 'Rescue Center', icon: <LifeBuoy size={22} /> },
      ]
    },
    {
      label: 'System',
      items: [
        { id: 'settings', label: 'Setup', icon: <SettingsIcon size={22} /> },
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
          <div className="logo-main">COMMAND CENTER<span className="logo-badge">INDIA</span></div>
          <div className="logo-sub">Emergency Response Division</div>
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
              {status === 'connected' ? 'ESP32 LIVE'
                : status === 'connecting' ? 'SYNCING...'
                : 'OFFLINE'}
            </span>
          </div>

          <div className="telemetry-badge hide-mobile">
            <Cpu size={14} color="var(--accent)" />
            RPi4 <span>{sensors.status ? 'ACTIVE' : 'IDLE'}</span>
          </div>
        </div>

        <div className="topbar-center">
          <div className="minimal-alert-strip">
            <div className="alert-tag">⚠ STATUS</div>
            <div className="alert-track">
              <span className="alert-msg-scroll">
                {status === 'connected' ? (
                  <>
                    TRIPOD SYSTEM ONLINE &nbsp;•&nbsp; 
                    {sensors.status === 'nominal' ? 'ALL MODULES NOMINAL' : sensors.status?.toUpperCase()} &nbsp;•&nbsp;
                    {sensors.flame && <span style={{ color: 'var(--danger)' }}>FIRE DETECTED &nbsp;•&nbsp;</span>}
                    {sensors.gas != null && sensors.gas > 70 && <span style={{ color: 'var(--danger)' }}>GAS ALERT &nbsp;•&nbsp;</span>}
                    {sensors.motion && <span style={{ color: 'var(--warning)' }}>MOTION DETECTED &nbsp;•&nbsp;</span>}
                    TELEMETRY ACTIVE (10Hz) &nbsp;•&nbsp;
                  </>
                ) : (
                  'WAITING FOR ESP32 HANDSHAKE...'
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
            {sensors.rssi != null ? `${sensors.rssi} dBm` : '---'}
          </div>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className={`app-main ${sidebarOpen ? 'scaled' : ''}`}>
        <div className="app-page-container">
          {activeView === 'overview'  && <Overview onNavigate={setActiveView} />}
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
