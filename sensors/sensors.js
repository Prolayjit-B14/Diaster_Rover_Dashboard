/**
 * RescueBOT — Sensor Integration Array
 * sensors/sensors.js
 *
 * Subscribes to MQTT telemetry and routes data to the 12 sensor cards.
 */

// mqtt-client.js is loaded via script tag and exposes window.mqttController
const mqttCtrl = window.mqttController;

/* ── CIRCUMFERENCE for r=32 SVG rings ────────────────────── */
const CIRC = 2 * Math.PI * 32; // ≈ 201.06


/* ============================================================
   HELPER UTILITIES
   ============================================================ */

/**
 * Set inner text of a value element.
 * @param {string} id   - Element ID
 * @param {string|number} val - Value to display
 * @param {string} [unit] - Optional unit suffix appended with space
 */
function updateSensor(id, val, unit) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = unit !== undefined ? `${val}` : `${val}`;
}

/**
 * Set the width of a progress bar as a percentage.
 * @param {string} id  - Bar element ID
 * @param {number} pct - Percentage 0–100
 */
function updateBar(id, pct) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.width = `${Math.min(100, Math.max(0, pct))}%`;
}

/**
 * Update a status badge text and colour class.
 * @param {string} id     - Badge element ID
 * @param {string} status - Display text
 * @param {'green'|'amber'|'red'|'cyan'|'orange'} colour - Badge colour key
 */
function updateStatus(id, status, colour) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = status;
    // Remove all colour classes then apply the correct one
    el.className = el.className.replace(/badge-(green|amber|red|cyan|orange)/g, '');
    el.classList.add(`badge-${colour}`);
}

/**
 * Update an SVG circular ring stroke-dashoffset to reflect a percentage.
 * @param {string} id    - SVG circle element ID
 * @param {number} pct   - Percentage 0–100
 */
function updateCircularRing(id, pct) {
    const el = document.getElementById(id);
    if (!el) return;
    const offset = CIRC * (1 - Math.min(100, Math.max(0, pct)) / 100);
    el.style.strokeDashoffset = offset.toFixed(2);
}

/* ============================================================
   CARD STATE HELPERS
   ============================================================ */

function setCardState(cardId, state) {
    const card = document.getElementById(cardId);
    if (!card) return;
    card.classList.remove('alert-state', 'warning-state');
    if (state === 'alert')   card.classList.add('alert-state');
    if (state === 'warning') card.classList.add('warning-state');
}

