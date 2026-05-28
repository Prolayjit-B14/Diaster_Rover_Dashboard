"""
train_blood_classifier.py — Custom Blood Detection Training Pipeline
=====================================================================
Since no reliable public blood detection model exists for real-time
laptop inference, this script provides a complete training pipeline.

Dataset recommendations:
  1. BioMedical Image Segmentation datasets (indoor surgical, not suitable)
  2. Custom collection from disaster/trauma stock imagery (recommended)
  3. Augmented red-region synthetic data (fastest bootstrap)

Usage:
  python backend/training/train_blood_classifier.py --data ./datasets/blood/ --epochs 50

Output: models/weights/blood/blood_classifier.pt
"""

import pathlib
import argparse
import logging
import sys

ROOT = pathlib.Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT))

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")


def create_dataset_structure():
    """Create the expected dataset folder structure."""
    base = ROOT / "models" / "datasets" / "blood"
    for split in ["train", "val", "test"]:
        for cls in ["blood", "no_blood"]:
            (base / split / cls).mkdir(parents=True, exist_ok=True)

    print(f"Dataset structure created at: {base}")
    print("\nAdd images to:")
    print(f"  {base}/train/blood/     ← ~200+ blood images")
    print(f"  {base}/train/no_blood/  ← ~200+ non-blood images")
    print(f"  {base}/val/blood/       ← ~50 blood images (validation)")
    print(f"  {base}/val/no_blood/    ← ~50 non-blood images (validation)")


def train(data_dir: str, epochs: int = 50, batch_size: int = 16):
    """
    Train a lightweight MobileNetV3-small binary classifier for blood detection.
    Suitable for CPU inference: ~2ms/frame after training.
    """
    try:
        import torch
        import torch.nn as nn
        import torchvision
        import torchvision.transforms as transforms
        from torchvision.datasets import ImageFolder
        from torch.utils.data import DataLoader
    except ImportError:
        log.error("Install: pip install torch torchvision")
        return

    data_path = pathlib.Path(data_dir)
    if not data_path.exists():
        log.error(f"Data directory not found: {data_path}")
        create_dataset_structure()
        return

    device = "cuda" if torch.cuda.is_available() else "cpu"
    log.info(f"Training on: {device}")

    # ── Data transforms ───────────────────────────────────────
    transform_train = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.RandomHorizontalFlip(),
        transforms.RandomRotation(15),
        transforms.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.3),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])
    transform_val = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])

    train_ds = ImageFolder(data_path / "train", transform=transform_train)
    val_ds   = ImageFolder(data_path / "val",   transform=transform_val)

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True,  num_workers=2)
    val_loader   = DataLoader(val_ds,   batch_size=batch_size, shuffle=False, num_workers=2)

    log.info(f"Train: {len(train_ds)} images | Val: {len(val_ds)} images")
    log.info(f"Classes: {train_ds.classes}")

    # ── Model: MobileNetV3-small (pretrained ImageNet) ────────
    model = torchvision.models.mobilenet_v3_small(
        weights=torchvision.models.MobileNet_V3_Small_Weights.DEFAULT
    )
    # Replace classifier head for binary classification
    model.classifier[-1] = nn.Linear(model.classifier[-1].in_features, 2)
    model = model.to(device)

    optimizer = torch.optim.Adam(model.parameters(), lr=1e-4, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.StepLR(optimizer, step_size=15, gamma=0.5)
    criterion = nn.CrossEntropyLoss()

    best_val_acc = 0.0
    out_path = ROOT / "models" / "weights" / "blood" / "blood_classifier.pt"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    # ── Training loop ─────────────────────────────────────────
    for epoch in range(1, epochs + 1):
        model.train()
        total_loss = 0
        correct = 0

        for imgs, labels in train_loader:
            imgs, labels = imgs.to(device), labels.to(device)
            optimizer.zero_grad()
            outputs = model(imgs)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
            correct += (outputs.argmax(1) == labels).sum().item()

        train_acc = correct / len(train_ds) * 100
        scheduler.step()

        # Validation
        model.eval()
        val_correct = 0
        with torch.no_grad():
            for imgs, labels in val_loader:
                imgs, labels = imgs.to(device), labels.to(device)
                outputs = model(imgs)
                val_correct += (outputs.argmax(1) == labels).sum().item()
        val_acc = val_correct / len(val_ds) * 100

        log.info(f"Epoch {epoch:3d}/{epochs} | "
                 f"Loss: {total_loss/len(train_loader):.3f} | "
                 f"Train: {train_acc:.1f}% | Val: {val_acc:.1f}%")

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            torch.save(model.state_dict(), out_path)
            log.info(f"  ✓ Saved best model: {out_path} (val_acc={val_acc:.1f}%)")

    log.info(f"\nTraining complete. Best val accuracy: {best_val_acc:.1f}%")
    log.info(f"Model saved: {out_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train blood detection classifier")
    parser.add_argument("--data",   default="models/datasets/blood", help="Dataset directory")
    parser.add_argument("--epochs", type=int, default=50, help="Training epochs")
    parser.add_argument("--batch",  type=int, default=16, help="Batch size")
    parser.add_argument("--create-structure", action="store_true",
                        help="Only create dataset folder structure")
    args = parser.parse_args()

    if args.create_structure:
        create_dataset_structure()
    else:
        train(args.data, args.epochs, args.batch)
