#!/bin/bash
# ============================================================
#  install.sh — RescueBOT AI Server Installer (Linux/macOS)
# ============================================================
#  Usage: chmod +x install.sh && ./install.sh

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "\n${BOLD}${CYAN}============================================================${NC}"
echo -e "${BOLD}  RescueBOT AI Server — Linux/macOS Installer${NC}"
echo -e "${BOLD}${CYAN}============================================================${NC}\n"

# ── Check Python ──────────────────────────────────────────────
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}[ERROR] python3 not found.${NC}"
    echo "Install Python 3.9+ via:"
    echo "  Ubuntu/Debian: sudo apt install python3 python3-pip python3-venv"
    echo "  macOS:         brew install python"
    exit 1
fi

PYTHON_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo -e "${GREEN}✓ Python ${PYTHON_VER} detected${NC}"

# ── Optional: Create virtual environment ──────────────────────
if [ ! -d ".venv" ]; then
    echo -e "\n${CYAN}Creating virtual environment (.venv)...${NC}"
    python3 -m venv .venv
    echo -e "${GREEN}✓ Virtual environment created${NC}"
fi

# ── Activate venv ─────────────────────────────────────────────
echo -e "\n${CYAN}Activating virtual environment...${NC}"
source .venv/bin/activate
echo -e "${GREEN}✓ Virtual environment active${NC}"

# ── Upgrade pip ───────────────────────────────────────────────
echo -e "\n${CYAN}Upgrading pip...${NC}"
pip install --upgrade pip --quiet

# ── Install dependencies ──────────────────────────────────────
echo -e "\n${CYAN}Installing Python packages...${NC}"
echo -e "${YELLOW}(This may take 5-10 minutes on first install)${NC}\n"
pip install -r requirements.txt

echo -e "\n${GREEN}✓ All packages installed${NC}"

# ── Check CUDA ────────────────────────────────────────────────
echo -e "\n${CYAN}Checking CUDA/GPU...${NC}"
python3 -c "import torch; cuda=torch.cuda.is_available(); print(f'CUDA available: {cuda}')" 2>/dev/null || true

# ── Run full initialization ───────────────────────────────────
echo -e "\n${CYAN}Running full project initialization...${NC}"
echo -e "${YELLOW}(Downloads models, validates environment, benchmarks)${NC}\n"
python3 init_project.py

echo -e "\n${BOLD}${GREEN}============================================================${NC}"
echo -e "${BOLD}${GREEN}  SETUP COMPLETE${NC}"
echo -e "${BOLD}${GREEN}============================================================${NC}\n"
echo -e "  To activate venv next time:"
echo -e "    ${BOLD}source .venv/bin/activate${NC}\n"
echo -e "  To start inference server:"
echo -e "    ${BOLD}python inference_server.py${NC}\n"
echo -e "  To verify environment:"
echo -e "    ${BOLD}python verify_environment.py${NC}\n"
