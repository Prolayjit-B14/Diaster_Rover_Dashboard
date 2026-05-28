"""
RescueBOT — Threaded ESP32-CAM Stream Reader
Drains the MJPEG stream in a background thread for zero-latency frame delivery.
Handles reconnects, timeouts, synthetic mode, webcam, and local video files.
"""
import cv2
import time
import queue
import threading
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config.settings import (
    FRAME_WIDTH, FRAME_HEIGHT, ESP32_RETRY_DELAY,
    INFERENCE_FPS
)


class StreamStats:
    """Tracks per-stream performance metrics."""
    def __init__(self):
        self.fps: float = 0.0
        self.latency_ms: float = 0.0
        self.frames_read: int = 0
        self.reconnect_attempts: int = 0
        self.last_frame_ts: float = 0.0
        self._fps_times: list = []
        self.connected: bool = False

    def record_frame(self):
        now = time.time()
        self.frames_read += 1
        self.last_frame_ts = now
        self.connected = True
        self._fps_times.append(now)
        # Keep only last 30 timestamps for rolling FPS
        if len(self._fps_times) > 30:
            self._fps_times.pop(0)
        if len(self._fps_times) >= 2:
            elapsed = self._fps_times[-1] - self._fps_times[0]
            self.fps = (len(self._fps_times) - 1) / elapsed if elapsed > 0 else 0.0
        # Latency = time since last frame
        self.latency_ms = 0.0

    @property
    def frame_age_ms(self) -> float:
        if self.last_frame_ts == 0:
            return 9999.0
        return (time.time() - self.last_frame_ts) * 1000.0


class ThreadedStreamReader:
    """
    Background-threaded MJPEG/webcam/file stream consumer.

    Modes:
      - stream_url = "http://ip:81/stream"  → ESP32 MJPEG
      - stream_url = "0", "1"               → local webcam index
      - stream_url = "path/to/file.mp4"     → local video (loop)
      - synthetic = True                    → generate HUD test frames
    """

    def __init__(self, stream_url: str = "", loop: bool = False,
                 synthetic: bool = False):
        self.stream_url = stream_url
        self.loop = loop
        self.synthetic = synthetic

        self._frame_queue: queue.Queue = queue.Queue(maxsize=2)
        self._running = False
        self._thread: threading.Thread | None = None
        self._cap: cv2.VideoCapture | None = None
        self.stats = StreamStats()

        # For synthetic HUD
        try:
            import numpy as np
            self._np = np
        except ImportError:
            self._np = None

    # ── Public API ────────────────────────────────────────────────────────────
    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._update_loop, daemon=True)
        self._thread.start()
        mode = "SYNTHETIC" if self.synthetic else self.stream_url
        print(f"[StreamReader] Started → {mode}")

    def stop(self):
        self._running = False
        if self._cap:
            self._cap.release()
        if self._thread:
            self._thread.join(timeout=3.0)
        print("[StreamReader] Stopped.")

    def read(self):
        """Returns the latest frame or None if queue is empty."""
        try:
            return self._frame_queue.get_nowait()
        except queue.Empty:
            return None

    def update_url(self, url: str):
        """Hot-swap the stream URL (e.g., when user changes ESP32 IP)."""
        self.stream_url = url
        self.synthetic = False
        if self._cap:
            self._cap.release()
            self._cap = None
        self.stats.reconnect_attempts += 1
        print(f"[StreamReader] URL updated → {url}")

    # ── Internal Loop ─────────────────────────────────────────────────────────
    def _push_frame(self, frame):
        """Replace queue content with the freshest frame."""
        if not self._frame_queue.empty():
            try:
                self._frame_queue.get_nowait()
            except queue.Empty:
                pass
        self._frame_queue.put(frame)
        self.stats.record_frame()

    def _update_loop(self):
        """Main background thread loop."""
        while self._running:
            if self.synthetic:
                self._synthetic_loop()
            else:
                self._stream_loop()

    def _synthetic_loop(self):
        """Generates a tactical HUD test frame at ~15 FPS."""
        import numpy as np
        while self._running and self.synthetic:
            frame = np.zeros((FRAME_HEIGHT, FRAME_WIDTH, 3), dtype=np.uint8)
            # Grid
            for y in range(0, FRAME_HEIGHT, 40):
                cv2.line(frame, (0, y), (FRAME_WIDTH, y), (15, 35, 15), 1)
            for x in range(0, FRAME_WIDTH, 40):
                cv2.line(frame, (x, 0), (x, FRAME_HEIGHT), (15, 35, 15), 1)
            # Radar pulse
            pulse = int((time.time() * 2.5) % 15)
            cv2.circle(frame, (FRAME_WIDTH // 2, FRAME_HEIGHT // 2),
                       100 + pulse * 3, (0, 80, 0), 1)
            cv2.circle(frame, (FRAME_WIDTH // 2, FRAME_HEIGHT // 2), 5, (0, 255, 0), -1)
            cv2.putText(frame, "RESCUEBOT SYNTHETIC STREAM",
                        (120, FRAME_HEIGHT // 2 - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 0), 1)
            cv2.putText(frame, f"CLOCK: {time.strftime('%H:%M:%S')}",
                        (20, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 212, 255), 1)
            self._push_frame(frame)
            time.sleep(1.0 / 15.0)

    def _stream_loop(self):
        """Reads frames from ESP32/webcam/file with auto-reconnect."""
        while self._running and not self.synthetic:
            try:
                # Resolve source
                try:
                    source = int(self.stream_url)  # webcam index
                except ValueError:
                    source = self.stream_url

                self._cap = cv2.VideoCapture(source)

                if not self._cap.isOpened():
                    print(f"[StreamReader] Cannot open source. Retrying in {ESP32_RETRY_DELAY}s...")
                    self.stats.reconnect_attempts += 1
                    self.stats.connected = False
                    time.sleep(ESP32_RETRY_DELAY)
                    continue

                print(f"[StreamReader] Connected → {self.stream_url}")
                self.stats.connected = True

                frame_interval = 1.0 / INFERENCE_FPS
                last_frame_time = 0.0

                while self._running:
                    ret, frame = self._cap.read()
                    if not ret:
                        if self.loop:
                            self._cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                            continue
                        print("[StreamReader] Stream dropped. Reconnecting...")
                        self.stats.connected = False
                        break

                    # FPS throttle for local files
                    now = time.time()
                    if isinstance(source, str) and not source.startswith("http"):
                        elapsed = now - last_frame_time
                        if elapsed < frame_interval:
                            time.sleep(frame_interval - elapsed)
                    last_frame_time = time.time()

                    self._push_frame(frame)

            except Exception as e:
                print(f"[StreamReader] Error: {e}. Retrying in {ESP32_RETRY_DELAY}s...")
                self.stats.connected = False
                self.stats.reconnect_attempts += 1
                time.sleep(ESP32_RETRY_DELAY)
