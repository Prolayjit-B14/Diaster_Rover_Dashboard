# RescueBOT | Tactical IoT Command Center 🛡️

**RescueBOT** is a next-generation, high-performance mission control dashboard designed for autonomous disaster response and search-and-rescue operations. Developed for high-stakes **Hackathons**, this project bridges the gap between rugged hardware and premium software aesthetics.



## 🏆 Hackathon Edition
Built for reliability, speed, and real-time visualization, RescueBOT provides first responders with a unified tactical interface to monitor hazardous environments.

### 👥 The Team: RescueBOT (TRIPOD)
- **Prolayjit Biswas** (Team Lead & Main Software-Hardware Support)
- **Arghya Roy** (Lead Hardware Engineer)
- **Shubhajit Haldar** (Hardware Support)
- **Papan Chowdhury** (Hardware Support)


---

## 🚀 Key Features

### 💻 Web Dashboard Modules
- **Mission Initialization**: A cinematic, high-tech boot sequence that performs system diagnostic checks before granting access to mission control.
- **Mission Overview (Live Dashboard)**: A high-density tactical overview featuring real-time telemetry cards, active alert lists, and mini-map/camera previews.
- **Live Vision Array**: Full-screen low-latency video feed with integrated AI analytics for human and motion detection.
- **Tactical Mapping**: Geospatial tracking powered by Leaflet, displaying live GPS coordinates and mission-critical waypoints.
- **Sensor Monitor**: Specialized view for deep-diving into high-frequency telemetry data with real-time pulse updates.

### 🤖 Hardware Capabilities
- **Environmental Awareness**: Continuous monitoring of hazardous gases, smoke, and atmospheric conditions.
- **Structural Diagnostics**: 6-axis vibration monitoring to detect structural instability in rescue zones.
- **Obstacle Avoidance**: Ultrasonic-based spatial awareness for safe robot navigation.
- **Geospatial Intelligence**: High-precision GPS localization for coordinated field operations.

---

## 🛠️ Hardware Stack (Components List)

### Core Controllers
- **ESP32 Dev Board**: The central nervous system handling telemetry, logic, and MQTT communication.
- **ESP32-CAM**: Dedicated detection node for real-time visual feedback and AI processing.

### Sensor Suite
- **MQ-2 Gas Sensor**: Detects LPG, Smoke, and Alcohol levels (critical for fire hazards).
- **DHT11**: Monitoring ambient Temperature and Humidity.
- **HC-SR04 Ultrasonic**: Precise distance measurement for obstacle detection.
- **NEO-6M GPS Module**: Provides real-time Latitude and Longitude coordinates.
- **MPU6050 Accelerometer/Gyro**: Detects vibration, tilt, and impact forces.
- **Flame Sensor**: Immediate detection of fire sources in the vicinity.

### Actuators & Drivers
- **L298N Motor Driver**: High-current driver for dual-motor robot locomotion.
- **MG996R Servos**: Heavy-duty servos for First Aid kit deployment and camera pan/tilt.

---

## 📡 IoT & Communication (Software-Hardware Sync)

RescueBOT utilizes a decoupled, event-driven architecture to ensure seamless synchronization between the physical robot and the web dashboard.

### 1. The MQTT Pipeline
- **Broker**: EMQX Cloud (WSS Protocol)
- **Latency**: < 100ms real-time synchronization.
- **Payload**: Structured JSON packets for telemetry, GPS, and status.

### 2. Connection Flow
1. **Hardware Boot**: ESP32 connects to WiFi and establishes a secure WebSocket connection to the MQTT broker.
2. **Telemetry Publishing**: Sensors are polled every 100ms; data is published to `rescuebot/robot/telemetry`.
3. **Dashboard Subscription**: The Web Dashboard (using `mqtt.js`) subscribes to all mission topics and updates the UI using an event-driven listener system.
4. **Command Dispatch**: User actions on the web UI (like "Start Stream" or "Deploy Kit") are published as commands that the ESP32 executes immediately.

---

## 📂 Project Architecture

```text
├── dashboard/       # Tactical Overview module
├── camera/          # AI Vision & Detection module
├── map/             # Geospatial Tracking module
├── sensors/         # High-density Telemetry module
├── shared/          # Design System & MQTT Client (The Core)
├── assets/          # Mission-critical UI images
├── firmware/        # Arduino/C++ source code for ESP32
└── index.html       # RescueBOT Entry Point (Init Sequence)
```

## ⚙️ Setup & Deployment

### For Developers
1. **Clone & Install**:
   ```bash
   npm install
   ```
2. **Launch Mission Control**:
   ```bash
   npm run dev
   ```
3. **Build Production Distribution**:
   ```bash
   npm run build
   ```

### Deployment
This project is fully optimized for **Vercel**. Every push to the `main` branch triggers an automated build using **Vite**, delivering a high-performance, edge-deployed mission control center.

---
**RescueBOT Mission Control** | *Empowering Rescue Missions through IoT & AI*  
© 2026 TEAM BOT THINGS
