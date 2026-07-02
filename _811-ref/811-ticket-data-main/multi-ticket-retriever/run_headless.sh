#!/bin/bash
# Wrapper script to run the scraper in headless mode

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Use virtual environment if it exists, otherwise use system Python
if [ -d "venv" ]; then
    PYTHON_CMD="venv/bin/python"
else
    PYTHON_CMD="python3"
fi

# Check if X display is available, if not use xvfb
if [ -z "$DISPLAY" ]; then
    echo "No display available, using xvfb..."
    # Install xvfb if not already installed
    if ! command -v xvfb-run &> /dev/null; then
        echo "Installing xvfb..."
        sudo apt-get update && sudo apt-get install -y xvfb
    fi
    xvfb-run -a "$PYTHON_CMD" "USAN work type.py" "$@"
else
    "$PYTHON_CMD" "USAN work type.py" "$@"
fi

