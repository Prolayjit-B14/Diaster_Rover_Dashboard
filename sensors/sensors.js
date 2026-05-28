/**
 * RescueBOT — Optimized Sensor Telemetry Array v3.0
 * sensors/sensors.js
 *
 * Direct binding to the rover's 8 physical sensors:
 * - Camera Stream (ESP32-CAM)
 * - GPS Navigation (NEO-6M)
 * - MPU-6050 IMU Suite (Tilt, Gyro, Accel)
 * - Seismic Vibration (Analog Piezo)
 * - IR Flame Sensor (Thermal digital)
 * - Combustible Gas (MQ-2 Analog)
 * - PIR Motion Detector (HC-SR501 Digital)
 * - Proximity Range (HC-SR04 Ultrasonic)
 */

/* ============================================================
   GLOBAL/STATE HELPERS
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

// Seed coordinates (drifts slightly over time)
window.gpsState = {
    lat: 37.77492,
    lng: -122.41941,
    sats: 10,
    status: '3D FIX'
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
    
    const maxDisp = 24; // boundary limit
    const dx = Math.min(maxDisp, Math.max(-maxDisp, (window.mpuState.roll / 45) * maxDisp));
    const dy = Math.min(maxDisp, Math.max(-maxDisp, (window.mpuState.pitch / 45) * maxDisp));
    
    dot.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;

    const absPitch = Math.abs(window.mpuState.pitch);
    const absRoll = Math.abs(window.mpuState.roll);
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
        const noise = Math.random() * 12;
        // Scale 0-2g range to 0-100% height
        const pctHeight = Math.min(100, Math.max(5, (vibVal / 2) * 80 + noise));
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
   ACTIVE TELEMETRY SIMULATION LOOP (RUNS OFFLINE FALLBACK)
   ============================================================ */

function startSimulatedTelemetry() {
    setInterval(() => {
        // Only run simulation steps if we aren't getting live values on these sensors
        
        // 1. MPU-6050 Precision Drift
        if (Math.random() > 0.4) {
            window.mpuState.pitch += (Math.random() - 0.5) * 2.5;
            window.mpuState.roll  += (Math.random() - 0.5) * 2.5;
            // Bound angles to normal operational levels
            window.mpuState.pitch = Math.min(15, Math.max(-15, window.mpuState.pitch));
            window.mpuState.roll  = Math.min(15, Math.max(-15, window.mpuState.roll));
            
            // Randomize tiny Gyro spikes
            window.mpuState.gx = (Math.random() - 0.5) * 8;
            window.mpuState.gy = (Math.random() - 0.5) * 8;
            window.mpuState.gz = (Math.random() - 0.5) * 3;
            
            // Randomize accel coordinates
            window.mpuState.ax = parseFloat(((Math.random() - 0.5) * 0.1).toFixed(2));
            window.mpuState.ay = parseFloat(((Math.random() - 0.5) * 0.1).toFixed(2));
            window.mpuState.az = parseFloat((1.0 + (Math.random() - 0.5) * 0.05).toFixed(2));
            
            // Update MPU GUI
            updateSensor('val-pitch', `${window.mpuState.pitch.toFixed(1)}°`);
            updateSensor('val-roll',  `${window.mpuState.roll.toFixed(1)}°`);
            updateSensor('val-gyro-x', window.mpuState.gx.toFixed(1));
            updateSensor('val-gyro-y', window.mpuState.gy.toFixed(1));
            updateSensor('val-gyro-z', window.mpuState.gz.toFixed(1));
            updateSensor('val-accel-x', window.mpuState.ax.toFixed(2));
            updateSensor('val-accel-y', window.mpuState.ay.toFixed(2));
            updateSensor('val-accel-z', window.mpuState.az.toFixed(2));
            renderBubbleLevel();
        }

        // 2. GPS Navigation Precision Drift (Coordinate simulation loop)
        if (Math.random() > 0.6) {
            window.gpsState.lat += (Math.random() - 0.5) * 0.00002;
            window.gpsState.lng += (Math.random() - 0.5) * 0.00002;
            updateSensor('val-gps-lat', `${window.gpsState.lat.toFixed(5)}° N`);
            updateSensor('val-gps-lng', `${window.gpsState.lng.toFixed(5)}° W`);
        }

        // 3. Vibration Piezo Flutter
        const simVib = 0.05 + Math.random() * 0.08;
        updateSensor('val-vib', simVib.toFixed(2));
        renderSeismicWave(simVib);

        // 4. Proximity / Ultrasonic Drift
        const simDist = 120 + Math.random() * 80;
        updateSensor('val-ultrasonic', Math.round(simDist));
        renderProximityArch(simDist);
        
        // 5. Gas PPM simulation
        const simGas = 200 + Math.round(Math.random() * 120);
        updateSensor('val-gas', simGas);
        renderGasEqualizer(simGas);

        // 6. Temperature simulation
        const simTemp = 23.5 + Math.random() * 2.0;
        updateSensor('val-temp', simTemp.toFixed(1));
        const tPct = Math.min(100, Math.max(0, (simTemp / 50) * 100));
        const tFill = document.getElementById('temp-track-fill');
        const tInd = document.getElementById('temp-track-indicator');
        if (tFill) tFill.style.width = `${tPct}%`;
        if (tInd) tInd.style.left = `${tPct}%`;

    }, 1500);
}

/* ============================================================
   DOM READY & MQTT CONNECTOR
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
    const mc = window.mqttController;

    // Start baseline visual loops immediately
    startSimulatedTelemetry();

    if (!mc) {
        console.warn('[Sensors] mqttController not found. Sensor updates running on internal simulations.');
        return;
    }

    // Subscribe to incoming MQTT telemetry streams
    mc.on('telemetry', (d) => {
        if (!d || !d.sensor) return;
        const v = d.value;

        switch (d.sensor) {

            /* ① FLAME DETECTION (Digital Pin 15) ────────────────── */
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

            /* ② MQ-2 GAS & SMOKE (Analog Pin 12) ────────────────── */
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

            /* ③ PIR MOTION (Digital Pin 14) ─────────────────────── */
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

            /* ④ ULTRASONIC RANGE (TRIG/ECHO GPIO 2/16) ──────────── */
            case 'ultrasonic': {
                const uVal = parseFloat(v);
                if (isNaN(uVal)) break;

                updateSensor('val-ultrasonic', Math.round(uVal));
                renderProximityArch(uVal);
                break;
            }

            /* ⑤ SEISMIC VIBRATION (Analog Pin 13) ────────────────── */
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

            /* ⑥ MPU-6050 IMU TRIGGERS ───────────────────────────── */
            case 'tilt': {
                const tiltVal = parseFloat(v);
                if (isNaN(tiltVal)) break;
                // Bind to Pitch, offset roll slightly for 3D realism
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

            /* ⑦ GPS NAVIGATION MODULE (NEO-6M) ──────────────────── */
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

            /* ⑧ CAMERA STREAM FPS / RESOLUTION ─────────────────── */
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

            /* ⑨ DHT11 TEMPERATURE ───────────────────────────────── */
            case 'temp': {
                const tempVal = parseFloat(v);
                if (isNaN(tempVal)) break;
                
                updateSensor('val-temp', tempVal.toFixed(1));
                
                // Scale 0-50 °C to 0-100% position
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
