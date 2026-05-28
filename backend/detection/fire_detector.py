"""
RescueBOT — Fire & Smoke Detector
Custom YOLO (if available) with HSV color fallback + temporal confirmation.
"""
import cv2
import numpy as np
from pathlib import Path
from collections import deque
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config.settings import (
    YOLO_FIRE_MODEL, YOLO_SMOKE_MODEL,
    FIRE_CONF_THRESHOLD, SMOKE_CONF_THRESHOLD,
    HSV_FIRE_PIXEL_RATIO,
    SMOKE_LAPLACIAN_MAX, SMOKE_STDDEV_MAX,
    FIRE_CONFIRM_FRAMES, FIRE_CONFIRM_MIN_HITS,
    SMOKE_CONFIRM_FRAMES, SMOKE_CONFIRM_MIN_HITS,
)
from models.schemas import FireDetection, SmokeDetection, BBox


class FireSmokeDetector:
    """
    Detects fire and smoke using:
      1. Custom YOLO model (if weights present)
      2. HSV color segmentation fallback
      3. Temporal confirmation queue (prevents flicker false positives)
      4. Texture/color verification on candidate regions
    """

    def __init__(self):
        self._fire_model = None
        self._smoke_model = None
        self._has_yolo_fire = False
        self._has_yolo_smoke = False

        # Try loading custom YOLO weights
        try:
            from ultralytics import YOLO
            if Path(YOLO_FIRE_MODEL).exists():
                self._fire_model = YOLO(YOLO_FIRE_MODEL)
                self._has_yolo_fire = True
                print("[FireSmokeDetector] Custom YOLO fire model loaded.")
            else:
                print("[FireSmokeDetector] Custom fire model not found → HSV fallback active.")

            if Path(YOLO_SMOKE_MODEL).exists():
                self._smoke_model = YOLO(YOLO_SMOKE_MODEL)
                self._has_yolo_smoke = True
                print("[FireSmokeDetector] Custom YOLO smoke model loaded.")
            else:
                print("[FireSmokeDetector] Custom smoke model not found → HSV fallback active.")
        except ImportError:
            print("[FireSmokeDetector] ultralytics not installed → HSV-only mode.")

        # Temporal confirmation buffers
        self._fire_queue: deque = deque(maxlen=FIRE_CONFIRM_FRAMES)
        self._smoke_queue: deque = deque(maxlen=SMOKE_CONFIRM_FRAMES)

        self._morph_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))

    # ── Public API ────────────────────────────────────────────────────────────
    def detect(self, frame: np.ndarray) -> tuple[FireDetection, SmokeDetection]:
        """Returns (FireDetection, SmokeDetection) for this frame."""
        fire_raw = self._detect_fire_raw(frame)
        smoke_raw = self._detect_smoke_raw(frame)

        # Push to temporal queues
        self._fire_queue.append(fire_raw[0])
        self._smoke_queue.append(smoke_raw[0])

        fire_confirmed  = sum(self._fire_queue)  >= FIRE_CONFIRM_MIN_HITS
        smoke_confirmed = sum(self._smoke_queue) >= SMOKE_CONFIRM_MIN_HITS

        fire_result  = fire_raw[1]  if fire_confirmed  else FireDetection()
        smoke_result = smoke_raw[1] if smoke_confirmed else SmokeDetection()

        fire_result.detected  = fire_confirmed
        smoke_result.detected = smoke_confirmed

        return fire_result, smoke_result

    def draw(self, frame: np.ndarray,
             fire: FireDetection, smoke: SmokeDetection) -> np.ndarray:
        """Draws fire/smoke bounding boxes onto frame."""
        if fire.detected and fire.bbox:
            b = fire.bbox
            cv2.rectangle(frame, (b.x, b.y), (b.x + b.w, b.y + b.h),
                          (0, 0, 255), 2)
            cv2.putText(frame, f"FIRE ({int(fire.confidence * 100)}%)",
                        (b.x, b.y - 5), cv2.FONT_HERSHEY_SIMPLEX,
                        0.4, (0, 0, 255), 1)

        if smoke.detected and smoke.bbox:
            b = smoke.bbox
            cv2.rectangle(frame, (b.x, b.y), (b.x + b.w, b.y + b.h),
                          (128, 128, 128), 1)
            cv2.putText(frame, f"SMOKE ({smoke.density.upper()})",
                        (b.x, b.y - 5), cv2.FONT_HERSHEY_SIMPLEX,
                        0.4, (180, 180, 180), 1)
        return frame

    # ── Fire Detection ────────────────────────────────────────────────────────
    def _detect_fire_raw(self, frame: np.ndarray) -> tuple[bool, FireDetection]:
        """Returns (raw_bool, FireDetection) before temporal confirmation."""
        # 1. Try YOLO
        if self._has_yolo_fire and self._fire_model is not None:
            try:
                results = self._fire_model(frame, verbose=False)[0]
                for box in results.boxes:
                    conf = float(box.conf[0])
                    if conf >= FIRE_CONF_THRESHOLD:
                        xyxy = box.xyxy[0].tolist()
                        bx = int(xyxy[0]); by = int(xyxy[1])
                        bw = int(xyxy[2] - xyxy[0]); bh = int(xyxy[3] - xyxy[1])
                        if self._verify_fire_hsv(frame, bx, by, bw, bh):
                            return True, FireDetection(
                                detected=True, confidence=round(conf, 3),
                                source="yolo",
                                bbox=BBox(x=bx, y=by, w=bw, h=bh)
                            )
            except Exception as e:
                print(f"[FireSmokeDetector] YOLO fire error: {e}")

        # 2. HSV fallback
        detected, bbox, conf = self._detect_fire_hsv(frame)
        if detected and bbox:
            bx, by, bw, bh = bbox
            if self._verify_fire_hsv(frame, bx, by, bw, bh):
                return True, FireDetection(
                    detected=True, confidence=round(conf, 3),
                    source="hsv",
                    bbox=BBox(x=bx, y=by, w=bw, h=bh)
                )
        return False, FireDetection()

    def _detect_fire_hsv(self, frame: np.ndarray):
        """HSV color mask for flame detection."""
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        mask1 = cv2.inRange(hsv,
                            np.array([0,   50, 100], dtype="uint8"),
                            np.array([35, 255, 255], dtype="uint8"))
        mask2 = cv2.inRange(hsv,
                            np.array([165,  50, 100], dtype="uint8"),
                            np.array([180, 255, 255], dtype="uint8"))
        mask = cv2.bitwise_or(mask1, mask2)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  self._morph_kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, self._morph_kernel)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        best, best_area = None, 0
        for c in contours:
            area = cv2.contourArea(c)
            if area > 100 and area > best_area:
                best_area = area
                best = c
        if best is not None:
            x, y, w, h = cv2.boundingRect(best)
            conf = min(0.99, 0.70 + (best_area / 1000.0) * 0.10)
            return True, (x, y, w, h), conf
        return False, None, 0.0

    def _verify_fire_hsv(self, frame, bx, by, bw, bh) -> bool:
        """Verifies fire candidate by checking flame color density in ROI."""
        h_img, w_img = frame.shape[:2]
        x1, y1 = max(0, bx), max(0, by)
        x2, y2 = min(w_img, bx + bw), min(h_img, by + bh)
        roi = frame[y1:y2, x1:x2]
        if roi.size == 0:
            return False
        hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
        mask = cv2.inRange(hsv,
                           np.array([0, 70, 120], dtype="uint8"),
                           np.array([35, 255, 255], dtype="uint8"))
        fire_pct = (cv2.countNonZero(mask) / (roi.shape[0] * roi.shape[1])) * 100
        return fire_pct > (HSV_FIRE_PIXEL_RATIO * 100)

    # ── Smoke Detection ───────────────────────────────────────────────────────
    def _detect_smoke_raw(self, frame: np.ndarray) -> tuple[bool, SmokeDetection]:
        if self._has_yolo_smoke and self._smoke_model is not None:
            try:
                results = self._smoke_model(frame, verbose=False)[0]
                for box in results.boxes:
                    conf = float(box.conf[0])
                    if conf >= SMOKE_CONF_THRESHOLD:
                        xyxy = box.xyxy[0].tolist()
                        bx = int(xyxy[0]); by = int(xyxy[1])
                        bw = int(xyxy[2] - xyxy[0]); bh = int(xyxy[3] - xyxy[1])
                        if self._verify_smoke_texture(frame, bx, by, bw, bh):
                            density = self._smoke_density(frame, bx, by, bw, bh)
                            return True, SmokeDetection(
                                detected=True, confidence=round(conf, 3),
                                density=density, source="yolo",
                                bbox=BBox(x=bx, y=by, w=bw, h=bh)
                            )
            except Exception as e:
                print(f"[FireSmokeDetector] YOLO smoke error: {e}")

        detected, bbox, conf = self._detect_smoke_hsv(frame)
        if detected and bbox:
            bx, by, bw, bh = bbox
            if self._verify_smoke_texture(frame, bx, by, bw, bh):
                density = self._smoke_density(frame, bx, by, bw, bh)
                return True, SmokeDetection(
                    detected=True, confidence=round(conf, 3),
                    density=density, source="hsv",
                    bbox=BBox(x=bx, y=by, w=bw, h=bh)
                )
        return False, SmokeDetection()

    def _detect_smoke_hsv(self, frame: np.ndarray):
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        mask = cv2.inRange(hsv,
                           np.array([0,    0, 100], dtype="uint8"),
                           np.array([180, 50, 200], dtype="uint8"))
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        best, best_area = None, 0
        for c in contours:
            area = cv2.contourArea(c)
            if area > 1500 and area > best_area:
                best_area = area
                best = c
        if best is not None:
            x, y, w, h = cv2.boundingRect(best)
            conf = min(0.95, 0.60 + (best_area / 3000.0) * 0.08)
            return True, (x, y, w, h), conf
        return False, None, 0.0

    def _verify_smoke_texture(self, frame, bx, by, bw, bh) -> bool:
        """Verifies smoke by checking low-texture Laplacian variance."""
        h_img, w_img = frame.shape[:2]
        roi = frame[max(0, by):min(h_img, by + bh), max(0, bx):min(w_img, bx + bw)]
        if roi.size == 0:
            return False
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        lap_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        std_dev = float(np.std(gray))
        return lap_var < SMOKE_LAPLACIAN_MAX and std_dev < SMOKE_STDDEV_MAX

    def _smoke_density(self, frame, bx, by, bw, bh) -> str:
        h_img, w_img = frame.shape[:2]
        roi = frame[max(0, by):min(h_img, by + bh), max(0, bx):min(w_img, bx + bw)]
        if roi.size == 0:
            return "low"
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        std = float(np.std(gray))
        if std < 15.0:   return "dense"
        if std < 28.0:   return "medium"
        return "low"
