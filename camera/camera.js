/**
 * RescueBOT — Vision Array Controller
 * camera.js — Full camera module with MQTT, FPS counter, AI detection, snapshot.
 */

import '../shared/mqtt-client.js';

document.addEventListener('DOMContentLoaded', () => {

    // ── Element References ────────────────────────────────────
    const streamImg        = document.getElementById('esp32-stream');
    const feedPlaceholder  = document.getElementById('feed-placeholder');
    const mainFeedPanel    = document.getElementById('main-feed-panel');
    const btnStreamToggle  = document.getElementById('btn-stream-toggle');
    const btnSnapshot      = document.getElementById('btn-snapshot');
    const btnFullscreen    = document.getElementById('btn-fullscreen');

    // Navbar indicators
    const camRecDot        = document.getElementById('cam-rec-dot');
    const camRecLabel      = document.getElementById('cam-rec-label');
    const missionClock     = document.getElementById('mission-clock');

    // HUD badges
    const recBadge         = document.getElementById('rec-badge');
    const fpsBadge         = document.getElementById('fps-badge');
    const latencyBadge     = document.getElementById('latency-badge');
    const hudTimestamp     = document.getElementById('hud-timestamp');

    // Sidebar stats
    const camConnBadge     = document.getElementById('cam-conn-badge');
    const statFps          = document.getElementById('stat-fps');
    const statRes          = document.getElementById('stat-res');
    const statLatency      = document.getElementById('stat-latency');
    const statQual         = document.getElementById('stat-qual');

    // New HUD elements
    const zoomValueEl      = document.getElementById('zoom-value');
    const compassDiscEl    = document.getElementById('hud-compass-disc');
    const compassHeadingEl = document.getElementById('compass-heading-val');
    const btnZoomIn        = document.getElementById('btn-zoom-in');
    const btnZoomOut       = document.getElementById('btn-zoom-out');

    // HUD Telemetry
    const hudSpeedEl       = document.getElementById('hud-speed');
    const hudHeadingEl     = document.getElementById('hud-heading');
    const hudLatEl         = document.getElementById('hud-lat');
    const hudLngEl         = document.getElementById('hud-lng');
    const hudAltEl         = document.getElementById('hud-alt');

    // Sidebar reset / clear buttons
    const btnClearTiles    = document.getElementById('btn-clear-tiles');
    const btnClearLog      = document.getElementById('btn-clear-log');

    // AI log
    const aiLogList        = document.getElementById('ai-log-list');

    // Vision Array Controls
    const ctrlRes          = document.getElementById('ctrl-resolution');
    const ctrlBrightness   = document.getElementById('ctrl-brightness');
    const ctrlContrast     = document.getElementById('ctrl-contrast');
    const ctrlSaturation   = document.getElementById('ctrl-saturation');
    const ctrlEffect       = document.getElementById('ctrl-effect');
    const ctrlLed          = document.getElementById('ctrl-led');
    const ctrlMirror       = document.getElementById('ctrl-mirror');
    const ctrlFlip         = document.getElementById('ctrl-flip');
    const ctrlNight        = document.getElementById('ctrl-night');
    const valBrightness    = document.getElementById('val-brightness');
    const valContrast      = document.getElementById('val-contrast');
    const valSaturation    = document.getElementById('val-saturation');
    const valLed           = document.getElementById('val-led');

    // ── State ─────────────────────────────────────────────────
    let isStreaming  = false;
    let isRecording  = false;
    let zoomLevel    = 1.0;

    // Detection tile counts
    const tileCounts = {
        motion: 0,
        human: 0,
        hazard: 0,
        fire: 0
    };

    // FPS tracking
    let fpsFrameTimes  = [];
    let fpsValue       = 0;
    let frameCount     = 0;

    // Tile auto-clear timers
    const tileTimers = {};

    // ── Mission Clock ─────────────────────────────────────────
    setInterval(() => {
        const now = new Date();
        const hh  = String(now.getHours()).padStart(2, '0');
        const mm  = String(now.getMinutes()).padStart(2, '0');
        const ss  = String(now.getSeconds()).padStart(2, '0');
        if (missionClock) missionClock.textContent = `${hh}:${mm}:${ss}`;
    }, 1000);

    // ── HUD Timestamp ─────────────────────────────────────────
    setInterval(() => {
        if (!hudTimestamp) return;
        const now = new Date();
        const pad = (n, len = 2) => String(n).padStart(len, '0');
        hudTimestamp.textContent =
            `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}  ` +
            `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    }, 1000);

    // ── Zoom Logic ────────────────────────────────────────────
    const updateZoom = () => {
        if (zoomValueEl) zoomValueEl.textContent = `${zoomLevel.toFixed(1)}x`;
        if (streamImg) {
            streamImg.style.transform = `scale(${zoomLevel})`;
            streamImg.style.transformOrigin = 'center';
            streamImg.style.transition = 'transform 0.25s ease';
        }
    };

    if (btnZoomIn) {
        btnZoomIn.addEventListener('click', () => {
            if (zoomLevel < 5.0) {
                zoomLevel += 0.5;
                updateZoom();
            }
        });
    }

    if (btnZoomOut) {
        btnZoomOut.addEventListener('click', () => {
            if (zoomLevel > 1.0) {
                zoomLevel -= 0.5;
                updateZoom();
            }
        });
    }

    // ── FPS Counter via img onload ────────────────────────────
    if (streamImg) {
        streamImg.addEventListener('load', () => {
            const now = performance.now();
            frameCount++;
            fpsFrameTimes.push(now);

            // Remove frames older than 1 second
            const oneSecAgo = now - 1000;
            fpsFrameTimes = fpsFrameTimes.filter(t => t > oneSecAgo);
            fpsValue = fpsFrameTimes.length;

            if (fpsBadge)    fpsBadge.textContent    = `${fpsValue} FPS`;
            if (statFps)     statFps.textContent      = fpsValue;

            // Estimate latency from frame rate (rough heuristic)
            const latencyMs = fpsValue > 0 ? Math.round(1000 / fpsValue) : 0;
            if (latencyBadge)  latencyBadge.textContent  = `${latencyMs} ms`;
            if (statLatency)   statLatency.textContent   = `${latencyMs}`;

            // Keep the stream mjpeg refreshing if it's a still URL (e.g., capture) and not a live push stream
            if (isStreaming && streamImg.src && !streamImg.src.includes('/mjpeg') && !streamImg.src.includes('/stream') && streamImg.src.includes('/capture')) {
                const sep = streamImg.src.includes('?') ? '&' : '?';
                const baseUrl = streamImg.src.split('?')[0];
                streamImg.src = `${baseUrl}${sep}_t=${Date.now()}`;
            }
        });
    }

    // ── Stream Toggle ─────────────────────────────────────────
    if (btnStreamToggle) {
        btnStreamToggle.addEventListener('click', () => {
            const mqtt = window.mqttController;
            if (!isStreaming) {
                // Activate stream
                if (mqtt) mqtt.sendCommand('TOGGLE_STREAM', { active: true });
                isStreaming = true;
                isRecording = true;

                // Update button
                btnStreamToggle.innerHTML = `<i data-lucide="square"></i> STOP STREAM`;
                btnStreamToggle.classList.add('active-stream');

                // Update navbar REC indicator
                if (camRecDot) {
                    camRecDot.classList.remove('standby');
                    camRecDot.classList.add('recording');
                }
                if (camRecLabel) camRecLabel.textContent = 'RECORDING';

                console.log('[Camera] Stream started.');
            } else {
                // Deactivate stream
                if (mqtt) mqtt.sendCommand('TOGGLE_STREAM', { active: false });
                isStreaming = false;
                isRecording = false;

                // Reset button
                btnStreamToggle.innerHTML = `<i data-lucide="play"></i> START STREAM`;
                btnStreamToggle.classList.remove('active-stream');

                // Hide img, show placeholder
                if (streamImg)       streamImg.style.display = 'none';
                if (feedPlaceholder) feedPlaceholder.style.display = 'flex';

                // Reset navbar indicator
                if (camRecDot) {
                    camRecDot.classList.remove('recording');
                    camRecDot.classList.add('standby');
                }
                if (camRecLabel) camRecLabel.textContent = 'STANDBY';

                // Reset camera badge
                if (camConnBadge) {
                    camConnBadge.className = 'badge badge-red';
                    camConnBadge.textContent = 'OFFLINE';
                }

                // Reset stats
                if (fpsBadge)    fpsBadge.textContent    = '-- FPS';
                if (latencyBadge) latencyBadge.textContent = '-- ms';
                if (statFps)     statFps.textContent      = '--';
                if (statLatency) statLatency.textContent  = '--';

                console.log('[Camera] Stream stopped.');
            }

            // Re-init lucide icons for new button
            if (typeof lucide !== 'undefined') lucide.createIcons();
        });
    }

    // ── Vision Array Controls Event Listeners ─────────────────
    const sendCamCommand = (cmd, valKey, val) => {
        const mqtt = window.mqttController;
        if (mqtt) {
            const payload = {};
            payload[valKey] = val;
            mqtt.sendCommand(cmd, payload);
        }
    };

    // ── Manual IP Mounting ────────────────────────────────────
    const ctrlCameraIp = document.getElementById('ctrl-camera-ip');
    const btnApplyIp   = document.getElementById('btn-apply-ip');

    // Restore saved IP if present
    if (ctrlCameraIp) {
        const savedIp = localStorage.getItem('rescuebot-camera-ip');
        if (savedIp) {
            ctrlCameraIp.value = savedIp;
        }
    }

    if (btnApplyIp && ctrlCameraIp) {
        btnApplyIp.addEventListener('click', () => {
            let val = ctrlCameraIp.value.trim();
            if (!val) {
                if (window.RESCUEBOT_UI) window.RESCUEBOT_UI.toast('Please enter a valid IP address.', 'warning');
                return;
            }

            // Remove any prefix protocol or port if the user pasted it
            val = val.replace(/^(https?:\/\/)?/, ''); // Remove http:// or https://
            val = val.replace(/\/.*$/, '');           // Remove trailing slash and path
            val = val.split(':')[0];                  // Remove port if present (e.g. :81)

            // Save to localStorage
            localStorage.setItem('rescuebot-camera-ip', val);

            // Construct the final URL on port 81 (the stream server)
            const streamUrl = `http://${val}:81/stream`;

            // Mount the stream
            if (streamImg) {
                streamImg.src = streamUrl;
                streamImg.style.display = 'block';
            }
            if (feedPlaceholder) feedPlaceholder.style.display = 'none';

            isStreaming = true;
            isRecording = true;

            // Update status badges
            if (camConnBadge) {
                camConnBadge.className = 'badge badge-green';
                camConnBadge.textContent = 'LIVE (MANUAL)';
            }
            if (camRecDot) {
                camRecDot.className = 'live-dot recording';
            }
            if (camRecLabel) camRecLabel.textContent = 'LIVE';

            if (window.RESCUEBOT_UI) window.RESCUEBOT_UI.toast(`Mounted manual camera feed: ${streamUrl}`, 'success');
            console.log('[Camera] Mounted manual camera stream:', streamUrl);
        });
    }

    if (ctrlRes) {
        ctrlRes.addEventListener('change', (e) => {
            const val = parseInt(e.target.value);
            sendCamCommand('SET_RESOLUTION', 'val', val);
            console.log('[Camera] Dispatched SET_RESOLUTION:', val);
        });
    }

    if (ctrlBrightness) {
        ctrlBrightness.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            if (valBrightness) valBrightness.textContent = val > 0 ? `+${val}` : val;
            sendCamCommand('SET_BRIGHTNESS', 'val', val);
        });
    }

    if (ctrlContrast) {
        ctrlContrast.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            if (valContrast) valContrast.textContent = val > 0 ? `+${val}` : val;
            sendCamCommand('SET_CONTRAST', 'val', val);
        });
    }

    if (ctrlSaturation) {
        ctrlSaturation.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            if (valSaturation) valSaturation.textContent = val > 0 ? `+${val}` : val;
            sendCamCommand('SET_SATURATION', 'val', val);
        });
    }

    if (ctrlEffect) {
        ctrlEffect.addEventListener('change', (e) => {
            const val = parseInt(e.target.value);
            sendCamCommand('SET_SPECIAL_EFFECT', 'val', val);
            console.log('[Camera] Dispatched SET_SPECIAL_EFFECT:', val);
        });
    }

    if (ctrlLed) {
        ctrlLed.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            const pct = Math.round((val / 255) * 100);
            if (valLed) valLed.textContent = `${pct}%`;
            sendCamCommand('SET_LED_INTENSITY', 'val', val);
            if (ctrlNight) {
                ctrlNight.checked = val > 0;
            }
        });
    }

    if (ctrlMirror) {
        ctrlMirror.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            sendCamCommand('SET_HMIRROR', 'enabled', enabled);
            console.log('[Camera] Dispatched SET_HMIRROR:', enabled);
        });
    }

    if (ctrlFlip) {
        ctrlFlip.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            sendCamCommand('SET_VFLIP', 'enabled', enabled);
            console.log('[Camera] Dispatched SET_VFLIP:', enabled);
        });
    }

    if (ctrlNight) {
        ctrlNight.addEventListener('change', (e) => {
            const enabled = e.target.checked;
            const val = enabled ? 255 : 0;
            if (ctrlLed) ctrlLed.value = val;
            if (valLed) valLed.textContent = enabled ? '100%' : '0%';
            sendCamCommand('SET_NIGHT_MODE', 'enabled', enabled);
            console.log('[Camera] Dispatched SET_NIGHT_MODE:', enabled);
        });
    }

    // ── Snapshot ──────────────────────────────────────────────
    if (btnSnapshot) {
        btnSnapshot.addEventListener('click', () => {
            if (!streamImg || streamImg.style.display === 'none') {
                console.warn('[Camera] No active stream to snapshot.');
                return;
            }

            try {
                const canvas  = document.createElement('canvas');
                canvas.width  = streamImg.naturalWidth  || streamImg.width  || 640;
                canvas.height = streamImg.naturalHeight || streamImg.height || 480;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(streamImg, 0, 0, canvas.width, canvas.height);

                const dataUrl = canvas.toDataURL('image/png');
                const link    = document.createElement('a');
                const ts      = new Date().toISOString().replace(/[:.]/g, '-');
                link.download = `rescuebot_snapshot_${ts}.png`;
                link.href     = dataUrl;
                link.click();
                console.log('[Camera] Snapshot saved.');

                addAILog({ label: 'SNAPSHOT', conf: 100 });
            } catch (err) {
                console.error('[Camera] Snapshot failed (CORS?):', err);
            }
        });
    }

    // ── Fullscreen ────────────────────────────────────────────
    if (btnFullscreen) {
        btnFullscreen.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                if (mainFeedPanel && mainFeedPanel.requestFullscreen) {
                    mainFeedPanel.requestFullscreen().catch(err => {
                        console.error('[Camera] Fullscreen error:', err);
                    });
                }
            } else {
                document.exitFullscreen();
            }
        });
    }

    // ── Tile Reset Button ─────────────────────────────────────
    if (btnClearTiles) {
        btnClearTiles.addEventListener('click', () => {
            Object.keys(tileCounts).forEach(key => {
                tileCounts[key] = 0;
                const countBadge = document.getElementById(`count-${key}`);
                if (countBadge) countBadge.textContent = '0';

                const confFill = document.getElementById(`conf-${key}`);
                if (confFill) confFill.style.width = '0%';

                const confVal = document.getElementById(`conf-val-${key}`);
                if (confVal) confVal.textContent = '0%';

                const lastEl = document.getElementById(`last-${key}`);
                if (lastEl) lastEl.textContent = '--:--:--';

                const statusEl = document.getElementById(`status-${key}`);
                if (statusEl) statusEl.textContent = 'CLEAR';

                const tile = document.getElementById(`tile-${key}`);
                if (tile) tile.className = 'detection-tile';

                const bbox = document.getElementById(`bbox-${key}`);
                if (bbox) bbox.style.display = 'none';

                if (tileTimers[key]) {
                    clearTimeout(tileTimers[key]);
                    delete tileTimers[key];
                }
            });
            if (window.RESCUEBOT_UI) window.RESCUEBOT_UI.toast('AI detection stats reset.', 'info');
        });
    }

    // ── Clear Log Button ──────────────────────────────────────
    if (btnClearLog) {
        btnClearLog.addEventListener('click', () => {
            if (aiLogList) {
                aiLogList.innerHTML = `
                    <div class="ai-log-empty">
                        <i data-lucide="radar" class="ai-log-radar-icon"></i>
                        <span>No events detected</span>
                    </div>
                `;
                if (typeof lucide !== 'undefined') lucide.createIcons();
                if (window.RESCUEBOT_UI) window.RESCUEBOT_UI.toast('AI event log cleared.', 'info');
            }
        });
    }

    // ── MQTT: Camera Feed ─────────────────────────────────────
    const bindMqtt = () => {
        const mqtt = window.mqttController;
        if (!mqtt) {
            setTimeout(bindMqtt, 500);
            return;
        }

        mqtt.on('camera', (d) => {
            if (d && d.active && d.url) {
                // Show the stream
                if (streamImg) {
                    streamImg.src = d.url;
                    streamImg.style.display = 'block';
                }
                if (feedPlaceholder) feedPlaceholder.style.display = 'none';

                isStreaming = true;
                isRecording = true;

                // Navbar red blink indicator
                if (camRecDot) {
                    camRecDot.classList.remove('standby');
                    camRecDot.classList.add('recording');
                }
                if (camRecLabel) camRecLabel.textContent = 'LIVE';

                // Sidebar badge → LIVE green
                if (camConnBadge) {
                    camConnBadge.className = 'badge badge-green';
                    camConnBadge.textContent = 'LIVE';
                }

                // Update stat values from payload
                if (d.fps      !== undefined && statFps)     statFps.textContent     = d.fps;
                if (d.fps      !== undefined && fpsBadge)    fpsBadge.textContent    = `${d.fps} FPS`;
                if (d.latency  !== undefined && statLatency) statLatency.textContent = d.latency;
                if (d.latency  !== undefined && latencyBadge) latencyBadge.textContent = `${d.latency} ms`;
                if (d.res      !== undefined && statRes)     statRes.textContent     = d.res;
                if (d.quality  !== undefined && statQual)    statQual.textContent    = d.quality;
            }
        });

        // ── MQTT: Alerts / AI Detection ───────────────────────
        mqtt.on('alerts', (d) => {
            if (!d || !d.label) return;

            const label = String(d.label).toUpperCase();
            const conf = d.conf !== undefined ? d.conf : Math.floor(Math.random() * 15) + 80;

            addAILog({ label: label, conf: conf, desc: d.desc });

            if (label === 'HUMAN') {
                triggerTile('human', 'DETECTED', 'triggered', conf, 5000);
            } else if (label === 'MOTION') {
                triggerTile('motion', 'DETECTED', 'triggered', conf, 5000);
            } else if (label === 'HAZARD') {
                triggerTile('hazard', 'WARNING', 'triggered', conf, 8000);
            } else if (label === 'FIRE') {
                triggerTile('fire', 'DANGER', 'danger-triggered', conf, 0);
            }
        });

        // ── MQTT: Telemetry (fire sensor & telemetry bar) ─────
        mqtt.on('telemetry', (d) => {
            if (!d) return;

            // Flame detection fallback
            if (
                d.sensor === 'fire' &&
                String(d.value).toUpperCase().includes('FIRE DETECTED')
            ) {
                triggerTile('fire', 'FIRE!', 'danger-triggered', 99, 0);
                addAILog({ label: 'FIRE', conf: 99, desc: 'Flame sensor active at rover node.' });
            }

            // HUD bottom telemetry strip overrides if sent as telemetry key-values
            if (d.sensor === 'temp') {
                const tempVal = parseFloat(d.value);
                const tempEl = document.getElementById('hud-tele-temp'); // if styled card exists
                // We also update general bottom strip elements if they match
            }
        });

        // ── MQTT: GPS (Heading & Position Strip update) ──────
        mqtt.on('gps', (d) => {
            if (!d) return;
            if (d.lat !== undefined && hudLatEl) hudLatEl.textContent = parseFloat(d.lat).toFixed(6);
            if (d.lng !== undefined && hudLngEl) hudLngEl.textContent = parseFloat(d.lng).toFixed(6);
            if (d.speed !== undefined && hudSpeedEl) hudSpeedEl.textContent = `${parseFloat(d.speed).toFixed(1)} m/s`;
            if (d.heading !== undefined) {
                const hVal = parseFloat(d.heading);
                if (hudHeadingEl) hudHeadingEl.textContent = `${hVal.toFixed(1)}°`;
                if (compassHeadingEl) compassHeadingEl.textContent = `${String(Math.round(hVal)).padStart(3, '0')}°`;
                if (compassDiscEl) compassDiscEl.style.transform = `rotate(${-hVal}deg)`;
            }
            if (d.alt !== undefined && hudAltEl) hudAltEl.textContent = `${parseFloat(d.alt).toFixed(1)} m`;
        });
    };

    // Wait for mqttController to be available
    bindMqtt();

    // ── Tile Trigger Helper ───────────────────────────────────
    /**
     * Highlights a detection tile, increments count, shows confidence and triggers bounding box.
     */
    function triggerTile(key, statusText, cssClass, conf, clearMs) {
        const tile = document.getElementById(`tile-${key}`);
        const statusEl = document.getElementById(`status-${key}`);
        const countBadge = document.getElementById(`count-${key}`);
        const confFill = document.getElementById(`conf-${key}`);
        const confVal = document.getElementById(`conf-val-${key}`);
        const lastEl = document.getElementById(`last-${key}`);
        const bbox = document.getElementById(`bbox-${key}`);
        const bboxConf = document.getElementById(`bbox-${key}-conf`);

        if (!tile || !statusEl) return;

        // Clear any pending auto-reset
        if (tileTimers[key]) {
            clearTimeout(tileTimers[key]);
            delete tileTimers[key];
        }

        // Increment count
        tileCounts[key]++;
        if (countBadge) countBadge.textContent = tileCounts[key];

        // Apply triggered class & status text
        tile.classList.remove('triggered', 'danger-triggered');
        tile.classList.add(cssClass);
        statusEl.textContent = statusText;

        // Update confidence
        if (confFill) confFill.style.width = `${conf}%`;
        if (confVal) confVal.textContent = `${conf}%`;

        // Update last trigger time
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        if (lastEl) lastEl.textContent = timeStr;

        // Show HUD bounding box overlay
        if (bbox) {
            bbox.style.display = 'block';
            if (bboxConf) bboxConf.textContent = `${conf}%`;
        }

        // Auto-clear timer if specified
        if (clearMs > 0) {
            tileTimers[key] = setTimeout(() => {
                tile.classList.remove('triggered', 'danger-triggered');
                statusEl.textContent = 'CLEAR';
                if (bbox) bbox.style.display = 'none';
                delete tileTimers[key];
            }, clearMs);
        }
    }

    // ── Add AI Log Entry ──────────────────────────────────────
    /**
     * Prepends a new rich log entry to the AI event log.
     */
    function addAILog(entry) {
        if (!aiLogList) return;

        // Remove empty state placeholder if present
        const emptyEl = aiLogList.querySelector('.ai-log-empty');
        if (emptyEl) emptyEl.remove();

        const label   = String(entry.label || 'EVENT').toUpperCase();
        const conf    = entry.conf !== undefined ? entry.conf : 0;
        const typeMap = {
            MOTION:   { class: 'log-motion', desc: 'Rover proximity radar reports motion signature.' },
            HUMAN:    { class: 'log-human', desc: 'AI Vision analysis confirms presence of human biological outline.' },
            HAZARD:   { class: 'log-hazard', desc: 'Integrated environmental analysis detects toxic chemical/gas signature.' },
            FIRE:     { class: 'log-fire', desc: 'Thermal infrared array sensors detect active flame thermal profile.' },
            SNAPSHOT: { class: 'log-default', desc: 'Rover snapshot captured and archived locally.' },
        };
        const logMeta = typeMap[label] || { class: 'log-default', desc: 'Field diagnostic telemetry event logged.' };

        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

        const div = document.createElement('div');
        div.className = `ai-log-entry ${logMeta.class}`;
        div.innerHTML = `
            <div class="ai-log-entry-header">
                <span class="ai-log-pill">${label}</span>
                <div class="ai-log-meta-right">
                    <span class="ai-log-time">${timeStr}</span>
                    ${conf ? `<span class="badge ${conf > 90 ? 'badge-red' : 'badge-amber'}" style="font-size: 8px; padding: 1px 4px;">${conf}%</span>` : ''}
                </div>
            </div>
            <div class="ai-log-desc">${entry.desc || logMeta.desc}</div>
        `;

        // Prepend so newest is at top
        aiLogList.insertBefore(div, aiLogList.firstChild);

        // Cap log at 20 entries
        while (aiLogList.children.length > 20) {
            aiLogList.removeChild(aiLogList.lastChild);
        }
    }

    // ── Sidebar Collapse (mirrors shared.js behaviour) ────────
    const sidebarCollapseBtn = document.getElementById('sidebar-collapse-btn');
    const sidebar            = document.getElementById('sidebar');
    if (sidebarCollapseBtn && sidebar) {
        sidebarCollapseBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            const icon = sidebarCollapseBtn.querySelector('[data-lucide]');
            if (icon) {
                const isCollapsed = sidebar.classList.contains('collapsed');
                icon.setAttribute('data-lucide', isCollapsed ? 'chevrons-right' : 'chevrons-left');
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }
        });
    }

    // ── MQTT status dot wiring ────────────────────────────────
    const mqttDot        = document.getElementById('mqtt-dot');
    const mqttStatusText = document.getElementById('mqtt-status-text');

    window.addEventListener('ares:statusChanged', (e) => {
        const s = e.detail;
        if (!mqttDot || !mqttStatusText) return;
        if (s === 'CONNECTED') {
            mqttDot.className = 'status-dot';
            mqttStatusText.textContent = 'SYSTEM ONLINE';
        } else if (s === 'CONNECTING') {
            mqttDot.className = 'status-dot warning';
            mqttStatusText.textContent = 'ESTABLISHING...';
        } else {
            mqttDot.className = 'status-dot offline';
            mqttStatusText.textContent = 'SYSTEM OFFLINE';
        }
    });

    // ── EDGE AI OBJECT DETECTION (TensorFlow.js + COCO-SSD) ──
    let cocoModel = null;
    let detectionTimeout = null;
    let lastAlertTime = 0;
    const alertThrottleMs = 5000; // Throttle MQTT alerts to 5 seconds to avoid network flooding

    console.log('[Edge AI] Loading COCO-SSD object detection neural network...');
    if (typeof cocoSsd !== 'undefined') {
        cocoSsd.load().then(model => {
            cocoModel = model;
            console.log('[Edge AI] Neural network successfully mounted!');
            if (window.RESCUEBOT_UI) window.RESCUEBOT_UI.toast('🤖 Edge AI Engine Online!', 'success');
            
            // Set indicator
            const fpsBadge = document.getElementById('fps-badge');
            if (fpsBadge) fpsBadge.textContent = 'AI DETECTING';
            
            // Initiate Edge AI loop
            startDetectionLoop();
        }).catch(err => {
            console.error('[Edge AI] Failed to load model:', err);
        });
    } else {
        console.warn('[Edge AI] cocoSsd global namespace not found. TensorFlow.js script may have failed to load.');
    }

    function startDetectionLoop() {
        if (!isStreaming || !cocoModel || !streamImg || streamImg.style.display === 'none') {
            // Check once per second when offline or model is compiling
            detectionTimeout = setTimeout(startDetectionLoop, 1000);
            return;
        }

        // Detect objects in raw image pixel matrix
        cocoModel.detect(streamImg).then(predictions => {
            handleAIPredictions(predictions);
            // Schedule next frame in 100ms (10 FPS limit to keep browser fluid)
            detectionTimeout = setTimeout(startDetectionLoop, 100);
        }).catch(err => {
            console.error('[Edge AI] Execution error:', err);
            detectionTimeout = setTimeout(startDetectionLoop, 1000);
        });
    }

    function handleAIPredictions(predictions) {
        const humanBBox = document.getElementById('bbox-human');
        const hazardBBox = document.getElementById('bbox-hazard');

        let humanDetected = false;
        let hazardDetected = false;

        predictions.forEach(p => {
            const scorePercent = Math.round(p.score * 100);
            if (scorePercent < 55) return; // Threshold cutoff for noise filtering

            // Map tensor coordinates to browser rendered canvas dimensions!
            const imgWidth = streamImg.clientWidth || streamImg.width || 640;
            const imgHeight = streamImg.clientHeight || streamImg.height || 480;
            const natWidth = streamImg.naturalWidth || imgWidth;
            const natHeight = streamImg.naturalHeight || imgHeight;

            const scaleX = imgWidth / natWidth;
            const scaleY = imgHeight / natHeight;

            const [x, y, w, h] = p.bbox;
            const displayX = x * scaleX;
            const displayY = y * scaleY;
            const displayW = w * scaleX;
            const displayH = h * scaleY;

            if (p.class === 'person') {
                humanDetected = true;
                
                // Position HUD bracket
                if (humanBBox) {
                    humanBBox.style.display = 'block';
                    humanBBox.style.left = `${displayX}px`;
                    humanBBox.style.top = `${displayY}px`;
                    humanBBox.style.width = `${displayW}px`;
                    humanBBox.style.height = `${displayH}px`;
                    
                    const labelConf = document.getElementById('bbox-human-conf');
                    if (labelConf) labelConf.textContent = `${scorePercent}%`;
                }

                // Push visual highlight & counts
                triggerTile('human', 'DETECTED', 'triggered', scorePercent, 3000);
                
                // Dispatch MQTT alarm
                publishAlert('HUMAN', scorePercent, 'Edge AI confirms active human biometric outline in stream matrix.');
            }
            else if (['backpack', 'handbag', 'cat', 'dog', 'chair', 'cell phone', 'laptop', 'bottle', 'cup', 'scissors', 'car', 'truck', 'motorcycle', 'fire hydrant', 'stop sign', 'traffic light', 'umbrella', 'suitcase', 'bird'].includes(p.class)) {
                hazardDetected = true;

                // Position hazard bracket
                if (hazardBBox) {
                    hazardBBox.style.display = 'block';
                    hazardBBox.style.left = `${displayX}px`;
                    hazardBBox.style.top = `${displayY}px`;
                    hazardBBox.style.width = `${displayW}px`;
                    hazardBBox.style.height = `${displayH}px`;
                    
                    const labelConf = document.getElementById('bbox-hazard-conf');
                    if (labelConf) labelConf.textContent = `${scorePercent}% (${p.class.toUpperCase()})`;
                }

                // Push visual highlight & counts
                triggerTile('hazard', 'WARNING', 'triggered', scorePercent, 4000);
                
                // Dispatch MQTT alarm
                publishAlert('HAZARD', scorePercent, `Vision analysis tags risk structural obstacle: ${p.class.toUpperCase()}`);
            }
        });

        // Hide bounding boxes if targets are lost
        if (!humanDetected && humanBBox) humanBBox.style.display = 'none';
        if (!hazardDetected && hazardBBox) hazardBBox.style.display = 'none';
    }

    function publishAlert(label, conf, desc) {
        const now = Date.now();
        if (now - lastAlertTime < alertThrottleMs) return;
        
        const mqtt = window.mqttController;
        if (mqtt) {
            mqtt.sendCommand('ALERT_TRIGGERED', {
                type: 'DETECTION',
                label: label,
                conf: conf,
                desc: desc
            });
            lastAlertTime = now;
            console.log('[Edge AI] Broadcasted MQTT Alert:', label, conf);
        }
    }

    // ── Lucide icon init ──────────────────────────────────────
    if (typeof lucide !== 'undefined') lucide.createIcons();

});
