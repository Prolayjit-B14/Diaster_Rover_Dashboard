import time
import json
import threading
import queue

# Core image processing dependencies
try:
    import cv2
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False
    print("[AI Dependency] CRITICAL ERROR: OpenCV (cv2) is not installed. Stream capabilities disabled.")

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False
    print("[AI Dependency] CRITICAL ERROR: NumPy is not installed. Numerical matrices disabled.")

# Edge IoT remote communication
try:
    import paho.mqtt.client as mqtt
    HAS_MQTT = True
except ImportError:
    HAS_MQTT = False
    print("[AI Dependency] WARNING: paho-mqtt not installed. Cloud MQTT updates will be bypassed.")

# Deep learning framework dependencies
try:
    from ultralytics import YOLO
    HAS_YOLO = True
except ImportError:
    HAS_YOLO = False
    print("[AI Dependency] WARNING: ultralytics (YOLO) not installed. Gracefully degrading to OpenCV-Only mode.")

try:
    import mediapipe as mp
    HAS_MEDIAPIPE = True
except ImportError:
    HAS_MEDIAPIPE = False
    print("[AI Dependency] WARNING: MediaPipe not installed. Bypassing MediaPipe skeletal analysis.")

try:
    import torch
    import torchvision.transforms as T
    from torchvision.models import mobilenet_v3_small
    HAS_PYTORCH = True
except ImportError:
    HAS_PYTORCH = False
    print("[AI Dependency] WARNING: PyTorch / Torchvision not installed. Scene classifier disabled.")


# =================================================================================================
# RescueBOT: HIGH-PERFORMANCE MULTI-MODEL DISASTER MANAGEMENT INFERENCE SERVER
# =================================================================================================
# Version: 3.0.0-HACKATHON-MVP-COMPLETE
# Platform: Laptop / Raspberry Pi 4/5 / Jetson Nano
# Description: Connects directly to the live ESP32-CAM MJPEG stream, runs the recommended 
#              multi-model pipeline (YOLOv8/YOLO11 Object Detection, MediaPipe Pose Estimation,
#              MobileNetV3 Scene Classification, OpenCV Proximity Motion Tracking, and HSV 
#              Color/Canny Texture Trackers), performs logic fusion to calculate survivor
#              probability, and publishes alerts to the RescueBOT Dashboard via MQTT.
# =================================================================================================

# ── NETWORK & MQTT SETTINGS ──────────────────────────────────────────────────────────────────────
MQTT_BROKER   = "broker.emqx.io"
MQTT_PORT     = 1883
TOPIC_ALERTS  = "ares1/Robot/alerts"
TOPIC_TELE    = "ares1/Robot/telemetry"
TOPIC_COMMAND = "ares1/Robot/command"
TOPIC_CAMERA  = "ares1/Robot/camera"

# Default ESP32-CAM MJPEG Stream endpoint (Update this with your board's IP)
DEFAULT_STREAM_URL = "http://192.168.1.100:81/stream"

# ── SENSOR FUSION STATE ──────────────────────────────────────────────────────────────────────────
_sensor_state_lock = threading.Lock()
sensor_state = {
    "gas": 0,
    "vibration": 0.0,
    "fire_sensor": "CLEAR",
    "pir_sensor": "CLEAR",
    "battery": 12.0
}

# ── LOW-LATENCY THREADED STREAM READER ───────────────────────────────────────────────────────────
class ThreadedStreamReader:
    """
    Spawns a background thread to continuously drain the ESP32-CAM HTTP MJPEG stream.
    This bypasses OpenCV's internal buffering latency, guaranteeing 0ms real-time delay!
    Supports looping local files, webcams, and generating synthetic grid-telemetry arrays.
    """
    def __init__(self, stream_url, loop=False, synthetic=False):
        self.stream_url = stream_url
        self.loop = loop
        self.synthetic = synthetic
        self.frame_queue = queue.Queue(maxsize=3)
        self.running = False
        self.thread = None
        self.cap = None

    def start(self):
        self.running = True
        self.thread = threading.Thread(target=self._update, daemon=True)
        self.thread.start()
        if self.synthetic:
            print("[Stream Reader] Threaded synthetic diagnostic HUD generator online!")
        else:
            print(f"[Stream Reader] Threaded consumer attached to source: {self.stream_url} (Loop: {self.loop})")

    def _update(self):
        while self.running:
            if self.synthetic:
                # Generate synthetic high-tech visual HUD frame matrix
                frame = np.zeros((480, 640, 3), dtype=np.uint8)
                # Draw faint tactical green gridlines
                for y in range(0, 480, 40):
                    cv2.line(frame, (0, y), (640, y), (15, 35, 15), 1)
                for x in range(0, 640, 40):
                    cv2.line(frame, (x, 0), (x, 480), (15, 35, 15), 1)
                
                # Dynamic pulsing radar ring
                pulse = int((time.time() * 2.5) % 15)
                cv2.circle(frame, (320, 240), 100 + pulse * 3, (0, 80, 0), 1)
                cv2.circle(frame, (320, 240), 5, (0, 255, 0), -1)
                
                cv2.putText(frame, "RESCUEBOT OPERATIONAL DIAGNOSTIC HUD", (170, 220), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 0), 1)
                cv2.putText(frame, "SYNTHETIC FLIGHT STREAM ARRAY", (200, 250), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 200, 0), 1)
                cv2.putText(frame, f"CLOCK: {time.strftime('%H:%M:%S')}", (20, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 212, 255), 1)
                
                # Push frame at ~15 FPS
                if not self.frame_queue.empty():
                    try:
                        self.frame_queue.get_nowait()
                    except queue.Empty:
                        pass
                self.frame_queue.put(frame)
                time.sleep(1.0 / 15.0)
                continue

            try:
                # Resolve webcam index if passed as string digits (e.g. "0")
                try:
                    stream_source = int(self.stream_url)
                except ValueError:
                    stream_source = self.stream_url

                self.cap = cv2.VideoCapture(stream_source)
                if not self.cap.isOpened():
                    print("[Stream Reader] Video source offline. Re-attempting in 3 seconds...")
                    time.sleep(3)
                    continue

                while self.running:
                    ret, frame = self.cap.read()
                    if not ret:
                        if self.loop:
                            # Looped video files rewind automatically to frame 0
                            self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                            continue
                        print("[Stream Reader] Frame source terminated/dropped. Reconnecting...")
                        break

                    # Keep queue size at 1 to only hold the freshest frame (0 latency!)
                    if not self.frame_queue.empty():
                        try:
                            self.frame_queue.get_nowait()
                        except queue.Empty:
                            pass
                    
                    self.frame_queue.put(frame)
                    
                    # Pace local files to avoid running faster than real-time
                    if isinstance(stream_source, str) and not stream_source.startswith("http"):
                        time.sleep(0.033)  # Pace at ~30 FPS
            except Exception as e:
                print(f"[Stream Reader] Connection crash: {e}")
                time.sleep(3)

    def read(self):
        if self.frame_queue.empty():
            return None
        return self.frame_queue.get()

    def stop(self):
        self.running = False
        if self.cap:
            self.cap.release()
        if self.thread:
            self.thread.join()
        print("[Stream Reader] Consumer thread terminated.")