/* ============================================================
   DOM READY
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

    /* ── Mission Clock ───────────────────────────────────── */
    const clockEl = document.getElementById('mission-clock');
    if (clockEl) {
        setInterval(() => {
            clockEl.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
        }, 1000);
    }

    /* ── Sidebar Collapse Toggle ─────────────────────────── */
    const sidebarCollapseBtn = document.getElementById('sidebar-collapse-btn');
    const sidebar = document.getElementById('sidebar');
    if (sidebarCollapseBtn && sidebar) {
        sidebarCollapseBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            const icon = sidebarCollapseBtn.querySelector('[data-lucide]');
            if (icon) {
                const isCollapsed = sidebar.classList.contains('collapsed');
                icon.setAttribute('data-lucide', isCollapsed ? 'chevrons-right' : 'chevrons-left');
                lucide.createIcons();
            }
        });
    }

    /* ── MQTT Telemetry Routing ──────────────────────────── */
    const mc = window.mqttController;
    if (!mc) return;

    mc.on('telemetry', (d) => {
        if (!d || !d.sensor) return;
        const v = d.value;

        switch (d.sensor) {

            /* ① Temperature ─────────────────────────────── */
            case 'temp': {
                updateSensor('val-temp', parseFloat(v).toFixed(1));
                updateBar('bar-temp', (v / 50) * 100);
                if (v > 40) {
                    updateStatus('status-temp', 'CRITICAL', 'red');
                    setCardState('card-temp', 'alert');
                } else if (v > 30) {
                    updateStatus('status-temp', 'WARNING', 'amber');
                    setCardState('card-temp', 'warning');
                } else {
                    updateStatus('status-temp', 'OPTIMAL', 'green');
                    setCardState('card-temp', 'normal');
                }
                break;
            }

            /* ② Humidity ────────────────────────────────── */
            case 'humidity': {
                const hVal = parseFloat(v).toFixed(1);
                const hPct = Math.min(100, Math.max(0, v));
                updateSensor('val-humidity', `${hVal}%`);
                updateCircularRing('ring-humidity', hPct);
                if (v > 85 || v < 20) {
                    updateStatus('status-humidity', 'WARNING', 'amber');
                } else {
                    updateStatus('status-humidity', 'OPTIMAL', 'green');
                }
                break;
            }

            /* ③ Gas ─────────────────────────────────────── */
            case 'gas': {
                updateSensor('val-gas', Math.round(v));
                updateBar('bar-gas', (v / 4095) * 100);
                if (v > 2500) {
                    updateStatus('status-gas', 'CRITICAL', 'red');
                    setCardState('card-gas', 'alert');
                } else if (v > 1500) {
                    updateStatus('status-gas', 'WARNING', 'amber');
                    setCardState('card-gas', 'warning');
                } else {
                    updateStatus('status-gas', 'OPTIMAL', 'green');
                    setCardState('card-gas', 'normal');
                }
                break;
            }

            /* ④ Ultrasonic ───────────────────────────────── */
            case 'ultrasonic': {
                updateSensor('val-ultrasonic', parseFloat(v).toFixed(1));
                updateBar('bar-ultrasonic', (v / 400) * 100);
                if (v < 10) {
                    updateStatus('status-ultrasonic', 'DANGER', 'red');
                    setCardState('card-ultrasonic', 'alert');
                } else if (v < 30) {
                    updateStatus('status-ultrasonic', 'WARNING', 'amber');
                    setCardState('card-ultrasonic', 'warning');
                } else {
                    updateStatus('status-ultrasonic', 'CLEAR', 'green');
                    setCardState('card-ultrasonic', 'normal');
                }
                break;
            }

            /* ⑤ PIR Motion ──────────────────────────────── */
            case 'pir': {
                const detected = v === 1 || v === true || v === 'DETECTED';
                const pirText  = detected ? 'DETECTED' : 'CLEAR';
                updateSensor('val-pir', pirText);
                const pulseEl = document.getElementById('pir-pulse');
                if (pulseEl) {
                    pulseEl.classList.toggle('active', detected);
                }
                if (detected) {
                    updateStatus('status-pir', 'DETECTED', 'red');
                    setCardState('card-pir', 'alert');
                } else {
                    updateStatus('status-pir', 'CLEAR', 'green');
                    setCardState('card-pir', 'normal');
                }
                break;
            }

            /* ⑥ Vibration ───────────────────────────────── */
            case 'vibration': {
                updateSensor('val-vib', parseFloat(v).toFixed(2));
                // Normalise roughly to 0–2g range
                updateBar('bar-vib', Math.min(100, (v / 2) * 100));
                if (v > 1.5) {
                    updateStatus('status-vib', 'CRITICAL', 'red');
                    setCardState('card-vib', 'alert');
                } else if (v > 0.8) {
                    updateStatus('status-vib', 'WARNING', 'amber');
                    setCardState('card-vib', 'warning');
                } else {
                    updateStatus('status-vib', 'STABLE', 'green');
                    setCardState('card-vib', 'normal');
                }
                break;
            }

            /* ⑦ Tilt ─────────────────────────────────────── */
            case 'tilt': {
                updateSensor('val-tilt', parseFloat(v).toFixed(1));
                updateBar('bar-tilt', (v / 180) * 100);
                if (v > 45) {
                    updateStatus('status-tilt', 'TILTED', 'amber');
                    setCardState('card-tilt', 'warning');
                } else {
                    updateStatus('status-tilt', 'LEVEL', 'green');
                    setCardState('card-tilt', 'normal');
                }
                break;
            }

            /* ⑧ Gyroscope ───────────────────────────────── */
            case 'gyro': {
                updateSensor('val-gyro', parseFloat(v).toFixed(1));
                updateBar('bar-gyro', (Math.abs(v) / 250) * 100);
                if (Math.abs(v) > 200) {
                    updateStatus('status-gyro', 'RAPID', 'amber');
                    setCardState('card-gyro', 'warning');
                } else {
                    updateStatus('status-gyro', 'NOMINAL', 'green');
                    setCardState('card-gyro', 'normal');
                }
                break;
            }

            /* ⑨ GPS ─────────────────────────────────────── */
            case 'gps': {
                // Expected: { sensor:'gps', value: { status, sats } }
                const gpsStatus = d.status || (d.value && d.value.status) || 'ACQUIRING';
                const gpsSats   = d.sats   || (d.value && d.value.sats)   || '--';
                updateSensor('val-gps-status', gpsStatus);
                updateSensor('val-gps-sats', gpsSats);
                if (gpsStatus === 'FIXED' || gpsStatus === '3D FIX') {
                    updateStatus('status-gps', 'FIXED', 'green');
                } else if (gpsStatus === 'ACQUIRING') {
                    updateStatus('status-gps', 'ACQUIRING', 'amber');
                } else {
                    updateStatus('status-gps', 'NO FIX', 'red');
                }
                break;
            }

            /* ⑩ Battery ─────────────────────────────────── */
            case 'batt': {
                // Expected: { sensor:'batt', value: pct, voltage: V }
                const pct     = parseFloat(v);
                const voltage = d.voltage !== undefined ? parseFloat(d.voltage).toFixed(2) : '--';
                updateSensor('val-battery', `${Math.round(pct)}%`);
                updateCircularRing('ring-battery', pct);
                updateSensor('val-batt-voltage', `${voltage}V`);
                if (pct < 20) {
                    updateStatus('status-batt', 'CRITICAL', 'red');
                    setCardState('card-batt', 'alert');
                } else if (pct < 50) {
                    updateStatus('status-batt', 'LOW', 'amber');
                    setCardState('card-batt', 'warning');
                } else {
                    updateStatus('status-batt', 'OPTIMAL', 'green');
                    setCardState('card-batt', 'normal');
                }
                break;
            }

            /* ⑪ WiFi Signal ─────────────────────────────── */
            case 'wifi': {
                const dbm = parseFloat(v);
                updateSensor('val-wifi', Math.round(dbm));
                // Map dBm range -100 (worst) to -30 (best) → 0–100%
                const wifiPct = Math.min(100, Math.max(0, ((dbm + 100) / 70) * 100));
                updateBar('bar-wifi', wifiPct);
                if (dbm < -80) {
                    updateStatus('status-wifi', 'WEAK', 'red');
                    setCardState('card-wifi', 'alert');
                } else if (dbm < -65) {
                    updateStatus('status-wifi', 'FAIR', 'amber');
                    setCardState('card-wifi', 'warning');
                } else {
                    updateStatus('status-wifi', 'STRONG', 'green');
                    setCardState('card-wifi', 'normal');
                }
                break;
            }

            /* ⑫ Camera FPS ──────────────────────────────── */
            case 'fps': {
                const fps = parseFloat(v);
                updateSensor('val-fps', Math.round(fps));
                if (fps > 25) {
                    updateStatus('status-cam', 'OPTIMAL', 'green');
                    setCardState('card-cam', 'normal');
                } else if (fps > 15) {
                    updateStatus('status-cam', 'WARNING', 'amber');
                    setCardState('card-cam', 'warning');
                } else {
                    updateStatus('status-cam', 'LOW', 'red');
                    setCardState('card-cam', 'alert');
                }
                break;
            }

            default:
                break;
        }
    });

    /* ── MQTT Connection Status → footer dot ─────────────── */
    mc.on('statusChanged', (status) => {
        const dot  = document.getElementById('mqtt-dot');
        const text = document.getElementById('mqtt-status-text');
        if (status === 'CONNECTED') {
            if (dot)  dot.className  = 'status-dot';
            if (text) text.textContent = 'MQTT ONLINE';
        } else {
            if (dot)  dot.className  = 'status-dot offline';
            if (text) text.textContent = status;
        }
    });
    /* legacy stubs */
    if (false) { // removed
    mc.on('connect', () => {
        const dot  = document.getElementById('mqtt-dot');
        const text = document.getElementById('mqtt-status-text');
        if (dot)  { dot.className  = 'status-dot'; }
        if (text) { text.textContent = 'MQTT ONLINE'; }
    });

    mc.on('disconnect', () => {});
    } // end if false

    /* ── Initialise Lucide icons ─────────────────────────── */
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
});
