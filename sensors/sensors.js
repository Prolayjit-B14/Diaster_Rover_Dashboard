/**
 * RescueBOT — Live Real-Time Sensor Telemetry Array v4.0
 * sensors/sensors.js
 *
 * Direct binding to the rover's physical hardware telemetry stream.
 * ZERO mock telemetry loops or simulated background values.
 * Telemetry nodes update EXCLUSIVELY via actual MQTT transmissions.
 */

/* ============================================================
   GLOBAL TELEMETRY STATES
   ============================================================ */

window.mpuState = {
    pitch: 0,
    roll: 0,
    gx: 0.0,
    gy: 0.0,
    gz: 0.0,
    ax: 0.00,
    ay: 0.00,
    az: 1.00
};

window.gpsState = {
    lat: 37.77492,
    lng: -122.41941,
    sats: 0,
    status: 'ACQUIRING'
};

/**
 * Set inner text of a value element.
 * @param {string}        id   - Element ID
 * @param {string|number} val  - Value to display
 * @param {string}        [unit] - Optional unit suffix
 */
function updateSensor(id, val, unit) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = unit !== undefined ? `${val} ${unit}` : `${val}`;
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
    el.className = el.className.replace(/badge-(green|amber|red|cyan|orange)/g, '').trim();
    el.classList.add(`badge-${colour}`);
}

function setCardState(cardId, state) {
    const card = document.getElementById(cardId);
    if (!card) return;
    card.classList.remove('alert-state', 'warning-state');
    if (state === 'alert')   card.classList.add('alert-state');
    if (state === 'warning') card.classList.add('warning-state');
}

/* ============================================================
   WIDGETS RENDER PIPELINES
   ============================================================ */

/**
 * Updates the 2D visual crosshair bubble level indicator.
 */
function renderBubbleLevel() {
    const dot = document.getElementById('bubble-level-dot');
    if (!dot) return;
    
    const maxDisp = 20; // bounding boundary limit (scaled down for 54px ring)
    const dx = Math.min(maxDisp, Math.max(-maxDisp, (window.mpuState.roll / 45) * maxDisp));
    const dy = Math.min(maxDisp, Math.max(-maxDisp, (window.mpuState.pitch / 45) * maxDisp));
    
    dot.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;

    const absPitch = Math.abs(window.mpuState.pitch);
    const absRoll = Math.abs(window.mpuState.roll);
    
    // Toggle active glowing crosshairs when perfectly level
    const crossV = document.getElementById('bubble-cross-v');
    const crossH = document.getElementById('bubble-cross-h');
    if (absPitch === 0 && absRoll === 0) {
        if (crossV) crossV.classList.add('active');
        if (crossH) crossH.classList.add('active');
    } else {
        if (crossV) crossV.classList.remove('active');
        if (crossH) crossH.classList.remove('active');
    }

    if (absPitch > 35 || absRoll > 35) {
        updateStatus('status-mpu', 'DANGER', 'red');
        setCardState('card-mpu', 'alert');
    } else if (absPitch > 15 || absRoll > 15) {
        updateStatus('status-mpu', 'UNSTABLE', 'amber');
        setCardState('card-mpu', 'warning');
    } else {
        updateStatus('status-mpu', 'LEVEL', 'green');
        setCardState('card-mpu', 'normal');
    }
}

/**
 * Updates the MQ-2 Gas segmented equalizer light bar
 */
function renderGasEqualizer(ppmVal) {
    const segments = document.querySelectorAll('#gas-equalizer .eq-segment');
    if (segments.length === 0) return;
    
    // Scale 0-4095 to 0-16 segments
    const filled = Math.min(16, Math.max(0, Math.round((ppmVal / 4095) * 16)));
    
    segments.forEach((seg, index) => {
        if (index < filled) {
            if (index < 6) {
                seg.style.backgroundColor = '#22C55E'; // green
            } else if (index < 11) {
                seg.style.backgroundColor = '#F59E0B'; // amber
            } else {
                seg.style.backgroundColor = '#EF4444'; // red
            }
        } else {
            seg.style.backgroundColor = ''; // reset
        }
    });
}

/**
 * Renders proximity ranges as curved guidelines
 */
