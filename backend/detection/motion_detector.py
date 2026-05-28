"""
RescueBOT — Motion Detector
OpenCV MOG2 background subtraction for kinetic motion tracking.
"""
import cv2
import numpy as np
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config.settings import (
    MOTION_AREA_THRESHOLD,
    BG_SUBTRACTOR_HISTORY, BG_SUBTRACTOR_THRESHOLD
)
from models.schemas import MotionDetection, BBox


class MotionDetector:
    """
    OpenCV MOG2 background subtractor for real-time kinetic motion tracking.
    Returns a motion score and bounding box of the largest motion region.
    """

    def __init__(self):
        self._bg_sub = cv2.createBackgroundSubtractorMOG2(
            history=BG_SUBTRACTOR_HISTORY,
            varThreshold=BG_SUBTRACTOR_THRESHOLD,
            detectShadows=True
        )
        self._kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        print("[MotionDetector] MOG2 background subtractor initialized.")

    def detect(self, frame: np.ndarray) -> MotionDetection:
        """
        Runs background subtraction on the frame.

        Returns:
            MotionDetection with detected flag, 0-1 score, and bounding box.
        """
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        fg_mask = self._bg_sub.apply(gray)

        # Clean shadow noise with morphological opening
        fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_OPEN, self._kernel)

        contours, _ = cv2.findContours(
            fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )

        largest_contour = None
        max_area = 0.0

        for c in contours:
            area = cv2.contourArea(c)
            if area > MOTION_AREA_THRESHOLD and area > max_area:
                max_area = area
                largest_contour = c

        if largest_contour is not None:
            x, y, w, h = cv2.boundingRect(largest_contour)
            # Normalize score: area relative to frame area
            frame_area = frame.shape[0] * frame.shape[1]
            score = min(1.0, max_area / (frame_area * 0.25))  # cap at 25% frame coverage
            return MotionDetection(
                detected=True,
                score=round(score, 3),
                bbox=BBox(x=x, y=y, w=w, h=h)
            )

        return MotionDetection(detected=False, score=0.0)

    def draw(self, frame: np.ndarray, result: MotionDetection) -> np.ndarray:
        """Draws motion bounding box onto frame."""
        if result.detected and result.bbox:
            b = result.bbox
            cv2.rectangle(frame, (b.x, b.y), (b.x + b.w, b.y + b.h),
                          (255, 255, 0), 1)
            cv2.putText(frame, f"MOTION ({int(result.score * 100)}%)",
                        (b.x, b.y - 5), cv2.FONT_HERSHEY_SIMPLEX,
                        0.4, (255, 255, 0), 1)
        return frame
