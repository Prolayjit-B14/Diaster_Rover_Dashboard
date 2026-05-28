"""
RescueBOT — Survivor Confidence Engine
Computes a weighted probability score that the detected person is a survivor
in need of rescue.

Formula:
  survivor_confidence = 0.35 × person_confidence
                      + 0.20 × motion_score
                      + 0.20 × gesture_score
                      + 0.15 × injury_score
                      + 0.10 × environmental_risk

Weights are fully configurable in config/settings.py.
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config.settings import (
    SURVIVOR_WEIGHT_PERSON,
    SURVIVOR_WEIGHT_MOTION,
    SURVIVOR_WEIGHT_GESTURE,
    SURVIVOR_WEIGHT_INJURY,
    SURVIVOR_WEIGHT_ENV_RISK,
)
from models.schemas import (
    SurvivorConfidence, PersonDetection, MotionDetection,
    GestureDetection, BloodDetection, FireDetection, SmokeDetection
)


class SurvivorConfidenceEngine:
    """
    Computes a single survivor confidence score by fusing outputs from all
    AI detection modules using configurable weighted averaging.
    """

    def compute(
        self,
        person: PersonDetection,
        motion: MotionDetection,
        gesture: GestureDetection,
        blood: BloodDetection,
        fire: FireDetection,
        smoke: SmokeDetection,
    ) -> SurvivorConfidence:
        """
        Calculates survivor confidence on a 0.0–1.0 scale.

        Returns:
            SurvivorConfidence with final score and per-component breakdown.
        """
        if not person.detected:
            return SurvivorConfidence(score=0.0, breakdown={})

        # ── Component scores (all normalised to 0–1) ─────────────────────────
        person_conf = float(person.confidence)

        # Motion score: direct from motion detector
        motion_score = float(motion.score) if motion.detected else 0.0

        # Gesture score: distress gestures weight higher
        gesture_score = 0.0
        if gesture.detected:
            gesture_score = float(gesture.confidence)
            if gesture.is_distress:
                gesture_score = min(1.0, gesture_score * 1.15)  # boost distress

        # Injury score: derived from posture + blood
        injury_score = 0.0
        if person.pose_state == "fallen":
            injury_score += 0.55
        elif person.pose_state == "distress":
            injury_score += 0.40
        if person.is_motionless:
            injury_score += 0.30
        if blood.detected:
            injury_score += min(0.30, blood.score / 15.0)  # normalize blood %
        injury_score = min(1.0, injury_score)

        # Environmental risk: fire and smoke proximity increase urgency
        env_risk = 0.0
        if fire.detected:
            env_risk += 0.60
        if smoke.detected:
            density_map = {"dense": 0.40, "medium": 0.25, "low": 0.10}
            env_risk += density_map.get(smoke.density, 0.10)
        env_risk = min(1.0, env_risk)

        # ── Weighted fusion ───────────────────────────────────────────────────
        score = (
            SURVIVOR_WEIGHT_PERSON   * person_conf  +
            SURVIVOR_WEIGHT_MOTION   * motion_score +
            SURVIVOR_WEIGHT_GESTURE  * gesture_score +
            SURVIVOR_WEIGHT_INJURY   * injury_score +
            SURVIVOR_WEIGHT_ENV_RISK * env_risk
        )
        score = round(min(1.0, max(0.0, score)), 3)

        breakdown = {
            "person_confidence":  round(person_conf, 3),
            "motion_score":       round(motion_score, 3),
            "gesture_score":      round(gesture_score, 3),
            "injury_score":       round(injury_score, 3),
            "environmental_risk": round(env_risk, 3),
            "weights": {
                "person":   SURVIVOR_WEIGHT_PERSON,
                "motion":   SURVIVOR_WEIGHT_MOTION,
                "gesture":  SURVIVOR_WEIGHT_GESTURE,
                "injury":   SURVIVOR_WEIGHT_INJURY,
                "env_risk": SURVIVOR_WEIGHT_ENV_RISK,
            }
        }

        return SurvivorConfidence(score=score, breakdown=breakdown)
