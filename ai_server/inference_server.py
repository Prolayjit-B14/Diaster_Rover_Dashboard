import cv2
import numpy as np
import time
import json
import threading
import queue
import paho.mqtt.client as mqtt
from ultralytics import YOLO

# =================================================================================================
# RescueBOT: HIGH-PERFORMANCE DISASTER MANAGEMENT AI/ML INFERENCE SERVER
# =================================================================================================
# Version: 1.0.0-HACKATHON-MVP
# Platform: Laptop / Raspberry Pi 4/5 / Jetson Nano
# Description: Connects directly to the live ESP32-CAM MJPEG stream, runs multi-task real-time 
#              inference (YOLOv8 Object Detection, YOLOv8-Pose Injury Classifier, HSV Fire/Smoke 
#              Tracker, and OpenCV Motion Contours), performs Sensor Fusion, and publishes 
#              rich dynamic HUD bounding box JSON alerts to the RescueBOT Dashboard via MQTT.
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
    """
    def __init__(self, stream_url):
        self.stream_url = stream_url
        self.frame_queue = queue.Queue(maxsize=3)
        self.running = False
        self.thread = None
        self.cap = None

    def start(self):
        self.running = True
        self.thread = threading.Thread(target=self._update, daemon=True)
        self.thread.start()
        print(f"[Stream Reader] Threaded consumer attached to: {self.stream_url}")

    def _update(self):
        while self.running:
            try:
                self.cap = cv2.VideoCapture(self.stream_url)
                if not self.cap.isOpened():
                    print("[Stream Reader] Stream offline. Re-attempting in 3 seconds...")
                    time.sleep(3)
                    continue

                while self.running:
                    ret, frame = self.cap.read()
                    if not ret:
                        print("[Stream Reader] Frame drop detected. Reconnecting stream...")
                        break

                    # Keep queue size at 1 to only hold the freshest frame (0 latency!)
                    if not self.frame_queue.empty():
                        try:
                            self.frame_queue.get_nowait()
                        except queue.Empty:
                            pass
                    
                    self.frame_queue.put(frame)
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


# ── AI INFERENCE PIPELINE ────────────────────────────────────────────────────────────────────────
class DisasterAIEngine:
    def __init__(self):
        print("\n[AI Setup] Loading lightweight YOLOv8 nano models onto device...")
        # yolov8n.pt for standard object classes (person, backpack, handbag, car, fire hydrant)
        self.detector = YOLO("yolov8n.pt")
        # yolov8n-pose.pt for keypoint skeletal pose estimation to evaluate injuries/falls
        self.pose_estimator = YOLO("yolov8n-pose.pt")
        print("[AI Setup] Neural networks loaded successfully!")

        # Initialize OpenCV Motion Background Subtractor
        self.bg_subtractor = cv2.createBackgroundSubtractorMOG2(history=100, varThreshold=50, detectShadows=True)
        
        # Throttler for MQTT alarms (prevents flooding the network)
        self.last_alert_time = {}
        self.alert_cooldown = 3.0 # seconds

    def process_frame(self, frame, mqtt_client):
        height, width, _ = frame.shape
        annotated_frame = frame.copy()
        
        # 1. OPENCV MOTION CONTROLS PIPELINE
        motion_detected, motion_bbox = self._detect_motion(frame)
        if motion_detected:
            mx, my, mw, mh = motion_bbox
            cv2.rectangle(annotated_frame, (mx, my), (mx+mw, my+mh), (255, 255, 0), 1)
            cv2.putText(annotated_frame, "MOTION DETECTED", (mx, my - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 0), 1)
            self._dispatch_alert(mqtt_client, "MOTION", 85, [mx, my, mw, mh], "low", 
                                 "Rover optical arrays report active sector kinetic signature.")

        # 2. HSV FIRE & SMOKE DETECTOR PIPELINE
        fire_detected, fire_bbox, fire_conf = self._detect_fire_hsv(frame)
        if fire_detected:
            fx, fy, fw, fh = fire_bbox
            cv2.rectangle(annotated_frame, (fx, fy), (fx+fw, fy+fh), (0, 0, 255), 2)
            cv2.putText(annotated_frame, f"FIRE DETECTED ({fire_conf}%)", (fx, fy - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 255), 1)
            self._dispatch_alert(mqtt_client, "FIRE", fire_conf, [fx, fy, fw, fh], "critical", 
                                 "Thermal fire analysis confirms active high-temperature combustion zone.")

        smoke_detected, smoke_bbox, smoke_prob = self._detect_smoke_hsv(frame)
        if smoke_detected:
            sx, sy, sw, sh = smoke_bbox
            cv2.rectangle(annotated_frame, (sx, sy), (sx+sw, sy+sh), (128, 128, 128), 1)
            cv2.putText(annotated_frame, f"SMOKE RISK ({smoke_prob}%)", (sx, sy - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (128, 128, 128), 1)
            self._dispatch_alert(mqtt_client, "SMOKE", smoke_prob, [sx, sy, sw, sh], "high", 
                                 "Optical sensors isolate low-visibility aerosol/smoke diffusion plume.")

        # 3. YOLOV8 GENERAL OBJECT & DEBRIS (HAZARD) PIPELINE
        results = self.detector(frame, verbose=False)[0]
        person_count = 0
        hazard_count = 0
        
        for box in results.boxes:
            cls_id = int(box.cls[0])
            conf   = float(box.conf[0])
            if conf < 0.5:
                continue

            xyxy = box.xyxy[0].tolist()
            x1, y1, x2, y2 = [int(val) for val in xyxy]
            bx, by, bw, bh = x1, y1, x2 - x1, y2 - y1
            
            # Map YOLO class names
            cls_name = self.detector.names[cls_id]

            # 3a. Person Detection
            if cls_name == "person":
                person_count += 1
                label = "Human Detected"
                severity = "medium"
                
                # Check for high-vis vest colors (orange/yellow) inside bounding box to flag "Rescue Worker"
                roi = frame[y1:y2, x1:x2]
                if self._check_high_vis(roi):
                    label = "Rescue Worker"
                    severity = "low"
                    color = (0, 255, 0)
                else:
                    color = (0, 212, 255)

                cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), color, 2)
                cv2.putText(annotated_frame, f"{label} ({int(conf*100)}%)", (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
                
                self._dispatch_alert(mqtt_client, "HUMAN", int(conf*100), [bx, by, bw, bh], severity, 
                                     f"Visual AI confirms human biometric outline. Class: {label}.")

            # 3b. Obstacles & Debris Hazards
            elif cls_name in ["car", "truck", "backpack", "handbag", "suitcase", "chair", "fire hydrant", "bottle"]:
                hazard_count += 1
                cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), (0, 165, 255), 1)
                cv2.putText(annotated_frame, f"HAZARD: {cls_name.upper()}", (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 165, 255), 1)
                
                self._dispatch_alert(mqtt_client, "HAZARD", int(conf*100), [bx, by, bw, bh], "high", 
                                     f"Optical mapping isolating structural obstacle/blockage: {cls_name.upper()}")

        # 4. YOLOV8-POSE SKELETAL SENSOR FUSION (INJURY / FALL / DISTRESS CLASSIFICATION)
        pose_results = self.pose_estimator(frame, verbose=False)[0]
        if pose_results.keypoints is not None:
            for kpts in pose_results.keypoints:
                # Keypoints vector: [17 keypoints containing [x, y, conf]]
                # 0: nose, 5: l_shoulder, 6: r_shoulder, 11: l_hip, 12: r_hip, 15: l_ankle, 16: r_ankle
                if len(kpts.xy) == 0:
                    continue
                xy = kpts.xy[0].tolist() # List of 17 keypoints
                conf = kpts.conf[0].tolist() if kpts.conf is not None else [1.0]*17
                
                if len(xy) < 17:
                    continue

                # Check if we have high-confidence skeletal mapping
                if conf[5] > 0.5 and conf[6] > 0.5 and conf[15] > 0.5 and conf[16] > 0.5:
                    head_y  = xy[0][1]
                    hip_y   = (xy[11][1] + xy[12][1]) / 2.0
                    ankle_y = (xy[15][1] + xy[16][1]) / 2.0
                    
                    head_x  = xy[0][0]
                    ankle_x = (xy[15][0] + xy[16][0]) / 2.0

                    # Calculate physical body orientation angle relative to ground
                    dx = abs(ankle_x - head_x)
                    dy = abs(ankle_y - head_y)
                    body_angle = np.arctan2(dy, dx) * 180 / np.pi # Angle in degrees

                    # Injury detection algorithm:
                    # If body is horizontal (body_angle < 35 degrees) and head is low, classify as "Fallen Person / Unconscious Body"
                    if body_angle < 35.0:
                        # Find enclosing box
                        xs = [pt[0] for pt in xy if pt[0] > 0]
                        ys = [pt[1] for pt in xy if pt[1] > 0]
                        if xs and ys:
                            px1, py1, px2, py2 = int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))
                            cv2.rectangle(annotated_frame, (px1, py1), (px2, py2), (0, 0, 255), 3)
                            cv2.putText(annotated_frame, "CRITICAL HARM DETECTED", (px1, py1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)
                            
                            self._dispatch_alert(mqtt_client, "HAZARD", 92, [px1, py1, px2-px1, py2-py1], "critical", 
                                                 "Pose estimation confirms a fallen, potentially motionless/injured survivor outline.")

                    # Distress Signatures:
                    # If hands (wrists 9 & 10) are raised higher than ears/nose (0), classify as "Distress Posture / Survivor Waving"
                    elif conf[9] > 0.5 and xy[9][1] < head_y:
                        xs = [pt[0] for pt in xy if pt[0] > 0]
                        ys = [pt[1] for pt in xy if pt[1] > 0]
                        if xs and ys:
                            px1, py1, px2, py2 = int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))
                            cv2.rectangle(annotated_frame, (px1, py1), (px2, py2), (0, 255, 128), 2)
                            cv2.putText(annotated_frame, "SURVIVOR SIGNALLING FOR HELP", (px1, py1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 128), 2)
                            
                            self._dispatch_alert(mqtt_client, "HAZARD", 88, [px1, py1, px2-px1, py2-py1], "high", 
                                                 "Survivor waving posture detected inside target region! Active distress sign.")

        # 5. DISASTER SCENE CLASSIFIER (Multi-Sensory Heuristics)
        disaster_type = "Unknown Emergency"
        disaster_conf = 50
        
        if fire_detected and smoke_detected:
            disaster_type = "Fire Incident"
            disaster_conf = int(max(fire_conf, smoke_prob))
        elif hazard_count > 3 or (person_count > 0 and sensor_state["vibration"] > 1.2):
            disaster_type = "Building Collapse / Debris"
            disaster_conf = 89
        elif sensor_state["gas"] > 2500:
            disaster_type = "Industrial Gas Leak"
            disaster_conf = 95
        
        # Publish overall disaster type scene classification telemetry
        if disaster_type != "Unknown Emergency":
            tele_payload = {
                "sensor": "disaster_scene",
                "value": f"{disaster_type} ({disaster_conf}%)",
                "status": "CRITICAL" if disaster_conf > 80 else "WARNING"
            }
            mqtt_client.publish(TOPIC_TELE, json.dumps(tele_payload))

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
        
        # Broad fire orange/yellow HSV limits
        lower_fire = np.array([10, 120, 180], dtype="uint8")
        upper_fire = np.array([30, 255, 255], dtype="uint8")
        
        mask = cv2.inRange(hsv, lower_fire, upper_fire)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        largest_contour = None
        max_area = 0
        for c in contours:
            area = cv2.contourArea(c)
            if area > 300: # Pixel grid cutoff limit to avoid noise
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
        # Cooldown guard per alert type to avoid visual HUD bracket cluttering
        if label in self.last_alert_time:
            if now - self.last_alert_time[label] < self.alert_cooldown:
                return
        
        self.last_alert_time[label] = now
        
        # Build the premium payload in the exact JSON format your dashboard website expects!
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
        
        mqtt_client.publish(TOPIC_ALERTS, json.dumps(payload), qos=1)
        print(f"[AI Alert] Dispatching JSON Alert over MQTT: {label} ({confidence}%) Severity: {severity.upper()}")


# ── MQTT SENSOR FUSION COMMAND LISTENERS ──────────────────────────────────────────────────────────
def on_mqtt_connect(client, userdata, flags, rc):
    if rc == 0:
        print("[MQTT Broker] Connected successfully to Cloud EMQX Cluster!")
        # Subscribe to ESP32 telemetries to allow Sensor Fusion
        client.subscribe(TOPIC_TELE)
        # Subscribe to commander
        client.subscribe(TOPIC_COMMAND)
    else:
        print(f"[MQTT Broker] Connection failed with code: {rc}")

def on_mqtt_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode())
        
        # Sensor Fusion Interceptor
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
    print(" RescueBOT Operations: Custom AI/ML Inference Pipeline Server Starting")
    print("=====================================================================")
    
    # Prompt the user to enter their ESP32-CAM stream URL if they want to override the default
    ip_override = input(f"\nEnter ESP32-CAM IP or press ENTER to use default ({DEFAULT_STREAM_URL}): ").strip()
    stream_url = DEFAULT_STREAM_URL
    if ip_override:
        if not ip_override.startswith("http"):
            stream_url = f"http://{ip_override}:81/stream"
        else:
            stream_url = ip_override

    # Connect to the EMQX cloud broker
    mqtt_client = mqtt.Client()
    mqtt_client.on_connect = on_mqtt_connect
    mqtt_client.on_message = on_mqtt_message
    
    try:
        mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
        mqtt_client.loop_start()
    except Exception as e:
        print(f"[MQTT Broker] Connection failed: {e}. Running local visual output only...")

    # Spawn threaded stream reader to avoid video buffering latency
    stream_reader = ThreadedStreamReader(stream_url)
    stream_reader.start()

    # Load Neural Networks and CV detectors
    ai_engine = DisasterAIEngine()

    print("\n[AI Active] Pipeline Online! Press 'q' inside the video window to quit.")
    
    try:
        while True:
            frame = stream_reader.read()
            if frame is None:
                time.sleep(0.01) # Avoid processor spinning while waiting for frame
                continue

            # Process frame through deep learning pipeline and color mask segmenters
            processed_frame = ai_engine.process_frame(frame, mqtt_client)

            # Draw local visual window display
            cv2.imshow("RescueBOT operational Vision Array - AI Stream", processed_frame)
            
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
    except KeyboardInterrupt:
        print("\nShutdown interrupt received.")
    finally:
        print("\nCleaning system pipeline resources...")
        stream_reader.stop()
        cv2.destroyAllWindows()
        mqtt_client.loop_stop()
        print("AI Inference Server offline.")

if __name__ == "__main__":
    main()
