"""
RescueBOT — Snapshot Handler
Auto-captures and saves annotated JPEG frames when AI triggers fire, human,
gesture, or CRITICAL rescue priority events.
"""
import cv2
import time
import os
import threading
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config.settings import SNAPSHOTS_DIR, SNAPSHOT_MAX_FILES
from models.schemas import SnapshotResult


class SnapshotHandler:
    """
    Manages automatic and manual snapshot capture from AI-annotated frames.

    Features:
    - Timestamped JPEG files saved to /snapshots/captures/
    - Automatic rotation (SNAPSHOT_MAX_FILES limit)
    - Thread-safe capture queue
    - Trigger-type metadata in filename
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._snapshots_dir = SNAPSHOTS_DIR
        self._snapshots_dir.mkdir(parents=True, exist_ok=True)
        self._capture_count = 0
        print(f"[SnapshotHandler] Saving to: {self._snapshots_dir}")

    def capture(self, frame, trigger: str = "manual") -> SnapshotResult:
        """
        Saves an annotated frame as JPEG.

        Args:
            frame: OpenCV BGR frame (already annotated)
            trigger: manual | person | fire | gesture | critical

        Returns:
            SnapshotResult with filename, path, and success flag.
        """
        if frame is None:
            return SnapshotResult(success=False, trigger=trigger)

        with self._lock:
            # Rotate old snapshots if over limit
            self._rotate_if_needed()

            ts = int(time.time() * 1000)
            time_label = time.strftime("%Y%m%d_%H%M%S")
            filename = f"snap_{time_label}_{trigger}.jpg"
            filepath = self._snapshots_dir / filename

            try:
                success = cv2.imwrite(str(filepath), frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
                if success:
                    self._capture_count += 1
                    print(f"[SnapshotHandler] Saved: {filename}")
                    return SnapshotResult(
                        success=True,
                        filename=filename,
                        path=str(filepath),
                        timestamp=ts,
                        trigger=trigger
                    )
                else:
                    return SnapshotResult(success=False, trigger=trigger)
            except Exception as e:
                print(f"[SnapshotHandler] Error saving snapshot: {e}")
                return SnapshotResult(success=False, trigger=trigger)

    def list_snapshots(self) -> list[dict]:
        """Returns metadata list of all saved snapshots (newest first)."""
        with self._lock:
            files = sorted(
                self._snapshots_dir.glob("snap_*.jpg"),
                key=lambda f: f.stat().st_mtime,
                reverse=True
            )
            return [
                {
                    "filename": f.name,
                    "path": str(f),
                    "size_kb": round(f.stat().st_size / 1024, 1),
                    "modified": int(f.stat().st_mtime * 1000)
                }
                for f in files
            ]

    def _rotate_if_needed(self):
        """Deletes oldest snapshot files if count exceeds limit."""
        files = sorted(
            self._snapshots_dir.glob("snap_*.jpg"),
            key=lambda f: f.stat().st_mtime
        )
        while len(files) >= SNAPSHOT_MAX_FILES:
            try:
                files[0].unlink()
                files.pop(0)
            except Exception:
                break
