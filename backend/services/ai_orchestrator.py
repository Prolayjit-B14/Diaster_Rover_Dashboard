"""
RescueBOT — AI Orchestrator
The central service that ties all detection modules together.
Runs the per-frame inference pipeline and maintains global state.
"""
import cv2
import numpy as np
import time
import threading
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config.settings import (
    FRAME_WIDTH, FRAME_HEIGHT,
    CLAHE_CLIP_LIMIT, CLAHE_TILE_SIZE, GAMMA_VALUE,
    LOW_LIGHT_THRESHOLD, BILATERAL_D, BILATERAL_SIGMA,
    SNAPSHOT_ON_PERSON, SNAPSHOT_ON_FIRE,
    SNAPSHOT_ON_GESTURE, SNAPSHOT_ON_CRITICAL,
)
from detection.stream_reader    import ThreadedStreamReader
from detection.motion_detector  import MotionDetector
from detection.fire_detector    import FireSmokeDetector
from detection.person_detector  import PersonDetector
from detection.gesture_detector import GestureDetector
from detection.blood_detector   import BloodDetector
from confidence_engine.survivor_confidence import SurvivorConfidenceEngine
from rescue_engine.priority_engine         import RescuePriorityEngine
from alerts.alert_engine                   import AlertEngine
from snapshots.snapshot_handler            import SnapshotHandler
from database.event_store                  import EventStore
from models.schemas import (
    LiveDetections, InjuryEstimation, LiveStatus,
    CameraStatus, PersonDetection, MotionDetection,
    FireDetection, SmokeDetection, GestureDetection, BloodDetection,
)


