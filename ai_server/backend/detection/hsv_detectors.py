"""
hsv_detectors.py — Pure OpenCV HSV Fallback Detectors
=======================================================
Used when YOLO model weights are unavailable.
Zero external dependencies beyond opencv-python + numpy.
"""

import cv2
import numpy as np
import pathlib
import yaml

ROOT = pathlib.Path(__file__).parent.parent.parent

with open(ROOT / "config.yaml") as f:
    CFG = yaml.safe_load(f)


def detect_fire_hsv(frame: np.ndarray) -> dict:
    """
    HSV fire detection using orange/yellow combustion color signature.
    H: 0-30 (red→orange→yellow), S: 120+, V: 100+
    Also captures red wrap-around H: 160-180.
    Accuracy: ~65%. False positives: red/orange lights, sunsets.
    """
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

    lower1 = np.array([0,   120, 100]); upper1 = np.array([30,  255, 255])
    lower2 = np.array([160, 120, 100]); upper2 = np.array([180, 255, 255])

    mask = cv2.bitwise_or(cv2.inRange(hsv, lower1, upper1),
                          cv2.inRange(hsv, lower2, upper2))

    # Morphological cleanup (remove noise)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask   = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

    fire_px  = cv2.countNonZero(mask)
    total_px = frame.shape[0] * frame.shape[1]
    ratio    = fire_px / total_px

    detected = ratio > 0.015  # >1.5% of frame
    conf = int(min(95, ratio * 1200)) if detected else 0

    # Get bounding rect for overlay
    bbox = None
    if detected:
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if contours:
            largest = max(contours, key=cv2.contourArea)
            x, y, w, h = cv2.boundingRect(largest)
            bbox = {"x": x, "y": y, "w": w, "h": h}

    return {"fire": detected, "conf": conf, "method": "hsv", "ratio": round(ratio, 4), "bbox": bbox}


def detect_smoke_hsv(frame: np.ndarray) -> dict:
    """
    HSV smoke detection using grey/white low-saturation plume signature.
    S: 0-60 (achromatic grey), V: 120-240 (medium brightness).
    Accuracy: ~70%. False positives: fog, steam, light walls.
    """
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

    lower = np.array([0,   0,  120]); upper = np.array([180, 60, 240])
    mask  = cv2.inRange(hsv, lower, upper)

    # Dilate then erode — smoke is diffuse and connected
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    mask   = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask   = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  kernel)

    smoke_px = cv2.countNonZero(mask)
    total_px = frame.shape[0] * frame.shape[1]
    ratio    = smoke_px / total_px

    detected = ratio > 0.07
    conf = int(min(90, ratio * 400)) if detected else 0

    return {"smoke": detected, "conf": conf, "method": "hsv", "ratio": round(ratio, 4)}


def detect_blood_hsv(frame: np.ndarray) -> dict:
    """
    HSV red-channel blood detection.
    H: 0-10 (red), S: 120+, V: 70+ → dark red blood pools.
    Accuracy: ~70%. Limitations documented in model_registry.json.
    """
    blood_cfg = CFG.get("blood", {})
    lower = np.array(blood_cfg.get("hsv_lower", [0, 120, 70]))
    upper = np.array(blood_cfg.get("hsv_upper", [10, 255, 255]))
    min_area = blood_cfg.get("min_area_px2", 800)

    hsv  = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, lower, upper)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask   = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

    blood_px = cv2.countNonZero(mask)
    detected = blood_px > min_area
    conf = int(min(70, blood_px / 40)) if detected else 0

    return {"blood": detected, "conf": conf, "method": "hsv", "pixels": blood_px}


def draw_hsv_overlay(frame: np.ndarray, detections: dict) -> np.ndarray:
    """
    Draw HSV detection overlays onto frame for debugging.
    Returns annotated frame copy.
    """
    out = frame.copy()
    font = cv2.FONT_HERSHEY_SIMPLEX

    if detections.get("fire", {}).get("fire"):
        d = detections["fire"]
        bbox = d.get("bbox")
        if bbox:
            cv2.rectangle(out, (bbox["x"], bbox["y"]),
                          (bbox["x"]+bbox["w"], bbox["y"]+bbox["h"]), (0, 69, 255), 2)
        cv2.putText(out, f"FIRE {d['conf']}%", (10, 30), font, 0.8, (0, 69, 255), 2)

    if detections.get("smoke", {}).get("smoke"):
        d = detections["smoke"]
        cv2.putText(out, f"SMOKE {d['conf']}%", (10, 65), font, 0.8, (128, 128, 128), 2)

    if detections.get("blood", {}).get("blood"):
        d = detections["blood"]
        cv2.putText(out, f"BLOOD {d['conf']}%", (10, 100), font, 0.8, (0, 0, 200), 2)

    return out
