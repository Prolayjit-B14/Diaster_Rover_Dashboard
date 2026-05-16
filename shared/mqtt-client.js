/**
 * ARES-1 Production IoT MQTT Client
 * Handles real-time communication with ESP32 hardware.
 * Decoupled event-based architecture for production reliability.
 */

class MqttController {
    constructor() {
        this.client = null;
        this.config = {
            broker: 'wss://broker.emqx.io:8084/mqtt',
            clientId: 'ares_dashboard_' + Math.random().toString(16).substring(2, 10),
            topics: {
                telemetry: 'ares1/rover/telemetry',
                gps: 'ares1/rover/gps',
                camera: 'ares1/rover/camera',
                alerts: 'ares1/rover/alerts',
                command: 'ares1/rover/command',
                status: 'ares1/rover/status'
            }
        };
        this.status = 'DISCONNECTED';
        this.listeners = new Map();
    }

    /**
     * Subscribe to specific data events
     * @param {string} event - telemetry, gps, camera, alerts, status
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
            this.listeners.get(event).forEach(callback => callback(data));
        }
        // Also dispatch global window event for legacy/broader support
        window.dispatchEvent(new CustomEvent(`ares:${event}`, { detail: data }));
    }

    connect() {
        if (this.client && this.client.connected) return;

        console.log(`[MQTT] Connecting to ${this.config.broker}...`);
        this.updateStatus('CONNECTING');

        try {
            this.client = mqtt.connect(this.config.broker, {
                clientId: this.config.clientId,
                clean: true,
                connectTimeout: 5000,
                reconnectPeriod: 2000,
                keepalive: 60
            });

            this.client.on('connect', () => {
                console.log('[MQTT] Connected successfully');
                this.updateStatus('CONNECTED');
                
                // Subscribe to all relevant topics
                const topicList = Object.values(this.config.topics);
                this.client.subscribe(topicList, (err) => {
                    if (!err) {
                        console.log(`[MQTT] Subscribed to ${topicList.length} channels`);
                    } else {
                        console.error('[MQTT] Subscription error:', err);
                    }
                });
            });

            this.client.on('message', (topic, message) => {
                this.handleMessage(topic, message.toString());
            });

            this.client.on('error', (err) => {
                console.error('[MQTT] Broker Error:', err);
                this.updateStatus('ERROR');
            });

            this.client.on('close', () => {
                if (this.status !== 'CONNECTING') {
                    this.updateStatus('DISCONNECTED');
                }
            });

            this.client.on('reconnect', () => {
                console.log('[MQTT] Attempting reconnection...');
                this.updateStatus('CONNECTING');
            });

        } catch (error) {
            console.error('[MQTT] Connection Failed:', error);
            this.updateStatus('ERROR');
        }
    }

    updateStatus(status) {
        this.status = status;
        this.emit('statusChanged', status);
        
        // Update UI Indicators globally if they exist
        const indicators = document.querySelectorAll('.mqtt-status-text');
        indicators.forEach(el => {
            el.textContent = status === 'CONNECTED' ? 'SYSTEM ONLINE' : 
                            status === 'CONNECTING' ? 'ESTABLISHING...' : 'SYSTEM OFFLINE';
            el.dataset.status = status;
        });

        const dots = document.querySelectorAll('.mqtt-status-dot');
        dots.forEach(dot => {
            dot.className = 'mqtt-status-dot ' + status.toLowerCase();
        });
    }

    handleMessage(topic, payload) {
        try {
            const data = JSON.parse(payload);
            
            switch (topic) {
                case this.config.topics.telemetry:
                    this.emit('telemetry', data);
                    break;
                case this.config.topics.gps:
                    this.emit('gps', data);
                    break;
                case this.config.topics.camera:
                    this.emit('camera', data);
                    break;
                case this.config.topics.alerts:
                    this.emit('alerts', data);
                    break;
                case this.config.topics.status:
                    this.emit('hardwareStatus', data);
                    break;
            }
        } catch (e) {
            console.warn('[MQTT] Non-JSON payload received:', payload);
        }
    }

    /**
     * Send command to hardware
     * @param {string} cmd 
     * @param {object} params 
     */
    sendCommand(cmd, params = {}) {
        if (this.client && this.client.connected) {
            const payload = JSON.stringify({ 
                command: cmd, 
                ...params, 
                timestamp: Date.now(),
                origin: 'dashboard'
            });
            this.client.publish(this.config.topics.command, payload, { qos: 1 });
            console.log('[MQTT] Command dispatched:', cmd, params);
        } else {
            console.error('[MQTT] Cannot send command: Client not connected');
        }
    }
}

// Singleton Instance
window.mqttController = new MqttController();

// Initialization
if (typeof mqtt !== 'undefined') {
    window.mqttController.connect();
} else {
    console.warn('[MQTT] mqtt.min.js not detected. Real-time features will be unavailable.');
}
;
