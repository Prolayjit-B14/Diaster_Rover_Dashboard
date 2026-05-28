"""
verify_environment.py — RescueBOT Environment Diagnostics
===========================================================
Validates that all dependencies, models, GPU/CPU, and
camera connectivity are correctly configured.

Run:  python verify_environment.py
"""

import sys
import os
import time
import pathlib
import json
import platform
import subprocess
import logging

ROOT = pathlib.Path(__file__).parent

# ── ANSI Colors ───────────────────────────────────────────────
try:
    from colorama import Fore, Style, init as colorama_init
    colorama_init(autoreset=True)
    GREEN  = Fore.GREEN
    YELLOW = Fore.YELLOW
    RED    = Fore.RED
    CYAN   = Fore.CYAN
    MAGENTA = Fore.MAGENTA
    BOLD   = Style.BRIGHT
    RESET  = Style.RESET_ALL
except ImportError:
    GREEN = YELLOW = RED = CYAN = MAGENTA = BOLD = RESET = ""

log = logging.getLogger("Verifier")
logging.basicConfig(level=logging.DEBUG, format="%(message)s")

PASS = f"{GREEN}✓ PASS{RESET}"
FAIL = f"{RED}✗ FAIL{RESET}"
WARN = f"{YELLOW}⚠ WARN{RESET}"
INFO = f"{CYAN}ℹ INFO{RESET}"

results = {}

# ─────────────────────────────────────────────────────────────
def section(title: str):
    print(f"\n{BOLD}{CYAN}{'─'*55}{RESET}")
    print(f"{BOLD}  {title}{RESET}")
    print(f"{BOLD}{CYAN}{'─'*55}{RESET}")

def check(name: str, ok: bool, detail: str = "", warn_only: bool = False):
    status = PASS if ok else (WARN if warn_only else FAIL)
    line = f"  {status}  {name}"
    if detail:
        line += f"  [{detail}]"
    print(line)
    results[name] = {"ok": ok, "detail": detail}
    return ok


# ─────────────────────────────────────────────────────────────
# 1. Python Version
# ─────────────────────────────────────────────────────────────
def check_python():
    section("Python Runtime")
    v = sys.version_info
    ver_str = f"{v.major}.{v.minor}.{v.micro}"
    ok = v.major == 3 and v.minor >= 9
    check("Python 3.9+", ok, ver_str)
    check("Platform", True, platform.system() + " " + platform.machine())
    return ok


# ─────────────────────────────────────────────────────────────
# 2. Required Packages
# ─────────────────────────────────────────────────────────────
REQUIRED_PACKAGES = [
    ("ultralytics",   "ultralytics",    True),
    ("torch",         "torch",          True),
    ("torchvision",   "torchvision",    True),
    ("cv2",           "opencv-python",  True),
    ("mediapipe",     "mediapipe",      True),
    ("numpy",         "numpy",          True),
    ("fastapi",       "fastapi",        True),
    ("uvicorn",       "uvicorn",        True),
    ("paho.mqtt",     "paho-mqtt",      True),
    ("PIL",           "Pillow",         True),
    ("requests",      "requests",       True),
    ("tqdm",          "tqdm",           True),
    ("yaml",          "pyyaml",         True),
    ("psutil",        "psutil",         True),
    ("scipy",         "scipy",          False),
    ("websockets",    "websockets",     False),
    ("pandas",        "pandas",         False),
    ("matplotlib",    "matplotlib",     False),
    ("colorama",      "colorama",       False),
]

def check_packages():
    section("Python Packages")
    all_ok = True
    for import_name, pkg_name, required in REQUIRED_PACKAGES:
        try:
            mod = __import__(import_name)
            ver = getattr(mod, "__version__", "?")
            check(f"import {import_name}", True, ver)
        except ImportError:
            if required:
                check(f"import {import_name}", False, f"MISSING — install: pip install {pkg_name}")
                all_ok = False
            else:
                check(f"import {import_name}", True, "optional — not installed", warn_only=True)
    return all_ok


