/**
 * RescueBOT Production IoT MQTT Client v3.1
 * Handles real-time communication with ESP32 hardware.
 * Decoupled event-based architecture for production reliability.
 *
 * Fixes applied:
 *  - Removed 'command' topic from subscriptions (was subscribing to own publish channel)
 *  - Added reconnect attempt counter with cap + exponential backoff (max 10 retries)
 *  - Removed trailing orphan semicolon
 */

class MqttController {
    constructor() {
        this.client = null;
        this.config = {
            broker: 'wss://broker.emqx.io:8084/mqtt',
            clientId: 'ares_dashboard_' + Math.random().toString(16).substring(2, 10),
            topics: {
                telemetry: 'ares1/Robot/telemetry',
                gps:       'ares1/Robot/gps',
                camera:    'ares1/Robot/camera',
                alerts:    'ares1/Robot/alerts',
                command:   'ares1/Robot/command',  // publish-only, NOT subscribed
                status:    'ares1/Robot/status'
            }
        };
        this.status           = 'DISCONNECTED';
        this.listeners        = new Map();
        this._reconnectCount  = 0;
        this._maxReconnects   = 10;
    }

    /**
     * Subscribe to specific data events.
     * @param {string}   event    - telemetry | gps | camera | alerts | status | statusChanged
     * @param {function} callback
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    emit(event, data) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(cb => {
                try { cb(data); } catch (e) { console.error('[MQTT] Listener error:', e); }
            });
        }
        // Dispatch global window event for broader interop
        window.dispatchEvent(new CustomEvent(`ares:${event}`, { detail: data }));
    }

    connect() {
        if (this.client && this.client.connected) return;

        console.log(`[MQTT] Connecting to ${this.config.broker}...`);
        this.updateStatus('CONNECTING');

        try {
            this.client = mqtt.connect(this.config.broker, {
                clientId:        this.config.clientId,
                clean:           true,
                connectTimeout:  8000,
                reconnectPeriod: 0,   // Manual reconnect to implement backoff
                keepalive:       60
            });

            this.client.on('connect', () => {
                console.log('[MQTT] Connected successfully.');
                this._reconnectCount = 0;
                this.updateStatus('CONNECTED');

                // Subscribe only to inbound topics (exclude 'command' — publish-only)
                const subscribeTopics = Object.entries(this.config.topics)
                    .filter(([key]) => key !== 'command')
                    .map(([, topic]) => topic);

                this.client.subscribe(subscribeTopics, (err) => {
                    if (!err) {
                        console.log(`[MQTT] Subscribed to ${subscribeTopics.length} channels.`);
                    } else {
                        console.error('[MQTT] Subscription error:', err);
                    }
                });
            });

            this.client.on('message', (topic, message) => {
                this.handleMessage(topic, message.toString());
            });

            this.client.on('error', (err) => {
                console.error('[MQTT] Broker error:', err);
                this.updateStatus('ERROR');
            });

            this.client.on('close', () => {
                if (this.status === 'CONNECTED') {
                    this.updateStatus('DISCONNECTED');
                }
                this._scheduleReconnect();
            });

            this.client.on('reconnect', () => {
                console.log('[MQTT] Reconnecting...');
                this.updateStatus('CONNECTING');
            });

        } catch (error) {
            console.error('[MQTT] Connection failed:', error);
            this.updateStatus('ERROR');
            this._scheduleReconnect();
        }
    }

    /** Exponential backoff reconnect — caps at 10 attempts. */
    _scheduleReconnect() {
        if (this._reconnectCount >= this._maxReconnects) {
            console.warn(`[MQTT] Max reconnect attempts (${this._maxReconnects}) reached. Giving up.`);
            this.updateStatus('ERROR');
            return;
        }
        const delay = Math.min(30000, 2000 * Math.pow(1.5, this._reconnectCount));
        this._reconnectCount++;
        console.log(`[MQTT] Reconnect attempt ${this._reconnectCount}/${this._maxReconnects} in ${Math.round(delay / 1000)}s...`);
        setTimeout(() => this.connect(), delay);
    }

    updateStatus(status) {
        this.status = status;
        this.emit('statusChanged', status);

        // Update all global status text indicators
        document.querySelectorAll('.mqtt-status-text').forEach(el => {
            el.textContent =
                status === 'CONNECTED'    ? 'SYSTEM ONLINE'   :
                status === 'CONNECTING'   ? 'ESTABLISHING...' :
                status === 'ERROR'        ? 'ERROR'           : 'SYSTEM OFFLINE';
            el.dataset.status = status;
        });

        document.querySelectorAll('.mqtt-status-dot').forEach(dot => {
            dot.className = 'mqtt-status-dot ' + status.toLowerCase();
        });
    }

    handleMessage(topic, payload) {
        try {
            const data = JSON.parse(payload);
            switch (topic) {
                case this.config.topics.telemetry: this.emit('telemetry', data);      break;
                case this.config.topics.gps:       this.emit('gps', data);            break;
                case this.config.topics.camera:    this.emit('camera', data);         break;
                case this.config.topics.alerts:    this.emit('alerts', data);         break;
                case this.config.topics.status:    this.emit('hardwareStatus', data); break;
            }
        } catch (e) {
            console.warn('[MQTT] Non-JSON payload on', topic, ':', payload.substring(0, 80));
        }
    }

    /**
     * Send command to hardware via the command topic.
     * @param {string} cmd
     * @param {object} params
     */
    sendCommand(cmd, params = {}) {
        if (this.client && this.client.connected) {
            const payload = JSON.stringify({
                command:   cmd,
                ...params,
                timestamp: Date.now(),
                origin:    'dashboard'
            });
            this.client.publish(this.config.topics.command, payload, { qos: 1 });
            console.log('[MQTT] Command dispatched:', cmd, params);
        } else {
            console.warn('[MQTT] Cannot send command — client not connected. Command:', cmd);
            if (window.RESCUEBOT_UI) {
                window.RESCUEBOT_UI.toast('MQTT offline — command not sent', 'warning');
            }
        }
    }
}

// Singleton Instance
window.mqttController = new MqttController();

// Auto-connect if mqtt library is available
if (typeof mqtt !== 'undefined') {
    window.mqttController.connect();
} else {
    console.warn('[MQTT] mqtt.min.js not detected. Real-time features disabled.');
}