class AIOrchestrator:
    """
    Coordinates the full inference pipeline:
      1. Frame acquisition (ThreadedStreamReader)
      2. Preprocessing (denoise, gamma, CLAHE)
      3. Detection (motion, fire, smoke, person, gesture, blood)
      4. Confidence fusion (survivor, rescue priority)
      5. Alert generation
      6. Snapshot capture
      7. Event logging
      8. State publishing (via WebSocket broadcast callback)
    """

    def __init__(self):
        # Detection modules
        self._motion    = MotionDetector()
        self._fire      = FireSmokeDetector()
        self._person    = PersonDetector()
        self._gesture   = GestureDetector()
        self._blood     = BloodDetector()

        # Engines
        self._survivor  = SurvivorConfidenceEngine()
        self._priority  = RescuePriorityEngine()
        self._alerts    = AlertEngine()
        self._snapshots = SnapshotHandler()
        self._db        = EventStore()

        # Stream reader (initialized on connect)
        self._stream: ThreadedStreamReader | None = None

        # Preprocessing tools
        self._clahe = cv2.createCLAHE(
            clipLimit=CLAHE_CLIP_LIMIT,
            tileGridSize=CLAHE_TILE_SIZE
        )
        lut_vals = [((i / 255.0) ** (1.0 / GAMMA_VALUE)) * 255
                    for i in range(256)]
        self._gamma_lut = np.array(lut_vals, dtype="uint8")

        # Shared state (accessed by API routes)
        self._lock = threading.Lock()
        self._latest: LiveDetections = LiveDetections()
        self._camera_status: CameraStatus = CameraStatus()
        self._annotated_frame: np.ndarray | None = None
        self._session_start = time.time()
        self._total_frames = 0
        self._total_alerts = 0
        self._peak_priority = "LOW"

        # Broadcast callback (set by main.py)
        self._broadcast_cb = None
        self._running = False
        self._thread: threading.Thread | None = None

        print("[Orchestrator] All AI modules initialized.")

    # ── Public Control ────────────────────────────────────────────────────────
    def set_broadcast_callback(self, cb):
        """Sets the async broadcast callback (from WebSocket manager)."""
        self._broadcast_cb = cb

    def connect_stream(self, url: str, loop: bool = False, synthetic: bool = False):
        """Connects or reconnects to a camera stream."""
        if self._stream:
            self._stream.stop()
        self._stream = ThreadedStreamReader(url, loop=loop, synthetic=synthetic)
        self._stream.start()
        self._camera_status.stream_url = url
        self._camera_status.connected = False

    def start(self):
        """Starts the background inference loop."""
        self._running = True
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()
        print("[Orchestrator] Inference loop started.")

    def stop(self):
        self._running = False
        if self._stream:
            self._stream.stop()
        if self._thread:
            self._thread.join(timeout=5.0)
        print("[Orchestrator] Stopped.")

    def get_latest(self) -> LiveDetections:
        with self._lock:
            return self._latest

    def get_camera_status(self) -> CameraStatus:
        with self._lock:
            return self._camera_status

    def get_annotated_frame(self) -> np.ndarray | None:
        with self._lock:
            return self._annotated_frame.copy() if self._annotated_frame is not None else None

    def get_alert_engine(self) -> AlertEngine:
        return self._alerts

    def get_snapshot_handler(self) -> SnapshotHandler:
        return self._snapshots

    def get_event_store(self) -> EventStore:
        return self._db

    def get_analytics(self) -> dict:
        db_stats = self._db.get_analytics()
        return {
            "session_start": int(self._session_start * 1000),
            "uptime_seconds": round(time.time() - self._session_start, 1),
            "total_frames": self._total_frames,
            "total_alerts": self._total_alerts,
            "peak_rescue_priority": self._peak_priority,
            **db_stats
        }

    # ── Inference Loop ────────────────────────────────────────────────────────
    def _run_loop(self):
        """Background thread: reads frames and runs full pipeline."""
        import asyncio

        while self._running:
            if self._stream is None:
                time.sleep(0.1)
                continue

            frame = self._stream.read()
            if frame is None:
                time.sleep(0.01)
                continue

            try:
                result, annotated = self._process_frame(frame)

                with self._lock:
                    self._latest = result
                    self._annotated_frame = annotated
                    self._total_frames += 1
                    # Update camera status from stream stats
                    if self._stream:
                        s = self._stream.stats
                        self._camera_status.connected       = s.connected
                        self._camera_status.fps             = round(s.fps, 1)
                        self._camera_status.frames_processed = self._total_frames
                        self._camera_status.uptime_seconds  = round(
                            time.time() - self._session_start, 1)
                        self._camera_status.last_frame_age_ms = round(s.frame_age_ms, 1)
                        self._camera_status.reconnect_attempts = s.reconnect_attempts

                # Broadcast via WebSocket (run async callback)
                if self._broadcast_cb is not None:
                    try:
                        import asyncio
                        loop = asyncio.get_event_loop()
                        if loop.is_running():
                            asyncio.run_coroutine_threadsafe(
                                self._broadcast_cb(result, self._camera_status),
                                loop
                            )
                    except Exception:
                        pass

            except Exception as e:
                print(f"[Orchestrator] Frame processing error: {e}")

    # ── Frame Processing Pipeline ─────────────────────────────────────────────
    def _process_frame(self, frame: np.ndarray) -> tuple[LiveDetections, np.ndarray]:
        """Full AI pipeline for a single frame. Returns (result, annotated_frame)."""
        frame = self._preprocess(frame)
        annotated = frame.copy()

        # 1. Motion
        motion = self._motion.detect(frame)
        annotated = self._motion.draw(annotated, motion)

        # 2. Fire & Smoke
        fire, smoke = self._fire.detect(frame)
        annotated = self._fire.draw(annotated, fire, smoke)

        # 3. Person
        person = self._person.detect(frame, motion.bbox if motion.detected else None)
        annotated = self._person.draw(annotated, person)

        # 4. Gesture
        gesture = self._gesture.detect(frame)
        annotated = self._gesture.draw(annotated, gesture)

        # 5. Blood (only if person detected)
        blood = BloodDetection()
        if person.detected and person.bbox:
            blood = self._blood.detect_from_frame(frame, person.bbox)

        # 6. Injury estimation
        injury = self._estimate_injury(person, blood)

        # 7. Live status
        live_status = self._classify_live_status(person, motion)

        # 8. Survivor confidence
        survivor = self._survivor.compute(person, motion, gesture, blood, fire, smoke)

        # 9. Rescue priority
        priority, first_aid = self._priority.compute(
            person, fire, smoke, gesture, blood, survivor
        )

        # Track peak priority
        priority_order = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}
        if priority_order.get(priority.level, 0) > priority_order.get(self._peak_priority, 0):
            self._peak_priority = priority.level

        # 10. Alerts
        active_alerts = []
        if person.detected:
            a = self._alerts.alert_human(person.confidence, person.pose_state, person.bbox)
            if a:
                active_alerts.append(a)
                self._total_alerts += 1
                self._db.log_event(
                    f"Human detected — {person.pose_state}",
                    person.confidence, "medium", "HUMAN"
                )
                # Auto-snapshot
                if SNAPSHOT_ON_PERSON:
                    snap = self._snapshots.capture(annotated, "person")
                    if snap.success:
                        a.snapshot_path = snap.filename

        if fire.detected:
            a = self._alerts.alert_fire(fire.confidence, fire.bbox)
            if a:
                active_alerts.append(a)
                self._total_alerts += 1
                self._db.log_event("Fire detected", fire.confidence, "critical", "FIRE")
                if SNAPSHOT_ON_FIRE:
                    self._snapshots.capture(annotated, "fire")

        if smoke.detected:
            a = self._alerts.alert_smoke(smoke.confidence, smoke.density, smoke.bbox)
            if a:
                active_alerts.append(a)

        if gesture.detected and gesture.is_distress:
            a = self._alerts.alert_gesture(gesture.confidence, gesture.gesture_type)
            if a:
                active_alerts.append(a)
                self._total_alerts += 1
                self._db.log_event(
                    f"Gesture detected — {gesture.gesture_type}",
                    gesture.confidence, "high", "GESTURE"
                )
                if SNAPSHOT_ON_GESTURE:
                    self._snapshots.capture(annotated, "gesture")

        if motion.detected:
            a = self._alerts.alert_motion(motion.score, motion.bbox)
            if a:
                active_alerts.append(a)

        if priority.level == "CRITICAL":
            a = self._alerts.alert_critical_rescue(priority.score)
            if a:
                active_alerts.append(a)
                self._db.log_event(
                    "CRITICAL rescue priority triggered",
                    priority.score, "critical", "RESCUE"
                )
                if SNAPSHOT_ON_CRITICAL:
                    self._snapshots.capture(annotated, "critical")

        result = LiveDetections(
            person=person,
            fire=fire,
            smoke=smoke,
            motion=motion,
            gesture=gesture,
            blood=blood,
            injury=injury,
            live_status=live_status,
            survivor_confidence=survivor,
            rescue_priority=priority,
            first_aid_urgency=first_aid,
            active_alerts=active_alerts,
        )

        return result, annotated

    # ── Preprocessing ─────────────────────────────────────────────────────────
    def _preprocess(self, frame: np.ndarray) -> np.ndarray:
        """Phase 1: OpenCV preprocessing — denoise, gamma, CLAHE."""
        h, w = frame.shape[:2]
        if w != FRAME_WIDTH or h != FRAME_HEIGHT:
            frame = cv2.resize(frame, (FRAME_WIDTH, FRAME_HEIGHT),
                               interpolation=cv2.INTER_LINEAR)

        # Bilateral denoise (edge-preserving)
        frame = cv2.bilateralFilter(frame, d=BILATERAL_D,
                                    sigmaColor=BILATERAL_SIGMA,
                                    sigmaSpace=BILATERAL_SIGMA)

        # Gamma correction for low-light
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        if float(np.mean(gray)) < LOW_LIGHT_THRESHOLD:
            frame = cv2.LUT(frame, self._gamma_lut)

        # CLAHE on L-channel (smoke contrast)
        lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        l = self._clahe.apply(l)
        frame = cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)

        return frame

    # ── Helper Classifiers ────────────────────────────────────────────────────
    def _estimate_injury(self, person: PersonDetection, blood: BloodDetection) -> InjuryEstimation:
        NOTE = "Estimation only — Not a medical diagnosis."
        if person.pose_state == "fallen" and person.is_motionless:
            return InjuryEstimation(estimated=True, label="possible_unconscious", note=NOTE)
        if person.pose_state == "fallen":
            return InjuryEstimation(estimated=True, label="fallen", note=NOTE)
        if person.pose_state == "distress" or blood.detected:
            return InjuryEstimation(estimated=True, label="possible_injury", note=NOTE)
        if person.detected:
            return InjuryEstimation(estimated=False, label="none", note=NOTE)
        return InjuryEstimation()

    def _classify_live_status(self, person: PersonDetection,
                               motion: MotionDetection) -> LiveStatus:
        NOTE = "No alive/dead classification is made by this system."
        if not person.detected:
            return LiveStatus(label="unknown", note=NOTE)
        if person.is_motionless and person.pose_state == "fallen":
            return LiveStatus(label="possible_unconscious", note=NOTE)
        if motion.detected and motion.score > 0.4:
            return LiveStatus(label="active_survivor", note=NOTE)
        if motion.detected:
            return LiveStatus(label="low_movement", note=NOTE)
        return LiveStatus(label="needs_rescue_verification", note=NOTE)
