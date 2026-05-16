# ARES-1 | Mission Control System

A high-performance, real-time tactical dashboard designed for autonomous disaster monitoring and search-and-rescue operations. Fully optimized for production deployment and hardware integration.

![Mission Overview](./assets/map_view.png)

## 🚀 System Overview

The **ARES-1 Mission Control** is a premium, multi-module dashboard that synchronizes with the ARES-1 Rover hardware. It provides a unified interface for telemetry, vision, and geospatial tracking.

- **Mission Initialization**: High-tech entry sequence with system diagnostics.
- **Unified Dashboard**: Real-time telemetry monitoring (Temp, Gas, Ultrasonic, Vibration).
- **Tactical Mapping**: GPS tracking with synchronized mission waypoints.
- **Vision Array**: Live stream control with AI detection capabilities.
- **Premium UI**: Dark-mode glassmorphism interface powered by Outfit & JetBrains Mono.

## 🛠️ Hardware Integration

The ARES-1 system is built on a distributed hardware architecture for maximum reliability in disaster zones.

### Core Components
- **Primary Controller (ESP32 Dev Board)**: Manages sensor data acquisition, actuator control, and MQTT telemetry.
- **Vision Node (Raspberry Pi 4)**: Handles high-definition MJPEG streaming and edge-AI object detection.
- **Sensor Array**: 
    - **MQ-2**: Gas/Smoke detection for fire hazards.
    - **DHT11**: Environment temperature and humidity.
    - **NEO-6M**: GPS localization for tactical mapping.
    - **HC-SR04**: Ultrasonic ranging for collision avoidance.
    - **MPU6050**: 6-axis vibration and orientation monitoring.

### Communication Protocol
The dashboard communicates via a lightweight **MQTT** pipeline over WebSockets (`wss://`). This ensures sub-100ms latency for critical command dispatches and real-time telemetry updates.

## 📂 Project Structure

```text
├── dashboard/       # Main Mission Overview module
├── camera/          # Live vision & AI analytics module
├── map/             # Tactical GPS tracking module
├── sensors/         # High-density telemetry module
├── shared/          # Shared Design System & MQTT Client
├── assets/          # Static mission assets (UI images)
├── firmware/        # ESP32/Arduino source code
├── public/          # Global assets & icons
└── index.html       # Mission Initialization entry point
```

## 📖 Documentation & Setup

### 1. Development Environment
Ensure you have **Node.js 18+** installed.
```bash
npm install
npm run dev
```

### 2. Hardware Synchronization
Update the MQTT broker settings in `shared/mqtt-client.js` to match your rover's configuration. The default configuration uses the EMQX public broker for testing.

### 3. Production Deployment
This repository is optimized for **Vercel**. Every push to the `main` branch triggers an automated build using **Vite**, generating a high-performance static distribution in the `dist` folder.

---
**Mission Lead:** Prolayjit Biswas  
**Organization:** TRIPOD | KGEC, Kolkata  
**Project Goal:** Developing autonomous solutions for active rescue support.  
© 2026 ARES-1 MISSION CONTROL

