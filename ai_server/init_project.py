# -*- coding: utf-8 -*-
import os, sys
# Force UTF-8 output on Windows to handle box-drawing chars
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
    os.environ["PYTHONIOENCODING"] = "utf-8"
"""
init_project.py — RescueBOT AI Server Master Initialization Script
===================================================================
One-command setup:  python init_project.py

Steps performed:
  1. Create all project directories
  2. Install Python dependencies (pip)
  3. Detect GPU / CPU and configure inference device
  4. Download all pretrained models
  5. Verify ESP32-CAM stream connectivity
  6. Run inference smoke tests
  7. Run full environment diagnostics
  8. Generate benchmark report
  9. Print final system status

Author: RescueBOT Team (BOT THINGS)
"""

import time
import pathlib
import subprocess
import platform
import json
import shutil
import logging

# ── Bootstrap: ensure colorama works ──────────────────────────
def _safe_pip(pkg):
    subprocess.run([sys.executable, "-m", "pip", "install", "--quiet", pkg], check=False)

try:
    from colorama import Fore, Style, init as colorama_init
    colorama_init(autoreset=True)
    GREEN  = Fore.GREEN;  YELLOW = Fore.YELLOW
    RED    = Fore.RED;    CYAN   = Fore.CYAN
    MAGENTA= Fore.MAGENTA; BOLD  = Style.BRIGHT
    RESET  = Style.RESET_ALL
except ImportError:
    _safe_pip("colorama")
    try:
        from colorama import Fore, Style, init as colorama_init
        colorama_init(autoreset=True)
        GREEN  = Fore.GREEN;  YELLOW = Fore.YELLOW
        RED    = Fore.RED;    CYAN   = Fore.CYAN
        MAGENTA= Fore.MAGENTA; BOLD  = Style.BRIGHT
        RESET  = Style.RESET_ALL
    except ImportError:
        GREEN = YELLOW = RED = CYAN = MAGENTA = BOLD = RESET = ""

ROOT = pathlib.Path(__file__).parent

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
log = logging.getLogger("InitProject")

STEP = 0
def step(title: str):
    global STEP
    STEP += 1
    print(f"\n{BOLD}{CYAN}{'='*60}{RESET}")
    print(f"{BOLD}{CYAN}  STEP {STEP}: {title}{RESET}")
    print(f"{BOLD}{CYAN}{'='*60}{RESET}\n")


# ─────────────────────────────────────────────────────────────
# STEP 1 — Create Directory Structure
# ─────────────────────────────────────────────────────────────
def create_directories():
    step("Creating Project Directory Structure")

    dirs = {
        # Model weights
        "models/weights/person":   "YOLOv8/YOLO11 person detection weights",
        "models/weights/fire":     "Fire detection model weights",
        "models/weights/smoke":    "Smoke detection model weights",
        "models/weights/gesture":  "MediaPipe gesture assets cache",
        "models/weights/injury":   "Pose/injury estimation weights",
        "models/weights/blood":    "Blood detection classifier (if available)",
        "models/weights/pose":     "YOLO pose estimation weights",
        # Support dirs
        "models/datasets":         "Training datasets (custom fine-tuning)",
        "models/cache":            "Inference cache / feature maps",
        "models/downloads":        "Temporary download staging area",
        "models/logs":             "Inference logs / diagnostics",
        # Backend structure
        "backend/api":             "FastAPI REST endpoints",
        "backend/detection":       "Per-task detection modules",
        "backend/training":        "Custom model training scripts",
        "backend/utils":           "Shared utilities (video, IO, MQTT)",
        "config":                  "Additional config files",
    }

    for rel, desc in dirs.items():
        p = ROOT / rel
        p.mkdir(parents=True, exist_ok=True)
        print(f"  {GREEN}✓{RESET} {rel:<40} — {desc}")

    # Create .gitkeep in weight dirs so they're tracked
    for subdir in (ROOT / "models" / "weights").iterdir():
        if subdir.is_dir():
            keep = subdir / ".gitkeep"
            if not keep.exists():
                keep.touch()

    log.info(f"{GREEN}✓ All directories created successfully.{RESET}")


