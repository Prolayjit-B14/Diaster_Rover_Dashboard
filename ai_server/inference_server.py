"""
inference_server.py — RescueBOT 7-Stage Survivor Intelligence Server
=====================================================================
Stage 1 : Input Layer          — ESP32-CAM MJPEG capture + pre-process
Stage 2 : Core AI Models       — Fire/Smoke, Human, Pose, Motion, Environment, Face
Stage 3 : Fusion Engine        — Per-frame scene understanding
Stage 4 : Survivor Intelligence— Per-person scored status classification
Stage 5 : Priority Ranker      — CRITICAL / HIGH / MEDIUM / LOW
Stage 6 : First Aid Tagger     — IMMEDIATE / MEDIUM / LOW / VERIFY
Stage 7 : Output Layer         — Structured JSON → MQTT + REST API

MQTT Topics:
  ares1/Robot/alerts    → Full scene_update payload (survivors[], scene_summary)
  ares1/Robot/telemetry → Sensor fusion input
  ares1/Robot/gps       → GPS data
FastAPI REST → http://localhost:8000/api/*

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
from collections import deque

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

# ── Survivor Intelligence Weights ─────────────────────────────
SI_WEIGHTS = {
    "human_conf":    0.25,
    "motion_score":  0.20,
    "gesture_score": 0.20,
    "posture_score": 0.20,
    "env_danger":    0.15,
}

# Survivor status thresholds
SI_THRESHOLDS = {
    "active":       0.75,
    "low_activity": 0.50,
    "unconscious":  0.25,
}

# Stationary frames before "trapped" suspicion
STATIONARY_FRAME_THRESHOLD = 15

# ── Global State ──────────────────────────────────────────────
_models       = {}
_alert_queue  = queue.Queue(maxsize=100)
_frame_stats  = {
    "fps": 0,
    "total_frames": 0,
    "last_frame_time": 0,
    "detections": {},
    "scene_summary": {},
    "survivors": [],
    "rescue_list": [],
}
_mqtt_client    = None
_latest_frame   = None
_frame_lock     = threading.Lock()

# Per-person tracking across frames: {person_id: deque of recent bboxes}
_person_tracks  = {}
_person_lost_frames = {}
_person_id_seq  = 0
_prev_fire_mask = None   # For fire spread estimation


# ═════════════════════════════════════════════════════════════
# MODEL LOADING
# ═════════════════════════════════════════════════════════════

def load_models():
    """Load all AI models at startup. Graceful fallback on failure."""
    log.info("Loading AI models...")

    # 1. Person detection — YOLO11n (kept for fallback)
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
# STAGE 2A — FIRE & SMOKE MODEL
# ═════════════════════════════════════════════════════════════

def detect_fire_hsv(frame: np.ndarray) -> dict:
    """HSV-based fire detection fallback (orange/yellow combustion tones)."""
    try:
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        lower1 = np.array([0,   120, 100])
        upper1 = np.array([30,  255, 255])
        lower2 = np.array([160, 120, 100])
        upper2 = np.array([180, 255, 255])
        mask1 = cv2.inRange(hsv, lower1, upper1)
        mask2 = cv2.inRange(hsv, lower2, upper2)
        mask  = cv2.bitwise_or(mask1, mask2)

        fire_px = cv2.countNonZero(mask)
        total   = frame.shape[0] * frame.shape[1]
        ratio   = fire_px / total

        detected = ratio > 0.02
        conf = min(95, int(ratio * 1000)) if detected else 0

        # Compute fire bounding box
        bbox = None
        if detected:
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if contours:
                largest = max(contours, key=cv2.contourArea)
                x, y, w, h = cv2.boundingRect(largest)
                bbox = {"x": x, "y": y, "w": w, "h": h}

        return {
            "fire": detected, "conf": conf, "method": "hsv",
            "bbox": bbox, "mask": mask,
        }
    except Exception:
        return {"fire": False, "conf": 0, "method": "hsv_error", "bbox": None, "mask": None}


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
                best = max(r.boxes, key=lambda b: float(b.conf[0]))
                max_conf = float(best.conf[0])
                x1, y1, x2, y2 = best.xyxy[0].tolist()
                bbox = {"x": int(x1), "y": int(y1), "w": int(x2 - x1), "h": int(y2 - y1)}
                return {"fire": True, "conf": round(max_conf * 100, 1), "method": "yolo",
                        "bbox": bbox, "mask": None}
        return {"fire": False, "conf": 0, "method": "yolo", "bbox": None, "mask": None}
    except Exception as e:
        log.debug(f"Fire YOLO error: {e}. Using HSV fallback.")
        return detect_fire_hsv(frame)


def compute_fire_spread_risk(frame: np.ndarray, fire_result: dict) -> str:
    """
    Estimate fire spread risk by comparing current fire mask size vs previous frame.
    Returns: LOW / MEDIUM / HIGH
    """
    global _prev_fire_mask
    if not fire_result["fire"]:
        _prev_fire_mask = None
        return "NONE"

    current_mask = fire_result.get("mask")
    if current_mask is None:
        # Build mask from bbox if YOLO mode
        bbox = fire_result.get("bbox")
        if bbox:
            current_mask = np.zeros(frame.shape[:2], dtype=np.uint8)
            cv2.rectangle(current_mask,
                          (bbox["x"], bbox["y"]),
                          (bbox["x"] + bbox["w"], bbox["y"] + bbox["h"]),
                          255, -1)

    if current_mask is None:
        _prev_fire_mask = None
        return "LOW"

    current_area = cv2.countNonZero(current_mask)

    if _prev_fire_mask is not None:
        prev_area = cv2.countNonZero(_prev_fire_mask)
        if prev_area > 0:
            expansion = (current_area - prev_area) / prev_area
            if expansion > 0.15:
                spread = "HIGH"
            elif expansion > 0.05:
                spread = "MEDIUM"
            else:
                spread = "LOW"
        else:
            spread = "MEDIUM"
    else:
        spread = "LOW"

    _prev_fire_mask = current_mask.copy()
    return spread


def detect_smoke_hsv(frame: np.ndarray) -> dict:
    """HSV-based smoke detection with density classification."""
    try:
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        # Grey/white smoke
        lower = np.array([0,   0,  100])
        upper = np.array([180, 60, 240])
        mask  = cv2.inRange(hsv, lower, upper)

        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        mask   = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

        smoke_px = cv2.countNonZero(mask)
        total    = frame.shape[0] * frame.shape[1]
        ratio    = smoke_px / total

        detected = ratio > 0.08
        conf = min(90, int(ratio * 300)) if detected else 0

        # Smoke density classification
        if ratio > 0.40:
            density = "opaque"   # very thick / life-threatening
        elif ratio > 0.20:
            density = "thick"    # severe
        elif ratio > 0.08:
            density = "thin"     # translucent
        else:
            density = "clear"

        # Dark/black smoke = toxic suspicion (check V channel in masked area)
        toxic_suspicion = False
        if detected:
            # Dark smoke: low V value but present
            dark_lower = np.array([0, 0, 20])
            dark_upper = np.array([180, 80, 80])
            dark_mask  = cv2.inRange(hsv, dark_lower, dark_upper)
            dark_px    = cv2.countNonZero(dark_mask)
            dark_ratio = dark_px / total
            toxic_suspicion = dark_ratio > 0.03

        # Visibility reduction estimate
        visibility_pct = max(0, int(100 - ratio * 200))

        bbox = None
        if detected:
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if contours:
                largest = max(contours, key=cv2.contourArea)
                x, y, w, h = cv2.boundingRect(largest)
                bbox = {"x": x, "y": y, "w": w, "h": h}

        return {
            "smoke": detected, "conf": conf, "method": "hsv",
            "density": density, "visibility_pct": visibility_pct,
            "toxic_suspicion": toxic_suspicion, "bbox": bbox,
        }
    except Exception:
        return {
            "smoke": False, "conf": 0, "method": "hsv_error",
            "density": "clear", "visibility_pct": 100,
            "toxic_suspicion": False, "bbox": None,
        }


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
                return {
                    "smoke": True, "conf": round(max_conf * 100, 1), "method": "yolo",
                    "density": "thick", "visibility_pct": 40,
                    "toxic_suspicion": False, "bbox": None,
                }
        return {
            "smoke": False, "conf": 0, "method": "yolo",
            "density": "clear", "visibility_pct": 100,
            "toxic_suspicion": False, "bbox": None,
        }
    except Exception as e:
        log.debug(f"Smoke YOLO error: {e}. Using HSV fallback.")
        return detect_smoke_hsv(frame)


# ═════════════════════════════════════════════════════════════
# STAGE 2B — HUMAN & FACE DETECTION WITH PREPROCESSING & SMOOTHING
# ═════════════════════════════════════════════════════════════

# Global Bounding Box Smoothing states
_smoothed_person_boxes = {}
_smoothed_face_boxes = {}

def preprocess_frame_if_needed(frame: np.ndarray) -> np.ndarray:
    """
    Lightweight, fast preprocessing for low-light, blurry, or low-contrast frames.
    Maintains high FPS while boosting detection accuracy.
    """
    try:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        mean_brightness = gray.mean()
        std_contrast = gray.std()
        
        processed = frame.copy()
        
        # 1. Low light enhancement (if mean brightness < 80)
        if mean_brightness < 80:
            yuv = cv2.cvtColor(processed, cv2.COLOR_BGR2YUV)
            clahe = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(8, 8))
            yuv[:, :, 0] = clahe.apply(yuv[:, :, 0])
            processed = cv2.cvtColor(yuv, cv2.COLOR_YUV2BGR)
        # 2. Low contrast enhancement (if standard deviation < 45 and not extremely dark)
        elif std_contrast < 45:
            yuv = cv2.cvtColor(processed, cv2.COLOR_BGR2YUV)
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            yuv[:, :, 0] = clahe.apply(yuv[:, :, 0])
            processed = cv2.cvtColor(yuv, cv2.COLOR_YUV2BGR)
            
        # 3. Noise reduction / Sharpening
        if mean_brightness < 60:
            # Low-light denoise
            processed = cv2.GaussianBlur(processed, (3, 3), 0)
        elif std_contrast < 35:
            # Mild unsharp mask to fix blurriness
            blurred = cv2.GaussianBlur(processed, (3, 3), 0)
            processed = cv2.addWeighted(processed, 1.3, blurred, -0.3, 0)
            
        return processed
    except Exception as e:
        log.debug(f"Preprocessing error: {e}")
        return frame

def get_face_box_from_keypoints(kps: list, kps_conf: list, person_box: dict, frame_w: int, frame_h: int) -> dict:
    """
    Computes a face bounding box directly from the first 5 facial keypoints of YOLO11n-pose
    (Nose, Left/Right Eye, Left/Right Ear). Falls back gracefully and scales relative to the
    person's bounding box if only the nose is visible.
    """
    try:
        if not kps or len(kps) < 5:
            return None

        # Filter the first 5 keypoints: Nose(0), L_Eye(1), R_Eye(2), L_Ear(3), R_Ear(4)
        valid_kps = []
        valid_idx = []
        for idx in range(5):
            x, y = kps[idx]
            conf = kps_conf[idx] if idx < len(kps_conf) else 1.0
            if x > 0 and y > 0 and conf > 0.35:
                valid_kps.append((x, y, conf))
                valid_idx.append(idx)

        if not valid_kps:
            return None

        p_w, p_h = person_box["w"], person_box["h"]
        kp_points = {idx: kps[idx] for idx in valid_idx}
        
        def dist(p1, p2):
            return math.sqrt((p1[0] - p2[0])**2 + (p1[1] - p2[1])**2)

        has_nose = 0 in valid_idx
        has_l_eye = 1 in valid_idx
        has_r_eye = 2 in valid_idx
        has_l_ear = 3 in valid_idx
        has_r_ear = 4 in valid_idx

        # Compute face width, and centers (cx, cy)
        if has_l_ear and has_r_ear:
            face_w = dist(kp_points[3], kp_points[4]) * 1.1
            cx = (kp_points[3][0] + kp_points[4][0]) / 2
            cy = (kp_points[3][1] + kp_points[4][1]) / 2 + face_w * 0.1
        elif has_l_eye and has_r_eye:
            face_w = dist(kp_points[1], kp_points[2]) * 2.0
            cx = (kp_points[1][0] + kp_points[2][0]) / 2
            cy = (kp_points[1][1] + kp_points[2][1]) / 2 + face_w * 0.1
        elif has_nose and has_l_ear:
            face_w = dist(kp_points[0], kp_points[3]) * 2.0
            cx = kp_points[0][0]
            cy = kp_points[0][1]
        elif has_nose and has_r_ear:
            face_w = dist(kp_points[0], kp_points[4]) * 2.0
            cx = kp_points[0][0]
            cy = kp_points[0][1]
        elif has_nose and has_l_eye:
            face_w = dist(kp_points[0], kp_points[1]) * 3.0
            cx = kp_points[0][0]
            cy = kp_points[0][1]
        elif has_nose and has_r_eye:
            face_w = dist(kp_points[0], kp_points[2]) * 3.0
            cx = kp_points[0][0]
            cy = kp_points[0][1]
        elif has_nose:
            face_w = p_w * 0.35
            cx = kp_points[0][0]
            cy = kp_points[0][1]
        else:
            xs = [pt[0] for pt in valid_kps]
            ys = [pt[1] for pt in valid_kps]
            cx = sum(xs) / len(xs)
            cy = sum(ys) / len(ys)
            face_w = p_w * 0.35

        # Face height/width ratio is typically ~1.2 - 1.3
        face_h = face_w * 1.25

        # Keep face dimensions bounded within reasonable proportions of the person's box
        face_w = max(min(face_w, p_w * 0.6), p_w * 0.15)
        face_h = max(min(face_h, p_h * 0.25), p_h * 0.05)

        # Position box so it surrounds the head (shift cy upward slightly)
        face_x = int(cx - face_w / 2)
        face_y = int(cy - face_h * 0.55)
        face_w = int(face_w)
        face_h = int(face_h)

        # Clip box to frame boundary
        face_x = max(0, min(face_x, frame_w - face_w))
        face_y = max(0, min(face_y, frame_h - face_h))

        # Calculate average confidence of the visible keypoints
        conf_sum = sum(pt[2] for pt in valid_kps)
        conf = int((conf_sum / len(valid_kps)) * 100)
        conf = max(30, min(99, conf))

        return {
            "x": face_x,
            "y": face_y,
            "w": face_w,
            "h": face_h,
            "conf": conf
        }
    except Exception as e:
        log.debug(f"get_face_box_from_keypoints error: {e}")
    return None

def dynamic_alpha(raw_val: float, smooth_val: float, base_alpha: float = 0.25, max_alpha: float = 0.7, threshold: float = 15.0) -> float:
    """Dynamically scales the smoothing factor based on box movement speed to cut jitter while maintaining responsiveness."""
    diff = abs(raw_val - smooth_val)
    if diff < 1.5:
        return 0.05  # Lock box when position change is negligible
    elif diff > threshold:
        return max_alpha  # Snap instantly to fast movements
    else:
        # Linear interpolation
        return base_alpha + (max_alpha - base_alpha) * ((diff - 1.5) / (threshold - 1.5))

def smooth_bbox(person_id: int, raw_box: dict, smoothed_boxes_dict: dict, is_face: bool = False) -> dict:
    """Applies Exponential Moving Average (EMA) smoothing to bounding box coordinates."""
    if person_id not in smoothed_boxes_dict:
        smoothed_boxes_dict[person_id] = {k: float(v) for k, v in raw_box.items()}
        return raw_box
        
    smoothed = smoothed_boxes_dict[person_id]
    
    pos_base_alpha = 0.12 if is_face else 0.20
    size_base_alpha = 0.08 if is_face else 0.15
    
    pos_max_alpha = 0.55 if is_face else 0.70
    size_max_alpha = 0.45 if is_face else 0.60
    
    pos_threshold = 10.0 if is_face else 18.0
    size_threshold = 8.0 if is_face else 14.0
    
    new_box = {}
    for k in ["x", "y"]:
        raw_val = float(raw_box[k])
        smooth_val = smoothed[k]
        alpha = dynamic_alpha(raw_val, smooth_val, pos_base_alpha, pos_max_alpha, pos_threshold)
        smoothed[k] = alpha * raw_val + (1.0 - alpha) * smooth_val
        new_box[k] = int(round(smoothed[k]))
        
    for k in ["w", "h"]:
        raw_val = float(raw_box[k])
        smooth_val = smoothed[k]
        alpha = dynamic_alpha(raw_val, smooth_val, size_base_alpha, size_max_alpha, size_threshold)
        smoothed[k] = alpha * raw_val + (1.0 - alpha) * smooth_val
        new_box[k] = int(round(smoothed[k]))
        
    if "conf" in raw_box:
        new_box["conf"] = raw_box["conf"]
        
    return new_box

def detect_persons_and_poses(frame: np.ndarray) -> tuple[list[dict], list[dict], list[dict]]:
    """
    Unified detector. Runs YOLO11n-pose once on the frame to detect persons, poses, and faces.
    Cuts CPU requirements in half by avoiding dual YOLO passes.
    """
    model = _models.get("pose")
    if model is None:
        model = _models.get("person")
        if model is None:
            return [], [], []
            
    try:
        # Calculate mean brightness of the frame to adjust conf_threshold adaptively
        try:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            mean_brightness = gray.mean()
        except Exception:
            mean_brightness = 100.0  # Fallback

        # Adaptive confidence threshold: 0.50–0.75 based on brightness
        if mean_brightness < 60:
            conf_thresh = 0.50
        elif mean_brightness > 140:
            conf_thresh = 0.75
        else:
            pct = (mean_brightness - 60) / 80.0
            conf_thresh = 0.50 + pct * 0.25

        iou_thresh = MODEL_CFG["pose"].get("iou_threshold", 0.45) if "pose" in _models else MODEL_CFG["person"].get("iou_threshold", 0.45)
        # Bounded between 0.45 and 0.60
        iou_thresh = max(0.45, min(0.60, iou_thresh))

        imgsz = CFG["inference"].get("imgsz", 480)
        results = model.predict(
            frame, verbose=False, imgsz=imgsz,
            conf=conf_thresh, iou=iou_thresh, device=DEVICE
        )
        
        persons = []
        poses = []
        faces = []
        
        for r in results:
            boxes = r.boxes
            keypoints_obj = getattr(r, 'keypoints', None)
            
            if boxes is None:
                continue
                
            for i, box in enumerate(boxes):
                # Ensure box corresponds to person class (0)
                cls_id = int(box.cls[0]) if box.cls is not None else 0
                if cls_id != 0:
                    continue
                    
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                w = x2 - x1
                h = y2 - y1
                conf = float(box.conf[0])
                
                aspect_ratio = w / (h + 1e-6)
                fallen = aspect_ratio > 1.2
                
                person_dict = {
                    "x": int(x1), "y": int(y1),
                    "w": int(w), "h": int(h),
                    "conf": round(conf * 100, 1),
                    "class": "person",
                    "fallen": fallen,
                    "cx": int(x1 + w / 2),
                    "cy": int(y1 + h / 2),
                }
                
                pose_dict = {"score": 0.6, "label": "standing", "sos": False, "injury": False, "unconscious": False}
                face_dict = None
                
                if keypoints_obj is not None and i < len(keypoints_obj.xy):
                    kps = keypoints_obj.xy[i].tolist()
                    kps_conf = keypoints_obj.conf[i].tolist() if (keypoints_obj.conf is not None and i < len(keypoints_obj.conf)) else [1.0] * 17
                    label, score, flags = classify_posture(kps)
                    pose_dict = {
                        "score": score, "label": label,
                        "sos": flags.get("sos", False),
                        "injury": flags.get("injury", False),
                        "unconscious": flags.get("unconscious", False),
                        "keypoints": kps
                    }
                    fh_img, fw_img = frame.shape[:2]
                    face_dict = get_face_box_from_keypoints(kps, kps_conf, person_dict, fw_img, fh_img)
                
                persons.append(person_dict)
                poses.append(pose_dict)
                faces.append(face_dict)
                
        return persons, poses, faces
    except Exception as e:
        log.error(f"Unified person and pose detection error: {e}")
        return [], [], []


def assign_person_ids(persons: list[dict]) -> list[dict]:
    """
    Centroid & IoU-based tracking with lost-frame grace period:
    assigns stable IDs to persons across frames and applies EMA smoothing.
    """
    global _person_id_seq, _person_lost_frames
    if not persons:
        # Increment lost frames for all active tracks
        to_delete = []
        for pid in list(_person_tracks.keys()):
            _person_lost_frames[pid] = _person_lost_frames.get(pid, 0) + 1
            if _person_lost_frames[pid] > 15:
                to_delete.append(pid)
        for pid in to_delete:
            _person_tracks.pop(pid, None)
            _person_lost_frames.pop(pid, None)
            _smoothed_person_boxes.pop(pid, None)
            _smoothed_face_boxes.pop(pid, None)
        return []

    matched = set()
    for person in persons:
        best_iou = 0.0
        best_id  = None

        for pid, track in _person_tracks.items():
            if pid in matched:
                continue
            if not track:
                continue
            prev = track[-1]
            iou  = _bbox_iou(person, prev)
            if iou > best_iou:
                best_iou = iou
                best_id  = pid

        if best_iou > 0.25 and best_id is not None:
            person["id"] = best_id
            track = _person_tracks[best_id]
            track.append({"x": person["x"], "y": person["y"],
                          "w": person["w"], "h": person["h"]})
            if len(track) > 30:
                track.popleft()
            _person_lost_frames[best_id] = 0  # Reset lost frames
            matched.add(best_id)
        else:
            _person_id_seq += 1
            pid = _person_id_seq
            person["id"] = pid
            _person_tracks[pid] = deque(
                [{"x": person["x"], "y": person["y"],
                  "w": person["w"], "h": person["h"]}],
                maxlen=30
            )
            _person_lost_frames[pid] = 0
            matched.add(pid)

        # ── Bounding Box Temporal Smoothing ──────────────────────
        pid = person["id"]
        
        # Smooth person box
        raw_person_box = {"x": person["x"], "y": person["y"], "w": person["w"], "h": person["h"]}
        smoothed_person = smooth_bbox(pid, raw_person_box, _smoothed_person_boxes, is_face=False)
        person["x"] = smoothed_person["x"]
        person["y"] = smoothed_person["y"]
        person["w"] = smoothed_person["w"]
        person["h"] = smoothed_person["h"]
        person["cx"] = int(person["x"] + person["w"] / 2)
        person["cy"] = int(person["y"] + person["h"] / 2)
        
        # Smooth face box if present
        if "face" in person and person["face"] is not None:
            raw_face_box = person["face"]
            smoothed_face = smooth_bbox(pid, raw_face_box, _smoothed_face_boxes, is_face=True)
            person["face"] = smoothed_face
            
        # Check track stability (must be seen for at least 3 frames)
        person["stable"] = len(_person_tracks[pid]) >= 3

    # Update lost frames for unmatched tracks
    to_delete = []
    for pid in list(_person_tracks.keys()):
        if pid not in matched:
            _person_lost_frames[pid] = _person_lost_frames.get(pid, 0) + 1
            if _person_lost_frames[pid] > 15:
                to_delete.append(pid)
                
    for pid in to_delete:
        _person_tracks.pop(pid, None)
        _person_lost_frames.pop(pid, None)
        _smoothed_person_boxes.pop(pid, None)
        _smoothed_face_boxes.pop(pid, None)

    # Return only stable detections to filter out 1-2 frame flickering false positives
    return [p for p in persons if p.get("stable", False)]


def _bbox_iou(a: dict, b: dict) -> float:
    """Compute IoU between two bboxes (dicts with x,y,w,h)."""
    ax1, ay1 = a["x"], a["y"]
    ax2, ay2 = ax1 + a["w"], ay1 + a["h"]
    bx1, by1 = b["x"], b["y"]
    bx2, by2 = bx1 + b["w"], by1 + b["h"]

    ix1 = max(ax1, bx1); iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2); iy2 = min(ay2, by2)
    iw  = max(0, ix2 - ix1)
    ih  = max(0, iy2 - iy1)
    inter = iw * ih
    if inter == 0:
        return 0.0
    union = a["w"] * a["h"] + b["w"] * b["h"] - inter
    return inter / (union + 1e-6)


def estimate_trapped(person: dict) -> float:
    """
    Trapped probability: person stationary over STATIONARY_FRAME_THRESHOLD frames.
    Returns 0.0 – 1.0
    """
    pid = person.get("id")
    if pid is None:
        return 0.0
    track = _person_tracks.get(pid)
    if not track or len(track) < STATIONARY_FRAME_THRESHOLD:
        return 0.0

    # Compare first and last position in track
    first = track[0]
    last  = track[-1]
    dx = abs(last["x"] - first["x"])
    dy = abs(last["y"] - first["y"])
    movement = math.sqrt(dx ** 2 + dy ** 2)

    # If movement < 15px over all tracked frames → likely trapped/stationary
    if movement < 15:
        return min(1.0, len(track) / 30)
    elif movement < 40:
        return 0.3
    return 0.0


def estimate_micro_movement(person: dict) -> float:
    """
    Detect subtle micro-movement (breathing) within person bbox across last few frames.
    Returns score 0.0 – 1.0  (high = alive + very low movement)
    """
    pid = person.get("id")
    if pid is None:
        return 0.0
    track = _person_tracks.get(pid)
    if not track or len(track) < 5:
        return 0.0

    recent = list(track)[-5:]
    movements = []
    for i in range(1, len(recent)):
        dx = abs(recent[i]["x"] - recent[i-1]["x"])
        dy = abs(recent[i]["y"] - recent[i-1]["y"])
        movements.append(math.sqrt(dx**2 + dy**2))

    avg_move = sum(movements) / len(movements)
    if 0 < avg_move < 8:
        return 0.6   # micro-movement → possibly alive but weak
    elif avg_move == 0:
        return 0.0   # totally stationary → unconscious suspicion
    return 1.0       # normal movement


# ═════════════════════════════════════════════════════════════
# STAGE 2C — POSE ESTIMATION MODEL
# ═════════════════════════════════════════════════════════════

def estimate_pose(frame: np.ndarray) -> dict:
    """
    Run YOLO11n-pose for skeletal keypoints.
    Returns posture score, label, and SOS/injury flags.
    """
    model = _models.get("pose")
    if model is None:
        return {"score": 0.6, "label": "unknown", "sos": False, "injury": False}

    try:
        results = model.predict(
            frame, verbose=False, imgsz=INF_CFG["imgsz"],
            conf=0.4, device=DEVICE,
        )
        for r in results:
            if r.keypoints is not None and len(r.keypoints) > 0:
                kps = r.keypoints.xy[0].tolist()
                label, score, flags = classify_posture(kps)
                return {
                    "score": score, "label": label,
                    "sos": flags.get("sos", False),
                    "injury": flags.get("injury", False),
                    "unconscious": flags.get("unconscious", False),
                    "keypoints": kps,
                }
        return {"score": 0.6, "label": "standing", "sos": False, "injury": False, "unconscious": False}
    except Exception as e:
        log.debug(f"Pose error: {e}")
        return {"score": 0.6, "label": "unknown", "sos": False, "injury": False, "unconscious": False}


def classify_posture(keypoints: list) -> tuple[str, float, dict]:
    """
    Classify posture from COCO 17-keypoint layout.
    Returns (label, score, flags_dict)
    Keypoint indices: 0=nose, 5/6=shoulders, 9/10=wrists, 11/12=hips, 13/14=knees, 15/16=ankles
    """
    flags = {"sos": False, "injury": False, "unconscious": False}
    if not keypoints or len(keypoints) < 17:
        return "unknown", 0.6, flags

    def kp(i):
        return keypoints[i] if i < len(keypoints) else [0, 0]

    try:
        nose       = kp(0)
        l_shoulder = kp(5);  r_shoulder = kp(6)
        l_elbow    = kp(7);  r_elbow    = kp(8)
        l_wrist    = kp(9);  r_wrist    = kp(10)
        l_hip      = kp(11); r_hip      = kp(12)
        l_knee     = kp(13); r_knee     = kp(14)
        l_ankle    = kp(15); r_ankle    = kp(16)

        mid_shoulder_y = (l_shoulder[1] + r_shoulder[1]) / 2
        mid_hip_y      = (l_hip[1] + r_hip[1]) / 2

        body_height = abs(mid_hip_y - mid_shoulder_y) + 1e-6

        # ── Fallen (unconscious posture) ──────────────────────
        # Horizontal body: shoulders and hips at similar Y
        if body_height < 50 and mid_hip_y > 0:
            flags["unconscious"] = True
            return "fallen", DET_CFG["posture_scores"]["fallen"], flags

        # ── SOS Wave: wrists above nose ───────────────────────
        wrist_avg_y = (l_wrist[1] + r_wrist[1]) / 2
        if (nose[1] > 0 and wrist_avg_y < nose[1] - 20 and
                l_wrist[1] > 0 and r_wrist[1] > 0):
            flags["sos"] = True
            return "sos_wave", DET_CFG["posture_scores"]["sos_wave"], flags

        # ── One hand raised (distress signal) ─────────────────
        if nose[1] > 0:
            if l_wrist[1] > 0 and l_wrist[1] < nose[1] - 10:
                return "hand_raised", 0.70, flags
            if r_wrist[1] > 0 and r_wrist[1] < nose[1] - 10:
                return "hand_raised", 0.70, flags

        # ── Abnormal limb angles (injury posture) ─────────────
        # Check if knee is bent at extreme angle (leg injury)
        if (l_knee[1] > 0 and l_ankle[1] > 0 and l_hip[1] > 0):
            # Rough angle check via cross product proxy
            knee_hip_dy = abs(l_knee[1] - l_hip[1])
            knee_ank_dy = abs(l_ankle[1] - l_knee[1])
            if knee_hip_dy > 0 and knee_ank_dy / knee_hip_dy < 0.3:
                flags["injury"] = True
                return "injury_posture", 0.40, flags

        return "standing", DET_CFG["posture_scores"]["standing"], flags

    except Exception:
        return "unknown", 0.6, flags


# ═════════════════════════════════════════════════════════════
# STAGE 2D — GESTURE DETECTION
# ═════════════════════════════════════════════════════════════

def detect_gesture_wave(frame: np.ndarray) -> dict:
    """
    Detect waving hand or raised hand using MediaPipe Hands.
    Returns gesture label, confidence, and urgency score.
    """
    model = _models.get("mp_hands")
    if model is None:
        return {"gesture": None, "conf": 0, "score": 0.0}

    try:
        rgb    = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = model.process(rgb)

        if not result.multi_hand_landmarks:
            return {"gesture": None, "conf": 0, "score": 0.0}

        hands_up = 0
        for hand_landmarks in result.multi_hand_landmarks:
            lm        = hand_landmarks.landmark
            wrist_y   = lm[0].y
            index_tip = lm[8].y
            mid_tip   = lm[12].y
            ring_tip  = lm[16].y

            fingers_up = sum([
                index_tip < wrist_y - 0.10,
                mid_tip   < wrist_y - 0.10,
                ring_tip  < wrist_y - 0.10,
            ])

            if fingers_up >= 2:
                hands_up += 1

        if hands_up >= 2:
            # Both hands raised = strong SOS signal
            return {"gesture": "sos_both_hands", "conf": 95, "score": 1.0}
        elif hands_up == 1:
            return {"gesture": "raised_hand", "conf": 82, "score": 0.7}
        else:
            return {"gesture": "hand_detected", "conf": 60, "score": 0.3}

    except Exception as e:
        log.debug(f"Gesture error: {e}")
        return {"gesture": None, "conf": 0, "score": 0.0}


# ═════════════════════════════════════════════════════════════
# STAGE 2E — MOTION ANALYSIS MODULE
# ═════════════════════════════════════════════════════════════

def detect_motion(frame: np.ndarray) -> dict:
    """
    Motion detection using MOG2. Returns per-frame motion stats + heatmap data.
    """
    model = _models.get("motion")
    if model is None:
        return {"motion": False, "score": 0.0, "contours": 0, "intensity": "none"}

    try:
        fg_mask = model.apply(frame)
        _, fg_mask = cv2.threshold(fg_mask, 200, 255, cv2.THRESH_BINARY)

        contours, _ = cv2.findContours(fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        valid = [c for c in contours if cv2.contourArea(c) > DET_CFG["motion_min_contour_area"]]

        motion_detected = len(valid) > 0
        score = min(1.0, len(valid) * 0.2) if motion_detected else 0.0

        # Intensity classification
        if score > 0.7:
            intensity = "high"
        elif score > 0.3:
            intensity = "medium"
        elif score > 0:
            intensity = "low"
        else:
            intensity = "none"

        return {
            "motion": motion_detected,
            "score": round(score, 3),
            "contours": len(valid),
            "intensity": intensity,
            "fg_mask": fg_mask,
        }
    except Exception as e:
        log.debug(f"Motion error: {e}")
        return {"motion": False, "score": 0.0, "contours": 0, "intensity": "none", "fg_mask": None}


def compute_person_motion_score(person: dict, fg_mask: np.ndarray) -> float:
    """
    Compute motion score within a specific person's bounding box.
    Returns 0.0 – 1.0
    """
    if fg_mask is None:
        return 0.5
    try:
        x, y, w, h = person["x"], person["y"], person["w"], person["h"]
        h_f, w_f   = fg_mask.shape[:2]
        x1 = max(0, x);      y1 = max(0, y)
        x2 = min(w_f, x + w); y2 = min(h_f, y + h)

        if x2 <= x1 or y2 <= y1:
            return 0.0

        roi      = fg_mask[y1:y2, x1:x2]
        roi_area = roi.shape[0] * roi.shape[1]
        if roi_area == 0:
            return 0.0

        motion_px = cv2.countNonZero(roi)
        return min(1.0, motion_px / roi_area)
    except Exception:
        return 0.5


# ═════════════════════════════════════════════════════════════
# STAGE 2F — ENVIRONMENTAL RISK MODULE
# ═════════════════════════════════════════════════════════════

class EnvironmentalRiskModule:
    """Computes environmental danger metrics per person and globally."""

    @staticmethod
    def fire_proximity(person: dict, fire: dict) -> tuple[str, float]:
        """
        Calculate pixel distance between person center and fire bbox center.
        Returns (label, normalized_danger_score)
        """
        if not fire.get("fire") or not fire.get("bbox"):
            return "SAFE", 0.0

        fbbox = fire["bbox"]
        fcx   = fbbox["x"] + fbbox["w"] / 2
        fcy   = fbbox["y"] + fbbox["h"] / 2
        pcx   = person.get("cx", person["x"] + person["w"] / 2)
        pcy   = person.get("cy", person["y"] + person["h"] / 2)

        dist  = math.sqrt((fcx - pcx) ** 2 + (fcy - pcy) ** 2)

        if dist < 80:
            return "CRITICAL", 1.0
        elif dist < 200:
            return "NEAR", 0.65
        elif dist < 400:
            return "MODERATE", 0.30
        else:
            return "SAFE", 0.05

    @staticmethod
    def thermal_context(frame: np.ndarray, person: dict) -> float:
        """
        Estimate heat context around person bbox via color temperature.
        High red/orange dominance → high heat.
        Returns danger score 0.0 – 1.0
        """
        try:
            x, y, w, h = person["x"], person["y"], person["w"], person["h"]
            fh, fw = frame.shape[:2]
            # Expand ROI slightly
            pad = 20
            x1 = max(0, x - pad);   y1 = max(0, y - pad)
            x2 = min(fw, x + w + pad); y2 = min(fh, y + h + pad)
            if x2 <= x1 or y2 <= y1:
                return 0.0

            roi = frame[y1:y2, x1:x2]
            hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)

            # High saturation + warm hue = heat
            warm_lower = np.array([0, 100, 100])
            warm_upper = np.array([30, 255, 255])
            warm_mask  = cv2.inRange(hsv, warm_lower, warm_upper)
            warm_ratio = cv2.countNonZero(warm_mask) / (roi.shape[0] * roi.shape[1] + 1)
            return min(1.0, warm_ratio * 3)
        except Exception:
            return 0.0

    @staticmethod
    def visibility_score(smoke: dict) -> str:
        """Return LOW / MEDIUM / HIGH visibility from smoke data."""
        pct = smoke.get("visibility_pct", 100)
        if pct < 30:
            return "LOW"
        elif pct < 70:
            return "MEDIUM"
        return "HIGH"

    @staticmethod
    def compute_env_danger(fire_proximity_score: float, thermal_score: float,
                           smoke: dict) -> float:
        """
        Aggregate environmental danger score 0.0 – 1.0
        """
        smoke_score = 1.0 - (smoke.get("visibility_pct", 100) / 100)
        env = (fire_proximity_score * 0.50 + thermal_score * 0.30 + smoke_score * 0.20)
        return min(1.0, round(env, 3))


ENV_RISK = EnvironmentalRiskModule()


# ═════════════════════════════════════════════════════════════
# STAGE 4 — SURVIVOR INTELLIGENCE
# ═════════════════════════════════════════════════════════════

class SurvivorIntelligence:
    """Per-person survivor status classification using 5-weight fusion."""

    @staticmethod
    def score(human_conf: float, motion_score: float, gesture_score: float,
              posture_score: float, env_danger: float) -> float:
        """
        score = human_conf×0.25 + motion_score×0.20 + gesture_score×0.20
              + posture_score×0.20 + env_danger×0.15
        Note: high env_danger REDUCES survivor confidence (person more at risk).
        We invert env_danger contribution so high danger → lower score (more critical).
        """
        raw = (
            SI_WEIGHTS["human_conf"]    * human_conf +
            SI_WEIGHTS["motion_score"]  * motion_score +
            SI_WEIGHTS["gesture_score"] * gesture_score +
            SI_WEIGHTS["posture_score"] * posture_score +
            SI_WEIGHTS["env_danger"]    * (1.0 - env_danger)  # high danger → lower score
        )
        return round(min(1.0, max(0.0, raw)), 3)

    @staticmethod
    def classify(score: float) -> str:
        """Map score to survivor status label."""
        if score > SI_THRESHOLDS["active"]:
            return "ACTIVE"
        elif score > SI_THRESHOLDS["low_activity"]:
            return "LOW_ACTIVITY"
        elif score > SI_THRESHOLDS["unconscious"]:
            return "POSSIBLY_UNCONSCIOUS"
        else:
            return "RESCUE_VERIFICATION"


SURVIVOR_INTEL = SurvivorIntelligence()


# ═════════════════════════════════════════════════════════════
# STAGE 5 — PRIORITY RANKER
# ═════════════════════════════════════════════════════════════

class PriorityRanker:
    """
    Assigns CRITICAL / HIGH / MEDIUM / LOW priority to each survivor.
    Based on: injury_suspicion + trapped + fire_proximity + smoke + gesture + movement
    """

    @staticmethod
    def rank(person: dict, pose: dict, gesture: dict, fire_prox_label: str,
             smoke: dict, motion_score: float, trapped_prob: float) -> str:
        """Returns priority string."""
        score = 0

        # Fire proximity
        prox_map = {"CRITICAL": 4, "NEAR": 3, "MODERATE": 1, "SAFE": 0}
        score += prox_map.get(fire_prox_label, 0)

        # Fallen / unconscious
        if person.get("fallen"):
            score += 3
        if pose.get("unconscious"):
            score += 3
        if pose.get("injury"):
            score += 2

        # Trapped
        if trapped_prob > 0.7:
            score += 3
        elif trapped_prob > 0.4:
            score += 1

        # Smoke severity
        density_map = {"opaque": 3, "thick": 2, "thin": 1, "clear": 0}
        score += density_map.get(smoke.get("density", "clear"), 0)

        # SOS gesture urgency
        if gesture.get("gesture") == "sos_both_hands":
            score += 3
        elif gesture.get("gesture") == "raised_hand":
            score += 1

        # Low motion (stationary person)
        if motion_score < 0.05:
            score += 2

        # Classify
        if score >= 8:
            return "CRITICAL"
        elif score >= 5:
            return "HIGH"
        elif score >= 2:
            return "MEDIUM"
        else:
            return "LOW"


PRIORITY_RANKER = PriorityRanker()


# ═════════════════════════════════════════════════════════════
# STAGE 6 — FIRST AID URGENCY TAGGER
# ═════════════════════════════════════════════════════════════

class FirstAidTagger:
    """Maps priority → first aid urgency label."""

    URGENCY_MAP = {
        "CRITICAL": "IMMEDIATE",
        "HIGH":     "MEDIUM_URGENCY",
        "MEDIUM":   "LOW_URGENCY",
        "LOW":      "VERIFY",
    }

    @staticmethod
    def tag(priority: str) -> str:
        return FirstAidTagger.URGENCY_MAP.get(priority, "VERIFY")


FIRST_AID = FirstAidTagger()


# ═════════════════════════════════════════════════════════════
# BLOOD DETECTION (unchanged)
# ═════════════════════════════════════════════════════════════

def detect_blood_hsv(frame: np.ndarray) -> dict:
    """HSV red-mask blood detection. ~70% precision."""
    try:
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        lower = np.array(BLOOD_CFG["hsv_lower"])
        upper = np.array(BLOOD_CFG["hsv_upper"])
        mask  = cv2.inRange(hsv, lower, upper)

        blood_px = cv2.countNonZero(mask)
        detected = blood_px > BLOOD_CFG["min_area_px2"]
        conf = min(70, int(blood_px / 50)) if detected else 0
        return {"blood": detected, "conf": conf, "method": "hsv", "pixels": blood_px}
    except Exception:
        return {"blood": False, "conf": 0, "method": "hsv_error"}


# ═════════════════════════════════════════════════════════════
# STAGE 3 — FUSION ENGINE
# ═════════════════════════════════════════════════════════════

def run_fusion_engine(frame: np.ndarray, persons: list[dict], motion: dict,
                      pose: dict, gesture: dict, fire: dict, smoke: dict,
                      sensor_score: float) -> dict:
    """
    Stage 3+4+5+6: Fuse all model outputs → unified scene understanding.
    Returns full structured output dict.
    """
    fire_spread  = compute_fire_spread_risk(frame, fire)
    visibility   = ENV_RISK.visibility_score(smoke)
    fg_mask      = motion.get("fg_mask")

    # Overall hazard level
    hazard_score = 0
    if fire.get("fire"):          hazard_score += 3
    if fire_spread == "HIGH":     hazard_score += 2
    if smoke.get("density") in ("thick", "opaque"): hazard_score += 2
    if smoke.get("toxic_suspicion"): hazard_score += 1
    if len(persons) > 0:         hazard_score += 1

    if hazard_score >= 6:    hazard_level = "CRITICAL"
    elif hazard_score >= 4:  hazard_level = "HIGH"
    elif hazard_score >= 2:  hazard_level = "MEDIUM"
    else:                    hazard_level = "LOW"

    scene_summary = {
        "survivor_count": len(persons),
        "fire_state":     "DETECTED" if fire.get("fire") else "CLEAR",
        "fire_spread_risk": fire_spread,
        "smoke_state":    smoke.get("density", "clear").upper(),
        "hazard_level":   hazard_level,
        "visibility":     visibility,
        "toxic_warning":  smoke.get("toxic_suspicion", False),
        "frame_id":       _frame_stats["total_frames"],
    }

    survivors    = []
    rescue_list  = []

    for person in persons:
        pid = person.get("id", 0)

        # Per-person metrics
        person_motion = compute_person_motion_score(person, fg_mask)
        trapped_prob  = estimate_trapped(person)
        micro_mv      = estimate_micro_movement(person)

        fire_prox_label, fire_prox_score = ENV_RISK.fire_proximity(person, fire)
        thermal_score = ENV_RISK.thermal_context(frame, person)
        env_danger    = ENV_RISK.compute_env_danger(fire_prox_score, thermal_score, smoke)

        # Survivor intelligence score
        human_conf_norm = person["conf"] / 100.0
        gesture_score   = gesture.get("score", 0.0)

        # Use individual pose from person dictionary (with global fallback)
        person_pose = person.get("pose", pose)
        posture_raw = person_pose.get("score", 0.6)
        if person_pose.get("unconscious"):
            posture_raw = 0.1
        elif person_pose.get("injury"):
            posture_raw = 0.3

        # Motion: micro-movement is still alive signal
        effective_motion = max(person_motion, micro_mv * 0.3)

        si_score = SURVIVOR_INTEL.score(
            human_conf    = human_conf_norm,
            motion_score  = effective_motion,
            gesture_score = gesture_score,
            posture_score = posture_raw,
            env_danger    = env_danger,
        )
        si_status = SURVIVOR_INTEL.classify(si_score)

        # Priority ranking
        priority = PRIORITY_RANKER.rank(
            person        = person,
            pose          = person_pose,
            gesture       = gesture,
            fire_prox_label = fire_prox_label,
            smoke         = smoke,
            motion_score  = person_motion,
            trapped_prob  = trapped_prob,
        )

        # First aid urgency
        urgency = FIRST_AID.tag(priority)

        survivor = {
            "id":       pid,
            "bbox":     {"x": person["x"], "y": person["y"],
                         "w": person["w"], "h": person["h"]},
            "face":     person.get("face"),
            "status":   si_status,
            "priority": priority,
            "urgency":  urgency,
            "scores": {
                "human_conf":    round(human_conf_norm, 3),
                "motion_score":  round(effective_motion, 3),
                "gesture_score": round(gesture_score, 3),
                "posture_score": round(posture_raw, 3),
                "env_danger":    round(env_danger, 3),
                "total":         si_score,
            },
            "posture":         person_pose.get("label", "unknown"),
            "gesture":         gesture.get("gesture"),
            "fire_proximity":  fire_prox_label,
            "trapped_prob":    round(trapped_prob, 2),
            "motion":          "stationary" if person_motion < 0.05 else "moving",
            "fallen":          person.get("fallen", False),
            "conf":            person["conf"],
        }
        survivors.append(survivor)
        rescue_list.append({
            "id":       pid,
            "priority": priority,
            "urgency":  urgency,
            "status":   si_status,
        })

    # Sort rescue list: CRITICAL first
    priority_order = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}
    rescue_list.sort(key=lambda r: priority_order.get(r["priority"], 9))

    return {
        "scene_summary": scene_summary,
        "survivors":     survivors,
        "rescue_list":   rescue_list,
        "fire":          {
            "detected":    fire.get("fire", False),
            "conf":        fire.get("conf", 0),
            "spread_risk": fire_spread,
            "bbox":        fire.get("bbox"),
        },
        "smoke":         {
            "detected":       smoke.get("smoke", False),
            "conf":           smoke.get("conf", 0),
            "density":        smoke.get("density", "clear"),
            "visibility_pct": smoke.get("visibility_pct", 100),
            "toxic_suspicion": smoke.get("toxic_suspicion", False),
            "bbox":           smoke.get("bbox"),
        },
        "motion":        {
            "detected":  motion.get("motion", False),
            "score":     motion.get("score", 0.0),
            "intensity": motion.get("intensity", "none"),
        },
        "pose":          {
            "label":       pose.get("label", "unknown"),
            "score":       pose.get("score", 0.6),
            "sos":         pose.get("sos", False),
            "injury":      pose.get("injury", False),
            "unconscious": pose.get("unconscious", False),
        },
        "gesture":       {
            "label": gesture.get("gesture"),
            "conf":  gesture.get("conf", 0),
            "score": gesture.get("score", 0.0),
        },
    }


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
            c.subscribe(MQTT_CFG["topics"]["telemetry"])
            c.subscribe(MQTT_CFG["topics"]["gps"])
        else:
            log.warning(f"MQTT connect failed: rc={rc}")

    def on_message(c, u, msg):
        try:
            data = json.loads(msg.payload.decode())
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


def publish_scene_update(client: mqtt.Client, fusion_result: dict):
    """
    Publish full structured scene update to MQTT.
    Single payload replaces all per-type alerts.
    """
    if client is None:
        return
    payload = {
        "label":         "SCENE_UPDATE",
        "timestamp":     datetime.now().isoformat(),
        **fusion_result,
    }
    try:
        client.publish(
            MQTT_CFG["topics"]["alerts"],
            json.dumps(payload),
            qos=0,
        )
    except Exception as e:
        log.debug(f"MQTT publish error: {e}")


def publish_legacy_alert(client: mqtt.Client, label: str, conf: float,
                          desc: str = "", extra: dict = None):
    """Publish legacy single-type alert for backward compat with old dashboard pages."""
    if client is None:
        return
    payload = {
        "label": label,
        "conf":  conf,
        "desc":  desc,
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

app = FastAPI(title="RescueBOT AI Server", version="3.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=SERVER_CFG["cors_origins"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/status")
def api_status():
    return {
        "status":         "online",
        "models":         list(_models.keys()),
        "fps":            _frame_stats["fps"],
        "total_frames":   _frame_stats["total_frames"],
        "survivor_count": len(_frame_stats.get("survivors", [])),
        "hazard_level":   _frame_stats.get("scene_summary", {}).get("hazard_level", "UNKNOWN"),
        "device":         DEVICE,
        "version":        "3.0.0",
    }

@app.get("/api/detections")
def api_detections():
    return _frame_stats.get("detections", {})

@app.get("/api/scene")
def api_scene():
    return {
        "scene_summary": _frame_stats.get("scene_summary", {}),
        "survivors":     _frame_stats.get("survivors", []),
        "rescue_list":   _frame_stats.get("rescue_list", []),
    }

@app.get("/api/survivors")
def api_survivors():
    return _frame_stats.get("survivors", [])

@app.get("/api/rescue_list")
def api_rescue_list():
    return _frame_stats.get("rescue_list", [])

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
    """
    Main video capture + 7-stage AI inference loop.
    All model outputs → Fusion → Survivor Intelligence → Priority → Output
    """
    esp_ip     = CAM_CFG["esp32_ip"]
    stream_url = CAM_CFG["stream_url"].replace("{ip}", esp_ip)

    log.info(f"Connecting to ESP32-CAM: {stream_url}")
    cap = None

    last_alert    = {}
    alert_cooldown = 3

    frame_times = []
    _frame_stats["sensor_score"] = 0.5

    while True:
        # ── (Re)connect to stream ─────────────────────────────
        if cap is None or not cap.isOpened():
            log.info(f"Connecting to {stream_url}...")
            cap = cv2.VideoCapture(stream_url)
            if not cap.isOpened():
                log.warning("Cannot open stream. Retrying in 5s...")
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

        # Preprocess frame for enhanced low-light / contrast visibility
        frame_proc = preprocess_frame_if_needed(frame)

        with _frame_lock:
            _latest_frame = frame_proc.copy()

        _frame_stats["total_frames"] += 1

        # ═════════════════════════════════════════════════════
        # STAGE 2: Run all models (Unified Single-Pass Inference)
        # ═════════════════════════════════════════════════════
        persons, poses, faces = detect_persons_and_poses(frame_proc)
        
        # Associate face and pose inside person dictionary before tracking/smoothing
        for i, person in enumerate(persons):
            person["pose"] = poses[i]
            person["face"] = faces[i]

        persons  = assign_person_ids(persons)
        motion   = detect_motion(frame_proc)
        
        # Backward compatibility pose/gesture summaries for legacy clients
        pose = persons[0]["pose"] if persons else {"score": 0.6, "label": "none",
                                                    "sos": False, "injury": False,
                                                    "unconscious": False}
        gesture  = detect_gesture_wave(frame_proc) if persons else {"gesture": None, "conf": 0, "score": 0.0}
        fire     = detect_fire(frame_proc)
        smoke    = detect_smoke(frame_proc)
        blood    = detect_blood_hsv(frame_proc)

        sensor_score = _frame_stats.get("sensor_score", 0.5)

        # ═════════════════════════════════════════════════════
        # STAGES 3-6: Fusion → Survivor Intel → Priority → Urgency
        # ═════════════════════════════════════════════════════
        fusion = run_fusion_engine(
            frame       = frame_proc,
            persons     = persons,
            motion      = motion,
            pose        = pose,
            gesture     = gesture,
            fire        = fire,
            smoke       = smoke,
            sensor_score= sensor_score,
        )

        # Update global state
        _frame_stats["scene_summary"] = fusion["scene_summary"]
        _frame_stats["survivors"]     = fusion["survivors"]
        _frame_stats["rescue_list"]   = fusion["rescue_list"]
        _frame_stats["detections"]    = {
            "persons": persons,
            "motion":  motion,
            "pose":    pose,
            "gesture": gesture,
            "fire":    fire,
            "smoke":   smoke,
            "blood":   blood,
        }

        # ═════════════════════════════════════════════════════
        # STAGE 7: Publish MQTT Output
        # ═════════════════════════════════════════════════════
        now = time.time()

        def should_alert(key: str) -> bool:
            return now - last_alert.get(key, 0) > alert_cooldown

        # Full scene update (new schema) — publish every frame if needed
        if should_alert("scene_update"):
            publish_scene_update(mqtt_client, fusion)
            last_alert["scene_update"] = now

        # Legacy alerts for backward compat
        if persons and should_alert("human"):
            best         = max(persons, key=lambda p: p["conf"])
            posture_label = pose.get("label", "standing")
            surv_count   = len(fusion["survivors"])
            hazard       = fusion["scene_summary"]["hazard_level"]
            desc = (f"AI confirms {surv_count} human(s). Posture: {posture_label}. "
                    f"Hazard: {hazard}")
            publish_legacy_alert(mqtt_client, "HUMAN", best["conf"], desc, {
                "x": best["x"], "y": best["y"],
                "w": best["w"], "h": best["h"],
                "posture": posture_label,
                "survivor_count": surv_count,
                "hazard_level": hazard,
            })
            last_alert["human"] = now

        if fire["fire"] and should_alert("fire"):
            publish_legacy_alert(
                mqtt_client, "FIRE", fire["conf"],
                f"Fire detected — spread risk: {fusion['fire']['spread_risk']}",
                {"spread_risk": fusion["fire"]["spread_risk"], "bbox": fire.get("bbox")},
            )
            last_alert["fire"] = now

        if smoke["smoke"] and should_alert("smoke"):
            publish_legacy_alert(
                mqtt_client, "SMOKE", smoke["conf"],
                f"Smoke detected — density: {smoke['density'].upper()}",
                {"density": smoke["density"], "visibility_pct": smoke.get("visibility_pct", 100)},
            )
            last_alert["smoke"] = now

        if motion["motion"] and not persons and should_alert("motion"):
            publish_legacy_alert(
                mqtt_client, "MOTION", int(motion["score"] * 100),
                f"Proximity motion detected ({motion['contours']} contours)",
            )
            last_alert["motion"] = now

        if gesture["gesture"] and should_alert("gesture"):
            publish_legacy_alert(
                mqtt_client, "GESTURE", gesture["conf"],
                f"Hand gesture: {gesture['gesture']}",
            )
            last_alert["gesture"] = now

        # Critical survivor alert
        critical_survivors = [s for s in fusion["survivors"] if s["priority"] == "CRITICAL"]
        if critical_survivors and should_alert("critical"):
            cs = critical_survivors[0]
            publish_legacy_alert(
                mqtt_client, "SURVIVOR_CRITICAL", int(cs["scores"]["total"] * 100),
                f"CRITICAL survivor #{cs['id']} — {cs['status']} — {cs['urgency']}",
                {"survivor": cs},
            )
            last_alert["critical"] = now

        # ── FPS tracking ──────────────────────────────────────
        t_end     = time.perf_counter()
        elapsed   = t_end - t_start
        frame_times.append(elapsed)
        if len(frame_times) > 30:
            frame_times.pop(0)
        avg_elapsed          = sum(frame_times) / len(frame_times)
        _frame_stats["fps"]  = round(1.0 / avg_elapsed, 1) if avg_elapsed > 0 else 0

        sleep_time = FRAME_INTERVAL - elapsed
        if sleep_time > 0:
            time.sleep(sleep_time)


# ═════════════════════════════════════════════════════════════
# ENTRY POINT
# ═════════════════════════════════════════════════════════════

def main():
    log.info("=" * 60)
    log.info("  RescueBOT AI Inference Server v3.0.0")
    log.info("  7-Stage Survivor Intelligence Pipeline")
    log.info(f"  Device: {DEVICE} | Target FPS: {TARGET_FPS}")
    log.info("=" * 60)

    load_models()

    mqtt_client = setup_mqtt()
    global _mqtt_client
    _mqtt_client = mqtt_client

    inf_thread = threading.Thread(
        target=inference_loop,
        args=(mqtt_client,),
        daemon=True,
        name="InferenceLoop",
    )
    inf_thread.start()
    log.info("✓ Inference loop started (7-stage pipeline)")

    log.info(f"✓ API server: http://localhost:{SERVER_CFG['api_port']}")
    log.info("  Endpoints: /api/status  /api/scene  /api/survivors  /api/rescue_list")
    uvicorn.run(
        app,
        host=SERVER_CFG["host"],
        port=SERVER_CFG["api_port"],
        log_level="warning",
    )


if __name__ == "__main__":
    main()