# ── MULTI-MODEL AI INFERENCE PIPELINE ────────────────────────────────────────────────────────────
class DisasterAIEngine:
    def __init__(self):
        global HAS_MEDIAPIPE, HAS_PYTORCH
        print("\n[AI Setup] Initializing multi-model AI suite...")
        self.sim_mode = False
        
        # 1. Base YOLOv8 / YOLO11 Nano Human detector
        self.human_detector = None
        if HAS_YOLO:
            try:
                self.human_detector = YOLO("yolov8n.pt")
                print("[AI Setup] Base YOLOv8 Human model successfully mounted.")
            except Exception as e:
                print(f"[AI Setup] YOLOv8 base human weights missing or failed: {e}")
        else:
            print("[AI Setup] YOLO base human model bypassed (ultralytics missing).")

        # 2. Base YOLOv8-Pose fallback model
        self.yolo_pose_estimator = None
        if HAS_YOLO:
            try:
                self.yolo_pose_estimator = YOLO("yolov8n-pose.pt")
                print("[AI Setup] Fallback YOLOv8-Pose model loaded.")
            except Exception as e:
                print(f"[AI Setup] YOLOv8-Pose loading bypassed/failed: {e}")

        # 3. Custom YOLOv8 models for Fire, Smoke, and Hazards
        self.fire_detector = None
        self.has_custom_fire = False
        if HAS_YOLO:
            try:
                self.fire_detector = YOLO("yolov8n-fire.pt")
                self.has_custom_fire = True
                print("[AI Setup] Custom YOLOv8 Fire model mounted successfully.")
            except Exception:
                self.has_custom_fire = False
                print("[AI Setup] YOLOv8-Fire model missing. Gracefully falling back to advanced HSV core.")
        else:
            print("[AI Setup] Custom YOLOv8 Fire model bypassed. Using HSV core.")

        self.smoke_detector = None
        self.has_custom_smoke = False
        if HAS_YOLO:
            try:
                self.smoke_detector = YOLO("yolov8n-smoke.pt")
                self.has_custom_smoke = True
                print("[AI Setup] Custom YOLOv8 Smoke model mounted successfully.")
            except Exception:
                self.has_custom_smoke = False
                print("[AI Setup] YOLOv8-Smoke model missing. Gracefully falling back to advanced HSV core.")
        else:
            print("[AI Setup] Custom YOLOv8 Smoke model bypassed. Using HSV core.")

        self.hazard_detector = None
        self.has_custom_hazards = False
        if HAS_YOLO:
            try:
                self.hazard_detector = YOLO("yolov8n-hazards.pt")
                self.has_custom_hazards = True
                print("[AI Setup] Custom YOLOv8 Hazard model mounted successfully.")
            except Exception:
                self.has_custom_hazards = False
                print("[AI Setup] YOLOv8-Hazard model missing. Gracefully falling back to advanced HSV/Canny edge texture cores.")
        else:
            print("[AI Setup] Custom YOLOv8 Hazard model bypassed. Using HSV/Canny core.")

        # 4. MediaPipe Pose Estimation setup
        if HAS_MEDIAPIPE:
            try:
                self.mp_pose = mp.solutions.pose.Pose(
                    static_image_mode=False,
                    min_detection_confidence=0.55,
                    min_tracking_confidence=0.55
                )
                print("[AI Setup] MediaPipe Pose Engine online.")
            except Exception as e:
                HAS_MEDIAPIPE = False
                print(f"[AI Setup] MediaPipe initialization failed: {e}. Switching fallback to YOLO-Pose.")

        # 5. MobileNetV3 Scene Classification setup
        if HAS_PYTORCH:
            try:
                # Use new Weights API (deprecated pretrained=True since torchvision 0.13)
                try:
                    from torchvision.models import MobileNet_V3_Small_Weights
                    self.scene_classifier = mobilenet_v3_small(weights=MobileNet_V3_Small_Weights.DEFAULT)
                except (ImportError, AttributeError):
                    # Fallback for older torchvision versions
                    self.scene_classifier = mobilenet_v3_small(pretrained=True)  # noqa: deprecated
                self.scene_classifier.eval()
                self.transform = T.Compose([
                    T.ToPILImage(),
                    T.Resize(224),
                    T.ToTensor(),
                    T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
                ])
                print("[AI Setup] PyTorch MobileNetV3 scene classifier successfully mounted.")
            except Exception as e:
                HAS_PYTORCH = False
                print(f"[AI Setup] MobileNetV3 failed to load: {e}. Switching fallback to sensory heuristic classifier.")

        # 6. Initialize OpenCV Motion Background Subtractor
        self.bg_subtractor = cv2.createBackgroundSubtractorMOG2(history=120, varThreshold=45, detectShadows=True)
        
        # Preprocessing setup (Phase 1)
        self.clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gamma_val = 1.5
        self.gamma_lut = np.array([((i / 255.0) ** (1.0 / gamma_val)) * 255 for i in np.arange(0, 256)]).astype("uint8")
        
        # Frame counter for classifier sub-sampling
        self.frame_counter = 0
        self.last_scene_type = "Unknown emergency"
        self.last_scene_conf = 30
        
        # Temporal confirmation queues for Fire and Smoke (Phase 4)
        self.fire_confirm_queue = []
        self.smoke_confirm_queue = []
        self.confirm_frame_limit = 10
        
        # Bounding box history list for motionless person tracking
        # Format: {"bbox": [x,y,w,h], "first_seen": ts, "last_seen": ts, "last_moved": ts, "is_motionless": bool}
        self.tracked_persons = []
        
        # Alert cooldown counters to prevent MQTT cluster congestion
        self.last_alert_time = {}
        self.alert_cooldown = 5.0 # seconds (Phase 9 spec)
        self.last_fire_state = False
        self.last_fire_time = 0.0
        print("[AI Setup] All pipelines online and ready!")

    def _track_person_motion(self, bbox, current_time):
        """Tracks a person bounding box using IoU to isolate motionless state durations."""
        bx, by, bw, bh = bbox
        cx, cy = bx + bw/2.0, by + bh/2.0
        matched_idx = -1
        max_iou = 0.0

        for i, tp in enumerate(self.tracked_persons):
            tx, ty, tw, th = tp["bbox"]
            ix1 = max(bx, tx)
            iy1 = max(by, ty)
            ix2 = min(bx + bw, tx + tw)
            iy2 = min(by + bh, ty + th)
            
            if ix2 > ix1 and iy2 > iy1:
                inter_area = (ix2 - ix1) * (iy2 - iy1)
                union_area = (bw * bh) + (tw * th) - inter_area
                iou = inter_area / float(union_area) if union_area > 0 else 0.0
                if iou > max_iou:
                    max_iou = iou
                    matched_idx = i

        if matched_idx != -1 and max_iou > 0.40:
            tp = self.tracked_persons[matched_idx]
            tx, ty, tw, th = tp["bbox"]
            tcx, tcy = tx + tw/2.0, ty + th/2.0
            
            distance = np.sqrt((cx - tcx)**2 + (cy - tcy)**2)
            movement_threshold = 0.15 * max(tw, th)
            
            if distance > movement_threshold:
                tp["last_moved"] = current_time
                tp["is_motionless"] = False
            else:
                stationary_time = current_time - tp["last_moved"]
                if stationary_time > 8.0:
                    tp["is_motionless"] = True
                    
            tp["bbox"] = bbox
            tp["last_seen"] = current_time
            return tp["is_motionless"], (current_time - tp["last_moved"])
        else:
            self.tracked_persons.append({
                "bbox": bbox,
                "first_seen": current_time,
                "last_seen": current_time,
                "last_moved": current_time,
                "is_motionless": False
            })
            return False, 0.0

    def _cleanup_tracked_persons(self, current_time):
        """Purges old tracks."""
        self.tracked_persons = [tp for tp in self.tracked_persons if current_time - tp["last_seen"] < 2.5]

    def _preprocess_frame(self, frame):
        """Phase 1: Advanced OpenCV preprocessing pipeline for hostile disaster environments."""
        if frame is None:
            return None
        
        # 1. Resize to target size dynamically
        h, w, _ = frame.shape
        if w != 640 or h != 480:
            processed = cv2.resize(frame, (640, 480), interpolation=cv2.INTER_LINEAR)
        else:
            processed = frame.copy()
            
        # 2. Denoise using Fast Bilateral Filtering (preserves edges, cleans dust/noise)
        processed = cv2.bilateralFilter(processed, d=5, sigmaColor=50, sigmaSpace=50)
        
        # 3. Dynamic low-light enhancement (Gamma LUT)
        gray = cv2.cvtColor(processed, cv2.COLOR_BGR2GRAY)
        mean_brightness = np.mean(gray)
        if mean_brightness < 95.0:
            processed = cv2.LUT(processed, self.gamma_lut)
            
        # 4. Smoke-aware contrast correction (CLAHE on L-channel of LAB space)
        lab = cv2.cvtColor(processed, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)
        cl = self.clahe.apply(l)
        limg = cv2.merge((cl, a, b))
        processed = cv2.cvtColor(limg, cv2.COLOR_LAB2BGR)
        
        return processed

    def _verify_fire_candidate(self, frame, bbox):
        """Phase 4: HSV flame check to reduce false positives from sunlight/lamps."""
        bx, by, bw, bh = bbox
        h_img, w_img, _ = frame.shape
        x1, y1 = max(0, bx), max(0, by)
        x2, y2 = min(w_img, bx + bw), min(h_img, by + bh)
        
        roi = frame[y1:y2, x1:x2]
        if roi.size == 0:
            return False
            
        hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
        lower_fire = np.array([0, 70, 120], dtype="uint8")
        upper_fire = np.array([35, 255, 255], dtype="uint8")
        mask = cv2.inRange(hsv, lower_fire, upper_fire)
        
        fire_pixels = cv2.countNonZero(mask)
        total_pixels = roi.shape[0] * roi.shape[1]
        percentage = (fire_pixels / float(total_pixels)) * 100 if total_pixels > 0 else 0.0
        return percentage > 8.0  # Verification threshold: 8% flame color density

    def _verify_smoke_candidate(self, frame, bbox):
        """Phase 4: Laplacian texture check to distinguish diffuse smoke from solid structures/fog."""
        bx, by, bw, bh = bbox
        h_img, w_img, _ = frame.shape
        x1, y1 = max(0, bx), max(0, by)
        x2, y2 = min(w_img, bx + bw), min(h_img, by + bh)
        
        roi = frame[y1:y2, x1:x2]
        if roi.size == 0:
            return False
            
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        # Smoke has low high-frequency content, hence low Laplacian variance
        laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        
        # Check standard deviation (diffuse smoke has low std deviation)
        std_dev = np.std(gray)
        return laplacian_var < 150.0 and std_dev < 32.0

    def _detect_bleeding(self, roi):
        """Scans bounding box for localized blood-red/crimson color masks."""
        if roi.size == 0:
            return False, 0.0, None
        hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
        lower_red1 = np.array([0, 110, 70])
        upper_red1 = np.array([10, 255, 230])
        lower_red2 = np.array([170, 110, 70])
        upper_red2 = np.array([180, 255, 230])
        mask1 = cv2.inRange(hsv, lower_red1, upper_red1)
        mask2 = cv2.inRange(hsv, lower_red2, upper_red2)
        mask = cv2.bitwise_or(mask1, mask2)
        
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        
        red_pixels = cv2.countNonZero(mask)
        total_pixels = roi.shape[0] * roi.shape[1]
        percentage = (red_pixels / float(total_pixels)) * 100 if total_pixels > 0 else 0.0
        
        # Wounds represent a focal concentration
        is_bleeding = 1.2 < percentage < 15.0
        return is_bleeding, percentage, mask

    def _detect_flooding(self, frame):
        """Scans the bottom 35% frame region for water blue or brown masks."""
        height, width, _ = frame.shape
        scan_y_start = int(height * 0.65)
        roi = frame[scan_y_start:height, 0:width]
        if roi.size == 0:
            return False, None, 0.0
            
        hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
        lower_blue = np.array([90, 40, 50])
        upper_blue = np.array([135, 255, 220])
        lower_brown = np.array([10, 50, 30])
        upper_brown = np.array([25, 180, 150])
        
        mask_blue = cv2.inRange(hsv, lower_blue, upper_blue)
        mask_brown = cv2.inRange(hsv, lower_brown, upper_brown)
        mask = cv2.bitwise_or(mask_blue, mask_brown)
        
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        
        water_pixels = cv2.countNonZero(mask)
        total_pixels = roi.shape[0] * roi.shape[1]
        percentage = (water_pixels / float(total_pixels)) * 100 if total_pixels > 0 else 0.0
        
        is_flooded = percentage > 10.0
        if is_flooded:
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if contours:
                largest = max(contours, key=cv2.contourArea)
                x, y, w, h = cv2.boundingRect(largest)
                return True, (x, y + scan_y_start, w, h), percentage
        return False, None, percentage

    def _detect_rubble_debris(self, frame):
        """Filters for grey colors matching rough Canny edge textures to identify debris."""
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        lower_grey = np.array([0, 0, 50])
        upper_grey = np.array([180, 35, 160])
        color_mask = cv2.inRange(hsv, lower_grey, upper_grey)
        
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, 40, 130)
        rubble_mask = cv2.bitwise_and(color_mask, edges)
        
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
        rubble_mask = cv2.morphologyEx(rubble_mask, cv2.MORPH_CLOSE, kernel)
        
        contours, _ = cv2.findContours(rubble_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        largest_contour = None
        max_area = 0
        for c in contours:
            area = cv2.contourArea(c)
            if area > 2000:
                if area > max_area:
                    max_area = area
                    largest_contour = c
        if largest_contour is not None:
            x, y, w, h = cv2.boundingRect(largest_contour)
            score = int(min(96, 60 + (max_area / 4000) * 10))
            return True, (x, y, w, h), score
        return False, None, 0

    def _calculate_smoke_density(self, roi):
        """Computes smoke opacity based on ROI contrast variance."""
        if roi.size == 0:
            return "low", 0.0
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        std_dev = np.std(gray)
        if std_dev < 15.0:
            return "dense", std_dev
        elif std_dev < 28.0:
            return "medium", std_dev
        else:
            return "low", std_dev

    def _classify_disaster_scene(self, frame, fire_detected, smoke_detected, hazard_count, person_count, has_flood, bleeding_count):
        """
        Runs MobileNetV3 scene classification when available.
        Fuses predictions with physical rover telemetry (gas, vibration).
        """
        gas = sensor_state["gas"]
        vib = sensor_state["vibration"]
        
        scores = {
            "Earthquake damage": 0,
            "Building collapse": 0,
            "Fire incident": 0,
            "Flood disaster": 0,
            "Landslide": 0,
            "Industrial accident": 0,
            "Unknown emergency": 10
        }

        # PyTorch Neural Net execution
        if HAS_PYTORCH:
            try:
                input_tensor = self.transform(frame).unsqueeze(0)
                with torch.no_grad():
                    outputs = self.scene_classifier(input_tensor)
                    probabilities = torch.nn.functional.softmax(outputs[0], dim=0)
                    top_prob, top_cat = torch.topk(probabilities, 5)
                    
                    # Convert ImageNet categories to disaster fields via category ranges
                    # e.g., mapping volcano/fire-screen/cliff/geyser
                    for score, idx in zip(top_prob.tolist(), top_cat.tolist()):
                        val = int(score * 100)
                        if idx in [980, 565, 970]:  # volcano / fire screen / alp
                            scores["Fire incident"] += int(val * 0.7)
                            scores["Landslide"] += int(val * 0.3)
                        elif idx in [975, 973, 972]:  # geyser / lakeside / cliff
                            scores["Flood disaster"] += int(val * 0.8)
                            scores["Landslide"] += int(val * 0.2)
                        elif idx in [637, 689]:  # structures / industrial
                            scores["Building collapse"] += int(val * 0.6)
                            scores["Industrial accident"] += int(val * 0.4)
            except Exception as e:
                pass

        # Heuristic state checks (fusion)
        if vib > 1.4:
            scores["Earthquake damage"] += 65
            scores["Building collapse"] += 35
        if hazard_count > 2:
            scores["Building collapse"] += 45
            scores["Earthquake damage"] += 20
        if fire_detected:
            scores["Fire incident"] += 55
        if smoke_detected:
            scores["Fire incident"] += 30
            scores["Industrial accident"] += 25
        if has_flood:
            scores["Flood disaster"] += 85
        if gas > 2000:
            scores["Industrial accident"] += 75
            scores["Fire incident"] += 15
        if vib > 0.8 and hazard_count > 1 and not fire_detected:
            scores["Landslide"] += 50
            scores["Building collapse"] += 15
            
        best_type = max(scores, key=scores.get)
        confidence = min(98, max(50, scores[best_type]))
        return best_type, confidence

    def process_frame(self, frame, mqtt_client):
        now_ts = time.time()
        height, width, _ = frame.shape
        annotated_frame = frame.copy()
        
        self._cleanup_tracked_persons(now_ts)
        
        # ── SYNTHETIC DISASTER SIMULATOR TIMELINE INJECTOR ──
        if getattr(self, 'sim_mode', False):
            cycle = int(now_ts) % 40  # 40-second repeating tactical timeline
            
            # Simulated overlay status bar
            cv2.rectangle(annotated_frame, (5, 5), (width-5, height-5), (0, 212, 255), 1)
            cv2.putText(annotated_frame, "TACTICAL SIMULATOR: LOGIC ACTIVE", (15, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 212, 255), 1)
            
            # Timeline Scenario 1 (0-10s): Waving Survivor trapped in concrete debris
            if 0 <= cycle < 10:
                if self.last_fire_state:
                    self.last_fire_state = False
                    if mqtt_client is not None:
                        try:
                            mqtt_client.publish(TOPIC_TELE, json.dumps({"sensor": "fire", "value": "CLEAR"}))
                        except Exception:
                            pass

                bx, by, bw, bh = 180, 110, 160, 240
                survivor_prob = 89
                cv2.rectangle(annotated_frame, (bx, by), (bx+bw, by+bh), (0, 212, 255), 2)
                cv2.putText(annotated_frame, f"Survivor (Distress Posture) ({survivor_prob}%)", (bx, by - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 212, 255), 1)
                
                # Concrete Rubble
                dx, dy, dw, dh = 50, 300, 540, 140
                cv2.rectangle(annotated_frame, (dx, dy), (dx+dw, dy+dh), (140, 140, 140), 1)
                cv2.putText(annotated_frame, "CONCRETE RUBBLE / DEBRIS", (dx, dy - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (140, 140, 140), 1)
                
                # Kinetic Motion detection
                mx, my, mw, mh = 210, 140, 50, 50
                cv2.rectangle(annotated_frame, (mx, my), (mx+mw, my+mh), (255, 255, 0), 1)
                cv2.putText(annotated_frame, "MOTION DETECTED", (mx, my - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 0), 1)
                
                # Dispatch alerts
                self._dispatch_alert(mqtt_client, "HUMAN", survivor_prob, [bx, by, bw, bh], "high", 
                                     f"Survivor (Distress Posture) Detected - Survivor Prob: {survivor_prob}% [H=92 M=85 P=95 T=65].")
                self._dispatch_alert(mqtt_client, "MOTION", 85, [mx, my, mw, mh], "low", 
                                     "Optical frames isolate active kinetic movement under debris.")
                self._dispatch_alert(mqtt_client, "HAZARD", 78, [dx, dy, dw, dh], "medium", 
                                     "Hazard: Rubble/Debris (78%) - Fractured concrete.")

            # Timeline Scenario 2 (10-20s): Collapsed unconscious victim under rubble
            elif 10 <= cycle < 20:
                if self.last_fire_state:
                    self.last_fire_state = False
                    if mqtt_client is not None:
                        try:
                            mqtt_client.publish(TOPIC_TELE, json.dumps({"sensor": "fire", "value": "CLEAR"}))
                        except Exception:
                            pass

                bx, by, bw, bh = 120, 230, 310, 130
                survivor_prob = 53
                cv2.rectangle(annotated_frame, (bx, by), (bx+bw, by+bh), (0, 0, 255), 2)
                cv2.putText(annotated_frame, f"Fallen Person (Unconscious) ({survivor_prob}%)", (bx, by - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1)
                
                # Debris
                dx, dy, dw, dh = 60, 180, 480, 100
                cv2.rectangle(annotated_frame, (dx, dy), (dx+dw, dy+dh), (140, 140, 140), 1)
                cv2.putText(annotated_frame, "STRUCTURAL HAZARD / COLLAPSE", (dx, dy - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (140, 140, 140), 1)

                self._dispatch_alert(mqtt_client, "HUMAN", survivor_prob, [bx, by, bw, bh], "critical", 
                                     f"Fallen Person (Unconscious) Detected - Survivor Prob: {survivor_prob}% [H=65 M=0 P=85 T=66]. Stationary for 12s.")
                self._dispatch_alert(mqtt_client, "HAZARD", 82, [dx, dy, dw, dh], "high", 
                                     "Hazard: Structural Collapse (82%) - Debris threat.")

            # Timeline Scenario 3 (20-30s): Severe Active Fire & Smoke outbreak
            elif 20 <= cycle < 30:
                if not self.last_fire_state:
                    self.last_fire_state = True
                    if mqtt_client is not None:
                        try:
                            mqtt_client.publish(TOPIC_TELE, json.dumps({"sensor": "fire", "value": "FIRE DETECTED"}))
                        except Exception:
                            pass

                fx, fy, fw, fh = 220, 160, 150, 190
                cv2.rectangle(annotated_frame, (fx, fy), (fx+fw, fy+fh), (0, 0, 255), 2)
                cv2.putText(annotated_frame, "FIRE DETECTED (97%)", (fx, fy - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1)
                
                sx, sy, sw, sh = 80, 40, 480, 280
                cv2.rectangle(annotated_frame, (sx, sy), (sx+sw, sy+sh), (128, 128, 128), 1)
                cv2.putText(annotated_frame, "SMOKE DETECTED (DENSE)", (sx, sy - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (128, 128, 128), 1)

                self._dispatch_alert(mqtt_client, "FIRE", 97, [fx, fy, fw, fh], "critical", 
                                     "Fire Detected (97%) - High combustion flame thermal zone isolated.")
                self._dispatch_alert(mqtt_client, "FIRE", 91, [sx, sy, sw, sh], "high", 
                                     "Smoke Detected (91%) - Dense smoke plume diffusing, low visibility.")

            # Timeline Scenario 4 (30-40s): Flood logging & Neon Rescuer active
            elif 30 <= cycle < 40:
                if self.last_fire_state:
                    self.last_fire_state = False
                    if mqtt_client is not None:
                        try:
                            mqtt_client.publish(TOPIC_TELE, json.dumps({"sensor": "fire", "value": "CLEAR"}))
                        except Exception:
                            pass

                flx, fly, flw, flh = 0, 310, 640, 170
                cv2.rectangle(annotated_frame, (flx, fly), (flx+flw, fly+flh), (255, 100, 0), 1)
                cv2.putText(annotated_frame, "FLOOD RISK (62%)", (flx, fly - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 100, 0), 1)
                
                rx, ry, rw, rh = 260, 90, 150, 260
                cv2.rectangle(annotated_frame, (rx, ry), (rx+rw, ry+rh), (0, 255, 0), 2)
                cv2.putText(annotated_frame, "Rescue Worker (98%)", (rx, ry - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)

                self._dispatch_alert(mqtt_client, "HAZARD", 62, [flx, fly, flw, flh], "high", 
                                     "Hazard: Water Flood (62%) - Water logging/muddy terrain.")
                self._dispatch_alert(mqtt_client, "HUMAN", 98, [rx, ry, rw, rh], "low", 
                                     "Rescue Worker Detected - Active fluor vest color matching confirmed.")
            
            return annotated_frame

        # ── STANDARD OPERATIONAL INFERENCE PIPELINE ──
        # Phase 1: Preprocessing
        frame = self._preprocess_frame(frame)
        height, width, _ = frame.shape
        annotated_frame = frame.copy()
        
        # Initialize hazard tracking list for Phase 5 risk mapping
        hazard_boxes = []

        # 1. OpenCV PROXIMITY MOTION TRACKING (Phase 7)
        motion_detected, motion_bbox = self._detect_motion(frame)
        motion_score = 0
        if motion_detected:
            mx, my, mw, mh = motion_bbox
            motion_score = 85
            cv2.rectangle(annotated_frame, (mx, my), (mx+mw, my+mh), (255, 255, 0), 1)
            cv2.putText(annotated_frame, "MOTION DETECTED", (mx, my - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 0), 1)
            
            self._dispatch_alert(
                mqtt_client, 
                "MOTION", 
                85, 
                [mx, my, mw, mh], 
                "low", 
                "Optical frames isolate active kinetic movement under debris."
            )

        # 2. YOLO CUSTOM / HSV FIRE & SMOKE TRACKERS (Phase 4)
        fire_detected = False
        fire_bbox = None
        fire_conf = 0
        
        if self.has_custom_fire and self.fire_detector is not None:
            try:
                fire_res = self.fire_detector(frame, verbose=False)[0]
                for box in fire_res.boxes:
                    conf = float(box.conf[0])
                    if conf > 0.50:
                        xyxy = box.xyxy[0].tolist()
                        candidate_bbox = [int(xyxy[0]), int(xyxy[1]), int(xyxy[2]-xyxy[0]), int(xyxy[3]-xyxy[1])]
                        if self._verify_fire_candidate(frame, candidate_bbox):
                            fire_detected = True
                            fire_conf = int(conf * 100)
                            fire_bbox = candidate_bbox
                            break
            except Exception:
                pass
        
        if not fire_detected: # HSV Fallback + verification
            raw_fire, raw_bbox, raw_conf = self._detect_fire_hsv(frame)
            if raw_fire and self._verify_fire_candidate(frame, raw_bbox):
                fire_detected = True
                fire_bbox = raw_bbox
                fire_conf = raw_conf

        # Phase 4: 10-frame Temporal Confirmation for Fire
        self.fire_confirm_queue.append(fire_detected)
        if len(self.fire_confirm_queue) > self.confirm_frame_limit:
            self.fire_confirm_queue.pop(0)
        confirmed_fire = (sum(self.fire_confirm_queue) >= 7)

        if confirmed_fire and fire_bbox is not None:
            self.last_fire_time = now_ts
            hazard_boxes.append(fire_bbox)
            if not self.last_fire_state:
                self.last_fire_state = True
                if mqtt_client is not None:
                    try:
                        mqtt_client.publish(TOPIC_TELE, json.dumps({
                            "sensor": "fire",
                            "value": "FIRE DETECTED"
                        }))
                    except Exception:
                        pass

            fx, fy, fw, fh = fire_bbox
            cv2.rectangle(annotated_frame, (fx, fy), (fx+fw, fy+fh), (0, 0, 255), 2)
            cv2.putText(annotated_frame, f"FIRE DETECTED ({fire_conf}%)", (fx, fy - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1)
            self._dispatch_alert(
                mqtt_client, 
                "FIRE", 
                fire_conf, 
                [fx, fy, fw, fh], 
                "critical", 
                f"Fire Detected ({fire_conf}%) - High combustion flame thermal zone isolated."
            )
        else:
            # If fire was active but hasn't been confirmed/seen for 3.0s, clear telemetry state
            if self.last_fire_state and (now_ts - self.last_fire_time > 3.0):
                self.last_fire_state = False
                if mqtt_client is not None:
                    try:
                        mqtt_client.publish(TOPIC_TELE, json.dumps({
                            "sensor": "fire",
                            "value": "CLEAR"
                        }))
                    except Exception:
                        pass

        smoke_detected = False
        smoke_bbox = None
        smoke_prob = 0
        
        if self.has_custom_smoke and self.smoke_detector is not None:
            try:
                smoke_res = self.smoke_detector(frame, verbose=False)[0]
                for box in smoke_res.boxes:
                    conf = float(box.conf[0])
                    if conf > 0.50:
                        xyxy = box.xyxy[0].tolist()
                        candidate_bbox = [int(xyxy[0]), int(xyxy[1]), int(xyxy[2]-xyxy[0]), int(xyxy[3]-xyxy[1])]
                        if self._verify_smoke_candidate(frame, candidate_bbox):
                            smoke_detected = True
                            smoke_prob = int(conf * 100)
                            smoke_bbox = candidate_bbox
                            break
            except Exception:
                pass
                    
        if not smoke_detected: # HSV Fallback + verification
            raw_smoke, raw_bbox, raw_prob = self._detect_smoke_hsv(frame)
            if raw_smoke and self._verify_smoke_candidate(frame, raw_bbox):
                smoke_detected = True
                smoke_bbox = raw_bbox
                smoke_prob = raw_prob

        # Phase 4: 10-frame Temporal Confirmation for Smoke
        self.smoke_confirm_queue.append(smoke_detected)
        if len(self.smoke_confirm_queue) > self.confirm_frame_limit:
            self.smoke_confirm_queue.pop(0)
        confirmed_smoke = (sum(self.smoke_confirm_queue) >= 7)

        if confirmed_smoke and smoke_bbox is not None:
            sx, sy, sw, sh = smoke_bbox
            hazard_boxes.append(smoke_bbox)
            smoke_roi = frame[sy:sy+sh, sx:sx+sw]
            density, std = self._calculate_smoke_density(smoke_roi)
            cv2.rectangle(annotated_frame, (sx, sy), (sx+sw, sy+sh), (128, 128, 128), 1)
            cv2.putText(annotated_frame, f"SMOKE ({density.upper()})", (sx, sy - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (128, 128, 128), 1)
            
            self._dispatch_alert(
                mqtt_client, 
                "FIRE", 
                smoke_prob, 
                [sx, sy, sw, sh], 
                "high" if density == "dense" else "medium", 
                f"Smoke Detected ({smoke_prob}%) - {density.capitalize()} smoke plume diffusing, low visibility."
            )

        # 3. Custom YOLO / HSV ENVIRONMENTAL HAZARDS (Phase 5)
        flood_detected, flood_bbox, flood_pct = self._detect_flooding(frame)
        if flood_detected:
            flx, fly, flw, flh = flood_bbox
            hazard_boxes.append(flood_bbox)
            cv2.rectangle(annotated_frame, (flx, fly), (flx+flw, fly+flh), (255, 100, 0), 1)
            cv2.putText(annotated_frame, f"FLOOD RISK ({int(flood_pct)}%)", (flx, fly - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 100, 0), 1)
            
            self._dispatch_alert(
                mqtt_client, 
                "HAZARD", 
                int(flood_pct + 40), 
                [flx, fly, flw, flh], 
                "high", 
                f"Hazard: Water Flood ({int(flood_pct)}%) - Water logging/muddy terrain."
            )

        debris_detected = False
        debris_bbox = None
        debris_score = 0
        
        if self.has_custom_hazards and self.hazard_detector is not None:
            try:
                hazard_res = self.hazard_detector(frame, verbose=False)[0]
                for box in hazard_res.boxes:
                    conf = float(box.conf[0])
                    cls_id = int(box.cls[0])
                    cls_name = self.hazard_detector.names[cls_id]
                    if conf > 0.50 and cls_name in ["debris", "broken_structure", "sharp_object", "electric_wire", "rubble"]:
                        xyxy = box.xyxy[0].tolist()
                        debris_detected = True
                        debris_score = int(conf * 100)
                        debris_bbox = [int(xyxy[0]), int(xyxy[1]), int(xyxy[2]-xyxy[0]), int(xyxy[3]-xyxy[1])]
                        hazard_boxes.append(debris_bbox)
                        
                        cv2.rectangle(annotated_frame, (debris_bbox[0], debris_bbox[1]), 
                                      (debris_bbox[0]+debris_bbox[2], debris_bbox[1]+debris_bbox[3]), (0, 165, 255), 1)
                        cv2.putText(annotated_frame, f"HAZARD: {cls_name.upper()}", (debris_bbox[0], debris_bbox[1] - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 165, 255), 1)
                        
                        self._dispatch_alert(
                            mqtt_client, 
                            "HAZARD", 
                            debris_score, 
                            debris_bbox, 
                            "high", 
                            f"Hazard: {cls_name.capitalize()} ({debris_score}%) - Blockage detected."
                        )
            except Exception:
                pass
        
        if not debris_detected: # CV fallback
            debris_detected, debris_bbox, debris_score = self._detect_rubble_debris(frame)
            if debris_detected:
                dx, dy, dw, dh = debris_bbox
                hazard_boxes.append(debris_bbox)
                cv2.rectangle(annotated_frame, (dx, dy), (dx+dw, dy+dh), (140, 140, 140), 1, cv2.LINE_DASHED)
                cv2.putText(annotated_frame, "CONCRETE RUBBLE / DEBRIS", (dx, dy - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (140, 140, 140), 1)
                
                self._dispatch_alert(
                    mqtt_client, 
                    "HAZARD", 
                    debris_score, 
                    [dx, dy, dw, dh], 
                    "medium", 
                    f"Hazard: Rubble/Debris ({debris_score}%) - Fractured concrete."
                )

        # 4. YOLOv8/v11 HUMAN & GENERAL OBJECT PIPELINE (GUARDS ACTIVE)
        person_count = 0
        hazard_count = 0
        bleeding_count = 0
        max_survivor_prob = 0
        
        if self.human_detector is not None:
            try:
                results = self.human_detector(frame, verbose=False)[0]
                for box in results.boxes:
                    cls_id = int(box.cls[0])
                    conf   = float(box.conf[0])
                    if conf < 0.50:
                        continue

                    xyxy = box.xyxy[0].tolist()
                    x1, y1, x2, y2 = [int(val) for val in xyxy]
                    bx, by, bw, bh = x1, y1, x2 - x1, y2 - y1
                    cls_name = self.human_detector.names[cls_id]

                    if cls_name == "person":
                        person_count += 1
                        is_motionless, stationary_time = self._track_person_motion([bx, by, bw, bh], now_ts)
                        
                        # Rescuer check (High-vis fluorescence)
                        roi = frame[y1:y2, x1:x2]
                        is_rescuer = self._check_high_vis(roi)
                        
                        # Bleeding wound cue
                        bleeding_detected, bleed_pct, bleed_mask = self._detect_bleeding(roi)
                        if bleeding_detected:
                            bleeding_count += 1
                        
                        # ── MEDIAPIPE / YOLO POSE EVALUATION ──
                        pose_detected = False
                        body_angle = 90.0 # default vertical standing
                        distress_waving = False
                        pose_conf = 50
                        
                        if HAS_MEDIAPIPE and hasattr(self, 'mp_pose') and self.mp_pose is not None:
                            try:
                                rgb_roi = cv2.cvtColor(roi, cv2.COLOR_BGR2RGB)
                                mp_res = self.mp_pose.process(rgb_roi)
                                if mp_res.pose_landmarks:
                                    landmarks = mp_res.pose_landmarks.landmark
                                    pose_detected = True
                                    pose_conf = int(mp_res.pose_landmarks.landmark[0].visibility * 100) if len(landmarks) > 0 else 75
                                    
                                    # Retrieve coordinates of key points relative to ROI
                                    rh_y = landmarks[12].y # right shoulder
                                    lh_y = landmarks[11].y # left shoulder
                                    head_y = landmarks[0].y # nose
                                    rw_y = landmarks[16].y # right wrist
                                    lw_y = landmarks[15].y # left wrist
                                    
                                    # Distress posturing (wrists above nose)
                                    if rw_y < head_y or lw_y < head_y:
                                        distress_waving = True
                                        
                                    # Estimate body angle based on shoulder to ankle coordinates
                                    sh_y = (rh_y + lh_y) / 2.0
                                    ank_y = (landmarks[28].y + landmarks[27].y) / 2.0
                                    sh_x = (landmarks[12].x + landmarks[11].x) / 2.0
                                    ank_x = (landmarks[28].x + landmarks[27].x) / 2.0
                                    
                                    dx = abs(ank_x - sh_x)
                                    dy = abs(ank_y - sh_y)
                                    body_angle = np.arctan2(dy, dx) * 180 / np.pi
                            except Exception:
                                pose_detected = False
                                
                        if not pose_detected and self.yolo_pose_estimator is not None: # YOLO-Pose Fallback
                            try:
                                yolo_pose_res = self.yolo_pose_estimator(frame, verbose=False)[0]
                                if yolo_pose_res.keypoints is not None:
                                    for kpts in yolo_pose_res.keypoints:
                                        if len(kpts.xy) == 0:
                                            continue
                                        xy = kpts.xy[0].tolist()
                                        k_conf = kpts.conf[0].tolist() if kpts.conf is not None else [1.0]*17
                                        if len(xy) >= 17:
                                            # check if bounding box matches this human
                                            px, py = xy[0][0], xy[0][1]
                                            if x1 <= px <= x2 and y1 <= py <= y2:
                                                pose_detected = True
                                                pose_conf = int(np.mean(k_conf) * 100)
                                                # Wrists (9,10) higher than nose (0)
                                                if (k_conf[9] > 0.5 and xy[9][1] < xy[0][1]) or (k_conf[10] > 0.5 and xy[10][1] < xy[0][1]):
                                                    distress_waving = True
                                                # body angle
                                                sh_y = (xy[5][1] + xy[6][1]) / 2.0
                                                ank_y = (xy[15][1] + xy[16][1]) / 2.0
                                                sh_x = (xy[5][0] + xy[6][0]) / 2.0
                                                ank_x = (xy[15][0] + xy[16][0]) / 2.0
                                                
                                                dx = abs(ank_x - sh_x)
                                                dy = abs(ank_y - sh_y)
                                                body_angle = np.arctan2(dy, dx) * 180 / np.pi
                                                break
                            except Exception:
                                pass
                        
                        # Posture label mapping
                        is_fallen = body_angle < 35.0
                        
                        # ── SURVIVOR PROBABILITY FUSION LOGIC (Phase 8) ──
                        H = int(conf * 100) # Human confidence
                        
                        # Phase 7 & 8: Proximity motion score inside person ROI
                        M = 0
                        if motion_detected and motion_bbox is not None:
                            mx, my, mw, mh = motion_bbox
                            ix1 = max(x1, mx)
                            iy1 = max(y1, my)
                            ix2 = min(x2, mx + mw)
                            iy2 = min(y2, my + mh)
                            if ix2 > ix1 and iy2 > iy1:
                                overlap_area = (ix2 - ix1) * (iy2 - iy1)
                                if overlap_area > 0.1 * (mw * mh):
                                    M = 85  # Motion isolated within human box

                        # Posture confidence estimation
                        P = 50
                        if distress_waving:
                            P = 95
                        elif is_fallen and is_motionless:
                            P = 85 # Unconscious collapsed state
                        elif is_fallen:
                            P = 75 # Fallen state
                        elif body_angle > 55.0:
                            P = 60 # Normal standing
                        
                        # Thermal / Physical sensor fusion mapping
                        T_sensor = min(100, int(30 + (sensor_state["vibration"] * 15) + (sensor_state["gas"] / 4095.0) * 35))
                        if sensor_state["pir_sensor"] == "TRIGGERED":
                            T_sensor = max(T_sensor, 90)
                        
                        # Scene context score
                        S_scene = self.last_scene_conf if self.last_scene_type != "Unknown emergency" else 30
                        
                        # Fusion formula: 0.35*H + 0.20*M + 0.25*P + 0.10*T_sensor + 0.10*S_scene
                        survivor_prob = int((0.35 * H) + (0.20 * M) + (0.25 * P) + (0.10 * T_sensor) + (0.10 * S_scene))
                        max_survivor_prob = max(max_survivor_prob, survivor_prob)
                        
                        # Default state labels and colors
                        sub_label = "Human Detected"
                        severity = "medium"
                        color = (0, 212, 255)
                        
                        if is_rescuer:
                            sub_label = "Rescue Worker"
                            severity = "low"
                            color = (0, 255, 0)
                        elif is_fallen and is_motionless:
                            sub_label = "Fallen Person (Unconscious)"
                            severity = "critical"
                            color = (0, 0, 255)
                        elif is_fallen:
                            sub_label = "Fallen Person"
                            severity = "high"
                            color = (0, 0, 255)
                        elif distress_waving:
                            sub_label = "Survivor (Distress Posture)"
                            severity = "high"
                            color = (0, 255, 128)
                        elif bleeding_detected:
                            sub_label = "Injured Person"
                            severity = "high"
                            color = (0, 128, 255)

                        # ── PHASE 9: EVENT REASONING ENGINE RULES ──
                        # Rule 1: Fallen Unconscious Trapped in Collapsed Scene
                        if is_fallen and is_motionless and stationary_time > 15.0 and self.last_scene_type in ["Building collapse", "Earthquake damage"]:
                            sub_label = "Trapped Unconscious Survivor"
                            severity = "critical"
                            color = (0, 0, 255)
                        # Rule 2: Active Survivor Signaling under Debris
                        elif (sub_label == "Survivor (Distress Posture)" or distress_waving) and debris_detected and M > 50:
                            sub_label = "Active Trapped Survivor"
                            severity = "high"
                            color = (0, 255, 128)

                        # Estimate face bounding box from person's box
                        face_w = int(bw * 0.35)
                        face_h = int(min(bh * 0.18, face_w * 1.25))
                        face_x = int(x1 + (bw - face_w) / 2)
                        face_y = int(y1 + (bh * 0.04))

                        # Ensure coordinates are within frame boundaries
                        face_x = max(0, min(face_x, width - 1))
                        face_y = max(0, min(face_y, height - 1))
                        face_w = max(1, min(face_w, width - face_x))
                        face_h = max(1, min(face_h, height - face_y))

                        # Visual HUD bracket overlays (face only)
                        cv2.rectangle(annotated_frame, (face_x, face_y), (face_x + face_w, face_y + face_h), color, 2)
                        cv2.putText(annotated_frame, f"{sub_label} ({survivor_prob}%)", (face_x, face_y - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)

                        if bleeding_detected and bleed_mask is not None:
                            contours, _ = cv2.findContours(bleed_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                            for c in contours:
                                if cv2.contourArea(c) > 50:
                                    rx, ry, rw, rh = cv2.boundingRect(c)
                                    cv2.circle(annotated_frame, (x1 + rx + rw//2, y1 + ry + rh//2), 3, (0, 0, 255), -1)

                        desc_text = f"{sub_label} Detected - Survivor Prob: {survivor_prob}% [H={H} M={M} P={P} T={T_sensor}]."
                        if is_motionless:
                            desc_text += f" Stationary for {int(stationary_time)}s."
                        if bleeding_detected:
                            desc_text += f" Suspected bleeding cue detected."
                            
                        self._dispatch_alert(
                            mqtt_client, 
                            "HUMAN", 
                            survivor_prob, 
                            [bx, by, bw, bh], 
                            severity, 
                            desc_text
                        )

                    # 3b. Environmental obstacle hazards
                    elif cls_name in ["car", "truck", "backpack", "handbag", "suitcase", "chair", "fire hydrant", "bottle"]:
                        hazard_count += 1
                        hazard_boxes.append([bx, by, bw, bh])
                        if not debris_detected: # only draw standard if custom yolo debris didn't cover it
                            cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), (0, 165, 255), 1)
                            cv2.putText(annotated_frame, f"HAZARD: {cls_name.upper()}", (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 165, 255), 1)
                            
                            self._dispatch_alert(
                                mqtt_client, 
                                "HAZARD", 
                                int(conf*100), 
                                [bx, by, bw, bh], 
                                "medium", 
                                f"Hazard: {cls_name.capitalize()} ({int(conf*100)}%) - Path blockage."
                            )
            except Exception as e:
                print(f"[AI Server] YOLO human pipeline error: {e}")
        else:
            # OpenCV Motion & High-Vis Rescuer Heuristic Fallback (Deep Learning Bypassed)
            if motion_detected:
                mx, my, mw, mh = motion_bbox
                person_count += 1
                
                # Check for fluorescent high-vis rescue vest in motion region
                roi = frame[my:my+mh, mx:mx+mw]
                is_rescuer = self._check_high_vis(roi)
                bleeding_detected, bleed_pct, bleed_mask = self._detect_bleeding(roi)
                if bleeding_detected:
                    bleeding_count += 1
                
                H = 0 # YOLO bypassed
                M = 85 # motion confirmed
                P = 60 # default standing
                T_sensor = min(100, int(30 + (sensor_state["vibration"] * 15) + (sensor_state["gas"] / 4095.0) * 35))
                if sensor_state["pir_sensor"] == "TRIGGERED":
                    T_sensor = max(T_sensor, 90)
                
                # Scene Context Score
                S_scene = self.last_scene_conf if self.last_scene_type != "Unknown emergency" else 30
                
                # Fusion formula
                survivor_prob = int((0.35 * H) + (0.20 * M) + (0.25 * P) + (0.10 * T_sensor) + (0.10 * S_scene))
                max_survivor_prob = max(max_survivor_prob, survivor_prob)
                
                sub_label = "Potential Survivor"
                severity = "medium"
                color = (0, 212, 255)
                
                if is_rescuer:
                    sub_label = "Rescue Worker"
                    severity = "low"
                    color = (0, 255, 0)
                elif bleeding_detected:
                    sub_label = "Injured Person"
                    severity = "high"
                    color = (0, 128, 255)
                
                # Estimate face bounding box from motion box
                face_w = int(mw * 0.35)
                face_h = int(min(mh * 0.18, face_w * 1.25))
                face_x = int(mx + (mw - face_w) / 2)
                face_y = int(my + (mh * 0.04))

                # Ensure coordinates are within frame boundaries
                face_x = max(0, min(face_x, width - 1))
                face_y = max(0, min(face_y, height - 1))
                face_w = max(1, min(face_w, width - face_x))
                face_h = max(1, min(face_h, height - face_y))

                cv2.rectangle(annotated_frame, (face_x, face_y), (face_x + face_w, face_y + face_h), color, 2)
                cv2.putText(annotated_frame, f"Heuristic: {sub_label} ({survivor_prob}%)", (face_x, face_y - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
                
                desc_text = f"Heuristic {sub_label} Detected - Motion tracking and visual fluor diagnostics active."
                if bleeding_detected:
                    desc_text += " Suspected localized wound signature detected."
                
                self._dispatch_alert(
                    mqtt_client, 
                    "HUMAN", 
                    survivor_prob, 
                    [mx, my, mw, mh], 
                    severity, 
                    desc_text
                )

        # Phase 6: Disaster Scene Classifier sub-sampling (Every 5th frame)
        self.frame_counter += 1
        if self.frame_counter % 5 == 0 or not hasattr(self, 'last_scene_type'):
            disaster_type, disaster_conf = self._classify_disaster_scene(
                frame,
                confirmed_fire, 
                confirmed_smoke, 
                hazard_count, 
                person_count, 
                flood_detected, 
                bleeding_count
            )
            self.last_scene_type = disaster_type
            self.last_scene_conf = disaster_conf
        
        if self.last_scene_type != "Unknown emergency":
            tele_payload = {
                "sensor": "disaster_scene",
                "value": f"{self.last_scene_type} ({self.last_scene_conf}%)",
                "status": "CRITICAL" if self.last_scene_conf > 75 else "WARNING"
            }
            if mqtt_client is not None:
                try:
                    mqtt_client.publish(TOPIC_TELE, json.dumps(tele_payload))
                except Exception:
                    pass
            
            # Send general scene alerts periodically
            self._dispatch_alert(
                mqtt_client, 
                "HAZARD", 
                self.last_scene_conf, 
                [0, 0, width, height], 
                "high" if self.last_scene_conf > 75 else "medium", 
                f"Disaster Type: {self.last_scene_type} ({self.last_scene_conf}%) - Vision + Telemetry Classifier active."
            )

        # ── PHASE 5: RISK GRID MAP & DANGER SCORE AGGREGATION ──
        risk_grid = [[0.0 for _ in range(4)] for _ in range(4)]
        cell_w = width / 4.0
        cell_h = height / 4.0
        for h_box in hazard_boxes:
            hx, hy, hw, hh = h_box
            start_col = int(max(0, hx // cell_w))
            end_col = int(min(3, (hx + hw) // cell_w))
            start_row = int(max(0, hy // cell_h))
            end_row = int(min(3, (hy + hh) // cell_h))
            for r in range(start_row, end_row + 1):
                for c in range(start_col, end_col + 1):
                    risk_grid[r][c] = 1.0

        global_hazard_score = min(1.0, 0.40 * (1.0 if confirmed_fire else 0.0) + 0.35 * (1.0 if flood_detected else 0.0) + 0.25 * (1.0 if debris_detected else 0.0))
        urgency = "low"
        if person_count > 0:
            urgency = "medium"
        if confirmed_fire or flood_detected:
            urgency = "high"
        if person_count > 0 and (confirmed_fire or flood_detected or bleeding_count > 0):
            urgency = "critical"

        # Rule 4: Critical fire and gas outbreak
        if confirmed_fire and confirmed_smoke and sensor_state["gas"] > 1500:
            self._dispatch_alert(
                mqtt_client,
                "FIRE",
                98,
                [0, 0, width, height],
                "critical",
                f"CRITICAL FIRE OUTBREAK: Live flames, dense smoke, and toxic gas ({sensor_state['gas']} ppm) detected!"
            )

        # Publish the Phase 11 structured JSON payload as telemetry
        structured_telemetry = {
            "timestamp": int(time.time() * 1000),
            "camera_id": "cam_ares_01",
            "scene": {
                "label": self.last_scene_type,
                "confidence": self.last_scene_conf / 100.0
            },
            "survivor_probability": float(max_survivor_prob) / 100.0,
            "urgency": urgency,
            "global_hazard_score": global_hazard_score,
            "risk_grid": risk_grid
        }
        if mqtt_client is not None:
            try:
                mqtt_client.publish(TOPIC_TELE, json.dumps(structured_telemetry))
            except Exception:
                pass

        return annotated_frame

    # ── AUXILIARY CV CORE DETECTORS ──────────────────────────────────────────────────────────────
    def _detect_motion(self, frame):
        """OpenCV contour mapping for background motion tracking."""
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        fg_mask = self.bg_subtractor.apply(gray)
        
        # Clean background noise using morphological opening/closing
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_OPEN, kernel)
        
        contours, _ = cv2.findContours(fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        largest_contour = None
        max_area = 0
        
        for c in contours:
            area = cv2.contourArea(c)
            if area > 1000: # motion threshold limits
                if area > max_area:
                    max_area = area
                    largest_contour = c
                    
        if largest_contour is not None:
            x, y, w, h = cv2.boundingRect(largest_contour)
            return True, (x, y, w, h)
        return False, None

    def _detect_fire_hsv(self, frame):
        """Color-masking thresholds in HSV space to extract flame thermal cores."""
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        
        # Broad fire orange/yellow/red HSV limits to capture all types of flames
        # Range 1: Hue 0 to 35 (covers red, orange, yellow)
        lower_fire1 = np.array([0, 50, 100], dtype="uint8")
        upper_fire1 = np.array([35, 255, 255], dtype="uint8")
        
        # Range 2: Hue 165 to 180 (covers dark red flames)
        lower_fire2 = np.array([165, 50, 100], dtype="uint8")
        upper_fire2 = np.array([180, 255, 255], dtype="uint8")
        
        mask1 = cv2.inRange(hsv, lower_fire1, upper_fire1)
        mask2 = cv2.inRange(hsv, lower_fire2, upper_fire2)
        mask = cv2.bitwise_or(mask1, mask2)
        
        # Morphological open/close to clear noise and group flame clusters
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        largest_contour = None
        max_area = 0
        for c in contours:
            area = cv2.contourArea(c)
            if area > 100: # Slightly lower threshold to capture smaller flames (e.g. a lighter)
                if area > max_area:
                    max_area = area
                    largest_contour = c
                    
        if largest_contour is not None:
            x, y, w, h = cv2.boundingRect(largest_contour)
            confidence = int(min(99, 70 + (max_area / 1000) * 10))
            return True, (x, y, w, h), confidence
        return False, None, 0

    def _detect_smoke_hsv(self, frame):
        """Color-masking thresholds to isolate diffuse gray smoke plumes."""
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        
        # Smoke ranges: low saturation, mild greyish-white value ranges
        lower_smoke = np.array([0, 0, 100], dtype="uint8")
        upper_smoke = np.array([180, 50, 200], dtype="uint8")
        
        mask = cv2.inRange(hsv, lower_smoke, upper_smoke)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        largest_contour = None
        max_area = 0
        for c in contours:
            area = cv2.contourArea(c)
            if area > 1500: # Large spreading area required to verify smoke plume
                if area > max_area:
                    max_area = area
                    largest_contour = c
                    
        if largest_contour is not None:
            x, y, w, h = cv2.boundingRect(largest_contour)
            probability = int(min(95, 60 + (max_area / 3000) * 8))
            return True, (x, y, w, h), probability
        return False, None, 0

    def _check_high_vis(self, roi):
        """Checks for fluorescent yellow or bright orange garments within ROI."""
        if roi.size == 0:
            return False
        hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
        
        # Bright neon orange or lime-green high-vis ranges
        lower_neon = np.array([15, 100, 100])
        upper_neon = np.array([40, 255, 255])
        
        mask = cv2.inRange(hsv, lower_neon, upper_neon)
        percentage = (cv2.countNonZero(mask) / roi.size) * 100
        return percentage > 10.0 # True if >10% of vest contains high-vis colors

    def _dispatch_alert(self, mqtt_client, label, confidence, bbox, severity, desc):
        """Sends formatted detection JSONs to the website MQTT topic."""
        now = time.time()
        # Cooldown guard per alert type or description to avoid flood
        alert_key = f"{label}_{desc[:15]}"
        if alert_key in self.last_alert_time:
            if now - self.last_alert_time[alert_key] < self.alert_cooldown:
                return
        
        self.last_alert_time[alert_key] = now
        
        # Build the payload conforming to standard overlays and live HUD log feeds
        payload = {
            "type": "DETECTION",
            "label": label,
            "conf": confidence,
            "x": bbox[0],
            "y": bbox[1],
            "w": bbox[2],
            "h": bbox[3],
            "severity": severity,
            "timestamp": int(now * 1000),
            "desc": desc
        }
        
        if mqtt_client is not None:
            try:
                mqtt_client.publish(TOPIC_ALERTS, json.dumps(payload), qos=1)
                print(f"[AI Alert] Dispatching Multi-Model Alert: {label} ({confidence}%) Severity: {severity.upper()}")
            except Exception as e:
                print(f"[AI Alert] MQTT Alert failed to publish: {e}")
        else:
            print(f"[Local AI Alert] {label} ({confidence}%) Severity: {severity.upper()} - {desc}")


# ── MQTT SENSOR FUSION COMMAND LISTENERS ──────────────────────────────────────────────────────────
def on_mqtt_connect(client, userdata, flags, rc):
    if rc == 0:
        print("[MQTT Broker] Connected successfully to Cloud EMQX Cluster!")
        try:
            client.subscribe(TOPIC_TELE)
            client.subscribe(TOPIC_COMMAND)
        except Exception as e:
            print(f"[MQTT Broker] Subscription failed: {e}")
    else:
        print(f"[MQTT Broker] Connection failed with code: {rc}")

def on_mqtt_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode())
        
        if msg.topic == TOPIC_TELE:
            sensor = payload.get("sensor")
            val = payload.get("value")
            
            if sensor == "gas":
                sensor_state["gas"] = int(val)
            elif sensor == "vibration":
                sensor_state["vibration"] = float(val)
            elif sensor == "fire":
                sensor_state["fire_sensor"] = val
            elif sensor == "pir":
                sensor_state["pir_sensor"] = val
            elif sensor == "batt":
                sensor_state["battery"] = float(val)
    except Exception as e:
        pass


# ── MAIN EXECUTION HUB ───────────────────────────────────────────────────────────────────────────
def main():
    print("=====================================================================")
    print(" RescueBOT Operations: Custom AI/ML Inference Pipeline Server")
    print("=====================================================================")
    
    print("\nSelect Stream Source Mode:")
    print(" [1] Live ESP32-CAM stream (Production)")
    print(" [2] Local Connected Webcam (Demo Mode)")
    print(" [3] Video File Loop (Test Mode)")
    print(" [4] Synthetic Disaster Simulator (Hackathon Demo Mode - 0 Hardware required!)")
    
    choice = input("\nEnter choice (1-4, default is 1): ").strip()
    
    stream_url = DEFAULT_STREAM_URL
    loop = False
    synthetic = False
    sim_mode = False
    
    if choice == "2":
        webcam_idx = input("\nEnter webcam index (default 0): ").strip()
        stream_url = webcam_idx if webcam_idx else "0"
    elif choice == "3":
        video_path = input("\nEnter path to local video file (e.g. sample.mp4): ").strip()
        if not video_path:
            video_path = "sample.mp4"
        stream_url = video_path
        loop = True
    elif choice == "4":
        synthetic = True
        sim_mode = True
        stream_url = "synthetic"
    else:
        ip_override = input(f"\nEnter ESP32-CAM IP or press ENTER to use default ({DEFAULT_STREAM_URL}): ").strip()
        if ip_override:
            if not ip_override.startswith("http"):
                stream_url = f"http://{ip_override}:81/stream"
            else:
                stream_url = ip_override

    # Establish MQTT Client with double-layer TCP + WebSockets resilience
    mqtt_client = None
    if HAS_MQTT:
        # 1. Attempt standard TCP on port 1883
        try:
            mqtt_client = mqtt.Client()
            mqtt_client.on_connect = on_mqtt_connect
            mqtt_client.on_message = on_mqtt_message
            print("[MQTT] Connecting to EMQX Broker via standard TCP on port 1883...")
            mqtt_client.connect(MQTT_BROKER, 1883, 60)
            mqtt_client.loop_start()
            print("[MQTT] Connected successfully via standard TCP port 1883.")
        except Exception as e:
            print(f"[MQTT] TCP port 1883 blocked or failed: {e}. Trying WebSockets fallback on port 8083...")
            try:
                # 2. Fallback to WebSockets (bypasses standard port 1883 firewalls)
                mqtt_client = mqtt.Client(transport="websockets")
                mqtt_client.on_connect = on_mqtt_connect
                mqtt_client.on_message = on_mqtt_message
                mqtt_client.connect(MQTT_BROKER, 8083, 60)
                mqtt_client.loop_start()
                print("[MQTT] Connected successfully via WebSockets fallback port 8083!")
            except Exception as wse:
                print(f"[MQTT] WebSockets fallback failed: {wse}. Running in Local Logging mode.")
                mqtt_client = None
    else:
        print("[MQTT] Bypassed. paho-mqtt module is missing.")

    # Ingest source stream reader
    stream_reader = ThreadedStreamReader(stream_url, loop=loop, synthetic=synthetic)
    stream_reader.start()

    ai_engine = DisasterAIEngine()
    ai_engine.sim_mode = sim_mode

    print("\n[AI Active] Pipeline Online! Press 'q' inside the video window to quit.")
    
    try:
        while True:
            frame = stream_reader.read()
            if frame is None:
                time.sleep(0.01)
                continue

            processed_frame = ai_engine.process_frame(frame, mqtt_client)
            
            # Show display only if OpenCV UI module is active
            if HAS_OPENCV:
                cv2.imshow("RescueBOT operational Vision Array - AI Stream", processed_frame)
                if cv2.waitKey(1) & 0xFF == ord('q'):
                    break
            else:
                time.sleep(0.03)  # Headless CPU frame throttling
    except KeyboardInterrupt:
        print("\nShutdown interrupt received.")
    finally:
        print("\nCleaning system pipeline resources...")
        stream_reader.stop()
        if HAS_OPENCV:
            cv2.destroyAllWindows()
        if mqtt_client is not None:
            try:
                mqtt_client.loop_stop()
            except Exception:
                pass
        print("AI Inference Server offline.")

if __name__ == "__main__":
    main()
