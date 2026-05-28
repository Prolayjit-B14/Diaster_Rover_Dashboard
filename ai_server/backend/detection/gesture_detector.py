"""
gesture_detector.py — MediaPipe Gesture & SOS Detection
=========================================================
Implements waving hand, raised hand, and SOS gesture detection
using MediaPipe Hands + joint angle analysis.
No model download needed — bundled with mediapipe package.
"""

import cv2
import numpy as np
import math
import logging

log = logging.getLogger(__name__)

try:
    import mediapipe as mp
    # Try legacy solutions API first (mediapipe < 0.10.14)
    try:
        MP_HANDS = mp.solutions.hands
        MP_POSE  = mp.solutions.pose
        MP_DRAW  = mp.solutions.drawing_utils
        MEDIAPIPE_AVAILABLE = True
        MEDIAPIPE_LEGACY    = True
    except AttributeError:
        # MediaPipe 0.10.14+ moved to Tasks API
        MEDIAPIPE_AVAILABLE = True
        MEDIAPIPE_LEGACY    = False
        MP_HANDS = MP_POSE = MP_DRAW = None
        log.warning("MediaPipe solutions API unavailable (v%s). Using Tasks API fallback.", mp.__version__)
except ImportError:
    MEDIAPIPE_AVAILABLE = False
    MEDIAPIPE_LEGACY    = False
    MP_HANDS = MP_POSE = MP_DRAW = None
    log.warning("MediaPipe not installed. Gesture detection unavailable.")


# ── Landmark indices (MediaPipe Hands) ───────────────────────
WRIST       = 0
THUMB_TIP   = 4
INDEX_TIP   = 8
MIDDLE_TIP  = 12
RING_TIP    = 16
PINKY_TIP   = 20
INDEX_MCP   = 5
MIDDLE_MCP  = 9
RING_MCP    = 13
PINKY_MCP   = 17


def distance(p1, p2) -> float:
    """Euclidean distance between two landmark [x, y] points."""
    return math.sqrt((p1[0]-p2[0])**2 + (p1[1]-p2[1])**2)


def count_raised_fingers(landmarks) -> int:
    """Count how many fingers are raised above their MCP joint."""
    lm = landmarks.landmark
    tips   = [INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP]
    mcps   = [INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP]
    raised = sum(1 for tip, mcp in zip(tips, mcps) if lm[tip].y < lm[mcp].y)
    # Thumb: check if tip is left/right of IP joint
    thumb_up = abs(lm[THUMB_TIP].x - lm[2].x) > 0.05
    return raised + (1 if thumb_up else 0)


def classify_gesture(landmarks, frame_h: int, frame_w: int) -> tuple[str, float]:
    """
    Classify hand gesture from MediaPipe hand landmarks.

    Returns: (gesture_name, confidence_0_to_100)
    Gestures: 'raised_hand', 'sos_wave', 'pointing', 'open_hand', 'unknown'
    """
    lm = landmarks.landmark

    wrist_y  = lm[WRIST].y
    index_y  = lm[INDEX_TIP].y
    middle_y = lm[MIDDLE_TIP].y
    ring_y   = lm[RING_TIP].y
    pinky_y  = lm[PINKY_TIP].y

    fingers_raised = count_raised_fingers(landmarks)

    # Raised hand (4-5 fingers up, wrist near bottom)
    if fingers_raised >= 4 and wrist_y > 0.5:
        return "raised_hand", 92.0

    # SOS wave: 3+ fingers up AND wrist near centre of frame
    if fingers_raised >= 3 and 0.3 < wrist_y < 0.7:
        return "sos_wave", 88.0

    # Open palm
    if fingers_raised >= 3:
        return "open_hand", 75.0

    # Pointing: only index up
    if index_y < wrist_y - 0.05 and middle_y > index_y and ring_y > index_y:
        return "pointing", 70.0

    return "hand_present", 60.0