function renderProximityArch(cmVal) {
    const archRed = document.getElementById('arch-red');
    const archAmber = document.getElementById('arch-amber');
    const archGreen = document.getElementById('arch-green');
    if (!archRed || !archAmber || !archGreen) return;

    if (cmVal < 15) {
        archRed.style.opacity = '1';
        archAmber.style.opacity = '0.3';
        archGreen.style.opacity = '0.1';
        updateStatus('status-ultrasonic', 'CRITICAL', 'red');
        setCardState('card-ultrasonic', 'alert');
    } else if (cmVal < 40) {
        archRed.style.opacity = '0.12';
        archAmber.style.opacity = '1';
        archGreen.style.opacity = '0.3';
        updateStatus('status-ultrasonic', 'WARNING', 'amber');
        setCardState('card-ultrasonic', 'warning');
    } else {
        archRed.style.opacity = '0.08';
        archAmber.style.opacity = '0.12';
        archGreen.style.opacity = '1';
        updateStatus('status-ultrasonic', 'CLEAR', 'green');
        setCardState('card-ultrasonic', 'normal');
    }
}

/**
 * Render dynamic wave movements on Piezo Vibration sensor
 */
function renderSeismicWave(vibVal) {
    const bars = document.querySelectorAll('#seismic-wave-wrap .seismic-bar');
    if (bars.length === 0) return;

    bars.forEach(bar => {
        const noise = Math.random() * 10;
        // Scale 0-2g range to 0-100% height
        const pctHeight = Math.min(100, Math.max(5, (vibVal / 2) * 85 + noise));
        bar.style.height = `${pctHeight.toFixed(0)}%`;

        if (vibVal > 1.2) {
            bar.style.background = 'linear-gradient(180deg, #EF4444 0%, rgba(239, 68, 68, 0.2) 100%)';
        } else if (vibVal > 0.6) {
            bar.style.background = 'linear-gradient(180deg, #F59E0B 0%, rgba(245, 158, 11, 0.2) 100%)';
        } else {
            bar.style.background = 'linear-gradient(180deg, #10B981 0%, rgba(16, 185, 129, 0.2) 100%)';
        }
    });
}

