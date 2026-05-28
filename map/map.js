/**
 * RescueBOT — Tactical Map Module
 * Full Leaflet integration with MQTT live GPS, tools, landmarks, HUD
 */

// ── TILE LAYER URLS ─────────────────────────────────────────────────────────
const TILE_STREET = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_SATELLITE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

// ── TOOL TYPES ───────────────────────────────────────────────────────────────
const TOOLS = {
    SAFE:         'safe',
    DANGER:       'danger',
    BASESTATION:  'basestation',
    SURVIVOR:     'survivor',
    OBSTACLE:     'obstacle',
    SUPPLIES:     'supplies',
    FIRE:         'fire',
    GAS:          'gas',
    WATER:        'water',
    CAMERA:       'camera',
};

// ── LANDMARK CONFIG ──────────────────────────────────────────────────────────
const LANDMARK_CONFIG = {
    [TOOLS.SAFE]:        { color: '#00FF88', label: 'Safe Zone',    emoji: '🛡️' },
    [TOOLS.DANGER]:      { color: '#FF2D55', label: 'Danger Zone',  emoji: '⚠️' },
    [TOOLS.BASESTATION]: { color: '#00D4FF', label: 'Base Station', emoji: '📡' },
    [TOOLS.SURVIVOR]:    { color: '#FF007F', label: 'Survivor SOS', emoji: '🆘' },
    [TOOLS.OBSTACLE]:    { color: '#FFB800', label: 'Obstacle',     emoji: '🚧' },
    [TOOLS.SUPPLIES]:    { color: '#A066FF', label: 'Supplies',     emoji: '📦' },
    [TOOLS.FIRE]:        { color: '#FF5722', label: 'Fire Source',  emoji: '🔥' },
    [TOOLS.GAS]:         { color: '#E040FB', label: 'Gas Hazard',   emoji: '💀' },
    [TOOLS.WATER]:       { color: '#2196F3', label: 'Water Hazard', emoji: '💧' },
    [TOOLS.CAMERA]:      { color: '#00E676', label: 'Photo Point',  emoji: '📷' },
};

// ─────────────────────────────────────────────────────────────────────────────
class MapDashboard {
    constructor() {
        this.map          = null;
        this.roverMarker  = null;
        this.pathLine     = null;
        this.pathCoords   = [];
        this.isFollowing  = true;
        this.activeTool   = null;
        this.landmarks    = [];
        this.totalDistance = 0;
        this.currentPos   = null;
        this.streetLayer  = null;
        this.satLayer     = null;
        this.activeLayer  = 'street';

        this._missionSecs = 0;
        this._missionInterval = null;
        this._roverHeading = 0;

        this.init();
    }

