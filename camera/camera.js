// Camera Dashboard V2 - Production Ready Hardware Integration
document.addEventListener('DOMContentLoaded', () => {
    const mqtt = window.mqttController;

    class CameraController {
        constructor() {
            this.isStreaming = false;
            this.isRecording = false;
            this.isNightMode = false;
            this.isHumanDetectOn = true;
            this.isMotionDetectOn = false;
            
            this.init();
        }

        init() {
            this.setupEventListeners();
            this.setupMqttListeners();
            this.addLog("CAMERA SYSTEM INITIALIZED", "READY");
        }

        setupEventListeners() {
            // Stream Toggle
            const btnStream = document.getElementById('btn-stream-toggle');
            if (btnStream) {
                btnStream.addEventListener('click', () => {
                    this.isStreaming = !this.isStreaming;
                    
                    if (mqtt) {
                        mqtt.sendCommand('TOGGLE_STREAM', { active: this.isStreaming });
                    }

                    this.updateStreamUI();
                    this.addLog(this.isStreaming ? "STREAM COMMAND DISPATCHED: START" : "STREAM COMMAND DISPATCHED: STOP");
                });
            }

            // AI Toggles
            document.getElementById('toggle-human-detect')?.addEventListener('change', (e) => {
                this.isHumanDetectOn = e.target.checked;
                if (mqtt) {
                    mqtt.sendCommand('SET_AI_HUMAN', { enabled: this.isHumanDetectOn });
                }
                this.addLog(`AI CONFIG: HUMAN DETECT ${this.isHumanDetectOn ? 'ON' : 'OFF'}`);
            });

            document.getElementById('toggle-motion-detect')?.addEventListener('change', (e) => {
                this.isMotionDetectOn = e.target.checked;
                if (mqtt) {
                    mqtt.sendCommand('SET_AI_MOTION', { enabled: this.isMotionDetectOn });
                }
                this.addLog(`AI CONFIG: MOTION DETECT ${this.isMotionDetectOn ? 'ON' : 'OFF'}`);
            });

            // Night Mode
            const btnNight = document.getElementById('btn-night-mode');
            if (btnNight) {
                btnNight.addEventListener('click', () => {
                    this.isNightMode = !this.isNightMode;
                    if (mqtt) {
                        mqtt.sendCommand('SET_NIGHT_MODE', { enabled: this.isNightMode });
                    }
                    btnNight.classList.toggle('active', this.isNightMode);
                    document.querySelector('.video-wrapper')?.classList.toggle('night-mode-active', this.isNightMode);
                    this.addLog(`HARDWARE: NIGHT MODE ${this.isNightMode ? 'ACTIVE' : 'INACTIVE'}`);
                });
            }

            // Snapshot
            document.getElementById('btn-capture')?.addEventListener('click', () => {
                this.addLog("CAPTURING HIGH-RES SNAPSHOT...");
                if (mqtt) mqtt.sendCommand('CAPTURE_IMAGE');
            });
        }

        setupMqttListeners() {
            if (!mqtt) return;

            mqtt.on('camera', (data) => {
                // data: { url: '...', active: true, fps: 30 }
                const feed = document.getElementById('esp32-stream');
                const placeholder = document.getElementById('stream-placeholder');
                
                if (data.active && data.url) {
                    this.isStreaming = true;
                    if (feed) {
                        feed.src = data.url;
                        feed.classList.remove('stream-hidden');
                    }
                    if (placeholder) placeholder.style.display = 'none';
                    
                    const hud = document.querySelector('.hud-top');
                    if (hud) hud.textContent = `LIVE | ${data.fps || 30} FPS | STABLE`;
                } else {
                    this.isStreaming = false;
                    if (feed) {
                        feed.src = '';
                        feed.classList.add('stream-hidden');
                    }
                    if (placeholder) placeholder.style.display = 'flex';
                }
                this.updateStreamToggleButton();
            });

            mqtt.on('alerts', (data) => {
                if (data.type === 'DETECTION') {
                    this.handleAIDetection(data);
                }
            });
        }

        updateStreamUI() {
            const feed = document.getElementById('esp32-stream');
            const placeholder = document.getElementById('stream-placeholder');
            
            if (this.isStreaming) {
                // We wait for the hardware to send the URL back via MQTT
                if (placeholder) placeholder.querySelector('span').textContent = "INITIALIZING STREAM...";
            } else {
                if (feed) {
                    feed.src = "";
                    feed.classList.add('stream-hidden');
                }
                if (placeholder) {
                    placeholder.style.display = 'flex';
                    placeholder.querySelector('span').textContent = "WAITING FOR HARDWARE SIGNAL...";
                }
            }
            this.updateStreamToggleButton();
        }

        updateStreamToggleButton() {
            const btnStream = document.getElementById('btn-stream-toggle');
            if (btnStream) {
                btnStream.classList.toggle('active', this.isStreaming);
                btnStream.innerHTML = this.isStreaming ? 
                    '<i data-lucide="square"></i>' : 
                    '<i data-lucide="play"></i>';
                if (window.lucide) window.lucide.createIcons();
            }
        }

        handleAIDetection(data) {
            const overlay = document.getElementById('ai-overlay');
            if (!overlay) return;

            if (data.detected) {
                overlay.innerHTML = `
                    <div class="detection-box" style="top:${data.y}%; left:${data.x}%; width:${data.w}px; height:${data.h}px;">
                        <div class="detection-label">${data.label} (${Math.round(data.conf * 100)}%)</div>
                    </div>
                `;
                this.addLog(`AI EVENT: ${data.label} DETECTED`);
            } else {
                overlay.innerHTML = '';
            }
        }

        addLog(message) {
            const container = document.getElementById('cam-event-logs');
            if (!container) return;
            const now = new Date();
            const ts = now.toLocaleTimeString('en-GB', { hour12: false });
            const item = document.createElement('div');
            item.className = 'log-row';
            item.innerHTML = `<span>[${ts}]</span> ${message}`;
            container.prepend(item);
            if (container.children.length > 20) container.removeChild(container.lastChild);
        }
    }

    // Global instance
    window.cameraController = new CameraController();
});

