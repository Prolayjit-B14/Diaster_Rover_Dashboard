/**
 * ARES-1 Production Mission Overview Logic
 * Integrated with event-driven MQTT pipeline.
 */

document.addEventListener('DOMContentLoaded', () => {
    const mqtt = window.mqttController;

    // --- MINI MAP INITIALIZATION ---
    const mapContainer = document.getElementById('mini-map');
    let miniMap = null;
    let roverMarker = null;

    if (mapContainer && typeof L !== 'undefined') {
        miniMap = L.map('mini-map', {
            zoomControl: false,
            attributionControl: false,
            scrollWheelZoom: false,
            dragging: false
        }).setView([0, 0], 1); 

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(miniMap);

        const roverIcon = L.divIcon({
            className: 'mini-rover-icon',
            html: `<div style="background: #2563EB; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 8px rgba(37, 99, 235, 0.6);"></div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6]
        });

        roverMarker = L.marker([0, 0], { icon: roverIcon });

        // Zoom Listeners
        document.getElementById('mini-zoom-in')?.addEventListener('click', () => miniMap.zoomIn());
        document.getElementById('mini-zoom-out')?.addEventListener('click', () => miniMap.zoomOut());
    }

    // --- MQTT EVENT SUBSCRIPTIONS ---

    if (mqtt) {
        // GPS Updates
        mqtt.on('gps', (data) => {
            const statusOverlay = document.getElementById('mini-map-status');
            if (statusOverlay) statusOverlay.style.display = 'none';

            if (miniMap && roverMarker) {
                if (!miniMap.hasLayer(roverMarker)) {
                    roverMarker.addTo(miniMap);
                    miniMap.setZoom(15);
                }
                const { lat, lng } = data;
                roverMarker.setLatLng([lat, lng]);
                miniMap.panTo([lat, lng]);
            }
        });

        // Telemetry Updates
        mqtt.on('telemetry', (data) => {
            // data: { sensor: 'TEMP', value: '24.5', unit: '°C' }
            const cards = document.querySelectorAll('.quick-card');
            cards.forEach(card => {
                const labelEl = card.querySelector('.q-label');
                if (labelEl && labelEl.textContent.trim().toUpperCase() === data.sensor.toUpperCase()) {
                    const valEl = card.querySelector('.q-value');
                    if (valEl) {
                        valEl.textContent = data.value + (data.unit || '');
                        valEl.classList.add('pulse-update');
                        setTimeout(() => valEl.classList.remove('pulse-update'), 600);
                    }
                }
            });
        });

        // Alerts Updates
        mqtt.on('alerts', (data) => {
            addGlobalAlert(data.message, data.severity || 'info');
        });
    }

    /**
     * Alert UI Helper
     */
    function addGlobalAlert(message, type) {
        const alertsList = document.querySelector('.alerts-list');
        if (!alertsList) return;

        const empty = alertsList.querySelector('.empty-alerts');
        if (empty) empty.style.display = 'none';

        const alertDiv = document.createElement('div');
        alertDiv.className = `alert-item severity-${type}`;
        
        const iconName = type === 'critical' ? 'octagon-alert' : 
                         type === 'warning' ? 'triangle-alert' : 'info';

        alertDiv.innerHTML = `
            <i data-lucide="${iconName}"></i>
            <span>${message}</span>
        `;
        
        alertsList.prepend(alertDiv);
        
        // Refresh icons
        if (window.lucide) window.lucide.createIcons();
        
        // Cap list size
        while (alertsList.children.length > 5) {
            alertsList.lastElementChild.remove();
        }
    }
});

