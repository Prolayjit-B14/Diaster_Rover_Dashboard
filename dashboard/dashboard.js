/**
 * RescueBOT Dashboard Logic v2.1
 * Handles mini-map, battery ring, MQTT bindings, quick actions.
 *
 * Fixes applied:
 *  - Guarded lucide.createIcons() with window.lucide check
 *  - Added subdomains:'abcd' to mini-map tile layer
 *  - Normalized MQTT status dot handling to single pattern
 *  - GPS values show '--' until real data arrives
 *  - Battery ring initializes to 0 (no fake 75% on load)
 *  - Added 'ROVER ONLINE' pill dynamic update on MQTT connect
 */

import '../shared/mqtt-client.js';

document.addEventListener('DOMContentLoaded', () => {
    const mqttCtrl = window.mqttController;

    // ── MINI MAP INIT ─────────────────────────────────────────
    let miniMap = null, roverMarker = null, tileLayer = null;
    const mapContainer = document.getElementById('mini-map-container');
    
    function setMapTileLayer(theme) {
        if (!miniMap || typeof L === 'undefined') return;
        if (tileLayer) miniMap.removeLayer(tileLayer);
        
        const tileUrl = theme === 'light'
            ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
            : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
            
        tileLayer = L.tileLayer(tileUrl, {
            subdomains: 'abcd',
            maxZoom:    20
        }).addTo(miniMap);
    }

    if (mapContainer && typeof L !== 'undefined') {
        miniMap = L.map('mini-map-container', {
            zoomControl:      false,
            attributionControl: false,
            scrollWheelZoom: false,
            dragging:        false
        }).setView([0, 0], 2);

        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        setMapTileLayer(currentTheme);

        window.addEventListener('ares:themeChanged', (e) => {
            setMapTileLayer(e.detail);
        });

        const roverIcon = L.divIcon({
            className: '',
            html: `<div style="width:14px;height:14px;background:#3B82F6;border-radius:50%;border:2px solid white;box-shadow:0 0 8px rgba(59, 130, 246, 0.5);"></div>`,
            iconSize:   [14, 14],
            iconAnchor: [7, 7]
        });
        roverMarker = L.marker([0, 0], { icon: roverIcon }).addTo(miniMap);
    }

    // ── BATTERY RING ──────────────────────────────────────────
    const CIRC = 251.2; // 2π × 40

    function updateBatteryRing(pct) {
        const ring  = document.getElementById('batt-ring');
        const valEl = document.getElementById('val-battery');
        if (!ring || !valEl) return;
        const clamped = Math.max(0, Math.min(100, pct));
        const offset  = CIRC - (clamped / 100) * CIRC;
        ring.style.strokeDashoffset = offset;
        ring.style.stroke = clamped > 50 ? 'var(--status-ok)' : clamped > 20 ? 'var(--status-warn)' : 'var(--status-danger)';
        valEl.textContent = `${Math.round(clamped)}%`;
    }

    // ── MQTT BINDINGS ─────────────────────────────────────────
    if (mqttCtrl) {
        mqttCtrl.on('gps', (d) => {
            const lat = parseFloat(d.lat);
            const lng = parseFloat(d.lng);
            // Only update if values are valid non-zero coordinates
            if (!isNaN(lat) && !isNaN(lng)) {
                setText('val-lat',   lat.toFixed(6) + '°');
                setText('val-lng',   lng.toFixed(6) + '°');
                setText('val-speed', (parseFloat(d.speed) || 0).toFixed(1) + ' km/h');
                if (d.satellites !== undefined) setText('val-sats', d.satellites);
                if (d.accuracy   !== undefined) setText('val-accuracy', parseFloat(d.accuracy).toFixed(1) + 'm');
                if (miniMap && roverMarker) {
                    roverMarker.setLatLng([lat, lng]);
                    miniMap.panTo([lat, lng]);
                }
            }
        });

        mqttCtrl.on('telemetry', (d) => {
            if (!d || !d.sensor) return;
            const sensor = d.sensor;
            const val    = d.value;

            if (sensor === 'temp')       updateTemp(val);
            if (sensor === 'humidity')   updateHumidity(val);
            if (sensor === 'gas')        updateGas(val);
            if (sensor === 'fire')       updateFire(val);
            if (sensor === 'pir')        updatePIR(val);
            if (sensor === 'ultrasonic') {
                const dist = parseFloat(val).toFixed(0);
                setText('val-ultrasonic', dist);
                setText('val-ultrasonic-big', dist);
                // Update range badge
                const badge = document.getElementById('ultrasonic-range-badge');
                const alertEl = document.getElementById('alert-ultrasonic-text');
                const alertPill = alertEl ? alertEl.closest('.alert-pill') : null;
                if (parseFloat(val) < 20) {
                    if (badge) { badge.textContent = 'TOO CLOSE'; badge.className = 'badge badge-red'; }
                    if (alertEl) alertEl.textContent = 'Obstacle Close!';
                    if (alertPill) alertPill.className = 'alert-pill critical';
                } else {
                    if (badge) { badge.textContent = 'CLEAR'; badge.className = 'badge badge-blue'; }
                    if (alertEl) alertEl.textContent = 'Distance OK';
                    if (alertPill) alertPill.className = 'alert-pill ok';
                }
            }
            if (sensor === 'vibration')  setText('val-vib', parseFloat(val).toFixed(2));
            if (sensor === 'tilt')       setText('val-tilt', parseFloat(val).toFixed(1));
            if (sensor === 'gyro')       setText('val-gyro', parseFloat(val).toFixed(1));
            if (sensor === 'batt') {
                // Assume 12.6V max — show percentage and voltage
                const voltage = parseFloat(val);
                const pct     = Math.min(100, Math.max(0, (voltage / 12.6) * 100));
                updateBatteryRing(pct);
                setText('val-voltage', voltage.toFixed(1) + 'V');
                // Update CHARGING / DISCHARGING badge
                const battStatus = document.getElementById('batt-status');
                if (battStatus) {
                    battStatus.textContent = pct > 95 ? 'FULL' : 'DISCHARGING';
                    battStatus.className   = 'badge ' + (pct > 20 ? 'badge-green' : 'badge-red');
                }
            }
            if (sensor === 'wifi') setText('val-rssi', parseFloat(val).toFixed(0) + ' dBm');
        });

        mqttCtrl.on('camera', (d) => {
            if (d && d.active && d.url) {
                const img = document.getElementById('cam-stream-thumb');
                const ph  = document.getElementById('cam-placeholder');
                const dot = document.getElementById('cam-live-dot');
                const lbl = document.getElementById('cam-live-label');
                if (img) { img.src = d.url; img.style.display = 'block'; }
                if (ph)  ph.style.display = 'none';
                if (dot) { dot.style.background = 'var(--red)'; dot.style.boxShadow = '0 0 10px var(--red)'; }
                if (lbl) lbl.textContent = 'LIVE';
            }
        });

        mqttCtrl.on('statusChanged', (status) => {
            const dot       = document.getElementById('mqtt-dot');
            const txt       = document.getElementById('mqtt-status-text');
            const roverPill = document.getElementById('rover-status-pill');

            // Sidebar MQTT indicator
            if (dot) {
                dot.className = 'status-dot' +
                    (status === 'CONNECTED'  ? '' :
                     status === 'CONNECTING' ? ' warning' : ' offline');
            }
            if (txt) {
                txt.textContent =
                    status === 'CONNECTED'  ? 'MQTT ONLINE'    :
                    status === 'CONNECTING' ? 'CONNECTING...'  : 'OFFLINE';
            }

            // Top navbar rover status pill
            if (roverPill) {
                const dot2 = roverPill.querySelector('.status-dot');
                const lbl  = roverPill.querySelector('span:last-child');
                if (dot2) dot2.className = 'status-dot' + (status === 'CONNECTED' ? '' : ' offline');
                if (lbl)  lbl.textContent = status === 'CONNECTED' ? 'ROVER ONLINE' : 'ROVER OFFLINE';
            }
        });
    }

    // ── QUICK ACTION BUTTONS ──────────────────────────────────
    document.getElementById('btn-estop')?.addEventListener('click', () => {
        mqttCtrl?.sendCommand('EMERGENCY_STOP');
        window.RESCUEBOT_UI?.toast('⚠️ Emergency Stop Triggered!', 'error');
    });

    document.getElementById('btn-auto')?.addEventListener('click', () => {
        mqttCtrl?.sendCommand('TOGGLE_AUTONOMOUS');
        window.RESCUEBOT_UI?.toast('🤖 Autonomous Mode Toggled', 'info');
    });

    document.getElementById('btn-cam')?.addEventListener('click', () => {
        window.location.href = '../camera/camera.html';
    });

    document.getElementById('btn-home')?.addEventListener('click', () => {
        mqttCtrl?.sendCommand('RETURN_TO_BASE');
        window.RESCUEBOT_UI?.toast('🏠 Return to Base Initiated', 'success');
    });

    // ── HELPERS ───────────────────────────────────────────────
    function setText(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function setBar(id, pct) {
        const el = document.getElementById(id);
        if (el) el.style.width = Math.min(100, Math.max(0, pct)) + '%';
    }

    function updateTemp(val) {
        const v = parseFloat(val);
        if (isNaN(v)) return;
        setText('val-temp', v.toFixed(1));
        setBar('bar-temp', (v / 50) * 100);
    }

    function updateHumidity(val) {
        const v = parseFloat(val);
        if (isNaN(v)) return;
        setText('val-humidity', v.toFixed(0));
        setBar('bar-hum', Math.min(100, Math.max(0, v)));
    }

    function updateGas(val) {
        const v = parseInt(val, 10);
        if (isNaN(v)) return;
        setText('val-gas', v);
        // Drive MQ-2 progress bar (0–4095 ADC range)
        const pct = Math.min(100, (v / 4095) * 100);
        const bar = document.getElementById('bar-gas-mq2');
        if (bar) bar.style.width = pct + '%';

        // Smoke detection threshold (MQ-2 typically ~1500+ ppm for smoke)
        const isSmoke   = v > 1500;
        const smokeBadge = document.getElementById('smoke-status-badge');
        if (smokeBadge) {
            smokeBadge.textContent = isSmoke ? 'DETECTED' : 'CLEAR';
            smokeBadge.className   = 'badge ' + (isSmoke ? 'badge-red' : 'badge-green');
        }
        const smokeAlert = document.getElementById('alert-smoke-text');
        if (smokeAlert) {
            smokeAlert.textContent = isSmoke ? 'Smoke Detected!' : 'Smoke Clear';
            const smokePill = smokeAlert.closest('.alert-pill');
            if (smokePill) {
                smokePill.className = 'alert-pill ' + (isSmoke ? 'critical' : 'ok');
                const icon = smokePill.querySelector('i, svg');
                if (icon) {
                    icon.setAttribute('data-lucide', isSmoke ? 'cloud-fog' : 'check-circle-2');
                    if (window.lucide) window.lucide.createIcons({ nodes: [smokePill] });
                }
            }
        }

        // Gas level alert
        const isBad     = v > 2500;
        const alertText = document.getElementById('alert-gas-text');
        if (alertText) {
            alertText.textContent = isBad ? 'HIGH GAS LEVEL!' : 'Gas Level Normal';
            const alertPill = alertText.closest('.alert-pill');
            if (alertPill) {
                alertPill.className = 'alert-pill ' + (isBad ? 'critical' : 'ok');
                const icon = alertPill.querySelector('i, svg');
                if (icon) {
                    icon.setAttribute('data-lucide', isBad ? 'alert-triangle' : 'check-circle-2');
                    if (window.lucide) window.lucide.createIcons({ nodes: [alertPill] });
                }
            }
        }
    }

    function updateFire(val) {
        const detected   = val === 'FIRE DETECTED' || val === true || val === 'true' || val === 1;
        const alertText  = document.getElementById('alert-fire-text');
        
        if (alertText) {
            alertText.textContent = detected ? 'FIRE DETECTED!' : 'No Fire Detected';
            const alertPill = alertText.closest('.alert-pill');
            if (alertPill) {
                alertPill.className = 'alert-pill ' + (detected ? 'critical' : 'ok');
                const icon = alertPill.querySelector('i, svg');
                if (icon) {
                    icon.setAttribute('data-lucide', detected ? 'flame' : 'check-circle-2');
                    if (window.lucide) window.lucide.createIcons({nodes: [alertPill]});
                }
            }
        }
    }

    function updatePIR(val) {
        // Handle both numeric (0/1) and string ('0'/'1'/'DETECTED') values from ESP32
        const detected =
            val === 1 || val === '1' || val === true ||
            val === 'true' || val === 'DETECTED';
        setText('val-pir', detected ? 'DETECTED' : 'CLEAR');
        const pirEl = document.getElementById('val-pir');
        if (pirEl) pirEl.style.color = detected ? 'var(--amber)' : 'var(--green)';
        
        const alertText  = document.getElementById('alert-pir-text');
        if (alertText) {
            alertText.textContent = detected ? 'Motion Detected!' : 'Motion Clear';
            const alertPill = alertText.closest('.alert-pill');
            if (alertPill) {
                alertPill.className = 'alert-pill ' + (detected ? 'critical' : 'ok');
                const icon = alertPill.querySelector('i, svg');
                if (icon) {
                    icon.setAttribute('data-lucide', detected ? 'eye' : 'check-circle-2');
                    if (window.lucide) window.lucide.createIcons({nodes: [alertPill]});
                }
            }
        }
    }

    // ── INIT — battery ring starts empty (no fake data) ──────
    updateBatteryRing(0);

    if (window.lucide) window.lucide.createIcons();
});
