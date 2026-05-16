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

## 🛠️ Technology Stack

- **Frontend**: Vanilla JavaScript + Vite (Multi-page Architecture)
- **Styling**: Modern CSS3 (Custom Design System + Glassmorphism)
- **Communication**: MQTT (Real-time telemetry & Hardware commands)
- **Deployment**: Optimized for **Vercel** & GitHub Pages
- **Hardware**: ESP32 (Main Control) + ESP32-CAM (Detection Node)

## 📂 Project Structure

```text
├── dashboard/       # Main Mission Overview module
├── camera/          # Live vision & AI analytics module
├── map/             # Tactical GPS tracking module
├── sensors/         # High-density telemetry module
├── shared/          # Shared Design System & MQTT Client
├── assets/          # Static mission assets
├── public/          # Global assets & icons
└── index.html       # Mission Initialization entry point
```

## ⚙️ Deployment & Development

### Local Development
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

### Production Deployment
The system is pre-configured for **Vercel**. Simply push to GitHub and the platform will handle the optimized bundling and clean URL routing.

---
**Developed by:** Prolayjit Biswas  
**Team:** TRIPOD | Kolkata, India  
© 2026 ARES-1 MISSION CONTROL
