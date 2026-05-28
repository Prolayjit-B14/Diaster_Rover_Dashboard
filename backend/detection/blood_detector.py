"""
RescueBOT — Blood Detector
HSV color segmentation for blood/wound identification.

IMPORTANT LIMITATIONS:
  - Detects red-color regions only (HSV masking).
  - Many non-blood objects share red tones (clothing, objects, etc.).
  - Result is INDICATIVE ONLY and must never be used for medical decisions.
  - System output always includes a disclaimer note.
"""
import cv2
import numpy as np
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config.settings import BLOOD_RATIO_MIN, BLOOD_RATIO_MAX
from models.schemas import BloodDetection


class BloodDetector:
    """
    HSV-based blood/wound region detector.

    Scans the person bounding box ROI for localized crimson/dark-red regions.
    A morphological open filter removes speckle noise before counting.

    Limitations (always disclosed):
    - False positives from: red clothing, fire reflections, colored objects.
    - Cannot distinguish fresh blood from dry blood or red paint.
    - Not a medical instrument. Result is visual-only estimation.
    """

    DISCLAIMER = (
        "Indicative only — red-region color signature detected. "
        "Not a medical assessment. Many non-blood objects share similar hues."
    )

    def __init__(self):
        self._morph_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        print("[BloodDetector] HSV blood detector initialized. (Indicative only)")

    def detect(self, roi: np.ndarray) -> BloodDetection:
        """
        Scans an ROI (person bounding box crop) for blood-red color signatures.

        Args:
            roi: BGR image crop of the detected person region.

        Returns:
            BloodDetection with score (pixel ratio %) and disclaimer note.
        """
        if roi is None or roi.size == 0:
            return BloodDetection(note=self.DISCLAIMER)

        hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)

        # Two HSV ranges covering crimson/blood red (wraps around hue wheel)
        mask1 = cv2.inRange(hsv,
                            np.array([0,   110,  70]),
                            np.array([10,  255, 230]))
        mask2 = cv2.inRange(hsv,
                            np.array([170, 110,  70]),
                            np.array([180, 255, 230]))
        mask = cv2.bitwise_or(mask1, mask2)

        # Morphological open to remove noise speckles
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, self._morph_kernel)

        red_pixels = cv2.countNonZero(mask)
        total_pixels = roi.shape[0] * roi.shape[1]
        percentage = (red_pixels / total_pixels) * 100.0 if total_pixels > 0 else 0.0

        # Focal concentration check: localized wound signature
        is_blood = BLOOD_RATIO_MIN < percentage < BLOOD_RATIO_MAX

        return BloodDetection(
            detected=is_blood,
            score=round(percentage, 2),
            note=self.DISCLAIMER
        )

    def detect_from_frame(self, frame: np.ndarray, person_bbox) -> BloodDetection:
        """
        Convenience wrapper: extracts the ROI from a full frame using the person bbox.
        """
        if person_bbox is None:
            return BloodDetection(note=self.DISCLAIMER)
        x, y, w, h = person_bbox.x, person_bbox.y, person_bbox.w, person_bbox.h
        h_img, w_img = frame.shape[:2]
        x1, y1 = max(0, x), max(0, y)
        x2, y2 = min(w_img, x + w), min(h_img, y + h)
        roi = frame[y1:y2, x1:x2]
        return self.detect(roi)