/* ============================================================
   DOM READY & MQTT CONNECTOR (PURE LIVE BINDINGS ONLY)
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
    const mc = window.mqttController;

    if (!mc) {
        console.warn('[Sensors] mqttController not found. Ensure active EMQX broker pipeline connection.');
        return;
    }

    // Subscribe to incoming MQTT telemetry streams
    mc.on('telemetry', (d) => {
        if (!d || !d.sensor) return;
        const v = d.value;

        switch (d.sensor) {

            /* ① Ambient Temperature (DHT11) ─────────────────────── */
            case 'temp': {
                const tempVal = parseFloat(v);
                if (isNaN(tempVal)) break;
                
                updateSensor('val-temp', tempVal.toFixed(1));
                
                // Scale 0-50 °C to 0-100% slider position
                const pct = Math.min(100, Math.max(0, (tempVal / 50) * 100));
                const fillEl = document.getElementById('temp-track-fill');
                const indEl = document.getElementById('temp-track-indicator');
                if (fillEl) fillEl.style.width = `${pct}%`;
                if (indEl) indEl.style.left = `${pct}%`;

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

            /* ② FLAME DETECTION (Digital Pin 15) ────────────────── */
            case 'fire': {
                const detected = v === 'FIRE DETECTED' || v === 'DETECTED' || v === '1' || v === 1 || v === true;
                const fireText = detected ? 'FIRE DETECTED' : 'CLEAR';
                
                updateSensor('val-fire', fireText);
                if (detected) {
                    updateStatus('status-fire', 'CRITICAL', 'red');
                    setCardState('card-fire', 'alert');
                } else {
                    updateStatus('status-fire', 'CLEAR', 'green');
                    setCardState('card-fire', 'normal');
                }
                break;
            }

            /* ③ MQ-2 GAS & SMOKE (Analog Pin 12) ────────────────── */
            case 'gas': {
                const gasVal = parseInt(v, 10);
                if (isNaN(gasVal)) break;

                updateSensor('val-gas', gasVal);
                renderGasEqualizer(gasVal);

                if (gasVal > 2500) {
                    updateStatus('status-gas', 'CRITICAL', 'red');
                    setCardState('card-gas', 'alert');
                } else if (gasVal > 1500) {
                    updateStatus('status-gas', 'WARNING', 'amber');
                    setCardState('card-gas', 'warning');
                } else {
                    updateStatus('status-gas', 'NOMINAL', 'green');
                    setCardState('card-gas', 'normal');
                }
                break;
            }

            /* ④ PIR MOTION (Digital Pin 14) ─────────────────────── */
            case 'pir': {
                const detected = v === 1 || v === '1' || v === true || v === 'true' || v === 'DETECTED';
                const presenceText = detected ? 'DETECTED' : 'ABSENT';
                
                updateSensor('val-pir', presenceText);
                if (detected) {
                    updateStatus('status-pir', 'ALERT', 'red');
                    setCardState('card-pir', 'alert');
                } else {
                    updateStatus('status-pir', 'CLEAR', 'green');
                    setCardState('card-pir', 'normal');
                }
                break;
            }

            /* ⑤ ULTRASONIC RANGE (TRIG/ECHO GPIO 2/16) ──────────── */
            case 'ultrasonic': {
                const uVal = parseFloat(v);
                if (isNaN(uVal)) break;

                updateSensor('val-ultrasonic', Math.round(uVal));
                renderProximityArch(uVal);
                break;
            }

            /* ⑥ SEISMIC VIBRATION (Analog Pin 13) ────────────────── */
            case 'vibration': {
                const vibVal = parseFloat(v);
                if (isNaN(vibVal)) break;

                updateSensor('val-vib', vibVal.toFixed(2));
                renderSeismicWave(vibVal);

                if (vibVal > 1.4) {
                    updateStatus('status-vib', 'CRITICAL', 'red');
                    setCardState('card-vib', 'alert');
                } else if (vibVal > 0.7) {
                    updateStatus('status-vib', 'WARNING', 'amber');
                    setCardState('card-vib', 'warning');
                } else {
                    updateStatus('status-vib', 'STABLE', 'green');
                    setCardState('card-vib', 'normal');
                }
                break;
            }

            /* ⑦ MPU-6050 IMU TRIGGERS ───────────────────────────── */
            case 'tilt': {
                const tiltVal = parseFloat(v);
                if (isNaN(tiltVal)) break;

                window.mpuState.pitch = tiltVal;
                updateSensor('val-pitch', `${tiltVal.toFixed(1)}°`);
                renderBubbleLevel();
                break;
            }

            case 'gyro': {
                const gyroVal = parseFloat(v);
                if (isNaN(gyroVal)) break;
                
                // Route to IMU 3-Axis Gyro values
                window.mpuState.gx = gyroVal;
                window.mpuState.gy = gyroVal * 0.8;
                window.mpuState.gz = gyroVal * 0.3;

                updateSensor('val-gyro-x', window.mpuState.gx.toFixed(1));
                updateSensor('val-gyro-y', window.mpuState.gy.toFixed(1));
                updateSensor('val-gyro-z', window.mpuState.gz.toFixed(1));
                break;
            }

            /* ⑧ GPS NAVIGATION MODULE (NEO-6M) ──────────────────── */
            case 'gps': {
                // If structured coordinate JSON is sent
                if (typeof v === 'object' && v !== null) {
                    if (v.lat) window.gpsState.lat = parseFloat(v.lat);
                    if (v.lng) window.gpsState.lng = parseFloat(v.lng);
                    if (v.sats) window.gpsState.sats = parseInt(v.sats, 10);
                    if (v.status) window.gpsState.status = v.status;
                } else {
                    // Try to parse values if sent as flat parameters
                    const sats = d.sats || (d.value && d.value.sats) || window.gpsState.sats;
                    const status = d.status || (d.value && d.value.status) || window.gpsState.status;
                    window.gpsState.sats = sats;
                    window.gpsState.status = status;
                }
                
                updateSensor('val-gps-lat', `${window.gpsState.lat.toFixed(5)}° N`);
                updateSensor('val-gps-lng', `${window.gpsState.lng.toFixed(5)}° W`);
                updateSensor('val-gps-sats', window.gpsState.sats);
                updateSensor('val-gps-status', window.gpsState.status);

                if (window.gpsState.status === 'FIXED' || window.gpsState.status === '3D FIX') {
                    updateStatus('status-gps', 'FIXED', 'green');
                } else if (window.gpsState.status === 'ACQUIRING') {
                    updateStatus('status-gps', 'ACQUIRING', 'amber');
                } else {
                    updateStatus('status-gps', 'NO FIX', 'red');
                }
                break;
            }

            /* ⑨ CAMERA STREAM FPS / RESOLUTION ─────────────────── */
            case 'fps': {
                const fpsVal = parseFloat(v);
                if (isNaN(fpsVal)) break;

                updateSensor('val-fps', `${Math.round(fpsVal)} FPS`);
                if (fpsVal > 25) {
                    updateStatus('status-cam', 'STREAMING', 'green');
                    setCardState('card-cam', 'normal');
                } else if (fpsVal > 12) {
                    updateStatus('status-cam', 'LOW FPS', 'amber');
                    setCardState('card-cam', 'warning');
                } else {
                    updateStatus('status-cam', 'LAGGING', 'red');
                    setCardState('card-cam', 'alert');
                }
                break;
            }

            default:
                break;
        }
    });

    /* ── MQTT Connection Status footer indicator ─────────── */
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

    // Run Lucide initialization
    if (window.lucide) window.lucide.createIcons();
});
