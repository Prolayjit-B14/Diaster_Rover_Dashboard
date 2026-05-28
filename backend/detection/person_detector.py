"""
RescueBOT — Person Detector
YOLOv8n for person detection + MediaPipe/YOLO-Pose for posture estimation.
Tracks motionless persons and detects rescuer high-vis vests.
"""
import cv2
import numpy as np
import time
from pathlib import Path
from typing import Optional, List
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config.settings import (
    YOLO_PERSON_MODEL, YOLO_POSE_MODEL,
    PERSON_CONF_THRESHOLD, MOTION_STATIONARY_SEC,
    HIGH_VIS_RATIO
)
from models.schemas import PersonDetection, BBox


class PersonTrack:
    """Tracks a single person across frames using IoU matching."""
    __slots__ = ["bbox", "first_seen", "last_seen", "last_moved", "is_motionless"]

    def __init__(self, bbox: tuple, ts: float):
        self.bbox = bbox
        self.first_seen = ts
        self.last_seen  = ts
        self.last_moved = ts
        self.is_motionless = False


class PersonDetector:
    """
    YOLOv8n person detector with:
      - Multi-person tracking (IoU-based)
      - Motionless state detection
      - Rescuer high-vis vest detection
      - MediaPipe pose fallback → YOLO-Pose fallback → heuristic
    """

    def __init__(self):
        self._model = None
        self._pose_model = None
        self._mp_pose = None
        self._has_yolo = False
        self._has_pose = False
        self._has_mediapipe = False

        # Load YOLO person model
        try:
            from ultralytics import YOLO
            self._model = YOLO(YOLO_PERSON_MODEL)
            self._has_yolo = True
            print("[PersonDetector] YOLOv8n person model loaded.")

            try:
                self._pose_model = YOLO(YOLO_POSE_MODEL)
                self._has_pose = True
                print("[PersonDetector] YOLOv8n-pose model loaded.")
            except Exception as e:
                print(f"[PersonDetector] Pose model unavailable: {e}")
        except ImportError:
            print("[PersonDetector] ultralytics not installed → motion-only fallback.")

        # Load MediaPipe pose
        try:
            import mediapipe as mp
            self._mp_pose = mp.solutions.pose.Pose(
                static_image_mode=False,
                min_detection_confidence=0.55,
                min_tracking_confidence=0.55
            )
            self._has_mediapipe = True
            print("[PersonDetector] MediaPipe Pose engine online.")
        except Exception as e:
            print(f"[PersonDetector] MediaPipe unavailable: {e}")

        # Person track registry
        self._tracks: List[PersonTrack] = []

    # ── Public API ────────────────────────────────────────────────────────────
    def detect(self, frame: np.ndarray,
               motion_bbox: Optional[BBox] = None) -> PersonDetection:
        """
        Runs person detection on the frame.

        Args:
            frame: BGR frame
            motion_bbox: from MotionDetector (used for survivor confidence)

        Returns:
            PersonDetection with all posture, tracking, and rescue metadata.
        """
        now = time.time()
        self._cleanup_tracks(now)

        if self._has_yolo and self._model is not None:
            return self._detect_yolo(frame, motion_bbox, now)
        elif motion_bbox is not None:
            return self._detect_fallback(frame, motion_bbox, now)
        return PersonDetection()

    def draw(self, frame: np.ndarray, result: PersonDetection) -> np.ndarray:
        """Draws person bounding box with posture label."""
        if result.detected and result.bbox:
            b = result.bbox
            color = (0, 255, 0) if result.is_rescuer else (
                (0, 0, 255) if result.is_motionless else (0, 212, 255)
            )
            cv2.rectangle(frame, (b.x, b.y), (b.x + b.w, b.y + b.h), color, 2)
            label = f"{result.pose_state.upper()} ({int(result.confidence * 100)}%)"
            if result.is_rescuer:
                label = f"RESCUER ({int(result.confidence * 100)}%)"
            cv2.putText(frame, label, (b.x, b.y - 5),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
        return frame

    # ── YOLO Detection ────────────────────────────────────────────────────────
    def _detect_yolo(self, frame, motion_bbox, now) -> PersonDetection:
        try:
            results = self._model(frame, verbose=False)[0]
        except Exception as e:
            print(f"[PersonDetector] YOLO error: {e}")
            return PersonDetection()

        best: Optional[PersonDetection] = None
        best_conf = 0.0

        for box in results.boxes:
            cls_id = int(box.cls[0])
            conf   = float(box.conf[0])
            if conf < PERSON_CONF_THRESHOLD:
                continue
            cls_name = self._model.names[cls_id]
            if cls_name != "person":
                continue

            xyxy = box.xyxy[0].tolist()
            x1, y1 = int(xyxy[0]), int(xyxy[1])
            x2, y2 = int(xyxy[2]), int(xyxy[3])
            bx, by, bw, bh = x1, y1, x2 - x1, y2 - y1

            is_motionless, stationary_sec = self._update_track(
                (bx, by, bw, bh), now
            )
            roi = frame[y1:y2, x1:x2]
            is_rescuer = self._check_highvis(roi)

            # Pose estimation
            pose_state, gesture_conf = self._estimate_pose(
                frame, roi, x1, y1, x2, y2
            )

            if conf > best_conf:
                best_conf = conf
                best = PersonDetection(
                    detected=True,
                    confidence=round(conf, 3),
                    count=1,
                    pose_state=pose_state,
                    is_rescuer=is_rescuer,
                    is_motionless=is_motionless,
                    stationary_seconds=round(stationary_sec, 1),
                    bbox=BBox(x=bx, y=by, w=bw, h=bh)
                )

        if best:
            # Count all persons
            person_count = sum(
                1 for box in results.boxes
                if float(box.conf[0]) >= PERSON_CONF_THRESHOLD
                and self._model.names[int(box.cls[0])] == "person"
            )
            best.count = person_count
            return best

        return PersonDetection()

    # ── Fallback (no YOLO) ────────────────────────────────────────────────────
    def _detect_fallback(self, frame, motion_bbox: BBox, now) -> PersonDetection:
        roi = frame[motion_bbox.y:motion_bbox.y + motion_bbox.h,
                    motion_bbox.x:motion_bbox.x + motion_bbox.w]
        is_rescuer = self._check_highvis(roi)
        is_motionless, stationary_sec = self._update_track(
            (motion_bbox.x, motion_bbox.y, motion_bbox.w, motion_bbox.h), now
        )
        return PersonDetection(
            detected=True,
            confidence=0.55,
            count=1,
            pose_state="unknown",
            is_rescuer=is_rescuer,
            is_motionless=is_motionless,
            stationary_seconds=round(stationary_sec, 1),
            bbox=motion_bbox
        )

    # ── Pose Estimation ───────────────────────────────────────────────────────
    def _estimate_pose(self, full_frame, roi, x1, y1, x2, y2):
        """Returns (pose_state, gesture_confidence)."""
        body_angle = 90.0
        distress_waving = False

        # 1. MediaPipe
        if self._has_mediapipe and self._mp_pose is not None:
            try:
                rgb = cv2.cvtColor(roi, cv2.COLOR_BGR2RGB)
                mp_res = self._mp_pose.process(rgb)
                if mp_res.pose_landmarks:
                    lm = mp_res.pose_landmarks.landmark
                    head_y = lm[0].y
                    rw_y = lm[16].y; lw_y = lm[15].y
                    if rw_y < head_y or lw_y < head_y:
                        distress_waving = True
                    sh_y = (lm[11].y + lm[12].y) / 2
                    ank_y = (lm[27].y + lm[28].y) / 2
                    sh_x = (lm[11].x + lm[12].x) / 2
                    ank_x = (lm[27].x + lm[28].x) / 2
                    dx = abs(ank_x - sh_x); dy = abs(ank_y - sh_y)
                    body_angle = float(np.arctan2(dy, dx) * 180 / np.pi)
            except Exception:
                pass

        # 2. YOLO-Pose fallback
        elif self._has_pose and self._pose_model is not None:
            try:
                pose_res = self._pose_model(full_frame, verbose=False)[0]
                if pose_res.keypoints is not None:
                    for kpts in pose_res.keypoints:
                        if len(kpts.xy) == 0:
                            continue
                        xy = kpts.xy[0].tolist()
                        k_conf = kpts.conf[0].tolist() if kpts.conf is not None else [1.0] * 17
                        if len(xy) >= 17:
                            px, py = xy[0][0], xy[0][1]
                            if x1 <= px <= x2 and y1 <= py <= y2:
                                if (k_conf[9] > 0.5 and xy[9][1] < xy[0][1]) or \
                                   (k_conf[10] > 0.5 and xy[10][1] < xy[0][1]):
                                    distress_waving = True
                                sh_y = (xy[5][1] + xy[6][1]) / 2
                                ank_y = (xy[15][1] + xy[16][1]) / 2
                                sh_x = (xy[5][0] + xy[6][0]) / 2
                                ank_x = (xy[15][0] + xy[16][0]) / 2
                                dx = abs(ank_x - sh_x); dy = abs(ank_y - sh_y)
                                body_angle = float(np.arctan2(dy, dx) * 180 / np.pi)
                                break
            except Exception:
                pass

        # Map angle + distress to pose state
        is_fallen = body_angle < 35.0
        if distress_waving:
            return "distress", 0.90
        if is_fallen:
            return "fallen", 0.80
        if body_angle > 55.0:
            return "standing", 0.70
        return "unknown", 0.50

    # ── High-Vis Rescuer Check ────────────────────────────────────────────────
    def _check_highvis(self, roi: np.ndarray) -> bool:
        if roi.size == 0:
            return False
        hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
        mask = cv2.inRange(hsv,
                           np.array([15, 100, 100]),
                           np.array([40, 255, 255]))
        pct = cv2.countNonZero(mask) / roi.size
        return pct > HIGH_VIS_RATIO

    # ── Person Track (IoU) ────────────────────────────────────────────────────
    def _update_track(self, bbox: tuple, now: float) -> tuple[bool, float]:
        bx, by, bw, bh = bbox
        cx, cy = bx + bw / 2.0, by + bh / 2.0
        best_idx, best_iou = -1, 0.0

        for i, t in enumerate(self._tracks):
            tx, ty, tw, th = t.bbox
            ix1 = max(bx, tx); iy1 = max(by, ty)
            ix2 = min(bx + bw, tx + tw); iy2 = min(by + bh, ty + th)
            if ix2 > ix1 and iy2 > iy1:
                inter = (ix2 - ix1) * (iy2 - iy1)
                union = bw * bh + tw * th - inter
                iou = inter / union if union > 0 else 0.0
                if iou > best_iou:
                    best_iou = iou; best_idx = i

        if best_idx != -1 and best_iou > 0.40:
            t = self._tracks[best_idx]
            tx, ty, tw, th = t.bbox
            tcx, tcy = tx + tw / 2.0, ty + th / 2.0
            dist = np.sqrt((cx - tcx)**2 + (cy - tcy)**2)
            thresh = 0.15 * max(tw, th)
            if dist > thresh:
                t.last_moved = now; t.is_motionless = False
            else:
                if now - t.last_moved > MOTION_STATIONARY_SEC:
                    t.is_motionless = True
            t.bbox = bbox; t.last_seen = now
            return t.is_motionless, now - t.last_moved
        else:
            self._tracks.append(PersonTrack(bbox, now))
            return False, 0.0

    def _cleanup_tracks(self, now: float):
        self._tracks = [t for t in self._tracks if now - t.last_seen < 2.5]