# ─────────────────────────────────────────────────────────────
# STEP 2 — Install Python Dependencies
# ─────────────────────────────────────────────────────────────
def install_dependencies():
    step("Installing Python Dependencies")

    req_file = ROOT / "requirements.txt"
    if not req_file.exists():
        log.error(f"{RED}requirements.txt not found at {req_file}{RESET}")
        return False

    print(f"  Installing from: {req_file}\n")

    # Base packages (always CPU-safe)
    cmd = [
        sys.executable, "-m", "pip", "install",
        "--upgrade", "--no-cache-dir",
        "-r", str(req_file)
    ]

    try:
        result = subprocess.run(cmd, check=True, text=True,
                                capture_output=False)
        log.info(f"{GREEN}✓ All packages installed successfully.{RESET}")
        return True
    except subprocess.CalledProcessError as e:
        log.error(f"{RED}✗ pip install failed (exit {e.returncode}).{RESET}")
        log.error("Try running manually: pip install -r requirements.txt")
        return False


# ─────────────────────────────────────────────────────────────
# STEP 3 — Detect GPU / CPU and Configure Device
# ─────────────────────────────────────────────────────────────
def detect_hardware():
    step("Detecting GPU / CPU Hardware")

    device_info = {
        "platform": platform.system(),
        "machine": platform.machine(),
        "python": sys.version,
        "device": "cpu",
        "cuda_available": False,
        "mps_available": False,
    }

    try:
        import torch
        cuda = torch.cuda.is_available()
        device_info["torch_version"] = torch.__version__
        device_info["cuda_available"] = cuda

        if cuda:
            device_name = torch.cuda.get_device_name(0)
            vram_mb = torch.cuda.get_device_properties(0).total_memory // (1024**2)
            device_info["device"] = "cuda"
            device_info["gpu_name"] = device_name
            device_info["vram_mb"] = vram_mb
            print(f"  {GREEN}✓ CUDA GPU detected: {device_name} ({vram_mb}MB VRAM){RESET}")
            print(f"  {GREEN}✓ GPU acceleration ENABLED — expect 30+ FPS{RESET}")

            # Suggest CUDA torch if not already CUDA build
            if "+cu" not in torch.__version__ and "cu" not in torch.__version__:
                print(f"\n  {YELLOW}⚠ PyTorch may be CPU-only build.{RESET}")
                print(f"  {YELLOW}  For full CUDA: pip install torch torchvision "
                      f"--index-url https://download.pytorch.org/whl/cu121{RESET}")
        else:
            if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                device_info["device"] = "mps"
                device_info["mps_available"] = True
                print(f"  {GREEN}✓ Apple MPS detected — hardware acceleration enabled{RESET}")
            else:
                device_info["device"] = "cpu"
                print(f"  {YELLOW}⚠ No GPU detected — CPU inference mode{RESET}")
                print(f"  {YELLOW}  Performance: ~10-15 FPS with YOLO11n (acceptable for laptop){RESET}")

    except ImportError:
        print(f"  {RED}✗ PyTorch not yet installed (will be installed in pip step){RESET}")
        device_info["device"] = "cpu"

    import psutil
    ram = psutil.virtual_memory()
    ram_gb = ram.total / (1024**3)
    ram_avail_gb = ram.available / (1024**3)
    device_info["ram_total_gb"] = round(ram_gb, 1)
    device_info["ram_avail_gb"] = round(ram_avail_gb, 1)
    print(f"\n  {CYAN}RAM: {ram_gb:.1f}GB total, {ram_avail_gb:.1f}GB available{RESET}")

    # Warn if RAM is very low
    if ram_gb < 6:
        print(f"  {YELLOW}⚠ Low RAM ({ram_gb:.1f}GB). Recommend 8GB+ for stable inference.{RESET}")

    # Update config.yaml with detected device
    config_path = ROOT / "config.yaml"
    if config_path.exists():
        try:
            import yaml
            with open(config_path) as f:
                cfg = yaml.safe_load(f)
            cfg["inference"]["device"] = device_info["device"]
            with open(config_path, "w") as f:
                yaml.dump(cfg, f, default_flow_style=False)
            print(f"\n  {GREEN}✓ config.yaml updated: device = {device_info['device']}{RESET}")
        except Exception as e:
            log.warning(f"Could not update config.yaml: {e}")

    # Save device info
    device_path = ROOT / "models" / "logs" / "device_info.json"
    device_path.parent.mkdir(parents=True, exist_ok=True)
    with open(device_path, "w") as f:
        json.dump(device_info, f, indent=2)

    return device_info


