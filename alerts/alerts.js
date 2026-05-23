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

    // ── ADD ALERT ──────────────────────────────────────────────
    function addAlert(type, priority, title, desc, icon) {
        const alert = {
            id:        Date.now(),
            type,
            priority,
            title,
            desc,
            icon,
            timestamp: new Date(),
            resolved:  false
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

            item.innerHTML = `
                <div class="alert-icon">${alert.icon}</div>
                <div class="alert-content">
                    <div class="alert-title">${alert.title}</div>
                    <div class="alert-desc">${alert.desc}</div>
                    <div class="alert-time">⏱ ${formatTime(alert.timestamp)}</div>
                </div>
                <div class="alert-priority-badge">
                    <span class="badge ${priorityBadgeClass(alert.priority)}">${priorityLabel(alert.priority)}</span>
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

        // Critical badge in section header
        if (criticalBadge) {
            criticalBadge.textContent = `${critical} CRITICAL`;
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

    // ── SOS BUTTON ─────────────────────────────────────────────
    if (sosBtn) {
        sosBtn.addEventListener('click', () => {
            sosBtn.classList.toggle('triggered');

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
            if (d.label === 'HUMAN') {
                addAlert('detection', 'medium', '👤 Human Detected', 'PIR sensor detected human presence in field of view', '👤');
            }
            if (d.label === 'MOTION') {
                addAlert('motion', 'low', '👁️ Motion Detected', 'Movement detected in rover proximity zone', '👁️');
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
