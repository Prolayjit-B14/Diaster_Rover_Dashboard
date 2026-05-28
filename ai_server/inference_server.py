"""
inference_server.py — RescueBOT Multi-Model AI Inference Server
================================================================
Connects to ESP32-CAM MJPEG stream, runs multi-model inference,
and publishes AI detection alerts via MQTT to the dashboard.

Detection Pipeline:
  1. Person Detection     — YOLO11n (persons, falling posture)
  2. Pose / Injury        — YOLO11n-pose (keypoints, fallen/SOS)
  3. Gesture Detection    — MediaPipe Hands (wave, raised hand, SOS)
  4. Motion Detection     — OpenCV MOG2 (proximity movement)
  5. Fire Detection       — YOLOv8n custom / HSV fallback
  6. Smoke Detection      — YOLOv8n custom / HSV fallback
  7. Blood Detection      — OpenCV HSV red-mask fallback
  8. Survivor Probability — Logic Fusion Engine (weighted formula)

MQTT Alerts → ares1/Robot/alerts
FastAPI REST → http://localhost:8000/api/*
WebSocket   → ws://localhost:8765

Run: python inference_server.py
"""

import sys
import os
import time
import pathlib
import logging
import json
import threading
import asyncio
import math
import queue
from datetime import datetime

import cv2
import numpy as np
import yaml
import paho.mqtt.client as mqtt
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# ── Paths ─────────────────────────────────────────────────────
ROOT = pathlib.Path(__file__).parent
sys.path.insert(0, str(ROOT))

# ── Logging ───────────────────────────────────────────────────
LOGS_DIR = ROOT / "models" / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOGS_DIR / f"inference_{datetime.now():%Y%m%d_%H%M%S}.log"),
    ],
)
log = logging.getLogger("InferenceServer")

# ── Config ────────────────────────────────────────────────────
with open(ROOT / "config.yaml") as f:
    CFG = yaml.safe_load(f)

MQTT_CFG   = CFG["mqtt"]
CAM_CFG    = CFG["camera"]
MODEL_CFG  = CFG["models"]
INF_CFG    = CFG["inference"]
DET_CFG    = CFG["detection"]
BLOOD_CFG  = CFG["blood"]
SERVER_CFG = CFG["server"]

DEVICE     = INF_CFG.get("device", "cpu")
TARGET_FPS = INF_CFG.get("target_fps", 10)
FRAME_INTERVAL = 1.0 / TARGET_FPS

# ── Global State ──────────────────────────────────────────────
_models      = {}
_alert_queue = queue.Queue(maxsize=100)
_frame_stats = {
    "fps": 0,
    "total_frames": 0,
    "last_frame_time": 0,
    "detections": {},
    "survivor_prob": 0.0,
}
_mqtt_client  = None
_latest_frame = None
_frame_lock   = threading.Lock()

# ═════════════════════════════════════════════════════════════
# MODEL LOADING
# ═════════════════════════════════════════════════════════════