# ─────────────────────────────────────────────────────────────
# STEP 4 — Download Models
# ─────────────────────────────────────────────────────────────
def download_models():
    step("Downloading Pretrained Model Weights")
    try:
        # Import from our downloader
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "download_models", ROOT / "download_models.py"
        )
        mod = importlib.util.load_from_spec(spec)
        spec.loader.exec_module(mod)
        results = mod.download_all_models(skip_existing=True)
        return results
    except Exception as e:
        log.error(f"{RED}Model download error: {e}{RESET}")
        # Fall back to direct subprocess call
        result = subprocess.run(
            [sys.executable, str(ROOT / "download_models.py")],
            check=False
        )
        return {"status": "completed" if result.returncode == 0 else "partial"}


# ─────────────────────────────────────────────────────────────
# STEP 5 — Verify ESP32-CAM Stream
# ─────────────────────────────────────────────────────────────
def verify_camera_stream():
    step("Verifying ESP32-CAM Stream Connectivity")

    try:
        import yaml
        with open(ROOT / "config.yaml") as f:
            cfg = yaml.safe_load(f)
        esp_ip = cfg.get("camera", {}).get("esp32_ip", "192.168.1.100")
        stream_url = cfg.get("camera", {}).get("stream_url", "").replace("{ip}", esp_ip)
    except Exception:
        esp_ip = "192.168.1.100"
        stream_url = f"http://{esp_ip}:81/stream"

    print(f"  Configured ESP32-CAM IP: {esp_ip}")
    print(f"  Stream URL: {stream_url}")

    if esp_ip == "192.168.1.100":
        print(f"\n  {YELLOW}⚠ Default IP detected. Update esp32_ip in config.yaml.{RESET}")
        print(f"  {CYAN}ℹ Camera stream can also be set manually from the dashboard UI.{RESET}")
        return False

    # Try HTTP connectivity to ESP32
    try:
        import requests
        r = requests.get(f"http://{esp_ip}/", timeout=5)
        print(f"  {GREEN}✓ ESP32-CAM reachable at {esp_ip} (HTTP {r.status_code}){RESET}")
    except Exception as e:
        print(f"  {YELLOW}⚠ ESP32-CAM unreachable: {e}{RESET}")
        print(f"  {CYAN}ℹ This is expected when rover is offline. Stream will connect at runtime.{RESET}")
        return False

    # Try opening stream with OpenCV
    try:
        import cv2
        cap = cv2.VideoCapture(stream_url)
        connected = cap.isOpened()
        cap.release()
        if connected:
            print(f"  {GREEN}✓ MJPEG stream ONLINE: {stream_url}{RESET}")
        else:
            print(f"  {YELLOW}⚠ Stream not accessible (rover may be powered off){RESET}")
        return connected
    except Exception as e:
        print(f"  {YELLOW}⚠ Stream test failed: {e}{RESET}")
        return False


# ─────────────────────────────────────────────────────────────
# STEP 6 — Run Inference Test
# ─────────────────────────────────────────────────────────────
def run_inference_test(device_info: dict):
    step("Running Inference Smoke Test")

    model_path = ROOT / "models" / "weights" / "person" / "yolo11n.pt"
    if not model_path.exists():
        print(f"  {YELLOW}⚠ Model not found. Skipping inference test.{RESET}")
        print(f"  {CYAN}ℹ Test will pass once download_models.py completes.{RESET}")
        return {}

    try:
        import numpy as np
        from ultralytics import YOLO
        import psutil

        device = device_info.get("device", "cpu")
        print(f"  Loading YOLO11n on device: {BOLD}{device}{RESET}")

        t0 = time.perf_counter()
        model = YOLO(str(model_path))
        load_time = (time.perf_counter() - t0) * 1000

        print(f"  {GREEN}✓ Model loaded in {load_time:.0f}ms{RESET}")

        # Warmup
        dummy = np.zeros((640, 640, 3), dtype=np.uint8)
        for _ in range(3):
            model.predict(dummy, verbose=False, imgsz=640, device=device)
        print(f"  {CYAN}Warmup complete. Benchmarking 10 frames...{RESET}")

        # Benchmark
        times = []
        for i in range(10):
            t0 = time.perf_counter()
            model.predict(dummy, verbose=False, imgsz=640, device=device)
            times.append((time.perf_counter() - t0) * 1000)

        avg_ms = sum(times) / len(times)
        min_ms = min(times)
        max_ms = max(times)
        avg_fps = 1000 / avg_ms

        mem_mb = psutil.Process().memory_info().rss / (1024 * 1024)

        bench = {
            "model": "yolo11n.pt",
            "device": device,
            "avg_latency_ms": round(avg_ms, 1),
            "min_latency_ms": round(min_ms, 1),
            "max_latency_ms": round(max_ms, 1),
            "avg_fps": round(avg_fps, 1),
            "memory_mb": round(mem_mb, 1),
            "load_time_ms": round(load_time, 1),
        }

        print(f"\n  {BOLD}Benchmark Results:{RESET}")
        print(f"    Device:    {device.upper()}")
        print(f"    Avg FPS:   {avg_fps:.1f}")
        print(f"    Avg Latency: {avg_ms:.1f}ms  (min: {min_ms:.1f}ms  max: {max_ms:.1f}ms)")
        print(f"    Memory:    {mem_mb:.0f}MB RSS")

        if avg_fps >= 10:
            print(f"\n  {GREEN}✓ INFERENCE READY: {avg_fps:.1f} FPS — real-time capable!{RESET}")
        elif avg_fps >= 3:
            print(f"\n  {YELLOW}⚠ SLOW INFERENCE: {avg_fps:.1f} FPS — usable but not ideal{RESET}")
        else:
            print(f"\n  {RED}✗ TOO SLOW: {avg_fps:.1f} FPS — consider GPU or reducing imgsz{RESET}")

        # Save benchmark
        bench_path = ROOT / "models" / "logs" / "benchmark_results.json"
        with open(bench_path, "w") as f:
            json.dump(bench, f, indent=2)
        print(f"\n  {GREEN}✓ Benchmark saved: {bench_path}{RESET}")
        return bench

    except Exception as e:
        print(f"  {RED}✗ Inference test failed: {e}{RESET}")
        return {"error": str(e)}


