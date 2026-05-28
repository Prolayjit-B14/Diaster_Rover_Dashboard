"""
RescueBOT — API Schemas (Pydantic)
All request/response models for REST endpoints and WebSocket payloads.
"""
from __future__ import annotations
from typing import List, Optional, Any
from pydantic import BaseModel, Field
import time


# ── Bounding Box ──────────────────────────────────────────────────────────────
class BBox(BaseModel):
    x: int = 0
    y: int = 0
    w: int = 0
    h: int = 0


# ── Per-Module Detection Results ─────────────────────────────────────────────
class PersonDetection(BaseModel):
    detected: bool = False
    confidence: float = 0.0          # 0.0 – 1.0
    count: int = 0
    pose_state: str = "none"          # standing | fallen | trapped | motionless | unknown
    is_rescuer: bool = False
    is_motionless: bool = False
    stationary_seconds: float = 0.0
    bbox: Optional[BBox] = None


class FireDetection(BaseModel):
    detected: bool = False
    confidence: float = 0.0
    source: str = "none"              # yolo | hsv | none
    bbox: Optional[BBox] = None


class SmokeDetection(BaseModel):
    detected: bool = False
    confidence: float = 0.0
    density: str = "none"            # low | medium | dense | none
    source: str = "none"
    bbox: Optional[BBox] = None


class MotionDetection(BaseModel):
    detected: bool = False
    score: float = 0.0               # 0.0 – 1.0
    bbox: Optional[BBox] = None


class GestureDetection(BaseModel):
    detected: bool = False
    gesture_type: str = "none"       # waving | raised_hand | sos | none
    confidence: float = 0.0
    is_distress: bool = False


class BloodDetection(BaseModel):
    detected: bool = False
    score: float = 0.0               # pixel ratio %
    note: str = "Indicative only. Not a medical assessment."


class InjuryEstimation(BaseModel):
    estimated: bool = False
    label: str = "none"              # possible_injury | fallen | trapped | none
    note: str = "Estimation only. Not a medical diagnosis."


class LiveStatus(BaseModel):
    label: str = "unknown"           # active_survivor | low_movement | possible_unconscious | needs_verification
    note: str = "No alive/dead classification is made."


# ── Confidence & Priority ─────────────────────────────────────────────────────
class SurvivorConfidence(BaseModel):
    score: float = 0.0               # 0.0 – 1.0
    breakdown: dict = Field(default_factory=dict)


class RescuePriority(BaseModel):
    level: str = "LOW"               # LOW | MEDIUM | HIGH | CRITICAL
    score: float = 0.0               # 0.0 – 1.0
    breakdown: dict = Field(default_factory=dict)


class FirstAidUrgency(BaseModel):
    level: str = "needs_verification"   # immediate_attention | medium_urgency | low_urgency | needs_verification
    note: str = "Estimation only. Not a medical diagnosis."


# ── Alert ─────────────────────────────────────────────────────────────────────
class Alert(BaseModel):
    id: int = 0
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))
    label: str = ""                  # HUMAN | FIRE | SMOKE | MOTION | GESTURE | HAZARD
    severity: str = "low"            # low | medium | high | critical
    confidence: float = 0.0
    description: str = ""
    bbox: Optional[BBox] = None
    snapshot_path: Optional[str] = None


class AlertList(BaseModel):
    alerts: List[Alert] = []
    total: int = 0


# ── Timeline ──────────────────────────────────────────────────────────────────
class TimelineEntry(BaseModel):
    id: int = 0
    timestamp: int = 0
    time_str: str = ""
    event: str = ""
    confidence: float = 0.0
    severity: str = "low"
    snapshot_ref: Optional[str] = None


class TimelineList(BaseModel):
    entries: List[TimelineEntry] = []
    total: int = 0


# ── Camera Status ─────────────────────────────────────────────────────────────
class CameraStatus(BaseModel):
    connected: bool = False
    stream_url: str = ""
    fps: float = 0.0
    latency_ms: float = 0.0
    resolution: str = "640x480"
    frames_processed: int = 0
    uptime_seconds: float = 0.0
    reconnect_attempts: int = 0
    last_frame_age_ms: float = 0.0


# ── Live Detections (full frame snapshot) ────────────────────────────────────
class LiveDetections(BaseModel):
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))
    person: PersonDetection = Field(default_factory=PersonDetection)
    fire: FireDetection = Field(default_factory=FireDetection)
    smoke: SmokeDetection = Field(default_factory=SmokeDetection)
    motion: MotionDetection = Field(default_factory=MotionDetection)
    gesture: GestureDetection = Field(default_factory=GestureDetection)
    blood: BloodDetection = Field(default_factory=BloodDetection)
    injury: InjuryEstimation = Field(default_factory=InjuryEstimation)
    live_status: LiveStatus = Field(default_factory=LiveStatus)
    survivor_confidence: SurvivorConfidence = Field(default_factory=SurvivorConfidence)
    rescue_priority: RescuePriority = Field(default_factory=RescuePriority)
    first_aid_urgency: FirstAidUrgency = Field(default_factory=FirstAidUrgency)
    active_alerts: List[Alert] = []


# ── WebSocket Broadcast Payload ───────────────────────────────────────────────
class WSBroadcast(BaseModel):
    type: str = "detection_update"
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))
    detections: LiveDetections = Field(default_factory=LiveDetections)
    camera: CameraStatus = Field(default_factory=CameraStatus)


# ── Analytics ─────────────────────────────────────────────────────────────────
class AnalyticsSummary(BaseModel):
    session_start: int = 0
    total_frames: int = 0
    total_alerts: int = 0
    persons_detected: int = 0
    fire_events: int = 0
    gesture_events: int = 0
    peak_rescue_priority: str = "LOW"
    avg_survivor_confidence: float = 0.0
    uptime_seconds: float = 0.0


# ── Snapshot ──────────────────────────────────────────────────────────────────
class SnapshotResult(BaseModel):
    success: bool = False
    filename: str = ""
    path: str = ""
    timestamp: int = Field(default_factory=lambda: int(time.time() * 1000))
    trigger: str = "manual"          # manual | person | fire | gesture | critical


# ── Camera Connect Request ────────────────────────────────────────────────────
class CameraConnectRequest(BaseModel):
    ip: str
    port: int = 81
    use_stream: bool = True