def load_models():
    """Load all AI models at startup. Graceful fallback on failure."""
    log.info("Loading AI models...")

    # 1. Person detection — YOLO11n
    person_path = ROOT / MODEL_CFG["person"]["path"]
    if person_path.exists():
        try:
            from ultralytics import YOLO
            _models["person"] = YOLO(str(person_path))
            log.info(f"✓ Person model loaded: {person_path.name}")
        except Exception as e:
            log.error(f"✗ Person model failed: {e}")
    else:
        log.warning("Person model not found. Run: python download_models.py")

    # 2. Pose estimation — YOLO11n-pose
    pose_path = ROOT / MODEL_CFG["pose"]["path"]
    if pose_path.exists():
        try:
            from ultralytics import YOLO
            _models["pose"] = YOLO(str(pose_path))
            log.info(f"✓ Pose model loaded: {pose_path.name}")
        except Exception as e:
            log.error(f"✗ Pose model failed: {e}")

    # 3. Fire — YOLOv8n custom / HSV fallback
    fire_path = ROOT / MODEL_CFG["fire"]["path"]
    if fire_path.exists() and fire_path.stat().st_size > 100000:
        try:
            from ultralytics import YOLO
            _models["fire"] = YOLO(str(fire_path))
            log.info(f"✓ Fire model loaded: {fire_path.name}")
        except Exception as e:
            log.warning(f"Fire model load failed, using HSV: {e}")
            _models["fire"] = "hsv_fallback"
    else:
        log.warning("Fire model missing — activating HSV fallback")
        _models["fire"] = "hsv_fallback"

    # 4. Smoke — YOLOv8n custom / HSV fallback
    smoke_path = ROOT / MODEL_CFG["smoke"]["path"]
    if smoke_path.exists() and smoke_path.stat().st_size > 100000:
        try:
            from ultralytics import YOLO
            _models["smoke"] = YOLO(str(smoke_path))
            log.info(f"✓ Smoke model loaded: {smoke_path.name}")
        except Exception as e:
            log.warning(f"Smoke model load failed, using HSV: {e}")
            _models["smoke"] = "hsv_fallback"
    else:
        log.warning("Smoke model missing — activating HSV fallback")
        _models["smoke"] = "hsv_fallback"

    # 5. MediaPipe Hands (gesture / wave)
    try:
        import mediapipe as mp
        _models["mp_hands"] = mp.solutions.hands.Hands(
            static_image_mode=False,
            max_num_hands=2,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        log.info("✓ MediaPipe Hands loaded")
    except Exception as e:
        log.warning(f"MediaPipe Hands unavailable: {e}")

    # 6. MediaPipe Pose (fallback for injury)
    try:
        import mediapipe as mp
        _models["mp_pose"] = mp.solutions.pose.Pose(
            static_image_mode=False,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        log.info("✓ MediaPipe Pose loaded")
    except Exception as e:
        log.warning(f"MediaPipe Pose unavailable: {e}")

    # 7. MOG2 Motion Detector (always available via OpenCV)
    _models["motion"] = cv2.createBackgroundSubtractorMOG2(
        history=CFG["motion"]["history"],
        varThreshold=CFG["motion"]["var_threshold"],
        detectShadows=CFG["motion"]["detect_shadows"],
    )
    log.info("✓ MOG2 Motion Detector initialized")

    log.info(f"Models loaded: {[k for k in _models if _models[k] != 'hsv_fallback']}")
    log.info(f"HSV fallbacks: {[k for k, v in _models.items() if v == 'hsv_fallback']}")


# ═════════════════════════════════════════════════════════════
# DETECTION FUNCTIONS
# ═════════════════════════════════════════════════════════════

def detect_persons(frame: np.ndarray) -> list[dict]:
    """Detect persons using YOLO11n. Returns list of detection dicts."""
    model = _models.get("person")
    if model is None:
        return []
    conf_thresh = MODEL_CFG["person"]["conf_threshold"]
    try:
        results = model.predict(
            frame, verbose=False, imgsz=INF_CFG["imgsz"],
            conf=conf_thresh, classes=[0],  # class 0 = person
            device=DEVICE,
        )
        detections = []
        for r in results:
            for box in r.boxes:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                conf = float(box.conf[0])
                detections.append({
                    "x": int(x1), "y": int(y1),
                    "w": int(x2 - x1), "h": int(y2 - y1),
                    "conf": round(conf * 100, 1),
                    "class": "person",
                })
        return detections
    except Exception as e:
        log.debug(f"Person detection error: {e}")
        return []


def estimate_pose(frame: np.ndarray) -> dict:
    """
    Run YOLO11n-pose for skeletal keypoints.
    Returns posture score and posture label.
    """
    model = _models.get("pose")
    if model is None:
        return {"score": 0.6, "label": "unknown"}

    try:
        results = model.predict(
            frame, verbose=False, imgsz=INF_CFG["imgsz"],
            conf=0.4, device=DEVICE,
        )
        for r in results:
            if r.keypoints is not None and len(r.keypoints) > 0:
                kps = r.keypoints.xy[0].tolist()
                label, score = classify_posture(kps)
                return {"score": score, "label": label, "keypoints": kps}
        return {"score": 0.6, "label": "standing"}
    except Exception as e:
        log.debug(f"Pose error: {e}")
        return {"score": 0.6, "label": "unknown"}


def classify_posture(keypoints: list) -> tuple[str, float]:
    """
    Classify posture from COCO keypoints.
    Keypoint indices: 0=nose, 5/6=shoulders, 11/12=hips, 13/14=knees, 15/16=ankles
    """
    if not keypoints or len(keypoints) < 17:
        return "unknown", 0.6

    def kp(i):
        return keypoints[i] if i < len(keypoints) else [0, 0]

    try:
        nose      = kp(0)
        l_shoulder= kp(5);  r_shoulder = kp(6)
        l_hip     = kp(11); r_hip      = kp(12)
        l_knee    = kp(13); r_knee     = kp(14)
        l_wrist   = kp(9);  r_wrist    = kp(10)

        mid_shoulder_y = (l_shoulder[1] + r_shoulder[1]) / 2
        mid_hip_y      = (l_hip[1] + r_hip[1]) / 2
        mid_knee_y     = (l_knee[1] + r_knee[1]) / 2

        body_height = abs(mid_hip_y - mid_shoulder_y) + 1e-6

        # Fallen: hips close to shoulders on Y-axis (horizontal body)
        if body_height < 50 and mid_hip_y > 0:
            return "fallen", DET_CFG["posture_scores"]["fallen"]

        # Raised wrists above head (SOS wave)
        wrist_avg_y = (l_wrist[1] + r_wrist[1]) / 2
        if nose[1] > 0 and wrist_avg_y < nose[1] - 20:
            return "sos_wave", DET_CFG["posture_scores"]["sos_wave"]

        # Default standing
        return "standing", DET_CFG["posture_scores"]["standing"]

    except Exception:
        return "unknown", 0.6


def detect_gesture_wave(frame: np.ndarray) -> dict:
    """
    Detect waving hand or raised hand using MediaPipe Hands.
    Returns gesture label and confidence.
    """
    model = _models.get("mp_hands")
    if model is None:
        return {"gesture": None, "conf": 0}

    try:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = model.process(rgb)

        if not result.multi_hand_landmarks:
            return {"gesture": None, "conf": 0}

        for hand_landmarks in result.multi_hand_landmarks:
            lm = hand_landmarks.landmark
            # Wrist Y vs fingertip Y: if fingertips above wrist → raised hand
            wrist_y    = lm[0].y
            index_tip  = lm[8].y
            middle_tip = lm[12].y
            ring_tip   = lm[16].y

            fingers_up = sum([
                index_tip  < wrist_y - 0.1,
                middle_tip < wrist_y - 0.1,
                ring_tip   < wrist_y - 0.1,
            ])

            if fingers_up >= 2:
                return {"gesture": "raised_hand", "conf": 88}

        return {"gesture": "hand_detected", "conf": 72}

    except Exception as e:
        log.debug(f"Gesture error: {e}")
        return {"gesture": None, "conf": 0}


def detect_motion(frame: np.ndarray) -> dict:
    """Detect motion using OpenCV MOG2 background subtraction."""
    model = _models.get("motion")
    if model is None:
        return {"motion": False, "score": 0, "contours": 0}

    try:
        fg_mask = model.apply(frame)
        # Remove shadows (grey pixels, value 127)
        _, fg_mask = cv2.threshold(fg_mask, 200, 255, cv2.THRESH_BINARY)

        contours, _ = cv2.findContours(fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        valid = [c for c in contours if cv2.contourArea(c) > DET_CFG["motion_min_contour_area"]]

        motion_detected = len(valid) > 0
        score = min(100, len(valid) * 20) if motion_detected else 0

        return {
            "motion": motion_detected,
            "score": score,
            "contours": len(valid),
        }
    except Exception as e:
        log.debug(f"Motion error: {e}")
        return {"motion": False, "score": 0, "contours": 0}


def detect_fire_hsv(frame: np.ndarray) -> dict:
    """HSV-based fire detection fallback (orange/yellow combustion tones)."""
    try:
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        # Fire: H=0-30 (red-orange-yellow), S=120+, V=100+
        lower1 = np.array([0,   120, 100])
        upper1 = np.array([30,  255, 255])
        lower2 = np.array([160, 120, 100])  # wrap-around red
        upper2 = np.array([180, 255, 255])

        mask1 = cv2.inRange(hsv, lower1, upper1)
        mask2 = cv2.inRange(hsv, lower2, upper2)
        mask  = cv2.bitwise_or(mask1, mask2)

        fire_px = cv2.countNonZero(mask)
        total   = frame.shape[0] * frame.shape[1]
        ratio   = fire_px / total

        detected = ratio > 0.02  # >2% of frame = fire present
        conf = min(95, int(ratio * 1000)) if detected else 0
        return {"fire": detected, "conf": conf, "method": "hsv"}
    except Exception as e:
        return {"fire": False, "conf": 0, "method": "hsv_error"}


def detect_fire(frame: np.ndarray) -> dict:
    """Fire detection: YOLO model or HSV fallback."""
    model = _models.get("fire")
    if model == "hsv_fallback" or model is None:
        return detect_fire_hsv(frame)
    try:
        conf_thresh = MODEL_CFG["fire"]["conf_threshold"]
        results = model.predict(frame, verbose=False, imgsz=INF_CFG["imgsz"],
                                conf=conf_thresh, device=DEVICE)
        for r in results:
            if len(r.boxes) > 0:
                max_conf = float(max(b.conf[0] for b in r.boxes))
                return {"fire": True, "conf": round(max_conf * 100, 1), "method": "yolo"}
        return {"fire": False, "conf": 0, "method": "yolo"}
    except Exception as e:
        log.debug(f"Fire YOLO error: {e}. Using HSV fallback.")
        return detect_fire_hsv(frame)


def detect_smoke_hsv(frame: np.ndarray) -> dict:
    """HSV-based smoke detection (grey/white plumes)."""
    try:
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        # Smoke: low saturation (grey), medium-high brightness
        lower = np.array([0,   0,   120])
        upper = np.array([180, 60,  240])
        mask  = cv2.inRange(hsv, lower, upper)

        # Require connected region (smoke is diffuse)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        mask   = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

        smoke_px = cv2.countNonZero(mask)
        total    = frame.shape[0] * frame.shape[1]
        ratio    = smoke_px / total

        detected = ratio > 0.08  # >8% of frame = smoke
        conf = min(90, int(ratio * 300)) if detected else 0
        return {"smoke": detected, "conf": conf, "method": "hsv"}
    except Exception as e:
        return {"smoke": False, "conf": 0, "method": "hsv_error"}


def detect_smoke(frame: np.ndarray) -> dict:
    """Smoke detection: YOLO model or HSV fallback."""
    model = _models.get("smoke")
    if model == "hsv_fallback" or model is None:
        return detect_smoke_hsv(frame)
    try:
        conf_thresh = MODEL_CFG["smoke"]["conf_threshold"]
        results = model.predict(frame, verbose=False, imgsz=INF_CFG["imgsz"],
                                conf=conf_thresh, device=DEVICE)
        for r in results:
            if len(r.boxes) > 0:
                max_conf = float(max(b.conf[0] for b in r.boxes))
                return {"smoke": True, "conf": round(max_conf * 100, 1), "method": "yolo"}
        return {"smoke": False, "conf": 0, "method": "yolo"}
    except Exception as e:
        log.debug(f"Smoke YOLO error: {e}. Using HSV fallback.")
        return detect_smoke_hsv(frame)


def detect_blood_hsv(frame: np.ndarray) -> dict:
    """
    HSV red-mask blood detection.
    Limitation: ~70% precision. False positives in red-lit environments.
    """
    try:
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        lower = np.array(BLOOD_CFG["hsv_lower"])
        upper = np.array(BLOOD_CFG["hsv_upper"])
        mask  = cv2.inRange(hsv, lower, upper)

        blood_px = cv2.countNonZero(mask)
        detected = blood_px > BLOOD_CFG["min_area_px2"]
        conf = min(70, int(blood_px / 50)) if detected else 0
        return {"blood": detected, "conf": conf, "method": "hsv", "pixels": blood_px}
    except Exception as e:
        return {"blood": False, "conf": 0, "method": "hsv_error"}


# ═════════════════════════════════════════════════════════════
# SURVIVOR PROBABILITY FUSION ENGINE
# ═════════════════════════════════════════════════════════════

def compute_survivor_probability(
    persons: list,
    motion: dict,
    pose: dict,
    sensor_score: float = 0.5,
) -> float:
    """
    P_survivor = 0.4(H) + 0.25(M) + 0.20(P) + 0.15(T)
    H = human detection confidence (0-1)
    M = motion score (0-1)
    P = posture score (0-1)
    T = sensor telemetry score (0-1)
    """
    fw = DET_CFG["fusion"]
    H = (persons[0]["conf"] / 100) if persons else 0.0
    M = motion["score"] / 100 if motion["motion"] else 0.0
    P = pose.get("score", 0.6) if persons else 0.0
    T = sensor_score

    prob = (fw["human_weight"] * H +
            fw["motion_weight"] * M +
            fw["posture_weight"] * P +
            fw["sensor_weight"] * T)

    return round(min(1.0, prob), 3)


# ═════════════════════════════════════════════════════════════
# MQTT
# ═════════════════════════════════════════════════════════════

def setup_mqtt() -> mqtt.Client:
    """Initialize and connect MQTT client."""
    client = mqtt.Client(client_id=MQTT_CFG["client_id"])
    if MQTT_CFG.get("username"):
        client.username_pw_set(MQTT_CFG["username"], MQTT_CFG["password"])

    def on_connect(c, u, f, rc):
        if rc == 0:
            log.info(f"✓ MQTT connected to {MQTT_CFG['broker']}")
            # Subscribe to telemetry for sensor fusion
            c.subscribe(MQTT_CFG["topics"]["telemetry"])
            c.subscribe(MQTT_CFG["topics"]["gps"])
        else:
            log.warning(f"MQTT connect failed: rc={rc}")

    def on_message(c, u, msg):
        try:
            data = json.loads(msg.payload.decode())
            # Update sensor score from gas/vibration telemetry
            if "gas" in data or "vibration" in data:
                gas = data.get("gas", 0)
                vib = data.get("vibration", 0)
                sensor_score = min(1.0, 0.3 + (vib * 0.15) + (gas / 4095 * 0.35))
                _frame_stats["sensor_score"] = sensor_score
        except Exception:
            pass

    client.on_connect = on_connect
    client.on_message = on_message

    try:
        client.connect(MQTT_CFG["broker"], MQTT_CFG["port"], keepalive=60)
        client.loop_start()
    except Exception as e:
        log.error(f"MQTT connection failed: {e}")
        log.warning("Running without MQTT — alerts will not reach dashboard")

    return client


def publish_alert(client: mqtt.Client, label: str, conf: float,
                  desc: str = "", extra: dict = None):
    """Publish a detection alert to the MQTT alerts topic."""
    if client is None:
        return
    payload = {
        "label": label,
        "conf": conf,
        "desc": desc,
        "timestamp": datetime.now().isoformat(),
        **(extra or {}),
    }
    try:
        client.publish(MQTT_CFG["topics"]["alerts"], json.dumps(payload), qos=0)
        log.info(f"ALERT → {label} ({conf}%) — {desc}")
    except Exception as e:
        log.debug(f"MQTT publish error: {e}")


# ═════════════════════════════════════════════════════════════
# FASTAPI REST SERVER
# ═════════════════════════════════════════════════════════════

app = FastAPI(title="RescueBOT AI Server", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=SERVER_CFG["cors_origins"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/status")
def api_status():
    return {
        "status": "online",
        "models": list(_models.keys()),
        "fps": _frame_stats["fps"],
        "total_frames": _frame_stats["total_frames"],
        "survivor_prob": _frame_stats.get("survivor_prob", 0),
        "device": DEVICE,
    }

@app.get("/api/detections")
def api_detections():
    return _frame_stats.get("detections", {})

@app.get("/api/models")
def api_models():
    reg_path = ROOT / "models" / "model_registry.json"
    if reg_path.exists():
        with open(reg_path) as f:
            return json.load(f)
    return {}

@app.get("/api/health")
def api_health():
    return {"ok": True, "timestamp": datetime.now().isoformat()}


# ═════════════════════════════════════════════════════════════
# MAIN INFERENCE LOOP
# ═════════════════════════════════════════════════════════════

def inference_loop(mqtt_client: mqtt.Client):
    """Main video capture + multi-model inference loop."""
    esp_ip   = CAM_CFG["esp32_ip"]
    stream_url = CAM_CFG["stream_url"].replace("{ip}", esp_ip)

    log.info(f"Connecting to ESP32-CAM: {stream_url}")
    cap = None

    last_alert = {}     # Throttle repeated alerts
    alert_cooldown = 3  # seconds between same-type alerts

    frame_times = []
    _frame_stats["sensor_score"] = 0.5

    while True:
        # ── (Re)connect to stream ─────────────────────────────
        if cap is None or not cap.isOpened():
            log.info(f"Connecting to {stream_url}...")
            cap = cv2.VideoCapture(stream_url)
            if not cap.isOpened():
                log.warning(f"Cannot open stream. Retrying in 5s...")
                time.sleep(5)
                continue
            log.info("✓ Stream connected!")

        # ── Capture frame ─────────────────────────────────────
        ret, frame = cap.read()
        if not ret or frame is None:
            log.warning("Frame grab failed — reconnecting...")
            cap.release()
            cap = None
            time.sleep(2)
            continue

        t_start = time.perf_counter()

        # Cache frame for REST API
        with _frame_lock:
            _latest_frame = frame.copy()

        _frame_stats["total_frames"] += 1

        # ── Run all detections ────────────────────────────────
        persons = detect_persons(frame)
        motion  = detect_motion(frame)
        pose    = estimate_pose(frame) if persons else {"score": 0.6, "label": "none"}
        gesture = detect_gesture_wave(frame)
        fire    = detect_fire(frame)
        smoke   = detect_smoke(frame)
        blood   = detect_blood_hsv(frame)

        sensor_score = _frame_stats.get("sensor_score", 0.5)

        # ── Survivor Probability ──────────────────────────────
        surv_prob = compute_survivor_probability(
            persons, motion, pose, sensor_score
        )
        _frame_stats["survivor_prob"] = surv_prob
        _frame_stats["detections"] = {
            "persons": persons,
            "motion":  motion,
            "pose":    pose,
            "gesture": gesture,
            "fire":    fire,
            "smoke":   smoke,
            "blood":   blood,
            "survivor_prob": surv_prob,
        }

        now = time.time()

        def should_alert(key: str) -> bool:
            return now - last_alert.get(key, 0) > alert_cooldown

        # ── Publish MQTT Alerts ───────────────────────────────
        if persons and should_alert("human"):
            best = max(persons, key=lambda p: p["conf"])
            posture_label = pose.get("label", "standing")
            desc = (f"AI confirms human presence. Posture: {posture_label}. "
                    f"Survivor probability: {surv_prob*100:.0f}%")
            publish_alert(
                mqtt_client, "HUMAN", best["conf"], desc,
                {
                    "x": best["x"], "y": best["y"],
                    "w": best["w"], "h": best["h"],
                    "posture": posture_label,
                    "survivor_prob": surv_prob,
                }
            )
            last_alert["human"] = now

        if fire["fire"] and should_alert("fire"):
            publish_alert(mqtt_client, "FIRE", fire["conf"],
                          f"Fire detected via {fire['method'].upper()}",
                          {"method": fire["method"]})
            last_alert["fire"] = now

        if smoke["smoke"] and should_alert("smoke"):
            publish_alert(mqtt_client, "SMOKE", smoke["conf"],
                          f"Smoke plume detected via {smoke['method'].upper()}")
            last_alert["smoke"] = now

        if motion["motion"] and not persons and should_alert("motion"):
            publish_alert(mqtt_client, "MOTION", motion["score"],
                          f"Proximity motion detected ({motion['contours']} contours)")
            last_alert["motion"] = now

        if gesture["gesture"] and should_alert("gesture"):
            publish_alert(mqtt_client, "GESTURE", gesture["conf"],
                          f"Hand gesture: {gesture['gesture']}")
            last_alert["gesture"] = now

        # ── FPS tracking ──────────────────────────────────────
        t_end = time.perf_counter()
        elapsed = t_end - t_start
        frame_times.append(elapsed)
        if len(frame_times) > 30:
            frame_times.pop(0)
        avg_elapsed = sum(frame_times) / len(frame_times)
        _frame_stats["fps"] = round(1.0 / avg_elapsed, 1) if avg_elapsed > 0 else 0

        # ── Throttle to target FPS ────────────────────────────
        sleep_time = FRAME_INTERVAL - elapsed
        if sleep_time > 0:
            time.sleep(sleep_time)


# ═════════════════════════════════════════════════════════════
# ENTRY POINT
# ═════════════════════════════════════════════════════════════

def main():
    log.info("="*60)
    log.info("  RescueBOT AI Inference Server v2.0.0")
    log.info(f"  Device: {DEVICE} | Target FPS: {TARGET_FPS}")
    log.info("="*60)

    # Load models
    load_models()

    # Setup MQTT
    mqtt_client = setup_mqtt()
    global _mqtt_client
    _mqtt_client = mqtt_client

    # Start inference loop in background thread
    inf_thread = threading.Thread(
        target=inference_loop,
        args=(mqtt_client,),
        daemon=True,
        name="InferenceLoop",
    )
    inf_thread.start()
    log.info("✓ Inference loop started")

    # Start FastAPI server (blocks)
    log.info(f"✓ API server: http://localhost:{SERVER_CFG['api_port']}")
    log.info(f"  Endpoints: /api/status  /api/detections  /api/models  /api/health")
    uvicorn.run(
        app,
        host=SERVER_CFG["host"],
        port=SERVER_CFG["api_port"],
        log_level="warning",
    )


if __name__ == "__main__":
    main()
