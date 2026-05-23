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

    // Detection tiles
    const tileMotion       = document.getElementById('tile-motion');
    const tileHuman        = document.getElementById('tile-human');
    const tileHazard       = document.getElementById('tile-hazard');
    const tileFire         = document.getElementById('tile-fire');
    const statusMotion     = document.getElementById('status-motion');
    const statusHuman      = document.getElementById('status-human');
    const statusHazard     = document.getElementById('status-hazard');
    const statusFire       = document.getElementById('status-fire');

    // AI log
    const aiLogList        = document.getElementById('ai-log-list');

    // ── State ─────────────────────────────────────────────────
    let isStreaming  = false;
    let isRecording  = false;

    // FPS tracking
    let fpsFrameTimes  = [];
    let fpsLastCalc    = performance.now();
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

            // Keep the stream mjpeg refreshing if it's a still URL
            if (isStreaming && streamImg.src && !streamImg.src.includes('/mjpeg')) {
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

                addAILog({ label: 'SNAPSHOT', conf: 100, type: 'default' });
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

            addAILog(d);

            const label = String(d.label).toUpperCase();

            if (label === 'HUMAN') {
                triggerTile(tileHuman, statusHuman, 'DETECTED', 'triggered', 5000);
            }
            if (label === 'MOTION') {
                triggerTile(tileMotion, statusMotion, 'DETECTED', 'triggered', 5000);
            }
            if (label === 'HAZARD') {
                triggerTile(tileHazard, statusHazard, 'WARNING', 'triggered', 8000);
            }
            if (label === 'FIRE') {
                triggerTile(tileFire, statusFire, 'DANGER', 'danger-triggered', 0);
            }
        });

        // ── MQTT: Telemetry (fire sensor) ─────────────────────
        mqtt.on('telemetry', (d) => {
            if (!d) return;
            if (
                d.sensor === 'fire' &&
                String(d.value).toUpperCase().includes('FIRE DETECTED')
            ) {
                triggerTile(tileFire, statusFire, 'FIRE!', 'danger-triggered', 0);
                addAILog({ label: 'FIRE', conf: 99, type: 'fire' });
            }
        });
    };

    // Wait for mqttController to be available
    bindMqtt();

    // ── Tile Trigger Helper ───────────────────────────────────
    /**
     * Highlights a detection tile and auto-clears after `clearMs` ms.
     * Pass clearMs = 0 to keep it triggered indefinitely (manual reset only).
     */
    function triggerTile(tile, statusEl, statusText, cssClass, clearMs) {
        if (!tile || !statusEl) return;

        // Clear any pending auto-reset
        const tileId = tile.id;
        if (tileTimers[tileId]) {
            clearTimeout(tileTimers[tileId]);
            delete tileTimers[tileId];
        }

        // Apply triggered state
        tile.classList.remove('triggered', 'danger-triggered');
        tile.classList.add(cssClass);
        statusEl.textContent = statusText;

        // Auto-clear
        if (clearMs > 0) {
            tileTimers[tileId] = setTimeout(() => {
                tile.classList.remove('triggered', 'danger-triggered');
                statusEl.textContent = 'CLEAR';
                delete tileTimers[tileId];
            }, clearMs);
        }
    }

    // ── Add AI Log Entry ──────────────────────────────────────
    /**
     * Prepends a new log entry to the AI event log.
     * @param {{ label: string, conf?: number, type?: string }} entry
     */
    function addAILog(entry) {
        if (!aiLogList) return;

        // Remove empty state placeholder if present
        const emptyEl = aiLogList.querySelector('.ai-log-empty');
        if (emptyEl) emptyEl.remove();

        const label   = String(entry.label || 'EVENT').toUpperCase();
        const conf    = entry.conf !== undefined ? `${entry.conf}%` : '';
        const typeMap = {
            MOTION:   'log-motion',
            HUMAN:    'log-human',
            HAZARD:   'log-hazard',
            FIRE:     'log-fire',
            SNAPSHOT: 'log-default',
        };
        const logClass = typeMap[label] || 'log-default';

        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

        const div = document.createElement('div');
        div.className = `ai-log-entry ${logClass}`;
        div.innerHTML =
            `<span class="ai-log-time">${timeStr}</span>` +
            `<span class="ai-log-label">${label}</span>` +
            (conf ? `<span class="ai-log-conf">${conf}</span>` : '');

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

    // ── Lucide icon init ──────────────────────────────────────
    if (typeof lucide !== 'undefined') lucide.createIcons();

});
