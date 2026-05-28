"""
RescueBOT — FastAPI Main Application Entry Point
Starts the FastAPI server with REST routes, WebSocket endpoint,
CORS middleware, and launches the AI inference engine.

Usage:
  python main.py [--stream ESP32_URL] [--webcam 0] [--synthetic] [--port 8000]

Default:
  Runs in interactive mode, prompting for stream source.
"""
import asyncio
import sys
import time
import json
import argparse
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Ensure backend root is in path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config.settings import FASTAPI_HOST, FASTAPI_PORT, ESP32_STREAM_URL, WS_BROADCAST_INTERVAL
from services.ai_orchestrator import AIOrchestrator
from websocket.manager import ws_manager
from api.routes import router, set_orchestrator
from models.schemas import LiveDetections, CameraStatus

# ── FastAPI App ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="RescueBOT AI Inference Engine",
    description=(
        "Disaster rescue intelligence system — "
        "ESP32-CAM + YOLO + MediaPipe + OpenCV + FastAPI"
    ),
    version="4.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS: allow the frontend (Vite dev server) and any local origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],        # restrict in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Global Orchestrator ───────────────────────────────────────────────────────
orchestrator: AIOrchestrator | None = None


# ── Startup / Shutdown ────────────────────────────────────────────────────────
@app.on_event("startup")
async def on_startup():
    global orchestrator
    print("\n" + "=" * 65)
    print("  RescueBOT AI Inference Engine v4.0.0")
    print("  FastAPI + YOLO + MediaPipe + OpenCV + WebSocket")
    print("=" * 65)

    orchestrator = AIOrchestrator()
    set_orchestrator(orchestrator)

    # Parse launch args (stream URL injected at startup)
    stream_url = getattr(app.state, "stream_url", None)
    loop_mode  = getattr(app.state, "loop_mode",   False)
    synthetic  = getattr(app.state, "synthetic",    False)

    if stream_url:
        orchestrator.connect_stream(stream_url, loop=loop_mode, synthetic=synthetic)
    else:
        # Default: synthetic HUD demo (safe for no hardware)
        orchestrator.connect_stream("synthetic", synthetic=True)
        print("[Startup] No stream URL provided. Running synthetic demo mode.")
        print("[Startup] Use POST /camera/connect to attach a real ESP32-CAM.")

    # Set broadcast callback
    orchestrator.set_broadcast_callback(broadcast_detections)

    # Start inference loop
    orchestrator.start()

    # Start periodic WebSocket broadcast task
    asyncio.create_task(ws_broadcast_loop())
    print(f"[Startup] Server ready at http://{FASTAPI_HOST}:{FASTAPI_PORT}")
    print(f"[Startup] API docs: http://localhost:{FASTAPI_PORT}/docs")
    print(f"[Startup] WebSocket: ws://localhost:{FASTAPI_PORT}/ws\n")


@app.on_event("shutdown")
async def on_shutdown():
    if orchestrator:
        orchestrator.stop()
    print("[Shutdown] AI engine stopped.")


# ── WebSocket Endpoint ────────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint. Broadcasts live detection JSON at WS_BROADCAST_FPS Hz.

    Message format:
    {
      "type": "detection_update",
      "timestamp": <ms>,
      "detections": { ... LiveDetections ... },
      "camera": { ... CameraStatus ... }
    }
    """
    await ws_manager.connect(websocket)
    try:
        while True:
            # Keep connection alive — server pushes, client just reads
            await asyncio.sleep(30)
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)


# ── Periodic Broadcast ────────────────────────────────────────────────────────
async def ws_broadcast_loop():
    """
    Background task that broadcasts detection state to all WebSocket clients
    at WS_BROADCAST_FPS Hz (default 5 Hz).
    """
    while True:
        try:
            if orchestrator and ws_manager.client_count > 0:
                detections = orchestrator.get_latest()
                camera     = orchestrator.get_camera_status()
                payload = {
                    "type": "detection_update",
                    "timestamp": int(time.time() * 1000),
                    "detections": detections.model_dump(),
                    "camera": camera.model_dump(),
                }
                await ws_manager.broadcast(payload)
        except Exception as e:
            print(f"[WS Broadcast] Error: {e}")
        await asyncio.sleep(WS_BROADCAST_INTERVAL)


async def broadcast_detections(detections: LiveDetections, camera: CameraStatus):
    """Called by orchestrator after each frame (event-driven broadcast)."""
    try:
        payload = {
            "type": "detection_update",
            "timestamp": int(time.time() * 1000),
            "detections": detections.model_dump(),
            "camera": camera.model_dump(),
        }
        await ws_manager.broadcast(payload)
    except Exception:
        pass


# ── Register Routes ───────────────────────────────────────────────────────────
app.include_router(router)


# ── CLI Entry Point ───────────────────────────────────────────────────────────
def parse_args():
    parser = argparse.ArgumentParser(description="RescueBOT AI Inference Server")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--stream", type=str, help="ESP32-CAM MJPEG stream URL")
    group.add_argument("--webcam", type=int, help="Local webcam index (e.g. 0)")
    group.add_argument("--video",  type=str, help="Local video file path")
    group.add_argument("--synthetic", action="store_true",
                       help="Synthetic HUD demo mode (no hardware required)")
    parser.add_argument("--port",  type=int, default=FASTAPI_PORT)
    parser.add_argument("--loop", action="store_true", help="Loop video file")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()

    # Determine stream source
    if args.synthetic:
        stream_url, loop, synthetic = "synthetic", False, True
    elif args.webcam is not None:
        stream_url, loop, synthetic = str(args.webcam), False, False
    elif args.video:
        stream_url, loop, synthetic = args.video, args.loop, False
    elif args.stream:
        stream_url, loop, synthetic = args.stream, False, False
    else:
        # Interactive mode
        print("\nSelect stream source:")
        print("  [1] Live ESP32-CAM  (enter IP)")
        print("  [2] Local webcam")
        print("  [3] Video file")
        print("  [4] Synthetic demo  (no hardware)")
        choice = input("Choice [1-4, default 4]: ").strip() or "4"

        if choice == "1":
            ip = input(f"ESP32 IP [default: {ESP32_STREAM_URL}]: ").strip()
            stream_url = f"http://{ip}:81/stream" if ip else ESP32_STREAM_URL
            loop, synthetic = False, False
        elif choice == "2":
            idx = input("Webcam index [default 0]: ").strip() or "0"
            stream_url, loop, synthetic = idx, False, False
        elif choice == "3":
            path = input("Video file path: ").strip()
            stream_url, loop, synthetic = path, True, False
        else:
            stream_url, loop, synthetic = "synthetic", False, True

    # Inject into app state (read by on_startup)
    app.state.stream_url = stream_url if not synthetic else None
    app.state.loop_mode  = loop
    app.state.synthetic  = synthetic

    print(f"\n[Launch] Starting server on http://0.0.0.0:{args.port}")
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=args.port,
        log_level="info",
        reload=False,
    )
