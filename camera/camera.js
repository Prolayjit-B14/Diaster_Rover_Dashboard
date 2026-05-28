/**
 * RescueBOT — 7-Stage Survivor Intelligence Controller
 * camera.js — Handles SCENE_UPDATE payloads, survivor cards,
 *             rescue priority list, detection tiles, env risk,
 *             bounding boxes and legacy alert types.
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

    // Navbar
    const camRecDot        = document.getElementById('cam-rec-dot');
    const camRecLabel      = document.getElementById('cam-rec-label');
    const missionClock     = document.getElementById('mission-clock');

    // HUD badges
    const fpsBadge         = document.getElementById('fps-badge');
    const latencyBadge     = document.getElementById('latency-badge');
    const hudTimestamp     = document.getElementById('hud-timestamp');

    // Sidebar camera badge
    const camConnBadge     = document.getElementById('cam-conn-badge');

    // HUD Telemetry
    const hudSpeedEl       = document.getElementById('hud-speed');
    const hudHeadingEl     = document.getElementById('hud-heading');
    const hudLatEl         = document.getElementById('hud-lat');
    const hudLngEl         = document.getElementById('hud-lng');
    const hudAltEl         = document.getElementById('hud-alt');

    // Scene Summary Strip
    const ssSurvivorCount  = document.getElementById('ss-survivor-count');
    const ssFireState      = document.getElementById('ss-fire-state');
    const ssSmokeState     = document.getElementById('ss-smoke-state');
    const ssVisibility     = document.getElementById('ss-visibility');
    const ssHazardLevel    = document.getElementById('ss-hazard-level');
    const ssSpreadRisk     = document.getElementById('ss-spread-risk');

    // Hazard banner
    const hazardBanner     = document.getElementById('scene-hazard-banner');
    const hazardTitle      = document.getElementById('hazard-banner-title');
    const hazardDesc       = document.getElementById('hazard-banner-desc');
    const hazardLevelChip  = document.getElementById('hazard-level-chip');
    const hazardSurvivors  = document.getElementById('hazard-survivors-chip');
    const hazardClose      = document.getElementById('hazard-banner-close');

    // Environmental Risk
    const envFireProxVal   = document.getElementById('env-fire-prox-val');
    const envVisibilityVal = document.getElementById('env-visibility-val');
    const envSmokeDensVal  = document.getElementById('env-smoke-density-val');
    const envToxicVal      = document.getElementById('env-toxic-val');

    // Survivor panel
    const survivorPanel    = document.getElementById('survivor-panel');
    const survivorEmpty    = document.getElementById('survivor-empty');
    const btnClearSurvivors= document.getElementById('btn-clear-survivors');

    // Rescue priority list
    const rescueList       = document.getElementById('rescue-priority-list');
    const rescueCountBadge = document.getElementById('rescue-count-badge');

    // Detection tiles
    const TILES = ['human', 'fire', 'smoke', 'pose', 'motion'];

    // Bounding boxes
    const bboxHuman        = document.getElementById('bbox-human');
    const bboxFire         = document.getElementById('bbox-fire');
    const bboxSmoke        = document.getElementById('bbox-smoke');

    // Timeline
    const timelineList     = document.getElementById('timeline-list');
    const btnClearTimeline = document.getElementById('btn-clear-timeline');

    // Vision controls
    const ctrlCameraIp  = document.getElementById('ctrl-camera-ip');
    const btnApplyIp    = document.getElementById('btn-apply-ip');
    const ctrlRes       = document.getElementById('ctrl-resolution');
    const ctrlBrightness= document.getElementById('ctrl-brightness');
    const ctrlContrast  = document.getElementById('ctrl-contrast');
    const ctrlLed       = document.getElementById('ctrl-led');
    const ctrlEffect    = document.getElementById('ctrl-effect');
    const ctrlMirror    = document.getElementById('ctrl-mirror');
    const ctrlFlip      = document.getElementById('ctrl-flip');
    const ctrlNight     = document.getElementById('ctrl-night');
    const valBrightness = document.getElementById('val-brightness');
    const valContrast   = document.getElementById('val-contrast');
    const valLed        = document.getElementById('val-led');

    // ── State ─────────────────────────────────────────────────
    let isStreaming = false;
    let isRecording = false;
    let lastScene   = null;

    // Tile event counters
    const tileCounts = { human: 0, fire: 0, smoke: 0, pose: 0, motion: 0 };
    const tileTimers = {};

    // FPS tracking
    let fpsFrameTimes = [];
    let fpsValue      = 0;

    // ── HUD Timestamp ─────────────────────────────────────────
    setInterval(() => {
        if (!hudTimestamp) return;
        const now = new Date();
        const p   = (n, l=2) => String(n).padStart(l, '0');
        hudTimestamp.textContent =
            `${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())}  ` +
            `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
    }, 1000);

    // ── Hazard Banner Close ───────────────────────────────────
    if (hazardClose) {
        hazardClose.addEventListener('click', () => {
            if (hazardBanner) hazardBanner.style.display = 'none';
        });
    }

    // ── Stream Toggle ─────────────────────────────────────────
    if (btnStreamToggle) {
        btnStreamToggle.addEventListener('click', () => {
            const mqtt = window.mqttController;
            if (!isStreaming) {
                if (mqtt) mqtt.sendCommand('TOGGLE_STREAM', { active: true });
                isStreaming = true; isRecording = true;
                btnStreamToggle.innerHTML = `<i data-lucide="square"></i>`;
                btnStreamToggle.title = 'Stop Monitoring';
                btnStreamToggle.classList.add('active-stream');
                if (camRecDot)   { camRecDot.classList.remove('standby'); camRecDot.classList.add('recording'); }
                if (camRecLabel) camRecLabel.textContent = 'RECORDING';
            } else {
                if (mqtt) mqtt.sendCommand('TOGGLE_STREAM', { active: false });
                isStreaming = false; isRecording = false;
                btnStreamToggle.innerHTML = `<i data-lucide="play"></i>`;
                btnStreamToggle.title = 'Start Monitoring';
                btnStreamToggle.classList.remove('active-stream');
                if (streamImg)       streamImg.style.display = 'none';
                if (feedPlaceholder) feedPlaceholder.style.display = 'flex';
                if (camRecDot)   { camRecDot.classList.remove('recording'); camRecDot.classList.add('standby'); }
                if (camRecLabel) camRecLabel.textContent = 'STANDBY';
                if (fpsBadge)    fpsBadge.textContent    = '-- FPS';
                if (latencyBadge) latencyBadge.textContent = '-- ms';
            }
            if (window.lucide) window.lucide.createIcons();
        });
    }

    // ── Manual IP Mount ───────────────────────────────────────
    if (ctrlCameraIp) {
        const saved = localStorage.getItem('rescuebot-camera-ip');
        if (saved) ctrlCameraIp.value = saved;
    }
    if (btnApplyIp && ctrlCameraIp) {
        btnApplyIp.addEventListener('click', () => {
            let val = ctrlCameraIp.value.trim();
            if (!val) return;
            val = val.replace(/^(https?:\/\/)?/, '').replace(/\/.*$/, '').split(':')[0];
            localStorage.setItem('rescuebot-camera-ip', val);
            const url = `http://${val}:81/stream`;
            if (streamImg) { streamImg.src = url; streamImg.style.display = 'block'; }
            if (feedPlaceholder) feedPlaceholder.style.display = 'none';
            isStreaming = true; isRecording = true;
            if (camRecDot) camRecDot.className = 'live-dot recording';
            if (camRecLabel) camRecLabel.textContent = 'LIVE';
            if (window.RESCUEBOT_UI) window.RESCUEBOT_UI.toast(`Mounted: ${url}`, 'success');
        });
    }

    // ── Vision Controls ───────────────────────────────────────
    const sendCmd = (cmd, key, val) => {
        const mqtt = window.mqttController;
        if (mqtt) { const p = {}; p[key] = val; mqtt.sendCommand(cmd, p); }
    };
    if (ctrlRes)        ctrlRes.addEventListener('change',  e => sendCmd('SET_RESOLUTION', 'val', parseInt(e.target.value)));
    if (ctrlBrightness) ctrlBrightness.addEventListener('input', e => { const v=parseInt(e.target.value); if(valBrightness) valBrightness.textContent=v>0?`+${v}`:v; sendCmd('SET_BRIGHTNESS','val',v); });
    if (ctrlContrast)   ctrlContrast.addEventListener('input',   e => { const v=parseInt(e.target.value); if(valContrast)   valContrast.textContent=v>0?`+${v}`:v;   sendCmd('SET_CONTRAST','val',v); });
    if (ctrlLed)        ctrlLed.addEventListener('input', e => { const v=parseInt(e.target.value); const p=Math.round((v/255)*100); if(valLed) valLed.textContent=`${p}%`; sendCmd('SET_LED_INTENSITY','val',v); if(ctrlNight) ctrlNight.checked=v>0; });
    if (ctrlEffect)     ctrlEffect.addEventListener('change', e => sendCmd('SET_SPECIAL_EFFECT','val',parseInt(e.target.value)));
    if (ctrlMirror)     ctrlMirror.addEventListener('change', e => sendCmd('SET_HMIRROR','enabled',e.target.checked));
    if (ctrlFlip)       ctrlFlip.addEventListener('change',   e => sendCmd('SET_VFLIP','enabled',e.target.checked));
    if (ctrlNight)      ctrlNight.addEventListener('change',  e => { const v=e.target.checked?255:0; if(ctrlLed) ctrlLed.value=v; if(valLed) valLed.textContent=e.target.checked?'100%':'0%'; sendCmd('SET_NIGHT_MODE','enabled',e.target.checked); });

    // ── FPS Counter ───────────────────────────────────────────
    if (streamImg) {
        streamImg.addEventListener('load', () => {
            const now = performance.now();
            fpsFrameTimes.push(now);
            fpsFrameTimes = fpsFrameTimes.filter(t => t > now - 1000);
            fpsValue = fpsFrameTimes.length;
            if (fpsBadge)     fpsBadge.textContent    = `${fpsValue} FPS`;
            const lat = fpsValue > 0 ? Math.round(1000 / fpsValue) : 0;
            if (latencyBadge) latencyBadge.textContent = `${lat} ms`;
        });
    }

    // ── Snapshot ──────────────────────────────────────────────
    if (btnSnapshot) {
        btnSnapshot.addEventListener('click', () => {
            if (!streamImg || streamImg.style.display === 'none') return;
            try {
                const canvas = document.createElement('canvas');
                canvas.width  = streamImg.naturalWidth  || 640;
                canvas.height = streamImg.naturalHeight || 480;
                canvas.getContext('2d').drawImage(streamImg, 0, 0);
                const a  = document.createElement('a');
                const ts = new Date().toISOString().replace(/[:.]/g, '-');
                a.download = `rescuebot_snapshot_${ts}.png`;
                a.href = canvas.toDataURL('image/png');
                a.click();
            } catch (err) {
                if (window.RESCUEBOT_UI) window.RESCUEBOT_UI.toast('Snapshot failed (CORS restriction)', 'error');
            }
        });
    }

    // ── Fullscreen ────────────────────────────────────────────
    if (btnFullscreen) {
        btnFullscreen.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                mainFeedPanel?.requestFullscreen().catch(() => {});
            } else {
                document.exitFullscreen();
            }
        });
    }

    // ── Clear Buttons ─────────────────────────────────────────
    if (btnClearSurvivors) {
        btnClearSurvivors.addEventListener('click', () => {
            renderSurvivors([]);
            renderRescueList([]);
        });
    }
    if (btnClearTimeline) {
        btnClearTimeline.addEventListener('click', () => {
            if (timelineList) timelineList.innerHTML = `<div class="timeline-empty"><i data-lucide="clock" style="width:20px;height:20px;opacity:0.3;"></i><span>No incidents logged</span></div>`;
            if (window.lucide) window.lucide.createIcons();
        });
    }

    // ═════════════════════════════════════════════════════════
    // TILE ENGINE
    // ═════════════════════════════════════════════════════════
    function triggerTile(key, statusText, cssClass, conf, clearMs = 5000) {
        const tile    = document.getElementById(`tile-${key}`);
        const statusEl= document.getElementById(`status-${key}`);
        const countEl = document.getElementById(`count-${key}`);
        const confFill= document.getElementById(`conf-${key}`);
        const confVal = document.getElementById(`conf-val-${key}`);

        if (!tile || !statusEl) return;

        if (tileTimers[key]) { clearTimeout(tileTimers[key]); delete tileTimers[key]; }

        tileCounts[key]++;
        if (countEl) countEl.textContent = tileCounts[key];

        tile.className = `detection-tile ${cssClass}`;
        statusEl.textContent = statusText;
        if (confFill) confFill.style.width = `${Math.min(100, conf)}%`;
        if (confVal)  confVal.textContent   = `${Math.round(conf)}%`;

        if (clearMs > 0) {
            tileTimers[key] = setTimeout(() => {
                tile.className = 'detection-tile';
                statusEl.textContent = key === 'pose' ? '--' : key === 'motion' ? 'NONE' : 'CLEAR';
                if (confFill) confFill.style.width = '0%';
                if (confVal)  confVal.textContent  = '0%';
                delete tileTimers[key];
            }, clearMs);
        }
    }

    // ═════════════════════════════════════════════════════════
    // BOUNDING BOX HELPERS & SCALING ENGINE
    // ═════════════════════════════════════════════════════════
    function getActiveImageRect() {
        if (!streamImg || streamImg.style.display === 'none') return null;
        
        const naturalWidth = streamImg.naturalWidth || 640;
        const naturalHeight = streamImg.naturalHeight || 480;
        const panelWidth = streamImg.clientWidth;
        const panelHeight = streamImg.clientHeight;
        
        if (!panelWidth || !panelHeight) return null;

        const streamRatio = naturalWidth / naturalHeight;
        const panelRatio = panelWidth / panelHeight;
        
        let renderWidth, renderHeight, offsetX, offsetY;
        
        if (panelRatio > streamRatio) {
            // Height-constrained (letterbox columns on left/right)
            renderHeight = panelHeight;
            renderWidth = renderHeight * streamRatio;
            offsetX = (panelWidth - renderWidth) / 2;
            offsetY = 0;
        } else {
            // Width-constrained (letterbox rows on top/bottom)
            renderWidth = panelWidth;
            renderHeight = renderWidth / streamRatio;
            offsetX = 0;
            offsetY = (panelHeight - renderHeight) / 2;
        }
        
        return {
            left: offsetX,
            top: offsetY,
            width: renderWidth,
            height: renderHeight,
            scaleX: renderWidth / naturalWidth,
            scaleY: renderHeight / naturalHeight
        };
    }

    function renderBoundingBoxes(survivors, fire, smoke) {
        const container = document.getElementById('bbox-container');
        if (!container) return;

        // Clear dynamic boxes
        container.innerHTML = '';

        const rect = getActiveImageRect();
        if (!rect) return;

        // Helper to create and position box element
        function createBoxElement(bbox, conf, labelClass, labelText) {
            const left = rect.left + bbox.x * rect.scaleX;
            const top = rect.top + bbox.y * rect.scaleY;
            const width = bbox.w * rect.scaleX;
            const height = bbox.h * rect.scaleY;

            const box = document.createElement('div');
            box.className = `hud-bbox ${labelClass}`;
            box.style.left = `${left}px`;
            box.style.top = `${top}px`;
            box.style.width = `${width}px`;
            box.style.height = `${height}px`;

            const label = document.createElement('div');
            label.className = 'bbox-label';
            label.innerHTML = `${labelText} <span>${Math.round(conf)}%</span>`;
            box.appendChild(label);

            return box;
        }

        // Render multiple person and face boxes
        if (survivors && survivors.length > 0) {
            survivors.forEach(s => {
                if (s.bbox) {
                    const boxEl = createBoxElement(s.bbox, s.conf, 'human', `PERSON ${s.id}`);
                    container.appendChild(boxEl);
                }
                if (s.face) {
                    const faceBoxEl = createBoxElement(s.face, s.face.conf || 88, 'face-box', `FACE ${s.id}`);
                    container.appendChild(faceBoxEl);
                }
            });
        }

        // Render Fire box
        if (fire && fire.detected && fire.bbox) {
            const fireBoxEl = createBoxElement(fire.bbox, fire.conf, 'fire', 'FIRE');
            container.appendChild(fireBoxEl);
        }

        // Render Smoke box
        if (smoke && smoke.detected && smoke.bbox) {
            const smokeBoxEl = createBoxElement(smoke.bbox, smoke.conf, 'smoke-box', 'SMOKE');
            container.appendChild(smokeBoxEl);
        }
    }

    function positionBbox(bboxEl, confEl, bbox, conf, label) {
        if (!bboxEl || !bbox) return;
        const rect = getActiveImageRect();
        if (!rect) {
            bboxEl.style.display = 'none';
            return;
        }
        const left = rect.left + bbox.x * rect.scaleX;
        const top = rect.top + bbox.y * rect.scaleY;
        const width = bbox.w * rect.scaleX;
        const height = bbox.h * rect.scaleY;

        bboxEl.style.display = 'block';
        bboxEl.style.left    = `${left}px`;
        bboxEl.style.top     = `${top}px`;
        bboxEl.style.width   = `${width}px`;
        bboxEl.style.height  = `${height}px`;
        if (confEl) confEl.textContent = `${Math.round(conf)}%`;
    }

    function hideBbox(bboxEl) {
        if (bboxEl) bboxEl.style.display = 'none';
    }

    // ═════════════════════════════════════════════════════════
    // SCENE SUMMARY STRIP
    // ═════════════════════════════════════════════════════════
    function updateSceneSummary(summary, fire, smoke) {
        if (!summary) return;

        if (ssSurvivorCount) ssSurvivorCount.textContent = summary.survivor_count ?? 0;

        // Fire state
        if (ssFireState) {
            ssFireState.textContent = summary.fire_state || 'CLEAR';
            ssFireState.className = `ss-value ${summary.fire_state === 'DETECTED' ? 'ss-danger' : 'ss-ok'}`;
        }

        // Smoke
        if (ssSmokeState) {
            const d = smoke?.density?.toUpperCase() || 'CLEAR';
            ssSmokeState.textContent = d;
            ssSmokeState.className = `ss-value ${d !== 'CLEAR' ? 'ss-warn' : 'ss-ok'}`;
        }

        // Visibility
        if (ssVisibility) {
            const v = summary.visibility || 'HIGH';
            ssVisibility.textContent = v;
            ssVisibility.className   = `ss-value ${v === 'LOW' ? 'ss-danger' : v === 'MEDIUM' ? 'ss-warn' : 'ss-ok'}`;
        }

        // Hazard level
        if (ssHazardLevel) {
            const h = summary.hazard_level || 'LOW';
            ssHazardLevel.textContent = h;
            ssHazardLevel.className   = `ss-value ss-hazard priority-${h.toLowerCase()}`;
        }

        // Spread risk
        if (ssSpreadRisk) {
            const sr = summary.fire_spread_risk || 'NONE';
            ssSpreadRisk.textContent = sr;
            ssSpreadRisk.className   = `ss-value ${sr === 'HIGH' ? 'ss-danger' : sr === 'MEDIUM' ? 'ss-warn' : ''}`;
        }
    }

    // ═════════════════════════════════════════════════════════
    // HAZARD BANNER
    // ═════════════════════════════════════════════════════════
    function updateHazardBanner(summary) {
        if (!hazardBanner || !summary) return;
        const h = summary.hazard_level;
        if (h === 'CRITICAL' || h === 'HIGH') {
            hazardBanner.style.display = '';
            hazardBanner.className = `scene-hazard-banner hazard-${h.toLowerCase()}`;
            if (hazardTitle)   hazardTitle.textContent   = `${h} HAZARD — ACTIVE`;
            if (hazardDesc)    hazardDesc.textContent    = buildHazardDesc(summary);
            if (hazardLevelChip) { hazardLevelChip.textContent = h; hazardLevelChip.className = `hazard-level-chip ${h.toLowerCase()}`; }
            if (hazardSurvivors) hazardSurvivors.textContent = `${summary.survivor_count} Survivor${summary.survivor_count !== 1 ? 's' : ''}`;
        } else {
            hazardBanner.style.display = 'none';
        }
    }

    function buildHazardDesc(s) {
        const parts = [];
        if (s.fire_state === 'DETECTED') parts.push(`Active fire (spread: ${s.fire_spread_risk})`);
        if (s.smoke_state && s.smoke_state !== 'CLEAR') parts.push(`${s.smoke_state} smoke`);
        if (s.toxic_warning) parts.push('Toxic gas suspected');
        if (s.visibility === 'LOW') parts.push('Low visibility');
        return parts.join(' · ') || 'Hazardous environment detected';
    }

    // ═════════════════════════════════════════════════════════
    // ENVIRONMENTAL RISK PANEL
    // ═════════════════════════════════════════════════════════
    function updateEnvRisk(survivors, smoke, summary) {
        // Fire proximity: worst among survivors
        let worstProx = 'SAFE';
        if (survivors && survivors.length > 0) {
            const proxOrder = { CRITICAL: 3, NEAR: 2, MODERATE: 1, SAFE: 0 };
            survivors.forEach(s => {
                if ((proxOrder[s.fire_proximity] || 0) > (proxOrder[worstProx] || 0))
                    worstProx = s.fire_proximity;
            });
        }
        if (envFireProxVal) {
            envFireProxVal.textContent = worstProx;
            envFireProxVal.className   = `env-risk-value ${worstProx === 'CRITICAL' ? 'danger' : worstProx === 'NEAR' ? 'warn' : 'safe'}`;
        }

        // Visibility
        const vis = summary?.visibility || 'HIGH';
        if (envVisibilityVal) {
            envVisibilityVal.textContent = vis;
            envVisibilityVal.className   = `env-risk-value ${vis === 'LOW' ? 'danger' : vis === 'MEDIUM' ? 'warn' : 'ok'}`;
        }

        // Smoke density
        const density = smoke?.density?.toUpperCase() || 'CLEAR';
        if (envSmokeDensVal) {
            envSmokeDensVal.textContent = density;
            envSmokeDensVal.className   = `env-risk-value ${density === 'OPAQUE' ? 'danger' : density === 'THICK' ? 'warn' : 'ok'}`;
        }

        // Toxic warning
        const toxic = smoke?.toxic_suspicion;
        if (envToxicVal) {
            envToxicVal.textContent = toxic ? 'YES ⚠' : 'NO';
            envToxicVal.className   = `env-risk-value ${toxic ? 'danger' : 'ok'}`;
        }
    }

    // ═════════════════════════════════════════════════════════
    // SURVIVOR INTELLIGENCE CARDS
    // ═════════════════════════════════════════════════════════
    function renderSurvivors(survivors) {
        if (!survivorPanel) return;

        if (!survivors || survivors.length === 0) {
            survivorPanel.innerHTML = `<div class="survivor-empty" id="survivor-empty">
                <i data-lucide="scan" style="width:22px;height:22px;opacity:0.3;"></i>
                <span>No survivors detected</span>
            </div>`;
            if (window.lucide) window.lucide.createIcons();
            return;
        }

        survivorPanel.innerHTML = survivors.map(s => {
            const statusClass = {
                ACTIVE:               'status-active',
                LOW_ACTIVITY:         'status-low',
                POSSIBLY_UNCONSCIOUS: 'status-unconscious',
                RESCUE_VERIFICATION:  'status-verify',
            }[s.status] || 'status-verify';

            const urgencyClass = {
                IMMEDIATE:      'urgency-immediate',
                MEDIUM_URGENCY: 'urgency-medium',
                LOW_URGENCY:    'urgency-low',
                VERIFY:         'urgency-verify',
            }[s.urgency] || 'urgency-verify';

            const priorityClass = `priority-${(s.priority||'low').toLowerCase()}`;

            const motionIcon = s.motion === 'stationary' ? '🔴' : '🟢';
            const fallenIcon = s.fallen ? ' ⚠ Fallen' : '';
            const gestureText = s.gesture ? ` · ${s.gesture.replace(/_/g, ' ')}` : '';

            const score = s.scores?.total ?? 0;
            const scoreWidth = Math.round(score * 100);

            return `<div class="survivor-card ${priorityClass}">
                <div class="survivor-card-header">
                    <div class="survivor-id-wrap">
                        <span class="survivor-id">#${s.id}</span>
                        <span class="survivor-status-pill ${statusClass}">${s.status.replace(/_/g, ' ')}</span>
                    </div>
                    <div class="survivor-priority-tags">
                        <span class="priority-tag ${priorityClass}">${s.priority}</span>
                        <span class="urgency-tag ${urgencyClass}">${s.urgency.replace(/_/g, ' ')}</span>
                    </div>
                </div>
                <div class="survivor-score-bar">
                    <div class="survivor-score-fill ${statusClass}-fill" style="width:${scoreWidth}%"></div>
                </div>
                <div class="survivor-meta-row">
                    <span class="survivor-meta-item">${motionIcon} ${s.motion}${fallenIcon}</span>
                    <span class="survivor-meta-item">🔥 ${s.fire_proximity}</span>
                    <span class="survivor-meta-item">🧍 ${s.posture || '--'}${gestureText}</span>
                </div>
                <div class="survivor-conf-row">
                    <span class="survivor-conf-label">AI Confidence</span>
                    <span class="survivor-conf-val">${Math.round(score * 100)}%</span>
                </div>
            </div>`;
        }).join('');

        if (window.lucide) window.lucide.createIcons();
    }

    // ═════════════════════════════════════════════════════════
    // RESCUE PRIORITY LIST
    // ═════════════════════════════════════════════════════════
    function renderRescueList(list) {
        if (!rescueList) return;

        if (rescueCountBadge) rescueCountBadge.textContent = list?.length || 0;

        if (!list || list.length === 0) {
            rescueList.innerHTML = `<div class="rescue-empty">
                <i data-lucide="shield-check" style="width:20px;height:20px;opacity:0.3;"></i>
                <span>No active rescue targets</span>
            </div>`;
            if (window.lucide) window.lucide.createIcons();
            return;
        }

        rescueList.innerHTML = list.map((r, idx) => {
            const urgencyClass = {
                IMMEDIATE:      'urgency-immediate',
                MEDIUM_URGENCY: 'urgency-medium',
                LOW_URGENCY:    'urgency-low',
                VERIFY:         'urgency-verify',
            }[r.urgency] || 'urgency-verify';
            const priorityClass = `priority-${(r.priority||'low').toLowerCase()}`;

            return `<div class="rescue-item ${priorityClass}">
                <div class="rescue-rank">${idx + 1}</div>
                <div class="rescue-info">
                    <div class="rescue-id">Survivor #${r.id}</div>
                    <div class="rescue-status-text">${r.status.replace(/_/g,' ')}</div>
                </div>
                <div class="rescue-tags">
                    <span class="priority-tag ${priorityClass}">${r.priority}</span>
                    <span class="urgency-tag ${urgencyClass}">${r.urgency.replace(/_/g,' ')}</span>
                </div>
            </div>`;
        }).join('');

        if (window.lucide) window.lucide.createIcons();
    }

    // ═════════════════════════════════════════════════════════
    // TIMELINE ENTRY
    // ═════════════════════════════════════════════════════════
    function addTimelineEntry(msg, type = 'info') {
        if (!timelineList) return;
        const empty = timelineList.querySelector('.timeline-empty');
        if (empty) empty.remove();

        const now = new Date();
        const p   = n => String(n).padStart(2, '0');
        const t   = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;

        const div = document.createElement('div');
        div.className = `timeline-entry ${type}`;
        div.innerHTML = `<span class="timeline-time">${t}</span><span class="timeline-msg">${msg}</span>`;
        timelineList.insertBefore(div, timelineList.firstChild);

        while (timelineList.children.length > 30) timelineList.removeChild(timelineList.lastChild);
    }

    // ═════════════════════════════════════════════════════════
    // MQTT BINDING
    // ═════════════════════════════════════════════════════════
    let _bindRetries = 0;
    const bindMqtt = () => {
        const mqtt = window.mqttController;
        if (!mqtt) {
            if (_bindRetries++ < 20) { setTimeout(bindMqtt, 500); }
            return;
        }

        // ── Camera stream URL ─────────────────────────────
        mqtt.on('camera', (d) => {
            if (d?.active && d?.url) {
                if (streamImg) { streamImg.src = d.url; streamImg.style.display = 'block'; }
                if (feedPlaceholder) feedPlaceholder.style.display = 'none';
                isStreaming = true;
                if (camRecDot)   { camRecDot.classList.remove('standby'); camRecDot.classList.add('recording'); }
                if (camRecLabel) camRecLabel.textContent = 'LIVE';
            }
        });

        // ── GPS telemetry ──────────────────────────────────
        mqtt.on('gps', (d) => {
            if (!d) return;
            if (d.lat !== undefined && hudLatEl) hudLatEl.textContent = parseFloat(d.lat).toFixed(6);
            if (d.lng !== undefined && hudLngEl) hudLngEl.textContent = parseFloat(d.lng).toFixed(6);
            if (d.speed !== undefined && hudSpeedEl) hudSpeedEl.textContent = `${parseFloat(d.speed).toFixed(1)} m/s`;
            if (d.heading !== undefined) {
                if (hudHeadingEl) hudHeadingEl.textContent = `${parseFloat(d.heading).toFixed(1)}°`;
            }
            if (d.alt !== undefined && hudAltEl) hudAltEl.textContent = `${parseFloat(d.alt).toFixed(1)} m`;
        });

        // ── MAIN: SCENE_UPDATE from 7-stage pipeline ───────
        mqtt.on('alerts', (d) => {
            if (!d) return;
            const label = String(d.label || '').toUpperCase();

            // ── Full scene update (new schema) ─────────────
            if (label === 'SCENE_UPDATE') {
                const summary   = d.scene_summary || {};
                const survivors = d.survivors     || [];
                const rescList  = d.rescue_list   || [];
                const fire      = d.fire          || {};
                const smoke     = d.smoke         || {};
                const motion    = d.motion        || {};
                const pose      = d.pose          || {};
                const gesture   = d.gesture       || {};

                lastScene = d;

                // Scene summary strip
                updateSceneSummary(summary, fire, smoke);

                // Hazard banner
                updateHazardBanner(summary);

                // Environmental risk panel
                updateEnvRisk(survivors, smoke, summary);

                // Survivor intelligence cards
                renderSurvivors(survivors);

                // Rescue priority list
                renderRescueList(rescList);

                // ── Bounding Boxes and Detection Tiles ───────────────────────
                renderBoundingBoxes(survivors, fire, smoke);

                // Human tile
                if (survivors.length > 0) {
                    const best = survivors.reduce((a, b) => a.conf > b.conf ? a : b);
                    triggerTile('human', 'DETECTED', 'triggered', best.conf, 6000);
                }

                // Fire tile
                if (fire.detected) {
                    const fClass = fire.spread_risk === 'HIGH' ? 'danger-triggered' : 'triggered';
                    triggerTile('fire', `${fire.spread_risk} SPREAD`, fClass, fire.conf, 6000);
                }

                // Smoke tile
                if (smoke.detected) {
                    const sLabel = smoke.density?.toUpperCase() + (smoke.toxic_suspicion ? ' ⚠TOXIC' : '');
                    triggerTile('smoke', sLabel, smoke.density === 'opaque' ? 'danger-triggered' : 'triggered', smoke.conf, 6000);
                }

                // Pose tile
                if (pose.label && pose.label !== 'none') {
                    const posClass = (pose.sos || pose.unconscious) ? 'danger-triggered' : 'triggered';
                    const posScore = Math.round((pose.score || 0.6) * 100);
                    triggerTile('pose', pose.label.toUpperCase().replace('_', ' '), posClass, posScore, 5000);
                }

                // Motion tile
                if (motion.detected) {
                    const motScore = Math.round((motion.score || 0) * 100);
                    triggerTile('motion', motion.intensity?.toUpperCase() || 'DETECTED', 'triggered', motScore, 4000);
                }

                // Timeline for critical survivors
                const criticals = survivors.filter(s => s.priority === 'CRITICAL');
                criticals.forEach(s => {
                    addTimelineEntry(
                        `🚨 CRITICAL: Survivor #${s.id} — ${s.status.replace(/_/g,' ')} · ${s.urgency.replace(/_/g,' ')}`,
                        'critical'
                    );
                });

                // Timeline for fire/toxic events
                if (fire.detected && fire.spread_risk === 'HIGH')
                    addTimelineEntry(`🔥 High fire spread risk detected`, 'warning');
                if (smoke.toxic_suspicion)
                    addTimelineEntry(`☠ Toxic smoke suspected`, 'critical');

                return;
            }

            // ── Legacy alert types (backward compat) ───────
            if (label === 'HUMAN') {
                const conf = d.conf || 85;
                triggerTile('human', 'DETECTED', 'triggered', conf, 5000);
                if (d.x !== undefined) {
                    positionBbox(bboxHuman, document.getElementById('bbox-human-conf'),
                        { x: d.x, y: d.y, w: d.w, h: d.h }, conf, 'Human');
                }
                addTimelineEntry(`👤 Human detected — ${d.posture || 'standing'} · Conf ${conf}%`, 'info');
                return;
            }

            if (label === 'FIRE') {
                triggerTile('fire', 'DETECTED', 'danger-triggered', d.conf || 80, 6000);
                if (d.bbox) positionBbox(bboxFire, document.getElementById('bbox-fire-conf'), d.bbox, d.conf || 80, 'Fire');
                addTimelineEntry(`🔥 Fire detected — spread: ${d.spread_risk || 'UNKNOWN'}`, 'critical');
                return;
            }

            if (label === 'SMOKE') {
                triggerTile('smoke', (d.density || 'DETECTED').toUpperCase(), 'triggered', d.conf || 70, 6000);
                addTimelineEntry(`💨 Smoke — ${d.density || 'unknown'} · Visibility ${d.visibility_pct || '--'}%`, 'warning');
                return;
            }

            if (label === 'MOTION') {
                triggerTile('motion', 'DETECTED', 'triggered', d.conf || 60, 4000);
                return;
            }

            if (label === 'GESTURE') {
                addTimelineEntry(`✋ Gesture: ${d.desc || 'hand signal'}`, 'info');
                return;
            }

            if (label === 'SURVIVOR_CRITICAL') {
                const s = d.survivor || {};
                addTimelineEntry(`🚨 CRITICAL survivor #${s.id || '?'} — ${s.urgency || 'IMMEDIATE'}`, 'critical');
                if (window.RESCUEBOT_UI)
                    window.RESCUEBOT_UI.toast(`CRITICAL: Survivor #${s.id || '?'} needs IMMEDIATE attention`, 'error');
                return;
            }
        });
    };

    bindMqtt();

    // ── MQTT status dot ───────────────────────────────────────
    const mqttDot  = document.getElementById('mqtt-dot');
    const mqttText = document.getElementById('mqtt-status-text');
    window.addEventListener('ares:statusChanged', (e) => {
        const s = e.detail;
        if (!mqttDot || !mqttText) return;
        if (s === 'CONNECTED')   { mqttDot.className = 'status-dot';          mqttText.textContent = 'SYSTEM ONLINE'; }
        else if (s === 'CONNECTING') { mqttDot.className = 'status-dot warning'; mqttText.textContent = 'ESTABLISHING...'; }
        else                     { mqttDot.className = 'status-dot offline';   mqttText.textContent = 'SYSTEM OFFLINE'; }
    });

    // ── Sidebar collapse ──────────────────────────────────────
    const sidebarCollapseBtn = document.getElementById('sidebar-collapse-btn');
    const sidebar            = document.getElementById('sidebar');
    if (sidebarCollapseBtn && sidebar) {
        sidebarCollapseBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            const icon = sidebarCollapseBtn.querySelector('[data-lucide]');
            if (icon) {
                icon.setAttribute('data-lucide', sidebar.classList.contains('collapsed') ? 'chevrons-right' : 'chevrons-left');
                if (window.lucide) lucide.createIcons();
            }
        });
    }

    // ── Viewport Resize Listener ──────────────────────────────
    window.addEventListener('resize', () => {
        if (lastScene) {
            const survivors = lastScene.survivors || [];
            const fire      = lastScene.fire      || {};
            const smoke     = lastScene.smoke     || {};
            renderBoundingBoxes(survivors, fire, smoke);
        }
    });

    if (typeof lucide !== 'undefined') lucide.createIcons();
});
