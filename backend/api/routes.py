"""
RescueBOT — REST API Routes
All FastAPI route handlers. Reads from the global AIOrchestrator singleton.
"""
import time
import cv2
import io
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse, JSONResponse

from models.schemas import (
    CameraStatus, LiveDetections, AlertList, TimelineList,
    AnalyticsSummary, SnapshotResult, CameraConnectRequest, Alert, TimelineEntry
)

router = APIRouter()

# ── Injected by main.py ───────────────────────────────────────────────────────
orchestrator = None   # set via set_orchestrator()

def set_orchestrator(orch):
    global orchestrator
    orchestrator = orch


def _require_orchestrator():
    if orchestrator is None:
        raise HTTPException(status_code=503, detail="AI engine not initialized.")
    return orchestrator


# ── Camera ────────────────────────────────────────────────────────────────────
@router.get("/camera/status", response_model=CameraStatus, tags=["Camera"])
async def get_camera_status():
    """Returns current camera connection status, FPS, latency, and stream info."""
    orch = _require_orchestrator()
    return orch.get_camera_status()


@router.get("/camera/frame", tags=["Camera"])
async def get_camera_frame():
    """
    Returns the latest AI-annotated frame as a JPEG image.
    Suitable for <img src="/camera/frame"> with polling or SSE.
    """
    orch = _require_orchestrator()
    frame = orch.get_annotated_frame()
    if frame is None:
        raise HTTPException(status_code=404, detail="No frame available.")
    ret, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    if not ret:
        raise HTTPException(status_code=500, detail="Frame encoding failed.")
    return StreamingResponse(io.BytesIO(jpeg.tobytes()), media_type="image/jpeg")


@router.post("/camera/connect", response_model=CameraStatus, tags=["Camera"])
async def connect_camera(req: CameraConnectRequest):
    """Sets the ESP32-CAM IP and reconnects the stream."""
    orch = _require_orchestrator()
    url = f"http://{req.ip}:{req.port}/stream" if req.use_stream \
          else f"http://{req.ip}/capture"
    orch.connect_stream(url)
    return orch.get_camera_status()


# ── Detections ────────────────────────────────────────────────────────────────
@router.get("/detections/live", response_model=LiveDetections, tags=["Detections"])
async def get_live_detections():
    """
    Returns a full snapshot of the current frame's AI detections.
    Includes all modules: person, fire, smoke, motion, gesture, blood,
    survivor confidence, rescue priority, first aid urgency.
    """
    orch = _require_orchestrator()
    return orch.get_latest()


# ── Alerts ────────────────────────────────────────────────────────────────────
@router.get("/alerts", tags=["Alerts"])
async def get_alerts(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    severity: str = Query(default=None)
):
    """
    Returns recent AI-generated alerts with optional severity filter.

    Response schema:
    {
      "alerts": [ Alert ],
      "total": int
    }
    """
    orch = _require_orchestrator()
    db = orch.get_event_store()
    rows = db.get_alerts(limit=limit, offset=offset, severity_filter=severity)
    total = db.get_alert_count()

    alerts = []
    for row in rows:
        alerts.append(Alert(
            id=row["id"],
            timestamp=row["timestamp"],
            label=row["label"],
            severity=row["severity"],
            confidence=row["confidence"],
            description=row["description"],
            snapshot_path=row.get("snapshot_path"),
        ))

    return {"alerts": [a.model_dump() for a in alerts], "total": total}


# ── Timeline ──────────────────────────────────────────────────────────────────
@router.get("/timeline", tags=["Timeline"])
async def get_timeline(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0)
):
    """
    Returns the AI incident timeline (newest first).

    Response schema:
    {
      "entries": [ TimelineEntry ],
      "total": int
    }
    """
    orch = _require_orchestrator()
    db = orch.get_event_store()
    rows = db.get_timeline(limit=limit, offset=offset)
    total = db.get_timeline_count()

    entries = []
    for row in rows:
        entries.append(TimelineEntry(
            id=row["id"],
            timestamp=row["timestamp"],
            time_str=row["time_str"],
            event=row["event"],
            confidence=row["confidence"],
            severity=row["severity"],
            snapshot_ref=row.get("snapshot_ref"),
        ))

    return {"entries": [e.model_dump() for e in entries], "total": total}


# ── Analytics ─────────────────────────────────────────────────────────────────
@router.get("/analytics", tags=["Analytics"])
async def get_analytics():
    """
    Returns aggregated session-level analytics:
    total frames, alert counts, fire events, peak priority, uptime, etc.
    """
    orch = _require_orchestrator()
    return orch.get_analytics()


# ── Snapshots ─────────────────────────────────────────────────────────────────
@router.post("/snapshot", response_model=SnapshotResult, tags=["Snapshots"])
async def manual_snapshot():
    """Triggers a manual snapshot of the current annotated frame."""
    orch = _require_orchestrator()
    frame = orch.get_annotated_frame()
    if frame is None:
        raise HTTPException(status_code=404, detail="No frame available for snapshot.")
    snap_handler = orch.get_snapshot_handler()
    result = snap_handler.capture(frame, trigger="manual")
    if not result.success:
        raise HTTPException(status_code=500, detail="Snapshot failed.")
    return result


@router.get("/snapshots", tags=["Snapshots"])
async def list_snapshots():
    """Returns metadata list of all saved snapshots (newest first)."""
    orch = _require_orchestrator()
    files = orch.get_snapshot_handler().list_snapshots()
    return {"snapshots": files, "count": len(files)}


@router.get("/snapshots/{filename}", tags=["Snapshots"])
async def serve_snapshot(filename: str):
    """Serves a saved snapshot JPEG file by filename."""
    from config.settings import SNAPSHOTS_DIR
    from pathlib import Path
    filepath = SNAPSHOTS_DIR / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Snapshot not found.")
    return StreamingResponse(open(filepath, "rb"), media_type="image/jpeg")


# ── Health ────────────────────────────────────────────────────────────────────
@router.get("/health", tags=["System"])
async def health_check():
    """Returns server health and uptime."""
    return {
        "status": "ok",
        "timestamp": int(time.time() * 1000),
        "service": "RescueBOT AI Inference Engine",
        "version": "4.0.0"
    }
