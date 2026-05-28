import sys
import os

def check_dependencies():
    print("==================================================")
    print(" RescueBOT Dependency & Model Verification Tool")
    print("==================================================")
    
    dependencies = {
        "cv2 (OpenCV)": "cv2",
        "numpy": "numpy",
        "paho.mqtt": "paho.mqtt",
        "ultralytics (YOLO)": "ultralytics",
        "mediapipe": "mediapipe",
        "torch (PyTorch)": "torch",
        "torchvision": "torchvision"
    }
    
    all_ok = True
    installed_versions = {}
    
    for name, module_name in dependencies.items():
        try:
            mod = __import__(module_name)
            version = getattr(mod, "__version__", "Installed (unknown version)")
            print(f" [OK] {name}: {version}")
            installed_versions[module_name] = True
        except ImportError as e:
            print(f" [FAIL] {name}: NOT INSTALLED ({e})")
            installed_versions[module_name] = False
            all_ok = False
            
    print("\n==================================================")
    print(" Model Files Verification")
    print("==================================================")
    
    model_files = [
        "yolov8n.pt",
        "yolov8n-pose.pt",
        "yolov8n-fire.pt",
        "yolov8n-smoke.pt",
        "yolov8n-hazards.pt"
    ]
    
    # Check current directory and user config
    for model_file in model_files:
        exists_local = os.path.exists(model_file)
        exists_ai_server = os.path.exists(os.path.join("ai_server", model_file))
        
        # Check standard YOLO cache path
        home_dir = os.path.expanduser("~")
        yolo_cache = os.path.join(home_dir, ".config", "Ultralytics", model_file)
        exists_cache = os.path.exists(yolo_cache)
        
        if exists_local:
            print(f" [OK] {model_file}: Found in root directory")
        elif exists_ai_server:
            print(f" [OK] {model_file}: Found in ai_server directory")
        elif exists_cache:
            print(f" [OK] {model_file}: Found in Ultralytics cache directory")
        else:
            print(f" [?] {model_file}: Not found locally (YOLO will auto-download on first run if online)")
            
    print("\n==================================================")
    print(" Model Loading Test")
    print("==================================================")
    
    if installed_versions.get("ultralytics"):
        from ultralytics import YOLO
        for model_file in ["yolov8n.pt", "yolov8n-pose.pt"]:
            try:
                print(f" Attempting to load {model_file}...")
                model = YOLO(model_file)
                print(f"  [OK] Loaded {model_file} successfully!")
            except Exception as e:
                print(f"  [FAIL] Failed to load {model_file}: {e}")
    else:
        print(" [!] Skipping YOLO load tests (ultralytics not installed)")
        
    if installed_versions.get("torch") and installed_versions.get("torchvision"):
        try:
            print(" Attempting to load MobileNetV3 small scene classifier...")
            from torchvision.models import mobilenet_v3_small
            model = mobilenet_v3_small(pretrained=True)
            print("  [OK] Loaded MobileNetV3 successfully!")
        except Exception as e:
            print(f"  [FAIL] Failed to load MobileNetV3: {e}")
    else:
        print(" [!] Skipping PyTorch load tests (torch/torchvision not installed)")

if __name__ == "__main__":
    check_dependencies()
