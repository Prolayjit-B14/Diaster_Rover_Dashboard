/**
 * RescueBOT Dashboard Logic v2.0
 * Handles mini-map, battery ring, MQTT bindings, quick actions
 */

import '../shared/mqtt-client.js';

document.addEventListener('DOMContentLoaded', () => {
    const mqtt = window.mqttController;

    // ── MINI MAP INIT ─────────────────────────────────────────
    let miniMap = null, roverMarker = null;
    const mapContainer = document.getElementById('mini-map-container');
    if (mapContainer && typeof L !== 'undefined') {
        miniMap = L.map('mini-map-container', {
            zoomControl: false, attributionControl: false,
            scrollWheelZoom: false, dragging: false
        }).setView([0, 0], 2);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(miniMap);

        const roverIcon = L.divIcon({
            className: '',
            html: `<div style="width:14px;height:14px;background:#00D4FF;border-radius:50%;border:2px solid white;box-shadow:0 0 12px #00D4FF;"></div>`,
            iconSize: [14, 14], iconAnchor: [7, 7]
        });
        roverMarker = L.marker([0, 0], { icon: roverIcon }).addTo(miniMap);
    }

    // ── BATTERY RING ──────────────────────────────────────────
    const CIRC = 251.2; // 2π × 40

    function updateBatteryRing(pct) {
        const ring = document.getElementById('batt-ring');
        const valEl = document.getElementById('val-battery');
        if (!ring || !valEl) return;
        const offset = CIRC - (pct / 100) * CIRC;
        ring.style.strokeDashoffset = offset;
        ring.style.stroke = pct > 50 ? '#00FF88' : pct > 20 ? '#FFB800' : '#FF2D55';
        valEl.textContent = `${Math.round(pct)}%`;
    }

    // ── MQTT BINDINGS ─────────────────────────────────────────
    if (mqtt) {
        mqtt.on('gps', (d) => {
            const lat = parseFloat(d.lat) || 0;
            const lng = parseFloat(d.lng) || 0;
            setText('val-lat', lat.toFixed(6) + '°');
            setText('val-lng', lng.toFixed(6) + '°');
            setText('val-speed', (d.speed || 0).toFixed(1) + ' km/h');
            if (d.satellites) setText('val-sats', d.satellites);
            if (miniMap && roverMarker) {
                roverMarker.setLatLng([lat, lng]);
                miniMap.panTo([lat, lng]);
            }
        });

        mqtt.on('telemetry', (d) => {
            const sensor = d.sensor;
            const val    = d.value;

            if (sensor === 'temp')        updateTemp(val);
            if (sensor === 'humidity')    updateHumidity(val);
            if (sensor === 'gas')         updateGas(val);
            if (sensor === 'fire')        updateFire(val);
            if (sensor === 'pir')         updatePIR(val);
            if (sensor === 'ultrasonic')  setText('val-ultrasonic', parseFloat(val).toFixed(0));
            if (sensor === 'vibration')   setText('val-vib', parseFloat(val).toFixed(2));
            if (sensor === 'tilt')        setText('val-tilt', parseFloat(val).toFixed(1));
            if (sensor === 'gyro')        setText('val-gyro', parseFloat(val).toFixed(1));
            if (sensor === 'batt') {
                const pct = ((parseFloat(val) / 12.6) * 100).toFixed(0);
                updateBatteryRing(parseFloat(pct));
                setText('val-voltage', parseFloat(val).toFixed(1) + 'V');
            }
            if (sensor === 'wifi') setText('val-rssi', val + ' dBm');
        });

        mqtt.on('camera', (d) => {
            if (d.active && d.url) {
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

        mqtt.on('statusChanged', (status) => {
            const dot  = document.getElementById('mqtt-dot');
            const txt  = document.getElementById('mqtt-status-text');
            if (!dot || !txt) return;
            if (status === 'CONNECTED') {
                dot.classList.remove('offline', 'warning');
                txt.textContent = 'MQTT ONLINE';
            } else if (status === 'CONNECTING') {
                dot.className = 'status-dot warning';
                txt.textContent = 'CONNECTING...';
            } else {
                dot.className = 'status-dot offline';
                txt.textContent = 'OFFLINE';
            }
        });
    }

    // ── QUICK ACTION BUTTONS ──────────────────────────────────
    document.getElementById('btn-estop')?.addEventListener('click', () => {
        mqtt?.sendCommand('EMERGENCY_STOP');
        window.RESCUEBOT_UI?.toast('⚠️ Emergency Stop Triggered!', 'error');
    });

    document.getElementById('btn-auto')?.addEventListener('click', () => {
        mqtt?.sendCommand('TOGGLE_AUTONOMOUS');
        window.RESCUEBOT_UI?.toast('🤖 Autonomous Mode Toggled', 'info');
    });

    document.getElementById('btn-cam')?.addEventListener('click', () => {
        window.location.href = '../camera/camera.html';
    });

    document.getElementById('btn-home')?.addEventListener('click', () => {
        mqtt?.sendCommand('RETURN_TO_BASE');
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
        setText('val-temp', v.toFixed(1));
        setBar('bar-temp', (v / 50) * 100);
    }

    function updateHumidity(val) {
        const v = parseFloat(val);
        setText('val-humidity', v.toFixed(0));
        setBar('bar-hum', v);
    }

    function updateGas(val) {
        const v = parseInt(val);
        setText('val-gas', v);
        setBar('bar-gas', (v / 4095) * 100);
        const isBad = v > 2500;
        const alertText = document.getElementById('alert-gas-text');
        const alertBadge = document.getElementById('alert-gas-badge');
        if (alertText) alertText.textContent = isBad ? 'HIGH GAS LEVEL!' : 'Gas Level Normal';
        if (alertBadge) {
            alertBadge.className = 'alert-mini-badge badge ' + (isBad ? 'badge-red' : 'badge-green');
            alertBadge.textContent = isBad ? 'ALERT' : 'OK';
        }
    }

    function updateFire(val) {
        const detected = val === 'FIRE DETECTED' || val === true || val === 'true';
        const alertText = document.getElementById('alert-fire-text');
        const alertBadge = document.getElementById('alert-fire-badge');
        if (alertText) alertText.textContent = detected ? '🔥 FIRE DETECTED!' : 'No Fire Detected';
        if (alertBadge) {
            alertBadge.className = 'alert-mini-badge badge ' + (detected ? 'badge-red' : 'badge-green');
            alertBadge.textContent = detected ? 'CRITICAL' : 'CLEAR';
        }
    }

    function updatePIR(val) {
        const detected = val === '1' || val === true || val === 'true' || val === 'DETECTED';
        setText('val-pir', detected ? 'DETECTED' : 'CLEAR');
        const el = document.getElementById('val-pir');
        if (el) el.style.color = detected ? 'var(--amber)' : 'var(--green)';
        const alertText = document.getElementById('alert-pir-text');
        const alertBadge = document.getElementById('alert-pir-badge');
        if (alertText) alertText.textContent = detected ? 'Motion Detected!' : 'Motion: Clear';
        if (alertBadge) {
            alertBadge.className = 'alert-mini-badge badge ' + (detected ? 'badge-amber' : 'badge-green');
            alertBadge.textContent = detected ? 'MOTION' : 'CLEAR';
        }
    }

    // ── INIT BATTERY RING ─────────────────────────────────────
    updateBatteryRing(75);

    lucide.createIcons();
});
