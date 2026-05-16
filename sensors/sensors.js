/**
 * RescueBOT Sensors Module Logic
 * Standardized for live hardware data ingestion via event-driven MQTT.
 */

document.addEventListener('DOMContentLoaded', () => {
    const mqtt = window.mqttController;

    const sensorIdMap = {
        'temp': 'sensor-temp',
        'temperature': 'sensor-temp',
        'gas': 'sensor-gas',
        'fire': 'sensor-fire',
        'flame': 'sensor-fire',
        'ultrasonic': 'sensor-ultrasonic',
        'distance': 'sensor-ultrasonic',
        'pir': 'sensor-pir',
        'motion': 'sensor-pir',
        'vibration': 'sensor-vibration',
        'tilt': 'sensor-tilt',
        'gyro': 'sensor-gyro',
        'gps': 'sensor-gps',
        'batt': 'sensor-batt',
        'battery': 'sensor-batt',
        'wifi': 'sensor-wifi',
        'camera': 'sensor-camera'
    };

    if (mqtt) {
        // Telemetry Data Ingestion
        mqtt.on('telemetry', (data) => {
            const elementId = sensorIdMap[data.sensor.toLowerCase()];
            const card = document.getElementById(elementId);
            if (!card) return;

            const valEl = card.querySelector('.sensor-monitor-value');
            if (valEl) {
                valEl.textContent = data.value;
                valEl.classList.add('pulse-update');
                setTimeout(() => valEl.classList.remove('pulse-update'), 500);
            }

            // Update status if provided in telemetry packet
            if (data.status) {
                updateSensorStatus(card, data.status);
            }
        });

        // Hardware Status Updates
        mqtt.on('hardwareStatus', (data) => {
            // data format: { sensor: 'temp', status: 'OPTIMAL' }
            const elementId = sensorIdMap[data.sensor.toLowerCase()];
            const card = document.getElementById(elementId);
            if (card) {
                updateSensorStatus(card, data.status);
            }
        });
    }

    /**
     * Update UI for a specific sensor card based on status
     */
    function updateSensorStatus(card, status) {
        const indicator = card.querySelector('.sensor-status-indicator');
        if (!indicator) return;

        card.classList.remove('status-optimal', 'status-warning', 'status-critical', 'status-offline');
        
        let statusClass = 'status-offline';
        const upperStatus = status.toUpperCase();

        if (upperStatus === 'OPTIMAL' || upperStatus === 'ONLINE') statusClass = 'status-optimal';
        else if (upperStatus === 'WARNING') statusClass = 'status-warning';
        else if (upperStatus === 'CRITICAL' || upperStatus === 'ALARM') statusClass = 'status-critical';

        card.classList.add(statusClass);
        indicator.textContent = upperStatus;
    }
});

