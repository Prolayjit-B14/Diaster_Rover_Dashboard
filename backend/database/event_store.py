"""
RescueBOT — SQLite Event Store
Logs all AI detection events to a persistent timeline database.
"""
import sqlite3
import threading
import time
from pathlib import Path
from typing import List, Optional, Dict, Any
import sys, os

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from config.settings import DATABASE_PATH


class EventStore:
    """
    Thread-safe SQLite event logger for AI detections and alerts.
    Stores timeline entries, alert history, and session analytics.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._db_path = str(DATABASE_PATH)
        self._init_db()
        print(f"[EventStore] SQLite database ready: {self._db_path}")

    def _get_conn(self) -> sqlite3.Connection:
        """Returns a new connection (thread-local safe)."""
        conn = sqlite3.connect(self._db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        """Creates tables if they don't exist."""
        with self._lock:
            conn = self._get_conn()
            try:
                conn.executescript("""
                    CREATE TABLE IF NOT EXISTS timeline (
                        id          INTEGER PRIMARY KEY AUTOINCREMENT,
                        timestamp   INTEGER NOT NULL,
                        time_str    TEXT NOT NULL,
                        event       TEXT NOT NULL,
                        confidence  REAL DEFAULT 0.0,
                        severity    TEXT DEFAULT 'low',
                        label       TEXT DEFAULT '',
                        snapshot_ref TEXT DEFAULT NULL
                    );

                    CREATE TABLE IF NOT EXISTS alerts (
                        id          INTEGER PRIMARY KEY AUTOINCREMENT,
                        timestamp   INTEGER NOT NULL,
                        label       TEXT NOT NULL,
                        severity    TEXT NOT NULL,
                        confidence  REAL DEFAULT 0.0,
                        description TEXT DEFAULT '',
                        bbox_x      INTEGER DEFAULT 0,
                        bbox_y      INTEGER DEFAULT 0,
                        bbox_w      INTEGER DEFAULT 0,
                        bbox_h      INTEGER DEFAULT 0,
                        snapshot_path TEXT DEFAULT NULL
                    );

                    CREATE TABLE IF NOT EXISTS sessions (
                        id              INTEGER PRIMARY KEY AUTOINCREMENT,
                        start_time      INTEGER NOT NULL,
                        end_time        INTEGER DEFAULT NULL,
                        total_frames    INTEGER DEFAULT 0,
                        total_alerts    INTEGER DEFAULT 0,
                        persons_detected INTEGER DEFAULT 0,
                        fire_events     INTEGER DEFAULT 0,
                        gesture_events  INTEGER DEFAULT 0,
                        peak_priority   TEXT DEFAULT 'LOW'
                    );

                    CREATE INDEX IF NOT EXISTS idx_timeline_ts ON timeline(timestamp DESC);
                    CREATE INDEX IF NOT EXISTS idx_alerts_ts   ON alerts(timestamp DESC);
                """)
                conn.commit()
            finally:
                conn.close()

    # ── Timeline ──────────────────────────────────────────────────────────────
    def log_event(self, event: str, confidence: float = 0.0,
                  severity: str = "low", label: str = "",
                  snapshot_ref: Optional[str] = None):
        """Inserts a timeline entry."""
        now = int(time.time() * 1000)
        now_ts = time.localtime()
        time_str = time.strftime("%H:%M:%S", now_ts)

        with self._lock:
            conn = self._get_conn()
            try:
                conn.execute(
                    "INSERT INTO timeline (timestamp, time_str, event, confidence, severity, label, snapshot_ref) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (now, time_str, event, confidence, severity, label, snapshot_ref)
                )
                conn.commit()
            finally:
                conn.close()

    def get_timeline(self, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        """Returns recent timeline entries (newest first)."""
        with self._lock:
            conn = self._get_conn()
            try:
                rows = conn.execute(
                    "SELECT * FROM timeline ORDER BY timestamp DESC LIMIT ? OFFSET ?",
                    (limit, offset)
                ).fetchall()
                return [dict(r) for r in rows]
            finally:
                conn.close()

    def get_timeline_count(self) -> int:
        with self._lock:
            conn = self._get_conn()
            try:
                return conn.execute("SELECT COUNT(*) FROM timeline").fetchone()[0]
            finally:
                conn.close()

    # ── Alerts ────────────────────────────────────────────────────────────────
    def log_alert(self, label: str, severity: str, confidence: float,
                  description: str, bbox: Optional[tuple] = None,
                  snapshot_path: Optional[str] = None):
        """Persists an alert to the database."""
        now = int(time.time() * 1000)
        bx, by, bw, bh = bbox if bbox else (0, 0, 0, 0)

        with self._lock:
            conn = self._get_conn()
            try:
                conn.execute(
                    "INSERT INTO alerts (timestamp, label, severity, confidence, description, "
                    "bbox_x, bbox_y, bbox_w, bbox_h, snapshot_path) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (now, label, severity, confidence, description, bx, by, bw, bh, snapshot_path)
                )
                conn.commit()
            finally:
                conn.close()

    def get_alerts(self, limit: int = 50, offset: int = 0,
                   severity_filter: Optional[str] = None) -> List[Dict[str, Any]]:
        """Returns recent alerts (newest first)."""
        with self._lock:
            conn = self._get_conn()
            try:
                if severity_filter:
                    rows = conn.execute(
                        "SELECT * FROM alerts WHERE severity=? ORDER BY timestamp DESC LIMIT ? OFFSET ?",
                        (severity_filter, limit, offset)
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT * FROM alerts ORDER BY timestamp DESC LIMIT ? OFFSET ?",
                        (limit, offset)
                    ).fetchall()
                return [dict(r) for r in rows]
            finally:
                conn.close()

    def get_alert_count(self) -> int:
        with self._lock:
            conn = self._get_conn()
            try:
                return conn.execute("SELECT COUNT(*) FROM alerts").fetchone()[0]
            finally:
                conn.close()

    # ── Analytics ─────────────────────────────────────────────────────────────
    def get_analytics(self) -> Dict[str, Any]:
        """Returns aggregate session analytics."""
        with self._lock:
            conn = self._get_conn()
            try:
                total_alerts    = conn.execute("SELECT COUNT(*) FROM alerts").fetchone()[0]
                total_events    = conn.execute("SELECT COUNT(*) FROM timeline").fetchone()[0]
                fire_events     = conn.execute("SELECT COUNT(*) FROM alerts WHERE label='FIRE'").fetchone()[0]
                person_events   = conn.execute("SELECT COUNT(*) FROM alerts WHERE label='HUMAN'").fetchone()[0]
                gesture_events  = conn.execute("SELECT COUNT(*) FROM alerts WHERE label='GESTURE'").fetchone()[0]
                critical_count  = conn.execute("SELECT COUNT(*) FROM alerts WHERE severity='critical'").fetchone()[0]
                return {
                    "total_alerts": total_alerts,
                    "total_timeline_events": total_events,
                    "fire_events": fire_events,
                    "person_events": person_events,
                    "gesture_events": gesture_events,
                    "critical_events": critical_count,
                }
            finally:
                conn.close()
