# Tripod: Disaster Response IoT Command Center

A high-performance, real-time IoT dashboard designed for search-and-rescue operations. Fully integrated with **ESP32** (Main Control) and **Raspberry Pi 4** (Vision & AI) hardware.

## 🚀 Key Features

- **Real-Time Telemetry**: Live sensor data from MQ-2 (Smoke), DHT11 (Temp/Hum), MPU6050 (Vibration), and HC-SR04 (Ultrasonic).
- **Tactical Mapping**: Live GPS tracking powered by the NEO-6M module.
- **AI Vision**: Dual-stream video feed from RPi4 (Main Stream) and ESP32-CAM (Detection Node).
- **Remote Control**: Manual robot drive with L298N motor driver support and First Aid kit deployment via Servo.
- **Compact UI**: Professional, high-density tactical interface localized for mission-critical operations.

## 🛠️ Hardware Stack

- **Core**: ESP32 Dev Board + Raspberry Pi 4 Model B.
- **Sensors**: MQ-2, Flame Sensor, DHT11, MPU6050, PIR, NEO-6M, HC-SR04.
- **Actuators**: L298N Motor Driver + MG996R Servos.
- **Communication**: WebSocket (Local/Remote) via WiFi/GSM.

## 📂 Project Structure

```text
src/
├── assets/          # Media & static images
├── context/         # IoT State & Global Context
├── hooks/           # WebSocket & Data Processing hooks
├── pages/           # Modular Dashboard Screens
├── styles/          # Unified Design System (CSS)
├── types/           # Hardware Payload Schemas
└── App.tsx          # Main Application Shell
```

## ⚙️ Setup

1. **Environment**: Create a `.env` file and set `VITE_WS_URL` to your robot's IP (e.g., `ws://192.168.1.100:81`).
2. **Install**: `npm install`
3. **Run**: `npm run dev`

---
*Command Center Station: Kolkata, India*