# ─────────────────────────────────────────────────────────────
# STEP 7 — Full Environment Diagnostics
# ─────────────────────────────────────────────────────────────
def run_full_diagnostics():
    step("Running Full Environment Diagnostics")
    result = subprocess.run(
        [sys.executable, str(ROOT / "verify_environment.py")],
        check=False
    )
    return result.returncode == 0


# ─────────────────────────────────────────────────────────────
# STEP 8 — Generate Model Loader Module
# ─────────────────────────────────────────────────────────────
def generate_model_loader():
    step("Generating Automatic Model Loader Module")

    loader_path = ROOT / "backend" / "detection" / "model_loader.py"
    loader_path.parent.mkdir(parents=True, exist_ok=True)

    loader_code = '''"""
model_loader.py — RescueBOT Automatic Model Loader
Auto-generated by init_project.py. Do not edit manually.
"""
import pathlib
import logging
import yaml
import json

ROOT = pathlib.Path(__file__).parent.parent.parent
log = logging.getLogger(__name__)

_models = {}
_config = None

def get_config():
    global _config
    if _config is None:
        cfg_path = ROOT / "config.yaml"
        with open(cfg_path) as f:
            _config = yaml.safe_load(f)
    return _config

def load_yolo(model_key: str):
    """Load (or return cached) a YOLO model by config key."""
    if model_key in _models:
        return _models[model_key]
    cfg = get_config()
    model_cfg = cfg["models"].get(model_key, {})
    path = ROOT / model_cfg.get("path", "")
    if not path.exists():
        log.warning(f"Model {model_key} not found at {path}. Fallback active.")
        return None
    try:
        from ultralytics import YOLO
        device = cfg["inference"].get("device", "cpu")
        model = YOLO(str(path))
        _models[model_key] = model
        log.info(f"Loaded {model_key} from {path.name}")
        return model
    except Exception as e:
        log.error(f"Failed to load {model_key}: {e}")
        return None

def load_mediapipe_hands():
    """Load MediaPipe Hands solution."""
    if "mp_hands" in _models:
        return _models["mp_hands"]
    try:
        import mediapipe as mp
        hands = mp.solutions.hands.Hands(
            static_image_mode=False,
            max_num_hands=2,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        _models["mp_hands"] = hands
        return hands
    except Exception as e:
        log.error(f"MediaPipe Hands load failed: {e}")
        return None

def load_mediapipe_pose():
    """Load MediaPipe Pose solution."""
    if "mp_pose" in _models:
        return _models["mp_pose"]
    try:
        import mediapipe as mp
        pose = mp.solutions.pose.Pose(
            static_image_mode=False,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        _models["mp_pose"] = pose
        return pose
    except Exception as e:
        log.error(f"MediaPipe Pose load failed: {e}")
        return None

def load_all():
    """Pre-load all models. Call at server startup."""
    log.info("Pre-loading all AI models...")
    load_yolo("person")
    load_yolo("pose")
    load_yolo("fire")
    load_yolo("smoke")
    load_mediapipe_hands()
    load_mediapipe_pose()
    log.info(f"Models loaded: {list(_models.keys())}")
    return _models

def get_registry():
    """Return the model registry from JSON."""
    reg_path = ROOT / "models" / "model_registry.json"
    if reg_path.exists():
        with open(reg_path) as f:
            return json.load(f)
    return {}

def diagnostics():
    """Quick diagnostics: return loaded model states."""
    return {k: type(v).__name__ for k, v in _models.items()}
'''
    with open(loader_path, "w") as f:
        f.write(loader_code)
    print(f"  {GREEN}✓ Model loader generated: {loader_path}{RESET}")


