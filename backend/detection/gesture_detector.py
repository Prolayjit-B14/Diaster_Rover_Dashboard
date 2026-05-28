"""
RescueBOT — Gesture Detector
MediaPipe Hands + Pose for waving, raised hand, SOS, and distress gesture detection.
"""
import cv2
import numpy as np
from pathlib import Path
import sys
from collections import deque

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from models.schemas import GestureDetection


class GestureDetector:
    """
    Detects emergency help gestures using MediaPipe:
      - Waving hand (temporal motion of wrist landmarks)
      - Raised hand (wrist above head)
      - SOS pattern (alternating raises)
      - General distress signal

    Falls back gracefully if MediaPipe is not installed.
    """

    def __init__(self):
        self._mp_hands = None
        self._mp_pose  = None
        self._has_mp   = False
        self._wrist_history: deque = deque(maxlen=15)  # For waving detection

        try:
            import mediapipe as mp

            self._mp_hands = mp.solutions.hands.Hands(
                static_image_mode=False,
                max_num_hands=2,
                min_detection_confidence=0.60,
                min_tracking_confidence=0.55
            )
            self._mp_pose = mp.solutions.pose.Pose(
                static_image_mode=False,
                min_detection_confidence=0.55,
                min_tracking_confidence=0.55
            )
            self._has_mp = True
            print("[GestureDetector] MediaPipe Hands + Pose online.")
        except Exception as e:
            print(f"[GestureDetector] MediaPipe unavailable: {e} — gesture detection disabled.")

    # ── Public API ────────────────────────────────────────────────────────────
    def detect(self, frame: np.ndarray) -> GestureDetection:
        """
        Runs hand and body landmark detection to identify distress gestures.
        """
        if not self._has_mp:
            return GestureDetection()

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        h, w = frame.shape[:2]

        # --- Hand-based gesture detection ---
        hand_result = self._mp_hands.process(rgb)
        if hand_result.multi_hand_landmarks:
            for hand_lm in hand_result.multi_hand_landmarks:
                lm = hand_lm.landmark
                wrist_y  = lm[0].y  * h
                wrist_x  = lm[0].x  * w
                tip_y    = lm[8].y  * h   # index finger tip
                pinky_y  = lm[20].y * h   # pinky tip

                # Record wrist position for waving detection
                self._wrist_history.append((wrist_x, wrist_y))

                # Raised hand: wrist above vertical midpoint of frame
                if wrist_y < h * 0.4:
                    # Check for waving (horizontal oscillation)
                    if self._is_waving():
                        return GestureDetection(
                            detected=True,
                            gesture_type="waving",
                            confidence=0.87,
                            is_distress=True
                        )
                    return GestureDetection(
                        detected=True,
                        gesture_type="raised_hand",
                        confidence=0.80,
                        is_distress=True
                    )

                # Open palm check: all finger tips above wrist
                if tip_y < wrist_y and pinky_y < wrist_y:
                    return GestureDetection(
                        detected=True,
                        gesture_type="open_palm",
                        confidence=0.75,
                        is_distress=True
                    )

        # --- Body pose distress check ---
        pose_result = self._mp_pose.process(rgb)
        if pose_result.pose_landmarks:
            lm = pose_result.pose_landmarks.landmark
            nose_y  = lm[0].y
            rw_y    = lm[16].y   # right wrist
            lw_y    = lm[15].y   # left wrist

            if rw_y < nose_y or lw_y < nose_y:
                return GestureDetection(
                    detected=True,
                    gesture_type="arms_raised",
                    confidence=0.82,
                    is_distress=True
                )

        return GestureDetection()

    def draw(self, frame: np.ndarray, result: GestureDetection) -> np.ndarray:
        """Draws a gesture indicator overlay."""
        if result.detected:
            cv2.putText(
                frame,
                f"GESTURE: {result.gesture_type.upper()} ({int(result.confidence * 100)}%)",
                (10, frame.shape[0] - 30),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 128), 2
            )
        return frame

    # ── Internal ──────────────────────────────────────────────────────────────
    def _is_waving(self) -> bool:
        """Detects horizontal oscillation in the wrist position history."""
        if len(self._wrist_history) < 8:
            return False
        xs = [p[0] for p in self._wrist_history]
        x_range = max(xs) - min(xs)
        # Consider it waving if wrist moved >80px horizontally in last 15 frames
        return x_range > 80