class GestureDetector:
    """
    Real-time gesture detector using MediaPipe Hands.
    Usage:
        detector = GestureDetector()
        result = detector.detect(frame)
    """

    def __init__(self, max_hands: int = 2, min_conf: float = 0.5):
        if not MEDIAPIPE_AVAILABLE:
            self._hands = None
            return
        self._hands = MP_HANDS.Hands(
            static_image_mode=False,
            max_num_hands=max_hands,
            min_detection_confidence=min_conf,
            min_tracking_confidence=0.5,
        )
        self._history = []  # gesture history for wave detection
        log.info("GestureDetector initialized (MediaPipe Hands)")

    def detect(self, frame: np.ndarray) -> dict:
        """
        Run gesture detection on a BGR frame.
        Returns dict with gesture, conf, hands_count, landmarks.
        """
        if self._hands is None:
            return {"gesture": None, "conf": 0, "hands_count": 0}

        h, w = frame.shape[:2]
        rgb  = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = self._hands.process(rgb)

        if not result.multi_hand_landmarks:
            self._history.append(None)
            if len(self._history) > 10:
                self._history.pop(0)
            return {"gesture": None, "conf": 0, "hands_count": 0}

        gestures = []
        for hand_landmarks in result.multi_hand_landmarks:
            gesture, conf = classify_gesture(hand_landmarks, h, w)
            gestures.append({"gesture": gesture, "conf": conf})

        # Pick highest confidence gesture
        best = max(gestures, key=lambda g: g["conf"])
        self._history.append(best["gesture"])
        if len(self._history) > 10:
            self._history.pop(0)

        # Wave detection: alternating raised_hand / open_hand in history
        is_waving = self._detect_wave_pattern()

        return {
            "gesture": "waving" if is_waving else best["gesture"],
            "conf": 90.0 if is_waving else best["conf"],
            "hands_count": len(result.multi_hand_landmarks),
            "all_hands": gestures,
        }

    def _detect_wave_pattern(self) -> bool:
        """Detect waving: rapid alternation of raised/non-raised states."""
        if len(self._history) < 5:
            return False
        recent = [g for g in self._history[-6:] if g is not None]
        changes = sum(1 for i in range(1, len(recent)) if recent[i] != recent[i-1])
        return changes >= 3

    def draw_landmarks(self, frame: np.ndarray, result) -> np.ndarray:
        """Draw hand landmarks onto frame."""
        out = frame.copy()
        if result and result.multi_hand_landmarks:
            for lm in result.multi_hand_landmarks:
                MP_DRAW.draw_landmarks(out, lm, MP_HANDS.HAND_CONNECTIONS)
        return out

    def close(self):
        if self._hands:
            self._hands.close()


class PoseAnalyzer:
    """
    Pose-based injury and fall detection using MediaPipe Pose.
    Fallback when YOLO pose model is unavailable.
    """

    def __init__(self):
        if not MEDIAPIPE_AVAILABLE:
            self._pose = None
            return
        self._pose = MP_POSE.Pose(
            static_image_mode=False,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        log.info("PoseAnalyzer initialized (MediaPipe Pose)")

    def analyze(self, frame: np.ndarray) -> dict:
        if self._pose is None:
            return {"posture": "unknown", "score": 0.6, "injury_possible": False}

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = self._pose.process(rgb)

        if not result.pose_landmarks:
            return {"posture": "unknown", "score": 0.6, "injury_possible": False}

        lm = result.pose_landmarks.landmark

        # Key landmarks
        l_shoulder = lm[11]; r_shoulder = lm[12]
        l_hip      = lm[23]; r_hip      = lm[24]
        l_knee     = lm[25]; r_knee     = lm[26]
        l_wrist    = lm[15]; r_wrist    = lm[16]
        nose       = lm[0]

        mid_shoulder_y = (l_shoulder.y + r_shoulder.y) / 2
        mid_hip_y      = (l_hip.y + r_hip.y) / 2
        body_delta_y   = abs(mid_hip_y - mid_shoulder_y)

        # Fallen: body is horizontal (hips and shoulders at similar Y)
        if body_delta_y < 0.12:
            return {
                "posture": "fallen",
                "score": 0.85,
                "injury_possible": True,
                "details": "Body is horizontal — possible fallen/unconscious person",
            }

        # SOS: wrists above nose level
        wrist_y_avg = (l_wrist.y + r_wrist.y) / 2
        if wrist_y_avg < nose.y - 0.05:
            return {
                "posture": "sos_wave",
                "score": 0.95,
                "injury_possible": False,
                "details": "Arms raised above head — SOS signal detected",
            }

        # Sitting: knees bent, hips at mid-frame
        knee_y_avg = (l_knee.y + r_knee.y) / 2
        if knee_y_avg < mid_hip_y + 0.05:
            return {
                "posture": "sitting",
                "score": 0.75,
                "injury_possible": True,
                "details": "Seated position — possible injury or exhaustion",
            }

        return {
            "posture": "standing",
            "score": 0.60,
            "injury_possible": False,
            "details": "Upright posture detected",
        }

    def close(self):
        if self._pose:
            self._pose.close()