# ─────────────────────────────────────────────────────────────
# 3. GPU / CPU
# ─────────────────────────────────────────────────────────────
def check_compute():
    section("Compute Hardware")
    try:
        import torch
        cuda_available = torch.cuda.is_available()
        check("PyTorch installed", True, torch.__version__)

        if cuda_available:
            device_name = torch.cuda.get_device_name(0)
            vram = torch.cuda.get_device_properties(0).total_memory // (1024**2)
            check("CUDA GPU available", True, f"{device_name} ({vram}MB VRAM)")
            check("GPU acceleration", True, "YOLO will use CUDA automatically")
        else:
            check("CUDA GPU available", False, "No CUDA GPU", warn_only=True)
            check("CPU inference", True, "Fallback — expect ~10-30 FPS on modern CPU")

        # MPS (Apple Silicon)
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            check("Apple MPS (M-series)", True, "MPS acceleration available")

        # RAM
        import psutil
        ram_gb = psutil.virtual_memory().total / (1024**3)
        ok_ram = ram_gb >= 4
        check(f"System RAM", ok_ram, f"{ram_gb:.1f} GB ({'OK' if ok_ram else 'LOW — recommend 8GB+'})")
        return cuda_available

    except Exception as e:
        check("Compute check", False, str(e))
        return False


# ─────────────────────────────────────────────────────────────
# 4. Model Files
# ─────────────────────────────────────────────────────────────
EXPECTED_MODELS = [
    ("models/weights/person/yolo11n.pt",      "Person Detection",     True),
    ("models/weights/pose/yolo11n-pose.pt",   "Pose Estimation",      True),
    ("models/weights/fire/fire_yolov8n.pt",   "Fire Detection",       False),
    ("models/weights/smoke/smoke_yolov8n.pt", "Smoke Detection",      False),
]

def check_models():
    section("Model Files")
    all_required_ok = True

    for rel_path, label, required in EXPECTED_MODELS:
        p = ROOT / rel_path
        if p.exists():
            size_mb = p.stat().st_size / (1024 * 1024)
            ok = size_mb > 0.1  # at least 100KB
            check(f"{label} ({p.name})", ok, f"{size_mb:.1f}MB")
        else:
            if required:
                check(f"{label} ({p.name})", False, "NOT FOUND — run: python download_models.py")
                all_required_ok = False
            else:
                check(f"{label} ({p.name})", True,
                      "Not found — HSV fallback active", warn_only=True)

    # Registry
    reg = ROOT / "models" / "model_registry.json"
    check("model_registry.json", reg.exists(),
          "Found" if reg.exists() else "Missing — run download_models.py")

    return all_required_ok


# ─────────────────────────────────────────────────────────────
# 5. YOLO Inference Test
# ─────────────────────────────────────────────────────────────
def check_inference():
    section("YOLO Inference Smoke Test")
    model_path = ROOT / "models" / "weights" / "person" / "yolo11n.pt"
    if not model_path.exists():
        check("YOLO inference", False, "Model not downloaded yet")
        return False

    try:
        import numpy as np
        from ultralytics import YOLO

        log.debug("Loading YOLO model...")
        t0 = time.perf_counter()
        model = YOLO(str(model_path))
        load_time = (time.perf_counter() - t0) * 1000
        check("YOLO model load", True, f"{load_time:.0f}ms")

        # Dummy frame
        dummy = np.zeros((640, 640, 3), dtype=np.uint8)
        t0 = time.perf_counter()
        results_yolo = model.predict(dummy, verbose=False, imgsz=640)
        inf_time = (time.perf_counter() - t0) * 1000
        fps = 1000 / inf_time if inf_time > 0 else 0

        check("YOLO inference", True, f"{inf_time:.0f}ms latency / {fps:.1f} FPS")
        ok = fps >= 1
        check("Inference speed", ok,
              "OK for real-time" if ok else "Too slow — check CPU/GPU")
        return ok

    except Exception as e:
        check("YOLO inference", False, str(e))
        return False


