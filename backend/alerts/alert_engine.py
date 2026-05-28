"""
RescueBOT — Alert Engine
Generates, de-duplicates, and manages cooldown for AI detection alerts.
Publishes to MQTT and maintains an in-memory alert queue.
"""
import time
import json
import threading
from collections import deque
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config.settings import ALERT_COOLDOWN_SEC, MAX_ALERT_HISTORY
from models.schemas import Alert, BBox


class AlertEngine:
    """
    Generates alerts from detection events with:
    - Per-type cooldown to prevent alert flooding
    - In-memory rolling history (thread-safe deque)
    - Optional MQTT publishing bridge
    - Auto-incrementing alert IDs
    """

    def __init__(self, mqtt_client=None):
        self._mqtt = mqtt_client
        self._lock = threading.Lock()
        self._history: deque[Alert] = deque(maxlen=MAX_ALERT_HISTORY)
        self._cooldowns: dict[str, float] = {}
        self._alert_id_counter = 0
        print("[AlertEngine] Initialized with cooldown: {:.1f}s".format(ALERT_COOLDOWN_SEC))

    # ── Public API ────────────────────────────────────────────────────────────
    def try_alert(
        self,
        label: str,
        severity: str,
        confidence: float,
        description: str,
        bbox: BBox | None = None,
        snapshot_path: str | None = None
    ) -> Alert | None:
        """
        Attempts to emit an alert if cooldown has expired.

        Args:
            label: HUMAN | FIRE | SMOKE | MOTION | GESTURE | HAZARD
            severity: low | medium | high | critical
            confidence: 0.0–1.0
            description: Human-readable alert message
            bbox: Optional bounding box
            snapshot_path: Optional auto-snapshot file reference

        Returns:
            Alert object if emitted, None if suppressed by cooldown.
        """
        key = f"{label}_{severity}"
        now = time.time()

        with self._lock:
            last = self._cooldowns.get(key, 0.0)
            if now - last < ALERT_COOLDOWN_SEC:
                return None  # Still in cooldown

            self._alert_id_counter += 1
            alert = Alert(
                id=self._alert_id_counter,
                timestamp=int(now * 1000),
                label=label,
                severity=severity,
                confidence=round(confidence, 3),
                description=description,
                bbox=bbox,
                snapshot_path=snapshot_path
            )

            self._history.appendleft(alert)
            self._cooldowns[key] = now

        # Publish to MQTT (outside lock)
        self._publish_mqtt(alert)
        self._log(alert)
        return alert

    def get_recent(self, limit: int = 50) -> list[Alert]:
        """Returns the most recent alerts (newest first)."""
        with self._lock:
            return list(self._history)[:limit]

    def get_count(self) -> int:
        with self._lock:
            return len(self._history)

    def set_mqtt(self, mqtt_client):
        self._mqtt = mqtt_client

    # ── Alert Generation Helpers ──────────────────────────────────────────────
    def alert_human(self, confidence: float, pose_state: str,
                    bbox: BBox | None = None, snapshot: str | None = None) -> Alert | None:
        label_map = {
            "fallen":    ("HUMAN DETECTED — Fallen person", "high"),
            "distress":  ("HUMAN DETECTED — Distress posture", "high"),
            "standing":  ("HUMAN DETECTED — Standing person", "medium"),
            "motionless": ("HUMAN DETECTED — Motionless person", "critical"),
        }
        text, severity = label_map.get(pose_state, ("HUMAN DETECTED", "medium"))
        if pose_state == "fallen":
            severity = "critical" if confidence > 0.75 else "high"
        return self.try_alert("HUMAN", severity, confidence, text, bbox, snapshot)

    def alert_fire(self, confidence: float, bbox: BBox | None = None,
                   snapshot: str | None = None) -> Alert | None:
        return self.try_alert(
            "FIRE", "critical", confidence,
            f"FIRE DETECTED ({int(confidence * 100)}%) — Active flame thermal zone isolated.",
            bbox, snapshot
        )

    def alert_smoke(self, confidence: float, density: str,
                    bbox: BBox | None = None) -> Alert | None:
        sev = "high" if density == "dense" else "medium"
        return self.try_alert(
            "SMOKE", sev, confidence,
            f"SMOKE DETECTED ({int(confidence * 100)}%) — {density.capitalize()} smoke plume.",
            bbox
        )

    def alert_gesture(self, confidence: float, gesture_type: str,
                      bbox: BBox | None = None, snapshot: str | None = None) -> Alert | None:
        return self.try_alert(
            "GESTURE", "high", confidence,
            f"HELP GESTURE DETECTED — {gesture_type.replace('_', ' ').upper()} ({int(confidence * 100)}%)",
            bbox, snapshot
        )

    def alert_motion(self, score: float, bbox: BBox | None = None) -> Alert | None:
        return self.try_alert(
            "MOTION", "low", score,
            f"MOTION DETECTED — Kinetic activity score: {int(score * 100)}%",
            bbox
        )

    def alert_critical_rescue(self, priority_score: float,
                               snapshot: str | None = None) -> Alert | None:
        return self.try_alert(
            "RESCUE", "critical", priority_score,
            f"CRITICAL RESCUE PRIORITY — Immediate response required. Score: {int(priority_score * 100)}%",
            None, snapshot
        )

    # ── Internal ──────────────────────────────────────────────────────────────
    def _publish_mqtt(self, alert: Alert):
        """Publishes alert to MQTT topic for legacy dashboard compatibility."""
        if self._mqtt is None:
            return
        try:
            from config.settings import TOPIC_ALERTS
            payload = {
                "type": "DETECTION",
                "label": alert.label,
                "conf": int(alert.confidence * 100),
                "x": alert.bbox.x if alert.bbox else 0,
                "y": alert.bbox.y if alert.bbox else 0,
                "w": alert.bbox.w if alert.bbox else 0,
                "h": alert.bbox.h if alert.bbox else 0,
                "severity": alert.severity,
                "timestamp": alert.timestamp,
                "desc": alert.description,
            }
            self._mqtt.publish(TOPIC_ALERTS, json.dumps(payload), qos=1)
        except Exception as e:
            print(f"[AlertEngine] MQTT publish failed: {e}")

    def _log(self, alert: Alert):
        print(
            f"[Alert] [{alert.severity.upper()}] {alert.label} "
            f"({int(alert.confidence * 100)}%) — {alert.description[:60]}"
        )
