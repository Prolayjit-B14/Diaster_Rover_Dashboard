/**
 * RescueBOT Alert Center — alerts.js
 * Priority-classified incident monitoring with MQTT integration.
 */

import '../shared/mqtt-client.js';

document.addEventListener('DOMContentLoaded', () => {

    // ── STATE ──────────────────────────────────────────────────
    let alerts       = [];
    let soundEnabled = false;
    let activeFilter = 'all';
    let uptimeSecs   = 0;
    // Deduplication: track last-seen time for each type+priority combo
    const lastAlertTime = {};

    // ── DOM REFS ───────────────────────────────────────────────
    const alertList          = document.getElementById('alert-list');
    const emptyAlerts        = document.getElementById('empty-alerts');
    const criticalBadge      = document.getElementById('critical-count-badge');
    const statTotal          = document.getElementById('stat-total');
    const statCritical       = document.getElementById('stat-critical');
    const statResolved       = document.getElementById('stat-resolved');
    const statUptime         = document.getElementById('stat-uptime');
    const cntCritical        = document.getElementById('cnt-critical');
    const cntHigh            = document.getElementById('cnt-high');
    const cntMedium          = document.getElementById('cnt-medium');
    const cntLow             = document.getElementById('cnt-low');
    const sosBtn             = document.getElementById('sos-btn');
    const soundToggleHeader  = document.getElementById('sound-toggle');
    const soundToggleCard    = document.getElementById('sound-toggle-card');
    const sidebarAlertCount  = document.getElementById('sidebar-alert-count');

    // ── HELPERS ────────────────────────────────────────────────
    function formatTime(date) {
        return [
            String(date.getHours()).padStart(2, '0'),
            String(date.getMinutes()).padStart(2, '0'),
            String(date.getSeconds()).padStart(2, '0')
        ].join(':');
    }

    function priorityBadgeClass(priority) {
        const map = {
            critical: 'badge-red',
            high:     'badge-orange',
            medium:   'badge-amber',
            low:      'badge-cyan'
        };
        return map[priority] || 'badge-cyan';
    }

    function priorityLabel(priority) {
        return priority.toUpperCase();
    }

    // ── SANITIZE ──────────────────────────────────────────────
    function sanitize(str) {
        const el = document.createElement('div');
        el.textContent = String(str);
        return el.innerHTML;
    }

    // ── ADD ALERT ──────────────────────────────────────────────
    function addAlert(type, priority, title, desc, icon, urgency = null) {
        // Deduplication: reject identical type+priority+title combos within 5 seconds
        const dedupKey = `${type}:${priority}:${title}`;
        const now = Date.now();
        if (lastAlertTime[dedupKey] && now - lastAlertTime[dedupKey] < 5000) {
            return;
        }
        lastAlertTime[dedupKey] = now;

        const alert = {
            id:        now,
            type,
            priority,
            title,
            desc,
            icon,
            timestamp: new Date(),
            resolved:  false,
            urgency
        };
        alerts.push(alert);
        renderAlerts();
        updateStats();
        updateCounts();

        if (priority === 'critical' && soundEnabled) {
            playBeep();
        }
    }

    // ── RENDER ALERTS ──────────────────────────────────────────
    function renderAlerts() {
        // Filter
        const filtered = activeFilter === 'all'
            ? [...alerts]
            : alerts.filter(a => a.priority === activeFilter);

        // Sort newest first
        filtered.sort((a, b) => b.timestamp - a.timestamp);

        // Clear list
        alertList.innerHTML = '';

        if (filtered.length === 0) {
            emptyAlerts.style.display = 'block';
            return;
        }

        emptyAlerts.style.display = 'none';

        filtered.forEach((alert, idx) => {
            const item = document.createElement('div');
            item.className = `alert-item ${alert.priority}`;
            item.style.animationDelay = `${idx * 0.04}s`;

            const urgencyHtml = alert.urgency 
                ? `<span class="urgency-tag urgency-${alert.urgency.toLowerCase().replace('_urgency', '')}">${sanitize(alert.urgency.replace('_', ' '))}</span>` 
                : '';

            item.innerHTML = `
                <div class="alert-icon">${sanitize(alert.icon)}</div>
                <div class="alert-content">
                    <div class="alert-title">${sanitize(alert.title)}</div>
                    <div class="alert-desc">${sanitize(alert.desc)}</div>
                    <div class="alert-time">⏱ ${formatTime(alert.timestamp)}</div>
                </div>
                <div class="alert-priority-badge">
                    <span class="badge ${priorityBadgeClass(alert.priority)}">${priorityLabel(alert.priority)}</span>
                    ${urgencyHtml}
                </div>
            `;
            alertList.appendChild(item);
        });
    }


    // ── UPDATE STATS ───────────────────────────────────────────
    function updateStats() {
        const total    = alerts.length;
        const critical = alerts.filter(a => a.priority === 'critical').length;
        const resolved = alerts.filter(a => a.resolved).length;

        if (statTotal)    statTotal.textContent    = total;
        if (statCritical) statCritical.textContent = critical;
        if (statResolved) statResolved.textContent = resolved;

        // Critical badge — hide when count is 0
        if (criticalBadge) {
            criticalBadge.textContent = `${critical} CRITICAL`;
            criticalBadge.style.display = critical > 0 ? '' : 'none';
        }

        // Sidebar nav badge
        if (sidebarAlertCount) {
            const active = alerts.filter(a => !a.resolved).length;
            sidebarAlertCount.textContent = active;
            sidebarAlertCount.style.display = active > 0 ? '' : 'none';
        }
    }

    // ── UPDATE FILTER COUNTS ───────────────────────────────────
    function updateCounts() {
        const counts = { critical: 0, high: 0, medium: 0, low: 0 };
        alerts.forEach(a => {
            if (counts[a.priority] !== undefined) counts[a.priority]++;
        });
        if (cntCritical) cntCritical.textContent = counts.critical;
        if (cntHigh)     cntHigh.textContent     = counts.high;
        if (cntMedium)   cntMedium.textContent   = counts.medium;
        if (cntLow)      cntLow.textContent      = counts.low;
    }

    // ── FILTER TABS ────────────────────────────────────────────
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            activeFilter = tab.dataset.filter || 'all';
            renderAlerts();
        });
    });

    // ── SOS BUTTON (one-shot: cannot be un-triggered once fired) ──
    if (sosBtn) {
        sosBtn.addEventListener('click', () => {
            // Prevent re-clicking once triggered
            if (sosBtn.classList.contains('triggered')) return;

            sosBtn.classList.add('triggered');
            sosBtn.textContent = 'SOS SENT';
            sosBtn.disabled = true;

            // Send MQTT command
            if (window.mqttController) {
                window.mqttController.sendCommand('SOS_TRIGGER', { active: true });
            }

            addAlert('sos', 'critical', '🚨 SOS TRIGGERED', 'Emergency broadcast sent via MQTT to all channels', '🚨');

            if (window.RESCUEBOT_UI) {
                window.RESCUEBOT_UI.toast('SOS BROADCAST SENT', 'error');
            }
        });
    }

    // ── SOUND TOGGLE (sync both toggles) ──────────────────────
    function syncSoundToggles() {
        [soundToggleHeader, soundToggleCard].forEach(btn => {
            if (!btn) return;
            if (soundEnabled) {
                btn.classList.add('on');
            } else {
                btn.classList.remove('on');
            }
        });
    }

    function handleSoundToggle() {
        soundEnabled = !soundEnabled;
        syncSoundToggles();
        if (window.RESCUEBOT_UI) {
            window.RESCUEBOT_UI.toast(
                soundEnabled ? '🔔 Sound alerts enabled' : '🔕 Sound alerts disabled',
                soundEnabled ? 'success' : 'info'
            );
        }
    }

    if (soundToggleHeader) soundToggleHeader.addEventListener('click', handleSoundToggle);
    if (soundToggleCard)   soundToggleCard.addEventListener('click', handleSoundToggle);

    // ── PLAY BEEP ──────────────────────────────────────────────
    function playBeep() {
        try {
            const ctx  = new (window.AudioContext || window.webkitAudioContext)();
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type      = 'square';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            osc.start();
            osc.stop(ctx.currentTime + 0.15);
        } catch (e) {
            console.warn('[Alerts] Audio unavailable:', e);
        }
    }

    // ── MQTT TELEMETRY LISTENER ────────────────────────────────
    const mqtt = window.mqttController;

    if (mqtt) {
        mqtt.on('telemetry', d => {
            if (d.sensor === 'fire' && d.value === 'FIRE DETECTED') {
                addAlert('fire', 'critical', '🔥 Fire Detected!', 'Flame sensor activated at rover position', '🔥');
            }
            if (d.sensor === 'gas' && parseInt(d.value, 10) > 2500) {
                addAlert('gas', 'critical', '💨 Hazardous Gas Level', 'MQ-2 reading: ' + d.value + ' ppm — above safe threshold', '💨');
            }
            if (d.sensor === 'batt' && parseFloat(d.value) < 11.0) {
                addAlert('battery', 'high', '🔋 Low Battery Warning', 'Voltage: ' + d.value + 'V — return to base recommended', '🔋');
            }
        });

        mqtt.on('alerts', d => {
            if (d.label === 'SCENE_UPDATE') {
                // Loop through survivors
                if (d.survivors && Array.isArray(d.survivors)) {
                    d.survivors.forEach(survivor => {
                        const prioLower = survivor.priority.toLowerCase();
                        // 1. SURVIVOR_CRITICAL
                        if (survivor.priority === 'CRITICAL' || survivor.priority === 'HIGH') {
                            addAlert(
                                'SURVIVOR_CRITICAL',
                                prioLower,
                                `👤 Survivor #${survivor.id} [${survivor.priority}]`,
                                `Status: ${survivor.status} | Posture: ${survivor.posture} | Gesture: ${survivor.gesture || 'none'}.`,
                                '👤',
                                survivor.urgency
                            );
                        }
                        // 2. SURVIVOR_UNCONSCIOUS
                        if (survivor.status === 'POSSIBLY_UNCONSCIOUS') {
                            addAlert(
                                'SURVIVOR_UNCONSCIOUS',
                                prioLower,
                                `💤 Unconscious Suspect #${survivor.id}`,
                                `Unconscious posture detected. Urgency: ${survivor.urgency}.`,
                                '💤',
                                survivor.urgency
                            );
                        }
                        // 3. TRAPPED
                        if (survivor.trapped_prob > 0.6) {
                            addAlert(
                                'TRAPPED',
                                prioLower,
                                `⚠️ Trapped Suspect #${survivor.id}`,
                                `High trapped probability: ${Math.round(survivor.trapped_prob * 100)}%. Urgency: ${survivor.urgency}.`,
                                '⚠️',
                                survivor.urgency
                            );
                        }
                    });
                }
                // 4. FIRE_SPREAD
                if (d.fire && d.fire.detected && d.fire.spread_risk === 'HIGH') {
                    addAlert('FIRE_SPREAD', 'critical', '🔥 Rapid Fire Spread!', 'Fire spread risk is HIGH.', '🔥');
                }
                // 5. SMOKE_DENSE
                if (d.smoke && d.smoke.detected && (d.smoke.density === 'opaque' || d.smoke.density === 'thick')) {
                    addAlert(
                        'SMOKE_DENSE',
                        d.smoke.density === 'opaque' ? 'critical' : 'high',
                        '💨 Dense Smoke Warning',
                        `Dense smoke (${d.smoke.density.toUpperCase()}) detected. Visibility: ${d.smoke.visibility_pct}%.`,
                        '💨'
                    );
                }
            } else if (d.label === 'HUMAN') {
                addAlert('detection', 'medium', '👤 Human Detected', d.desc || 'PIR sensor detected human presence in field of view', '👤');
            } else if (d.label === 'FIRE') {
                addAlert('fire', 'critical', '🔥 Fire Detected!', d.desc || 'Fire detected in camera feed', '🔥');
            } else if (d.label === 'SMOKE') {
                addAlert('smoke', 'high', '💨 Smoke Detected', d.desc || 'Smoke detected in camera feed', '💨');
            }
        });
    }

    // ── SEED INITIAL ALERTS ────────────────────────────────────
    addAlert('system', 'low', '✅ MQTT Connected',      'Real-time data stream established',         '📡');
    addAlert('system', 'low', '✅ All Sensors Online',  '12 sensor modules reporting nominal',        '🟢');

    // ── MISSION UPTIME COUNTER ─────────────────────────────────
    setInterval(() => {
        uptimeSecs++;
        const h = String(Math.floor(uptimeSecs / 3600)).padStart(2, '0');
        const m = String(Math.floor((uptimeSecs % 3600) / 60)).padStart(2, '0');
        const s = String(uptimeSecs % 60).padStart(2, '0');
        if (statUptime) statUptime.textContent = `${h}:${m}:${s}`;
    }, 1000);

    // ── LUCIDE ICONS ───────────────────────────────────────────
    if (window.lucide) window.lucide.createIcons();

});