# -------------------------------------------------------------
# Final Boot Summary
# -------------------------------------------------------------
def print_final_summary(device_info: dict, bench: dict, all_ok: bool):
    print(f"\n{BOLD}{'='*60}{RESET}")
    print(f"{BOLD}{'='*60}{RESET}")
    print(f"""
  {BOLD}{CYAN}   ██████╗ ███████╗███████╗ ██████╗██╗   ██╗███████╗{RESET}
  {BOLD}{CYAN}   ██╔══██╗██╔════╝██╔════╝██╔════╝██║   ██║██╔════╝{RESET}
  {BOLD}{CYAN}   ██████╔╝█████╗  ███████╗██║     ██║   ██║█████╗  {RESET}
  {BOLD}{CYAN}   ██╔══██╗██╔══╝  ╚════██║██║     ██║   ██║██╔══╝  {RESET}
  {BOLD}{CYAN}   ██║  ██║███████╗███████║╚██████╗╚██████╔╝███████╗{RESET}
  {BOLD}{CYAN}   ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═════╝ ╚══════╝{RESET}
  {BOLD}  RescueBOT AI Inference Server — Initialization Complete{RESET}
""")
    device = device_info.get("device", "cpu").upper()
    fps = bench.get("avg_fps", "--")
    mem = bench.get("memory_mb", "--")

    print(f"  {'-'*55}")
    print(f"  Device:         {BOLD}{device}{RESET}")
    print(f"  Inference FPS:  {BOLD}{fps}{RESET} FPS (YOLO11n)")
    print(f"  Memory Usage:   {BOLD}{mem}{RESET} MB")
    print(f"  {'-'*55}")

    if all_ok:
        print(f"\n  {BOLD}{GREEN}✓ SYSTEM READY FOR DEPLOYMENT{RESET}\n")
        print(f"  To start the AI inference server:")
        print(f"    {BOLD}python inference_server.py{RESET}\n")
        print(f"  To re-verify environment:")
        print(f"    {BOLD}python verify_environment.py{RESET}\n")
        print(f"  To re-download models:")
        print(f"    {BOLD}python download_models.py --force{RESET}\n")
    else:
        print(f"\n  {BOLD}{YELLOW}⚠ PARTIAL SETUP — Check errors above{RESET}\n")
        print(f"  Common fixes:")
        print(f"    pip install -r requirements.txt")
        print(f"    python download_models.py")
        print(f"    python verify_environment.py\n")

    print(f"  Config:    ai_server/config.yaml")
    print(f"  Logs:      ai_server/models/logs/")
    print(f"  Weights:   ai_server/models/weights/")
    print(f"  Benchmark: ai_server/models/logs/benchmark_results.json")
    print(f"\n{BOLD}{'='*60}{RESET}")
    print(f"{BOLD}{'='*60}{RESET}\n")


# -------------------------------------------------------------
# Main Entry Point
# -------------------------------------------------------------
def main():
    start_time = time.time()

    print(f"\n{BOLD}{CYAN}{'='*60}{RESET}")
    print(f"{BOLD}{CYAN}  RescueBOT AI -- Project Initialization{RESET}")
    print(f"{BOLD}{CYAN}  {time.strftime('%Y-%m-%d %H:%M:%S')}{RESET}")
    print(f"{BOLD}{CYAN}{'='*60}{RESET}")

    # ── Execute all steps ──────────────────────────────────────
    create_directories()
    install_dependencies()
    device_info = detect_hardware()
    download_models()
    verify_camera_stream()
    bench = run_inference_test(device_info)
    generate_model_loader()
    diag_ok = run_full_diagnostics()

    elapsed = time.time() - start_time
    print(f"\n  {CYAN}Initialization completed in {elapsed:.1f}s{RESET}")

    all_ok = bench.get("avg_fps", 0) > 0 or diag_ok
    print_final_summary(device_info, bench, all_ok)

    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