    // ── INIT ─────────────────────────────────────────────────────────────────
    init() {
        // Create map
        this.map = L.map('map-canvas', {
            zoomControl: false,
            attributionControl: false,
            preferCanvas: true
        }).setView([20.5937, 78.9629], 5);  // Default: India center

        // Tile layers
        this.streetLayer = L.tileLayer(TILE_STREET, {
            subdomains: 'abcd',
            maxZoom: 20,
            opacity: 1
        });
        this.satLayer = L.tileLayer(TILE_SATELLITE, {
            maxZoom: 20,
            opacity: 1
        });

        // Add default layer
        this.streetLayer.addTo(this.map);

        // Rover custom icon
        const roverIconHtml = `
            <div style="
                position:relative;
                width:20px; height:20px;
                display:flex; align-items:center; justify-content:center;
            ">
                <div class="rover-icon-inner" style="
                    width:16px; height:16px;
                    background:#00D4FF;
                    border-radius:50%;
                    border:2px solid rgba(255,255,255,0.8);
                    box-shadow: 0 0 0 0 rgba(0,212,255,0.5),
                                0 0 12px rgba(0,212,255,0.8);
                    display:flex; align-items:center; justify-content:center;
                ">
                    <div style="
                        width:6px; height:6px;
                        background:#fff;
                        border-radius:50%;
                    "></div>
                </div>
                <div id="rover-heading-needle" style="
                    position:absolute;
                    top:-6px; left:50%;
                    transform:translateX(-50%);
                    width:0; height:0;
                    border-left:4px solid transparent;
                    border-right:4px solid transparent;
                    border-bottom:8px solid #00D4FF;
                "></div>
            </div>
        `;

        this.roverIcon = L.divIcon({
            html: roverIconHtml,
            className: '',
            iconSize: [20, 20],
            iconAnchor: [10, 10],
        });

        this.roverMarker = null;

        // Path polyline
        this.pathLine = L.polyline([], {
            color: '#00D4FF',
            weight: 3,
            opacity: 0.8,
            dashArray: null,
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(this.map);

        this.setupListeners();
        this.setupMqtt();
        this.startMissionTimer();
    }

    // ── MQTT ─────────────────────────────────────────────────────────────────
    setupMqtt() {
        // Use the singleton MqttController from mqtt-client.js
        if (window.mqttController) {
            window.mqttController.on('gps', (d) => {
                const lat  = parseFloat(d.lat)  || 0;
                const lng  = parseFloat(d.lng)  || 0;
                const hdg  = parseFloat(d.heading)   || 0;
                const spd  = parseFloat(d.speed)     || 0;
                const sats = parseInt(d.satellites)  || 0;
                const alt  = parseFloat(d.altitude)  || null;
                this.updateRobot(lat, lng, hdg, spd, sats, alt);
            });

            // Update GPS status dot on connection changes
            window.mqttController.on('statusChanged', (status) => {
                const dot = document.getElementById('gps-dot');
                const txt = document.getElementById('gps-status');
                if (dot && txt) {
                    if (status === 'CONNECTED') {
                        dot.className = 'status-dot';
                        txt.textContent = '3D GPS FIX';
                    } else if (status === 'CONNECTING') {
                        dot.className = 'status-dot warning';
                        txt.textContent = 'ACQUIRING...';
                    } else {
                        dot.className = 'status-dot offline';
                        txt.textContent = 'GPS OFFLINE';
                    }
                }
            });
        }

        // NOTE: Only use mqttController.on('gps') — do NOT also listen to
        // window 'ares:gps' event because mqtt-client.js fires both.
        // Listening to both caused every GPS packet to trigger updateRobot() twice.
    }

    // ── MAP & TOOL LISTENERS ─────────────────────────────────────────────────
    setupListeners() {
        // Map click → add landmark based on active tool & update target HUD coordinates
        this.map.on('click', (e) => {
            this._setText('target-lat-hud', e.latlng.lat.toFixed(5));
            this._setText('target-lng-hud', e.latlng.lng.toFixed(5));

            if (!this.activeTool || this.activeTool === TOOLS.FOLLOW) return;
            this.addLandmark(e.latlng.lat, e.latlng.lng, this.activeTool);
        });

        // Tool buttons
        const toolBtns = [
            { id: 'btn-follow',          tool: null,            followToggle: true },
            { id: 'btn-safe',            tool: TOOLS.SAFE                          },
            { id: 'btn-danger',          tool: TOOLS.DANGER                        },
            { id: 'btn-base-station',    tool: TOOLS.BASESTATION                   },
            { id: 'btn-survivor',        tool: TOOLS.SURVIVOR                      },
            { id: 'btn-obstacle',        tool: TOOLS.OBSTACLE                      },
            { id: 'btn-supplies',        tool: TOOLS.SUPPLIES                      },
            { id: 'btn-fire',            tool: TOOLS.FIRE                          },
            { id: 'btn-gas',             tool: TOOLS.GAS                           },
            { id: 'btn-water',           tool: TOOLS.WATER                         },
            { id: 'btn-camera',          tool: TOOLS.CAMERA                        },
        ];

        toolBtns.forEach(({ id, tool, followToggle }) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener('click', () => {
                if (followToggle) {
                    // Toggle follow mode
                    this.isFollowing = !this.isFollowing;
                    btn.classList.toggle('active', this.isFollowing);
                    if (this.isFollowing && this.currentPos) {
                        this.map.panTo(this.currentPos);
                    }
                    window.RESCUEBOT_UI?.toast(
                        this.isFollowing ? 'Follow mode: ON' : 'Follow mode: OFF',
                        this.isFollowing ? 'success' : 'info'
                    );
                    return;
                }

                // Select / deselect tool
                if (this.activeTool === tool) {
                    this.activeTool = null;
                    btn.classList.remove('active');
                    this.map.getContainer().style.cursor = '';
                } else {
                    // Deactivate all other tool btns
                    toolBtns.forEach(b => {
                        const el = document.getElementById(b.id);
                        if (el && !b.followToggle) el.classList.remove('active');
                    });
                    this.activeTool = tool;
                    btn.classList.add('active');
                    this.map.getContainer().style.cursor = 'crosshair';
                    window.RESCUEBOT_UI?.toast(
                        `Click map to place: ${LANDMARK_CONFIG[tool]?.label || tool}`,
                        'info'
                    );
                }
            });
        });

        // Layer toggle buttons
        const btnStreet = document.getElementById('btn-street');
        const btnSat    = document.getElementById('btn-satellite');

        const setLayer = (layer) => {
            if (layer === 'street') {
                if (this.map.hasLayer(this.satLayer)) this.map.removeLayer(this.satLayer);
                if (!this.map.hasLayer(this.streetLayer)) this.streetLayer.addTo(this.map);
                btnStreet?.classList.add('active');
                btnSat?.classList.remove('active');
                this.activeLayer = 'street';
            } else {
                if (this.map.hasLayer(this.streetLayer)) this.map.removeLayer(this.streetLayer);
                if (!this.map.hasLayer(this.satLayer)) this.satLayer.addTo(this.map);
                btnSat?.classList.add('active');
                btnStreet?.classList.remove('active');
                this.activeLayer = 'satellite';
            }
        };

        btnStreet?.addEventListener('click', () => setLayer('street'));
        btnSat?.addEventListener('click',    () => setLayer('satellite'));

        // Right panel: zoom in / out
        document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
            this.map.zoomIn();
        });
        document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
            this.map.zoomOut();
        });

        // Right panel: recenter
        document.getElementById('btn-recenter')?.addEventListener('click', () => {
            if (this.currentPos) {
                this.map.setView(this.currentPos, Math.max(this.map.getZoom(), 15), { animate: true });
            } else {
            window.RESCUEBOT_UI?.toast('No GPS fix yet', 'warning');
            }
        });

        // Right panel: layers quick toggle
        document.getElementById('btn-layers')?.addEventListener('click', () => {
            setLayer(this.activeLayer === 'street' ? 'satellite' : 'street');
        });

        // Clear path button
        document.getElementById('btn-clear-path')?.addEventListener('click', () => {
            this.pathCoords = [];
            this.pathLine.setLatLngs([]);
            this.totalDistance = 0;
            this._setText('dist-display', '0 m');
            window.RESCUEBOT_UI?.toast('Tracking path cleared', 'info');
        });
    }

    // ── ROBOT UPDATE ─────────────────────────────────────────────────────────
    updateRobot(lat, lng, heading, speed, sats, altitude = null) {
        const latlng = L.latLng(lat, lng);

        // Calculate distance increment
        if (this.currentPos) {
            const delta = this.getDistMeters(
                this.currentPos.lat, this.currentPos.lng, lat, lng
            );
            // Ignore tiny GPS jitter (< 0.5m)
            if (delta > 0.5) {
                this.totalDistance += delta;
            }
        }

        this.currentPos = latlng;
        this._roverHeading = heading;

        // Move rover marker, instantiating on first real coordinate to avoid fake initial position
        if (!this.roverMarker) {
            this.roverMarker = L.marker(latlng, { icon: this.roverIcon, zIndexOffset: 1000 }).addTo(this.map);
            this.map.setView(latlng, 16);
        } else {
            this.roverMarker.setLatLng(latlng);
        }

        // Rotate heading needle
        this._updateRoverHeading(heading);

        // Append path — cap at 500 points to prevent memory growth on long missions
        this.pathCoords.push(latlng);
        if (this.pathCoords.length > 500) {
            this.pathCoords.shift();
        }
        this.pathLine.setLatLngs(this.pathCoords);

        // Pan if following
        if (this.isFollowing) {
            this.map.panTo(latlng, { animate: true, duration: 0.5 });
        }

        // ── Update HUD cards (Altitude card removed)
        this._setText('lat-hud', lat.toFixed(5));
        this._setText('lng-hud', lng.toFixed(5));

        // Update GPS pill status
        const gpsStatus = document.getElementById('gps-status');
        if (gpsStatus) {
            gpsStatus.textContent = sats >= 4 ? '3D GPS FIX' : sats > 0 ? 'WEAK FIX' : 'NO FIX';
        }
        const gpsDot = document.getElementById('gps-dot');
        if (gpsDot) {
            gpsDot.className = 'status-dot' + (sats < 4 ? ' warning' : '');
        }
    }

    // ── HEADING ARROW ─────────────────────────────────────────────────────────
    _updateRoverHeading(degrees) {
        // Instead of recreating the full Leaflet icon (expensive DOM operation),
        // find the existing marker element and apply a CSS transform rotation.
        const markerEl = this.roverMarker?.getElement();
        if (markerEl) {
            const inner = markerEl.querySelector('div');
            if (inner) inner.style.transform = `rotate(${degrees}deg)`;
        }
    }

    // ── ADD LANDMARK ─────────────────────────────────────────────────────────
    addLandmark(lat, lng, type) {
        const cfg = LANDMARK_CONFIG[type];
        if (!cfg) return;

        const markerHtml = `
            <div style="
                width:24px; height:24px;
                background:${cfg.color};
                border-radius:50% 50% 50% 0;
                transform:rotate(-45deg);
                border:2px solid rgba(255,255,255,0.7);
                box-shadow:0 0 10px ${cfg.color}80;
                display:flex; align-items:center; justify-content:center;
            ">
                <span style="
                    transform:rotate(45deg);
                    font-size:10px;
                    line-height:1;
                ">${cfg.emoji}</span>
            </div>
        `;

        const icon = L.divIcon({
            html: markerHtml,
            className: '',
            iconSize: [24, 24],
            iconAnchor: [12, 24],
        });

        const idx = this.landmarks.length + 1;
        const name = `${cfg.label} #${idx}`;
        const marker = L.marker([lat, lng], { icon })
            .addTo(this.map)
            .bindPopup(`
                <div style="
                    font-family:'Inter',sans-serif;
                    color:#E8F4FD;
                    background:#0D1B35;
                    padding:4px 0;
                ">
                    <strong style="color:${cfg.color};">${cfg.emoji} ${name}</strong><br>
                    <span style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#8BA4C0;">
                        ${lat.toFixed(6)}°, ${lng.toFixed(6)}°
                    </span>
                </div>
            `, {
                className: 'rescuebot-popup'
            });

        this.landmarks.push({ lat, lng, type, name, marker, color: cfg.color });
        this.updateLandmarkUI();

        // Deactivate tool after placing
        const toolBtnIds = {
            [TOOLS.SAFE]:        'btn-safe',
            [TOOLS.DANGER]:      'btn-danger',
            [TOOLS.BASESTATION]: 'btn-base-station',
            [TOOLS.SURVIVOR]:    'btn-survivor',
            [TOOLS.OBSTACLE]:    'btn-obstacle',
            [TOOLS.SUPPLIES]:    'btn-supplies',
            [TOOLS.FIRE]:        'btn-fire',
            [TOOLS.GAS]:         'btn-gas',
            [TOOLS.WATER]:       'btn-water',
            [TOOLS.CAMERA]:      'btn-camera',
        };
        const activeBtnId = toolBtnIds[this.activeTool];
        if (activeBtnId) {
            document.getElementById(activeBtnId)?.classList.remove('active');
        }
        this.activeTool = null;
        this.map.getContainer().style.cursor = '';

        window.RESCUEBOT_UI?.toast(`${name} placed`, 'success');
    }

    // ── UPDATE LANDMARK UI ───────────────────────────────────────────────────
    updateLandmarkUI() {
        const list = document.getElementById('landmark-list');
        if (!list) return;

        if (this.landmarks.length === 0) {
            list.innerHTML = '<div class="landmark-placeholder">Click map to add</div>';
            return;
        }

        list.innerHTML = this.landmarks.map((lm, i) => `
            <div class="landmark-item" style="border-left-color:${lm.color};">
                <div class="landmark-dot" style="background:${lm.color};box-shadow:0 0 6px ${lm.color}80;"></div>
                <div class="landmark-info">
                    <div class="landmark-name">${lm.name}</div>
                    <div class="landmark-coords">${lm.lat.toFixed(5)}°, ${lm.lng.toFixed(5)}°</div>
                </div>
                <button
                    onclick="window.mapDash.removeLandmark(${i})"
                    style="
                        background:none; border:none; cursor:pointer;
                        color:var(--text-muted); padding:2px; border-radius:4px;
                        display:flex; align-items:center; transition:color 0.2s;
                    "
                    onmouseenter="this.style.color='#FF2D55'"
                    onmouseleave="this.style.color='var(--text-muted)'"
                    title="Remove"
                >✕</button>
            </div>
        `).join('');
    }

    // ── REMOVE LANDMARK ──────────────────────────────────────────────────────
    removeLandmark(index) {
        if (this.landmarks[index]) {
            this.map.removeLayer(this.landmarks[index].marker);
            this.landmarks.splice(index, 1);
            // Re-number
            this.landmarks.forEach((lm, i) => {
                const cfg = LANDMARK_CONFIG[lm.type];
                lm.name = `${cfg.label} #${i + 1}`;
            });
            this.updateLandmarkUI();
        }
    }

    // ── HAVERSINE DISTANCE ───────────────────────────────────────────────────
    getDistMeters(lat1, lon1, lat2, lon2) {
        const R    = 6371000; // Earth radius in metres
        const toR  = (d) => d * Math.PI / 180;
        const dLat = toR(lat2 - lat1);
        const dLon = toR(lon2 - lon1);
        const a    = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                   + Math.cos(toR(lat1)) * Math.cos(toR(lat2))
                   * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c    = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    // ── MISSION TIMER ────────────────────────────────────────────────────────
    startMissionTimer() {
        this._missionSecs = 0;
        this._missionInterval = setInterval(() => {
            this._missionSecs++;
            const h = String(Math.floor(this._missionSecs / 3600)).padStart(2, '0');
            const m = String(Math.floor((this._missionSecs % 3600) / 60)).padStart(2, '0');
            const s = String(this._missionSecs % 60).padStart(2, '0');
            this._setText('mission-timer-hud', `${h}:${m}:${s}`);
        }, 1000);
    }

    // ── HELPER ───────────────────────────────────────────────────────────────
    _setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }
}

// ── BOOTSTRAP ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // Ensure Leaflet popup styles match our dark theme
    const popupStyle = document.createElement('style');
    popupStyle.textContent = `
        .leaflet-popup-content-wrapper {
            background: #0D1B35 !important;
            color: #E8F4FD !important;
            border: 1px solid rgba(0,212,255,0.25) !important;
            border-radius: 10px !important;
            box-shadow: 0 8px 32px rgba(0,0,0,0.6) !important;
        }
        .leaflet-popup-tip {
            background: #0D1B35 !important;
        }
        .leaflet-popup-close-button {
            color: #8BA4C0 !important;
        }
        .leaflet-popup-close-button:hover {
            color: #00D4FF !important;
        }
    `;
    document.head.appendChild(popupStyle);

    // Instantiate map dashboard
    window.mapDash = new MapDashboard();

    // Re-initialize lucide icons after DOM is ready
    if (window.lucide) window.lucide.createIcons();
});
