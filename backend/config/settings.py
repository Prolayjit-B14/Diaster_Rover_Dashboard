"""
RescueBOT — Central Configuration
All tunable parameters, network settings, and AI thresholds live here.
"""
import os
from pathlib import Path

# ── Project Paths ────────────────────────────────────────────────────────────
BASE_DIR       = Path(__file__).resolve().parent.parent
SNAPSHOTS_DIR  = BASE_DIR / "snapshots" / "captures"
DATABASE_PATH  = BASE_DIR / "database" / "events.db"
MODELS_DIR     = BASE_DIR / "models" / "weights"

# Create directories on import
SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
MODELS_DIR.mkdir(parents=True, exist_ok=True)

# ── Network Settings ─────────────────────────────────────────────────────────
FASTAPI_HOST   = "0.0.0.0"
FASTAPI_PORT   = 8000

# ESP32-CAM endpoints
ESP32_DEFAULT_IP   = os.getenv("ESP32_IP", "192.168.1.100")
ESP32_STREAM_URL   = f"http://{ESP32_DEFAULT_IP}:81/stream"
ESP32_CAPTURE_URL  = f"http://{ESP32_DEFAULT_IP}/capture"
ESP32_TIMEOUT_SEC  = 10
ESP32_RETRY_DELAY  = 3     # seconds between reconnect attempts
ESP32_MAX_RETRIES  = 20

# MQTT settings (for bridge to existing dashboard MQTT)
MQTT_BROKER    = "broker.emqx.io"
MQTT_PORT      = 1883
TOPIC_ALERTS   = "ares1/Robot/alerts"
TOPIC_TELE     = "ares1/Robot/telemetry"
TOPIC_COMMAND  = "ares1/Robot/command"
TOPIC_CAMERA   = "ares1/Robot/camera"

# ── WebSocket ────────────────────────────────────────────────────────────────
WS_BROADCAST_FPS = 5          # detections broadcast rate (Hz)
WS_BROADCAST_INTERVAL = 1.0 / WS_BROADCAST_FPS

# ── Frame Processing ─────────────────────────────────────────────────────────
FRAME_WIDTH    = 640
FRAME_HEIGHT   = 480
INFERENCE_FPS  = 10           # target inference FPS (throttle above this)

# ── YOLO Model Paths / Names ─────────────────────────────────────────────────
YOLO_PERSON_MODEL   = "yolov8n.pt"         # auto-downloaded by ultralytics
YOLO_POSE_MODEL     = "yolov8n-pose.pt"    # auto-downloaded
YOLO_FIRE_MODEL     = str(MODELS_DIR / "yolov8n-fire.pt")    # custom (optional)
YOLO_SMOKE_MODEL    = str(MODELS_DIR / "yolov8n-smoke.pt")   # custom (optional)
YOLO_HAZARD_MODEL   = str(MODELS_DIR / "yolov8n-hazards.pt") # custom (optional)

# ── Detection Thresholds ─────────────────────────────────────────────────────
PERSON_CONF_THRESHOLD   = 0.50
FIRE_CONF_THRESHOLD     = 0.50
SMOKE_CONF_THRESHOLD    = 0.50
MOTION_AREA_THRESHOLD   = 1000   # minimum contour area for motion
HSV_FIRE_PIXEL_RATIO    = 0.08   # 8% flame color density to verify fire
SMOKE_LAPLACIAN_MAX     = 150.0
SMOKE_STDDEV_MAX        = 32.0
HIGH_VIS_RATIO          = 0.10   # 10% for rescuer vest detection
BLOOD_RATIO_MIN         = 1.2    # blood pixel % range
BLOOD_RATIO_MAX         = 15.0
MOTION_STATIONARY_SEC   = 8.0    # seconds before person flagged motionless

# Temporal confirmation (frames) before fire/smoke is confirmed
FIRE_CONFIRM_FRAMES     = 10
FIRE_CONFIRM_MIN_HITS   = 7
SMOKE_CONFIRM_FRAMES    = 10
SMOKE_CONFIRM_MIN_HITS  = 7

# ── Survivor Confidence Engine Weights ──────────────────────────────────────
# Must sum to 1.0
SURVIVOR_WEIGHT_PERSON   = 0.35
SURVIVOR_WEIGHT_MOTION   = 0.20
SURVIVOR_WEIGHT_GESTURE  = 0.20
SURVIVOR_WEIGHT_INJURY   = 0.15
SURVIVOR_WEIGHT_ENV_RISK = 0.10

# ── Rescue Priority Engine Weights ──────────────────────────────────────────
# Must sum to 1.0
PRIORITY_WEIGHT_INJURY     = 0.30
PRIORITY_WEIGHT_FIRE       = 0.20
PRIORITY_WEIGHT_SMOKE      = 0.15
PRIORITY_WEIGHT_SURVIVOR   = 0.15
PRIORITY_WEIGHT_GESTURE    = 0.10
PRIORITY_WEIGHT_BLOOD      = 0.10

# Priority thresholds
PRIORITY_CRITICAL_THRESHOLD = 0.75
PRIORITY_HIGH_THRESHOLD     = 0.55
PRIORITY_MEDIUM_THRESHOLD   = 0.35

# ── Alert Engine ─────────────────────────────────────────────────────────────
ALERT_COOLDOWN_SEC = 5.0          # minimum seconds between same-type alerts
MAX_ALERT_HISTORY  = 200          # max alerts kept in memory

# Snapshot trigger conditions
SNAPSHOT_ON_PERSON   = True
SNAPSHOT_ON_FIRE     = True
SNAPSHOT_ON_GESTURE  = True
SNAPSHOT_ON_CRITICAL = True
SNAPSHOT_MAX_FILES   = 100        # rotate after this many snapshots

# ── OpenCV Preprocessing ─────────────────────────────────────────────────────
CLAHE_CLIP_LIMIT    = 2.0
CLAHE_TILE_SIZE     = (8, 8)
GAMMA_VALUE         = 1.5
LOW_LIGHT_THRESHOLD = 95.0        # mean brightness below this triggers gamma
BILATERAL_D         = 5
BILATERAL_SIGMA     = 50
BG_SUBTRACTOR_HISTORY   = 120
BG_SUBTRACTOR_THRESHOLD = 45