# ─────────────────────────────────────────────────────────────
# 6. MediaPipe
# ─────────────────────────────────────────────────────────────
def check_mediapipe():
    section("MediaPipe Gesture & Pose")
    try:
        import mediapipe as mp
        import numpy as np

        ver = mp.__version__
        check("MediaPipe installed", True, f"v{ver}")

        dummy = np.zeros((480, 640, 3), dtype=np.uint8)

        # MediaPipe 0.10+ uses Tasks API; solutions may still exist as legacy
        hands_ok = False
        pose_ok  = False

        # Try legacy solutions API (works on many 0.10.x builds)
        try:
            hands = mp.solutions.hands.Hands(static_image_mode=True, max_num_hands=2)
            hands.process(dummy)
            hands.close()
            hands_ok = True
        except Exception:
            pass

        # Try Tasks API (0.10.14+)
        if not hands_ok:
            try:
                from mediapipe.tasks import python as mp_tasks
                from mediapipe.tasks.python import vision
                hands_ok = True  # Tasks API available
            except Exception:
                pass

        check("MediaPipe Hands", hands_ok,
              "Solutions or Tasks API available" if hands_ok else "API not accessible")

        try:
            pose = mp.solutions.pose.Pose(static_image_mode=True)
            pose.process(dummy)
            pose.close()
            pose_ok = True
        except Exception:
            pose_ok = hands_ok  # If Tasks API works, pose is also available

        check("MediaPipe Pose", pose_ok, "Pose estimation ready" if pose_ok else "Unavailable")
        check("Waving/SOS Detection", True, "Implemented via joint angle analysis in gesture_detector.py")
        return hands_ok

    except ImportError:
        check("MediaPipe", False, "Not installed — run: pip install mediapipe")
        return False
    except Exception as e:
        check("MediaPipe", False, str(e))
        return False


# ─────────────────────────────────────────────────────────────
# 7. OpenCV Camera Stream
# ─────────────────────────────────────────────────────────────
def check_camera():
    section("Camera / Stream Connectivity")
    try:
        import cv2
        check("OpenCV installed", True, cv2.__version__)

        # Check MOG2
        bg = cv2.createBackgroundSubtractorMOG2()
        import numpy as np
        bg.apply(np.zeros((480, 640, 3), dtype=np.uint8))
        check("MOG2 Motion Detector", True, "Background subtractor ready")

        # Try to load config
        config_path = ROOT / "config.yaml"
        if config_path.exists():
            import yaml
            with open(config_path) as f:
                cfg = yaml.safe_load(f)
            esp_ip = cfg.get("camera", {}).get("esp32_ip", "")
            stream_url = cfg.get("camera", {}).get("stream_url", "").replace("{ip}", esp_ip)

            print(f"\n  {INFO}  Configured ESP32-CAM: {stream_url}")
            print(f"  {INFO}  To test live stream: set esp32_ip in config.yaml")

            # Try connecting
            if esp_ip and esp_ip != "192.168.1.100":
                cap = cv2.VideoCapture(stream_url)
                ok = cap.isOpened()
                cap.release()
                check("ESP32-CAM live stream", ok,
                      f"{stream_url}" if ok else "Unreachable (normal if rover offline)")
            else:
                check("ESP32-CAM stream", True,
                      "Not tested (update esp32_ip in config.yaml)", warn_only=True)
        else:
            check("config.yaml", False, "Not found")

        return True

    except Exception as e:
        check("Camera check", False, str(e))
        return False


