/**
 * RescueBOT — Sensor Integration Array v2.1
 * sensors/sensors.js
 *
 * Subscribes to MQTT telemetry and routes data to the 12 sensor cards.
 *
 * Fixes applied:
 *  - Removed dead `if (false) { ... }` block
 *  - Moved mqttController reference inside DOMContentLoaded (prevents early binding crash)
 *  - Fixed PIR value comparison — now handles '1' (string) as well as 1 (int)
 *  - Fixed updateSensor() to actually append unit when provided
 *  - Removed duplicate sidebar collapse handler (handled by shared.js)
 *  - Guarded lucide.createIcons() with window.lucide check
 */

/* ── CIRCUMFERENCE for r=32 SVG rings ────────────────────── */
const CIRC = 2 * Math.PI * 32; // ≈ 201.06


/* ============================================================
   HELPER UTILITIES
   ============================================================ */

/**
 * Set inner text of a value element.
 * @param {string}        id   - Element ID
 * @param {string|number} val  - Value to display
 * @param {string}        [unit] - Optional unit suffix appended after a space
 */
function updateSensor(id, val, unit) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = unit !== undefined ? `${val} ${unit}` : `${val}`;
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
    el.className = el.className.replace(/badge-(green|amber|red|cyan|orange)/g, '').trim();
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

    /* ── Resolve mqttController inside DOMContentLoaded ─────── */
    /* (avoids early top-level binding before MQTT initialises) */
    const mc = window.mqttController;

    /* ── MQTT Telemetry Routing ──────────────────────────────── */
    if (!mc) {
        console.warn('[Sensors] mqttController not found. Sensor updates disabled.');
        return;
    }

    mc.on('telemetry', (d) => {
        if (!d || !d.sensor) return;
        const v = d.value;

        switch (d.sensor) {

            /* ① Temperature ─────────────────────────────── */
            case 'temp': {
                const tempVal = parseFloat(v);
                if (isNaN(tempVal)) break;
                updateSensor('val-temp', tempVal.toFixed(1));
                updateBar('bar-temp', (tempVal / 50) * 100);
                if (tempVal > 40) {
                    updateStatus('status-temp', 'CRITICAL', 'red');
                    setCardState('card-temp', 'alert');
                } else if (tempVal > 30) {
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
                const hVal = parseFloat(v);
                if (isNaN(hVal)) break;
                const hPct = Math.min(100, Math.max(0, hVal));
                updateSensor('val-humidity', `${hVal.toFixed(1)}%`);
                updateCircularRing('ring-humidity', hPct);
                if (hVal > 85 || hVal < 20) {
                    updateStatus('status-humidity', 'WARNING', 'amber');
                } else {
                    updateStatus('status-humidity', 'OPTIMAL', 'green');
                }
                break;
            }

            /* ③ Gas ─────────────────────────────────────── */
            case 'gas': {
                const gasVal = parseInt(v, 10);
                if (isNaN(gasVal)) break;
                updateSensor('val-gas', gasVal);
                updateBar('bar-gas', (gasVal / 4095) * 100);
                if (gasVal > 2500) {
                    updateStatus('status-gas', 'CRITICAL', 'red');
                    setCardState('card-gas', 'alert');
                } else if (gasVal > 1500) {
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
                const uVal = parseFloat(v);
                if (isNaN(uVal)) break;
                updateSensor('val-ultrasonic', uVal.toFixed(1));
                updateBar('bar-ultrasonic', (uVal / 400) * 100);
                if (uVal < 10) {
                    updateStatus('status-ultrasonic', 'DANGER', 'red');
                    setCardState('card-ultrasonic', 'alert');
                } else if (uVal < 30) {
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
                // Handle both int (1/0), string ('1'/'0'), bool, and keyword values
                const detected =
                    v === 1 || v === '1' || v === true ||
                    v === 'true' || v === 'DETECTED';
                const pirText = detected ? 'DETECTED' : 'CLEAR';
                updateSensor('val-pir', pirText);
                const pulseEl = document.getElementById('pir-pulse');
                if (pulseEl) pulseEl.classList.toggle('active', detected);
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
                const vibVal = parseFloat(v);
                if (isNaN(vibVal)) break;
                updateSensor('val-vib', vibVal.toFixed(2));
                // Normalise roughly to 0–2g range
                updateBar('bar-vib', Math.min(100, (vibVal / 2) * 100));
                if (vibVal > 1.5) {
                    updateStatus('status-vib', 'CRITICAL', 'red');
                    setCardState('card-vib', 'alert');
                } else if (vibVal > 0.8) {
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
                const tiltVal = parseFloat(v);
                if (isNaN(tiltVal)) break;
                updateSensor('val-tilt', tiltVal.toFixed(1));
                updateBar('bar-tilt', (tiltVal / 180) * 100);
                if (tiltVal > 45) {
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
                const gyroVal = parseFloat(v);
                if (isNaN(gyroVal)) break;
                updateSensor('val-gyro', gyroVal.toFixed(1));
                updateBar('bar-gyro', (Math.abs(gyroVal) / 250) * 100);
                if (Math.abs(gyroVal) > 200) {
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
                const gpsStatus = d.status || (d.value && d.value.status) || 'ACQUIRING';
                const gpsSats   = d.sats   || (d.value && d.value.sats)   || '--';
                updateSensor('val-gps-status', gpsStatus);
                updateSensor('val-gps-sats',   gpsSats);
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
                const pct     = parseFloat(v);
                const voltage = d.voltage !== undefined ? parseFloat(d.voltage).toFixed(2) : '--';
                if (isNaN(pct)) break;
                updateSensor('val-battery',      `${Math.round(pct)}%`);
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
                if (isNaN(dbm)) break;
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
                if (isNaN(fps)) break;
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
        if (dot) {
            dot.className = 'status-dot' +
                (status === 'CONNECTED'  ? '' :
                 status === 'CONNECTING' ? ' warning' : ' offline');
        }
        if (text) {
            text.textContent =
                status === 'CONNECTED'  ? 'MQTT ONLINE'    :
                status === 'CONNECTING' ? 'CONNECTING...'  : status;
        }
    });

    /* ── Initialise Lucide icons ─────────────────────────── */
    if (window.lucide) window.lucide.createIcons();
});
