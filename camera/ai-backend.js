/**
 * RescueBOT — AI Backend Integration Module
 * Connects the camera page to the Python FastAPI backend via WebSocket.
 * Updates all new Rescue Intelligence, Confidence Meters, Timeline,
 * Snapshot Gallery, and Alert Banner sections with live AI data.
 *
 * Non-destructive: does NOT modify existing camera.js behaviour.
 * The existing COCO-SSD browser detection continues as fallback when WS offline.
 */

(function () {
    'use strict';

    // ── Configuration ─────────────────────────────────────────────────────────
    const AI_WS_URL         = 'ws://localhost:8000/ws';
    const AI_REST_BASE      = 'http://localhost:8000';
    const REST_POLL_INTERVAL = 2500;   // ms: fallback polling when WS fails
    const TIMELINE_MAX_DOM  = 40;      // max entries to render in DOM
    const SNAP_POLL_INTERVAL = 8000;   // ms: check for new snapshots

    // ── Internal State ────────────────────────────────────────────────────────
    let ws              = null;
    let wsConnected     = false;
    let restPollTimer   = null;
    let snapPollTimer   = null;
    let alertBannerTimeout = null;
    let wsReconnectDelay = 2000;
    let wsReconnectTimer = null;
    let knownSnapshots  = new Set();
    const timelineData  = [];

    // ── Cache DOM Elements ────────────────────────────────────────────────────
    function $id(id) { return document.getElementById(id); }

    const DOM = {};
    document.addEventListener('DOMContentLoaded', () => {
        Object.assign(DOM, {
            // AI server pill
            serverDot:  $id('ai-server-dot'),
            serverText: $id('ai-server-text'),

            // Alert banner
            banner:         $id('ai-alert-banner'),
            bannerTitle:    $id('ai-alert-title'),
            bannerDesc:     $id('ai-alert-desc'),
            bannerPriority: $id('ai-alert-priority-badge'),
            bannerClose:    $id('ai-alert-close'),

            // Rescue Intelligence cards
            riHumanVal:    $id('ri-human-val'),
            riHumanCount:  $id('ri-human-count'),
            riMotionVal:   $id('ri-motion-val'),
            riFireVal:     $id('ri-fire-val'),
            riSmokeVal:    $id('ri-smoke-val'),
            riGestureVal:  $id('ri-gesture-val'),
            riBloodVal:    $id('ri-blood-val'),
            riInjuryVal:   $id('ri-injury-val'),
            riSurvivorFill: $id('ri-survivor-fill'),
            riSurvivorVal:  $id('ri-survivor-val'),
            riPriorityFill: $id('ri-priority-fill'),
            riPriorityVal:  $id('ri-priority-val'),
            riFirstaidVal:  $id('ri-firstaid-val'),
            riLivestatusVal:$id('ri-livestatus-val'),
            priorityBadge:  $id('rescue-priority-badge'),

            // Confidence meters
            cmPerson:  $id('cm-person'),   cmPersonPct:  $id('cm-person-pct'),
            cmFire:    $id('cm-fire'),     cmFirePct:    $id('cm-fire-pct'),
            cmSmoke:   $id('cm-smoke'),    cmSmokePct:   $id('cm-smoke-pct'),
            cmGesture: $id('cm-gesture'),  cmGesturePct: $id('cm-gesture-pct'),
            cmSurvivor:$id('cm-survivor'), cmSurvivorPct:$id('cm-survivor-pct'),
            cmRescue:  $id('cm-rescue'),   cmRescuePct:  $id('cm-rescue-pct'),

            // Timeline
            timelineList: $id('timeline-list'),
            btnClearTimeline: $id('btn-clear-timeline'),

            // Snapshots
            snapGallery: $id('snapshot-gallery'),
            snapCount:   $id('snap-count'),
        });

        // ── Wire up banner close button ───────────────────────────────────────
        if (DOM.bannerClose) {
            DOM.bannerClose.addEventListener('click', hideBanner);
        }
        if (DOM.btnClearTimeline) {
            DOM.btnClearTimeline.addEventListener('click', () => {
                timelineData.length = 0;
                renderTimeline();
            });
        }

        // ── Start connections ──────────────────────────────────────────────────
        connectWebSocket();
        startSnapshotPoller();
    });

    // ── WebSocket Management ──────────────────────────────────────────────────
    function connectWebSocket() {
        if (ws) { try { ws.close(); } catch (e) {} }
        setServerStatus('connecting');

        try {
            ws = new WebSocket(AI_WS_URL);

            ws.onopen = () => {
                wsConnected = true;
                wsReconnectDelay = 2000;
                setServerStatus('online');
                stopRestPoll();
                console.log('[AI Backend] WebSocket connected →', AI_WS_URL);
                // Signal to existing camera.js that Python AI is active
                window.hasExternalAIServer = true;
                window.lastExternalAITime  = Date.now();
            };

            ws.onmessage = (evt) => {
                window.lastExternalAITime = Date.now();
                try {
                    const data = JSON.parse(evt.data);
                    if (data.type === 'detection_update') {
                        handleDetectionUpdate(data);
                    }
                } catch (e) {
                    console.warn('[AI Backend] WS parse error:', e);
                }
            };

            ws.onclose = () => {
                wsConnected = false;
                setServerStatus('offline');
                console.warn('[AI Backend] WebSocket disconnected. Falling back to REST poll.');
                startRestPoll();
                scheduleReconnect();
            };

            ws.onerror = () => {
                setServerStatus('offline');
            };

        } catch (e) {
            setServerStatus('offline');
            startRestPoll();
            scheduleReconnect();
        }
    }

    function scheduleReconnect() {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = setTimeout(() => {
            console.log(`[AI Backend] Attempting WS reconnect... (delay: ${wsReconnectDelay}ms)`);
            connectWebSocket();
            wsReconnectDelay = Math.min(wsReconnectDelay * 1.5, 30000);
        }, wsReconnectDelay);
    }

    // ── REST Poll Fallback ─────────────────────────────────────────────────────
    function startRestPoll() {
        if (restPollTimer) return;
        restPollTimer = setInterval(async () => {
            try {
                const r = await fetch(`${AI_REST_BASE}/detections/live`);
                if (!r.ok) return;
                const data = await r.json();
                handleDetectionsPayload(data, null);
                window.hasExternalAIServer = true;
                window.lastExternalAITime  = Date.now();
                setServerStatus('online');
            } catch (e) {
                setServerStatus('offline');
            }
        }, REST_POLL_INTERVAL);
    }

    function stopRestPoll() {
        if (restPollTimer) { clearInterval(restPollTimer); restPollTimer = null; }
    }

    // ── Main Dispatch ─────────────────────────────────────────────────────────
    function handleDetectionUpdate(data) {
        handleDetectionsPayload(data.detections, data.camera);
    }

    function handleDetectionsPayload(det, cam) {
        if (!det) return;

        const p  = det.person          || {};
        const fi = det.fire            || {};
        const sm = det.smoke           || {};
        const mo = det.motion          || {};
        const ge = det.gesture         || {};
        const bl = det.blood           || {};
        const inj = det.injury         || {};
        const ls  = det.live_status    || {};
        const sc  = det.survivor_confidence || {};
        const rp  = det.rescue_priority || {};
        const fa  = det.first_aid_urgency || {};
        const alerts = det.active_alerts || [];

        // ── Update Rescue Intelligence Cards ──────────────────────────────────
        updateRiHuman(p);
        updateRiMotion(mo);
        updateRiCard(DOM.riFireVal,  fi.detected,  fi.detected ? `${pct(fi.confidence)}%` : 'CLEAR',
                     fi.detected ? 'danger' : 'safe');
        updateRiCard(DOM.riSmokeVal, sm.detected,  sm.detected ? (sm.density || 'LOW').toUpperCase() : 'CLEAR',
                     sm.detected ? 'warning' : 'safe');
        updateRiCard(DOM.riGestureVal, ge.detected, ge.detected ? (ge.gesture_type || 'DETECTED').replace(/_/g, ' ').toUpperCase() : 'NONE',
                     ge.detected ? 'active' : '');
        updateRiCard(DOM.riBloodVal, bl.detected, bl.detected ? `DETECTED (${bl.score?.toFixed(1)}%)` : 'CLEAR',
                     bl.detected ? 'danger' : '');
        if (DOM.riInjuryVal) {
            DOM.riInjuryVal.textContent = inj.estimated
                ? (inj.label || 'POSSIBLE').replace(/_/g, ' ').toUpperCase()
                : '—';
            DOM.riInjuryVal.className = 'ri-value' + (inj.estimated ? ' warning' : '');
        }

        // Survivor Confidence meter
        const sc_pct = Math.round((sc.score || 0) * 100);
        if (DOM.riSurvivorFill) DOM.riSurvivorFill.style.width = sc_pct + '%';
        if (DOM.riSurvivorVal)  DOM.riSurvivorVal.textContent   = sc_pct + '%';

        // Rescue Priority meter
        const rp_pct = Math.round((rp.score || 0) * 100);
        if (DOM.riPriorityFill) DOM.riPriorityFill.style.width = rp_pct + '%';
        if (DOM.riPriorityVal)  DOM.riPriorityVal.textContent   = (rp.level || 'LOW');

        // Priority badge
        updatePriorityBadge(rp.level || 'LOW');

        // First Aid Urgency
        const urgencyMap = {
            immediate_attention: 'IMMEDIATE',
            medium_urgency: 'MEDIUM',
            low_urgency: 'LOW',
            needs_verification: 'VERIFY'
        };
        if (DOM.riFirstaidVal) {
            DOM.riFirstaidVal.textContent = urgencyMap[fa.level] || 'VERIFY';
            DOM.riFirstaidVal.className = 'ri-value' + (
                fa.level === 'immediate_attention' ? ' danger' :
                fa.level === 'medium_urgency' ? ' warning' : ''
            );
        }

        // Live Status
        if (DOM.riLivestatusVal) {
            DOM.riLivestatusVal.textContent = (ls.label || 'unknown').replace(/_/g, ' ').toUpperCase();
            DOM.riLivestatusVal.className = 'ri-value' + (
                ls.label === 'active_survivor' ? ' safe' :
                ls.label === 'possible_unconscious' ? ' danger' :
                ls.label === 'low_movement' ? ' warning' : ''
            );
        }

        // ── Confidence Meters ─────────────────────────────────────────────────
        setMeter(DOM.cmPerson, DOM.cmPersonPct, p.confidence || 0);
        setMeter(DOM.cmFire,   DOM.cmFirePct,   fi.confidence || 0);
        setMeter(DOM.cmSmoke,  DOM.cmSmokePct,  sm.confidence || 0);
        setMeter(DOM.cmGesture,DOM.cmGesturePct,ge.confidence || 0);
        setMeter(DOM.cmSurvivor,DOM.cmSurvivorPct, sc.score || 0);
        setMeter(DOM.cmRescue,  DOM.cmRescuePct,   rp.score || 0);

        // ── Alert Banner ──────────────────────────────────────────────────────
        if (alerts.length > 0) {
            const topAlert = alerts.reduce((best, a) => {
                const sev = { critical: 4, high: 3, medium: 2, low: 1 };
                return (sev[a.severity] || 0) > (sev[best.severity] || 0) ? a : best;
            }, alerts[0]);
            if (topAlert.severity === 'critical' || topAlert.severity === 'high') {
                showBanner(topAlert);
            }
            // Add to timeline
            alerts.forEach(a => addTimelineEntry(a));
        }

        // Also log motion detection state changes to timeline
        if (mo.detected && mo.score > 0.5) {
            addTimelineEntry({
                label: 'MOTION', severity: 'low',
                confidence: mo.score,
                description: `Kinetic activity: ${pct(mo.score)}%`
            });
        }
    }

    // ── Helper: Update Rescue Intel Card ──────────────────────────────────────
    function updateRiHuman(p) {
        if (!DOM.riHumanVal) return;
        if (p.detected) {
            DOM.riHumanVal.textContent = (p.pose_state || 'DETECTED').replace(/_/g, ' ').toUpperCase();
            DOM.riHumanVal.className = 'ri-value ' + (
                p.pose_state === 'fallen' || p.is_motionless ? 'danger' : 'active'
            );
            if (DOM.riHumanCount) DOM.riHumanCount.textContent = p.count || 1;
        } else {
            DOM.riHumanVal.textContent = 'NONE';
            DOM.riHumanVal.className = 'ri-value';
        }
        // Update card style
        const card = $id('ri-human');
        if (card) {
            card.classList.toggle('alert', p.detected && (p.pose_state === 'fallen' || p.is_motionless));
            card.classList.toggle('active', p.detected && !p.is_motionless);
        }
    }

    function updateRiMotion(mo) {
        if (!DOM.riMotionVal) return;
        if (mo.detected) {
            const lvl = mo.score > 0.7 ? 'HIGH' : mo.score > 0.4 ? 'MEDIUM' : 'LOW';
            DOM.riMotionVal.textContent = `${lvl} (${pct(mo.score)}%)`;
            DOM.riMotionVal.className   = 'ri-value ' + (mo.score > 0.7 ? 'warning' : 'active');
        } else {
            DOM.riMotionVal.textContent = 'NONE';
            DOM.riMotionVal.className   = 'ri-value';
        }
    }

    function updateRiCard(el, active, text, cls) {
        if (!el) return;
        el.textContent = text;
        el.className = 'ri-value' + (cls ? ' ' + cls : '');
    }

    // ── Helper: Priority Badge ────────────────────────────────────────────────
    function updatePriorityBadge(level) {
        if (!DOM.priorityBadge) return;
        DOM.priorityBadge.textContent = level;
        DOM.priorityBadge.className = 'badge priority-' + level.toLowerCase();
    }

    // ── Helper: Confidence Meter ──────────────────────────────────────────────
    function setMeter(fillEl, pctEl, val) {
        const p = Math.round(val * 100);
        if (fillEl) fillEl.style.width = p + '%';
        if (pctEl)  pctEl.textContent  = p + '%';
    }

    // ── Alert Banner ──────────────────────────────────────────────────────────
    const shownAlertKeys = new Set();

    function showBanner(alert) {
        const key = `${alert.label}_${alert.severity}_${Math.floor((alert.timestamp || Date.now()) / 5000)}`;
        if (shownAlertKeys.has(key)) return;
        shownAlertKeys.add(key);
        setTimeout(() => shownAlertKeys.delete(key), 15000);

        if (!DOM.banner) return;
        if (DOM.bannerTitle)    DOM.bannerTitle.textContent = `${alert.label} DETECTED`;
        if (DOM.bannerDesc)     DOM.bannerDesc.textContent  = alert.description || '';
        if (DOM.bannerPriority) {
            DOM.bannerPriority.textContent = (alert.severity || 'MEDIUM').toUpperCase();
            DOM.bannerPriority.className   = 'ai-alert-priority priority-' + (alert.severity || 'medium');
        }
        DOM.banner.style.display = 'block';
        clearTimeout(alertBannerTimeout);
        alertBannerTimeout = setTimeout(hideBanner, 8000);
    }

    function hideBanner() {
        if (DOM.banner) DOM.banner.style.display = 'none';
    }

    // ── Incident Timeline ─────────────────────────────────────────────────────
    const recentTimelineKeys = new Set();

    function addTimelineEntry(alert) {
        const ts = alert.timestamp || Date.now();
        const key = `${alert.label}_${Math.floor(ts / 3000)}`;
        if (recentTimelineKeys.has(key)) return;
        recentTimelineKeys.add(key);
        setTimeout(() => recentTimelineKeys.delete(key), 10000);

        const now = new Date(ts);
        const time_str = now.toLocaleTimeString('en-GB', { hour12: false });

        timelineData.unshift({
            event:      alert.description || alert.label,
            time_str,
            severity:   alert.severity || 'low',
            confidence: alert.confidence || 0,
        });

        // Trim
        if (timelineData.length > TIMELINE_MAX_DOM) timelineData.length = TIMELINE_MAX_DOM;
        renderTimeline();
    }

    function renderTimeline() {
        if (!DOM.timelineList) return;
        if (timelineData.length === 0) {
            DOM.timelineList.innerHTML = `
                <div class="timeline-empty">
                    <i data-lucide="clock" style="width:20px;height:20px;opacity:0.3;"></i>
                    <span>No incidents logged</span>
                </div>`;
            if (typeof lucide !== 'undefined') lucide.createIcons();
            return;
        }
        DOM.timelineList.innerHTML = timelineData.map(e => `
            <div class="timeline-entry">
                <div class="timeline-dot sev-${e.severity}"></div>
                <div class="timeline-body">
                    <span class="timeline-event">${escapeHtml(e.event)}</span>
                    <div class="timeline-meta">
                        <span class="timeline-time">${e.time_str}</span>
                        <span class="timeline-conf">CONF: ${pct(e.confidence)}%</span>
                    </div>
                </div>
            </div>
        `).join('');
    }

    // ── Snapshot Gallery ──────────────────────────────────────────────────────
    function startSnapshotPoller() {
        fetchSnapshots();
        snapPollTimer = setInterval(fetchSnapshots, SNAP_POLL_INTERVAL);
    }

    async function fetchSnapshots() {
        try {
            const r = await fetch(`${AI_REST_BASE}/snapshots`);
            if (!r.ok) return;
            const data = await r.json();
            renderSnapshots(data.snapshots || []);
        } catch (e) {
            // Server offline — no-op
        }
    }

    function renderSnapshots(snaps) {
        if (!DOM.snapGallery) return;
        if (snaps.length === 0) {
            DOM.snapGallery.innerHTML = `
                <div class="snapshot-empty">
                    <i data-lucide="image" style="width:20px;height:20px;opacity:0.3;"></i>
                    <span>No snapshots captured</span>
                </div>`;
            if (typeof lucide !== 'undefined') lucide.createIcons();
            if (DOM.snapCount) DOM.snapCount.textContent = '0';
            return;
        }
        if (DOM.snapCount) DOM.snapCount.textContent = snaps.length;

        // Only re-render if we have new files
        const names = snaps.map(s => s.filename);
        const newSet = new Set(names);
        if ([...newSet].every(n => knownSnapshots.has(n)) && knownSnapshots.size === newSet.size) return;
        knownSnapshots = newSet;

        DOM.snapGallery.innerHTML = snaps.slice(0, 18).map(s => `
            <div class="snapshot-thumb" title="${escapeHtml(s.filename)}"
                 onclick="window.open('${AI_REST_BASE}/snapshots/${encodeURIComponent(s.filename)}', '_blank')">
                <img src="${AI_REST_BASE}/snapshots/${encodeURIComponent(s.filename)}"
                     loading="lazy" alt="${escapeHtml(s.filename)}"
                     onerror="this.parentElement.style.display='none'">
                <div class="snapshot-thumb-label">${escapeHtml(s.filename.replace('snap_','').replace('.jpg',''))}</div>
            </div>
        `).join('');
    }

    // ── AI Server Status Indicator ────────────────────────────────────────────
    function setServerStatus(status) {
        if (!DOM.serverDot || !DOM.serverText) return;
        DOM.serverDot.className  = 'status-dot ' + status;
        DOM.serverText.textContent = status === 'online' ? 'AI ONLINE'
                                   : status === 'connecting' ? 'CONNECTING'
                                   : 'AI OFFLINE';
    }

    // ── Utility ───────────────────────────────────────────────────────────────
    function pct(val) { return Math.round((val || 0) * 100); }

    function escapeHtml(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    console.log('[AI Backend] Module loaded. Connecting to', AI_WS_URL);
})();