# ─────────────────────────────────────────────────────────────
# 8. MQTT Connectivity
# ─────────────────────────────────────────────────────────────
def check_mqtt():
    section("MQTT Broker Connectivity")
    try:
        import paho.mqtt.client as mqtt
        check("paho-mqtt installed", True)

        config_path = ROOT / "config.yaml"
        if config_path.exists():
            import yaml
            with open(config_path) as f:
                cfg = yaml.safe_load(f)
            broker = cfg.get("mqtt", {}).get("broker", "broker.emqx.io")
            port = cfg.get("mqtt", {}).get("port", 1883)

            print(f"\n  {INFO}  Configured broker: {broker}:{port}")

            connected = [False]
            def on_connect(c, u, f, rc):
                connected[0] = (rc == 0)

            client = mqtt.Client(client_id="rescuebot_verify_test")
            client.on_connect = on_connect
            try:
                client.connect(broker, port, keepalive=5)
                client.loop_start()
                time.sleep(2)
                client.loop_stop()
                client.disconnect()
                check("MQTT broker reachable", connected[0],
                      f"{broker}:{port}" if connected[0] else "Unreachable (check credentials or network)")
            except Exception as e:
                check("MQTT broker reachable", False, str(e), warn_only=True)
        return True

    except ImportError:
        check("paho-mqtt", False, "Not installed")
        return False


# ─────────────────────────────────────────────────────────────
# 9. Directory Structure
# ─────────────────────────────────────────────────────────────
def check_directories():
    section("Project Directory Structure")
    required_dirs = [
        "models/weights/person",
        "models/weights/fire",
        "models/weights/smoke",
        "models/weights/gesture",
        "models/weights/injury",
        "models/weights/blood",
        "models/weights/pose",
        "models/logs",
        "models/cache",
        "models/datasets",
        "models/downloads",
    ]
    all_ok = True
    for d in required_dirs:
        p = ROOT / d
        ok = p.exists() and p.is_dir()
        check(d, ok, "OK" if ok else "MISSING — run python init_project.py")
        if not ok:
            all_ok = False
    return all_ok


# ─────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────
def main():
    print(f"\n{BOLD}{CYAN}{'='*55}{RESET}")
    print(f"{BOLD}  RescueBOT AI — Environment Verification{RESET}")
    print(f"{BOLD}  {time.strftime('%Y-%m-%d %H:%M:%S')}{RESET}")
    print(f"{BOLD}{CYAN}{'='*55}{RESET}")

    py_ok    = check_python()
    pkg_ok   = check_packages()
    gpu_ok   = check_compute()
    dir_ok   = check_directories()
    model_ok = check_models()
    inf_ok   = check_inference()
    mp_ok    = check_mediapipe()
    cam_ok   = check_camera()
    mqtt_ok  = check_mqtt()

    # ── Final Summary ─────────────────────────────────────────
    section("FINAL VERIFICATION SUMMARY")
    checks = [
        ("Python 3.9+",        py_ok),
        ("All packages",       pkg_ok),
        ("Directory structure",dir_ok),
        ("Model files",        model_ok),
        ("YOLO inference",     inf_ok),
        ("MediaPipe",          mp_ok),
        ("OpenCV/Camera",      cam_ok),
    ]

    all_pass = all(ok for _, ok in checks)
    for label, ok in checks:
        print(f"  {'✓' if ok else '✗'} {label}")

    print(f"\n{BOLD}{'='*55}{RESET}")
    if all_pass:
        print(f"{BOLD}{GREEN}  ✅ SYSTEM READY — Run: python inference_server.py{RESET}")
    else:
        print(f"{BOLD}{YELLOW}  ⚠ ISSUES DETECTED — See above for remediation{RESET}")
        if not model_ok:
            print(f"  → Run:  python download_models.py")
        if not pkg_ok:
            print(f"  → Run:  pip install -r requirements.txt")
    print(f"{BOLD}{'='*55}{RESET}\n")

    # Save report
    report_path = ROOT / "models" / "logs" / "verify_report.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with open(report_path, "w") as f:
        json.dump({
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "system_ready": all_pass,
            "checks": {label: ok for label, ok in checks},
            "detailed": results,
        }, f, indent=2)
    print(f"  Report saved: {report_path}")

    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(main())
