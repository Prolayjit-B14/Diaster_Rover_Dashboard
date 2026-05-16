/**
 * RescueBOT Industrial GPS Mapping Logic
 * Rewritten for live hardware data ingestion via MQTT.
 */

document.addEventListener('DOMContentLoaded', () => {
    const mqtt = window.mqttController;

    class MapDashboard {
        constructor() {
            this.map = null;
            this.RobotMarker = null;
            this.pathLine = null;
            this.pathCoords = [];
            this.isFollowing = true;
            this.activeTool = null;
            this.landmarks = [];
            this.totalDistance = 0;
            this.currentPos = { lat: 0, lng: 0, heading: 0 };
            
            this.init();
        }

        init() {
            const mapContainer = document.getElementById('map-canvas');
            if (!mapContainer || typeof L === 'undefined') return;

            this.map = L.map('map-canvas', {
                zoomControl: false,
                attributionControl: false,
                scrollWheelZoom: true
            }).setView([0, 0], 2);

            this.streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(this.map);
            this.satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}');

            const RobotIcon = L.divIcon({
                className: 'Robot-marker-icon',
                html: `<div class="Robot-arrow" style="transform: rotate(0deg);">
                        <svg width="44" height="44" viewBox="0 0 24 24" fill="#2563EB" stroke="white" stroke-width="2">
                            <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/>
                        </svg>
                       </div>`,
                iconSize: [44, 44],
                iconAnchor: [22, 22]
            });

            this.RobotMarker = L.marker([0, 0], { icon: RobotIcon }).addTo(this.map);
            
            this.pathLine = L.polyline([], { 
                color: '#2563EB', 
                weight: 4, 
                opacity: 0.8,
                lineJoin: 'round'
            }).addTo(this.map);

            this.setupListeners();
            this.setupMqtt();
        }

        setupMqtt() {
            if (!mqtt) return;

            mqtt.on('gps', (data) => {
                // data format: { lat: 22.57, lng: 88.36, heading: 120, speed: 5.2 }
                this.updateRobot(data.lat, data.lng, data.heading || 0, data.speed || 0);
            });
        }

        setupListeners() {
            this.map.on('click', (e) => {
                if (this.activeTool) {
                    this.addLandmark(e.latlng.lat, e.latlng.lng, this.activeTool);
                    this.activeTool = null;
                    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                }
            });

            document.querySelectorAll('.tool-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const type = btn.getAttribute('data-type');
                    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                    if (this.activeTool !== type) {
                        this.activeTool = type;
                        btn.classList.add('active');
                    } else {
                        this.activeTool = null;
                    }
                });
            });

            document.getElementById('btn-street')?.addEventListener('click', (e) => {
                this.map.addLayer(this.streetLayer);
                this.map.removeLayer(this.satelliteLayer);
                e.currentTarget.classList.add('active');
                document.getElementById('btn-satellite')?.classList.remove('active');
            });

            document.getElementById('btn-satellite')?.addEventListener('click', (e) => {
                this.map.addLayer(this.satelliteLayer);
                this.map.removeLayer(this.streetLayer);
                e.currentTarget.classList.add('active');
                document.getElementById('btn-street')?.classList.remove('active');
            });

            document.getElementById('btn-follow')?.addEventListener('click', (e) => {
                this.isFollowing = !this.isFollowing;
                e.currentTarget.classList.toggle('active', this.isFollowing);
                if (this.isFollowing) this.map.panTo([this.currentPos.lat, this.currentPos.lng]);
            });

            document.getElementById('btn-zoom-in')?.addEventListener('click', () => this.map.zoomIn());
            document.getElementById('btn-zoom-out')?.addEventListener('click', () => this.map.zoomOut());
        }

        addLandmark(lat, lng, type) {
            const configs = {
                target: { color: '#EF4444', label: 'TARGET' },
                hazard: { color: '#F59E0B', label: 'HAZARD' },
                clear: { color: '#10B981', label: 'SECURE' }
            };
            const config = configs[type];

            const markerIcon = L.divIcon({
                className: 'landmark-icon',
                html: `<div style="background: ${config.color}; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 10px ${config.color}66;"></div>`,
                iconSize: [14, 14],
                iconAnchor: [7, 7]
            });

            L.marker([lat, lng], { icon: markerIcon }).addTo(this.map);
            this.landmarks.push({ lat, lng, config });
            this.updateLandmarkUI();
        }

        updateLandmarkUI() {
            const list = document.getElementById('landmark-list');
            if (!list) return;
            if (this.landmarks.length === 0) {
                list.innerHTML = '<div class="empty-list">No landmarks recorded.</div>';
                return;
            }
            list.innerHTML = this.landmarks.slice(-4).reverse().map(l => `
                <div class="landmark-item">
                    <div style="width: 12px; height: 12px; border-radius: 50%; background: ${l.config.color}"></div>
                    <div class="landmark-info">
                        <span class="landmark-name">${l.config.label}</span>
                        <span class="landmark-coords">${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}</span>
                    </div>
                </div>
            `).join('');
        }

        updateRobot(lat, lng, heading, speed = 0) {
            if (this.pathCoords.length > 0) {
                const prev = this.pathCoords[this.pathCoords.length - 1];
                const d = this.getDistMeters(prev[0], prev[1], lat, lng);
                this.totalDistance += d;
                this.updateDistHUD(this.totalDistance);
            }

            this.currentPos = { lat, lng, heading };
            this.RobotMarker.setLatLng([lat, lng]);
            
            const arrowEl = this.RobotMarker.getElement()?.querySelector('.Robot-arrow');
            if (arrowEl) arrowEl.style.transform = `rotate(${heading}deg)`;
            
            this.pathCoords.push([lat, lng]);
            this.pathLine.setLatLngs(this.pathCoords);
            
            if (this.isFollowing) this.map.panTo([lat, lng]);
            
            this.currentPos = { lat, lng, heading };
            this.RobotMarker.setLatLng([lat, lng]);
            
            const arrowEl = this.RobotMarker.getElement()?.querySelector('.Robot-arrow');
            if (arrowEl) arrowEl.style.transform = `rotate(${heading}deg)`;
            
            this.pathCoords.push([lat, lng]);
            this.pathLine.setLatLngs(this.pathCoords);
            
            if (this.isFollowing) this.map.panTo([lat, lng]);
            
            const latEl = document.getElementById('lat-display');
            const lngEl = document.getElementById('lng-display');
            const satEl = document.getElementById('sat-count');

            if (latEl) latEl.textContent = lat.toFixed(6) + '°';
            if (lngEl) lngEl.textContent = lng.toFixed(6) + '°';
            if (satEl) satEl.textContent = Math.floor(Math.random() * 5) + 8; // Simulated satellite count
        }

        getDistMeters(lat1, lon1, lat2, lon2) {
            const R = 6371e3;
            const φ1 = lat1 * Math.PI/180;
            const φ2 = lat2 * Math.PI/180;
            const Δφ = (lat2-lat1) * Math.PI/180;
            const Δλ = (lon2-lon1) * Math.PI/180;
            const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            return R * c;
        }

        updateDistHUD(val) {
            const el = document.getElementById('map-dist');
            if (el) el.textContent = Math.floor(val);
        }
    }

    // Singleton Instance
    window.mapDash = new MapDashboard();
    
    // Mission Timer
    let seconds = 0;
    const missionTimeEl = document.getElementById('mission-time');
    if (missionTimeEl) {
        setInterval(() => {
            seconds++;
            const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
            const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
            const s = (seconds % 60).toString().padStart(2, '0');
            missionTimeEl.textContent = `${h}:${m}:${s}`;
        }, 1000);
    }
});

