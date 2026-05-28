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
    let miniMap = null, roverMarker = null;
    const mapContainer = document.getElementById('mini-map-container');
    if (mapContainer && typeof L !== 'undefined') {
        miniMap = L.map('mini-map-container', {
            zoomControl:      false,
            attributionControl: false,
            scrollWheelZoom: false,
            dragging:        false
        }).setView([0, 0], 2);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            subdomains: 'abcd',
            maxZoom:    20
        }).addTo(miniMap);

        const roverIcon = L.divIcon({
            className: '',
            html: `<div style="width:14px;height:14px;background:#00D4FF;border-radius:50%;border:2px solid white;box-shadow:0 0 12px #00D4FF;"></div>`,
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
        ring.style.stroke = clamped > 50 ? '#00FF88' : clamped > 20 ? '#FFB800' : '#FF2D55';
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
            if (sensor === 'ultrasonic') setText('val-ultrasonic', parseFloat(val).toFixed(0));
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
        setBar('bar-gas', (v / 4095) * 100);
        const isBad       = v > 2500;
        const alertText   = document.getElementById('alert-gas-text');
        
        if (alertText) {
            alertText.textContent = isBad ? 'HIGH GAS LEVEL!' : 'Gas Level Normal';
            const alertPill = alertText.closest('.alert-pill');
            if (alertPill) {
                alertPill.className = 'alert-pill ' + (isBad ? 'critical' : 'ok');
                const icon = alertPill.querySelector('i, svg');
                if (icon) {
                    icon.setAttribute('data-lucide', isBad ? 'alert-triangle' : 'check-circle-2');
                    if (window.lucide) window.lucide.createIcons({nodes: [alertPill]});
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
