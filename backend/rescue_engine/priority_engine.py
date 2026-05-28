"""
RescueBOT — Rescue Priority Engine
Computes the rescue priority level (LOW / MEDIUM / HIGH / CRITICAL)
based on weighted fusion of all detection signals.

Formula:
  priority_score = 0.30 × injury_score
                 + 0.20 × fire_proximity
                 + 0.15 × smoke_level
                 + 0.15 × survivor_confidence
                 + 0.10 × gesture_urgency
                 + 0.10 × blood_score
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config.settings import (
    PRIORITY_WEIGHT_INJURY,
    PRIORITY_WEIGHT_FIRE,
    PRIORITY_WEIGHT_SMOKE,
    PRIORITY_WEIGHT_SURVIVOR,
    PRIORITY_WEIGHT_GESTURE,
    PRIORITY_WEIGHT_BLOOD,
    PRIORITY_CRITICAL_THRESHOLD,
    PRIORITY_HIGH_THRESHOLD,
    PRIORITY_MEDIUM_THRESHOLD,
)
from models.schemas import (
    RescuePriority, FirstAidUrgency,
    PersonDetection, FireDetection, SmokeDetection,
    GestureDetection, BloodDetection, SurvivorConfidence
)


class RescuePriorityEngine:
    """
    Computes rescue priority and first aid urgency from all sensor inputs.
    Outputs a priority level (LOW/MEDIUM/HIGH/CRITICAL) and a numeric score.

    NOTE: First Aid Urgency output is estimation only — NOT a medical diagnosis.
    """

    def compute(
        self,
        person: PersonDetection,
        fire: FireDetection,
        smoke: SmokeDetection,
        gesture: GestureDetection,
        blood: BloodDetection,
        survivor: SurvivorConfidence,
    ) -> tuple[RescuePriority, FirstAidUrgency]:
        """
        Returns (RescuePriority, FirstAidUrgency).
        """
        if not person.detected:
            return (
                RescuePriority(level="LOW", score=0.0),
                FirstAidUrgency(level="needs_verification")
            )

        # ── Component scores ──────────────────────────────────────────────────
        # Injury score from posture + motionless state
        injury_score = 0.0
        if person.pose_state == "fallen" and person.is_motionless:
            injury_score = 1.0
        elif person.pose_state == "fallen":
            injury_score = 0.75
        elif person.pose_state == "distress":
            injury_score = 0.55
        elif person.pose_state == "standing":
            injury_score = 0.20

        # Fire proximity (fire detected = maximum fire risk)
        fire_proximity = float(fire.confidence) if fire.detected else 0.0

        # Smoke level
        smoke_level = 0.0
        if smoke.detected:
            density_map = {"dense": 1.0, "medium": 0.65, "low": 0.30}
            smoke_level = density_map.get(smoke.density, 0.30)

        # Gesture urgency
        gesture_urgency = 0.0
        if gesture.detected and gesture.is_distress:
            gesture_urgency = float(gesture.confidence)

        # Blood score
        blood_score = 0.0
        if blood.detected:
            blood_score = min(1.0, blood.score / 10.0)

        # Survivor confidence (0–1)
        survivor_conf = float(survivor.score)

        # ── Weighted priority score ───────────────────────────────────────────
        score = (
            PRIORITY_WEIGHT_INJURY   * injury_score   +
            PRIORITY_WEIGHT_FIRE     * fire_proximity  +
            PRIORITY_WEIGHT_SMOKE    * smoke_level     +
            PRIORITY_WEIGHT_SURVIVOR * survivor_conf   +
            PRIORITY_WEIGHT_GESTURE  * gesture_urgency +
            PRIORITY_WEIGHT_BLOOD    * blood_score
        )
        score = round(min(1.0, max(0.0, score)), 3)

        # ── Map score to level ────────────────────────────────────────────────
        if score >= PRIORITY_CRITICAL_THRESHOLD:
            level = "CRITICAL"
        elif score >= PRIORITY_HIGH_THRESHOLD:
            level = "HIGH"
        elif score >= PRIORITY_MEDIUM_THRESHOLD:
            level = "MEDIUM"
        else:
            level = "LOW"

        breakdown = {
            "injury_score":     round(injury_score, 3),
            "fire_proximity":   round(fire_proximity, 3),
            "smoke_level":      round(smoke_level, 3),
            "survivor_conf":    round(survivor_conf, 3),
            "gesture_urgency":  round(gesture_urgency, 3),
            "blood_score":      round(blood_score, 3),
        }

        priority = RescuePriority(level=level, score=score, breakdown=breakdown)

        # ── First Aid Urgency (estimation only, NOT a medical diagnosis) ──────
        urgency = self._estimate_first_aid(score, injury_score, blood_score, person)

        return priority, urgency

    def _estimate_first_aid(
        self, score: float, injury: float,
        blood: float, person: PersonDetection
    ) -> FirstAidUrgency:
        """
        Estimates first aid urgency level.
        NEVER classifies alive/dead. NOT a medical diagnosis.
        """
        NOTE = "Estimation only — Not a medical diagnosis. Always verify with trained personnel."

        if person.is_motionless and person.pose_state == "fallen":
            return FirstAidUrgency(level="immediate_attention", note=NOTE)
        if score >= PRIORITY_HIGH_THRESHOLD or blood > 0.5:
            return FirstAidUrgency(level="immediate_attention", note=NOTE)
        if score >= PRIORITY_MEDIUM_THRESHOLD:
            return FirstAidUrgency(level="medium_urgency", note=NOTE)
        if person.detected and score > 0.1:
            return FirstAidUrgency(level="low_urgency", note=NOTE)
        return FirstAidUrgency(level="needs_verification", note=NOTE)
