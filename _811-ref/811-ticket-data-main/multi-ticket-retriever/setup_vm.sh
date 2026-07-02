#!/bin/bash
# Setup script for GCP VM instance

set -e

echo "🚀 Setting up ticket scraper on GCP VM..."

# Update system packages
echo "📦 Updating system packages..."
sudo apt-get update
sudo apt-get install -y python3 python3-pip python3-venv python3-tk

# Create directory for the application
echo "📁 Creating application directory..."
mkdir -p ~/multi-ticket-retriever
cd ~/multi-ticket-retriever

# Create virtual environment
echo "🐍 Creating Python virtual environment..."
python3 -m venv venv

# Activate virtual environment and install dependencies
echo "📥 Installing Python dependencies..."
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate

# Create activation script for convenience
cat > activate_env.sh << 'EOF'
#!/bin/bash
source ~/multi-ticket-retriever/venv/bin/activate
EOF
chmod +x activate_env.sh

# Create wrapper script to run with venv
cat > run_scraper.sh << 'EOF'
#!/bin/bash
cd "$(dirname "$0")"
source venv/bin/activate
python "USAN work type.py" "$@"
EOF
chmod +x run_scraper.sh

# Create background runner script if run_background.sh exists in current dir
if [ -f "run_background.sh" ]; then
    cp run_background.sh ~/multi-ticket-retriever/
    chmod +x ~/multi-ticket-retriever/run_background.sh
fi

echo "✅ Setup complete!"
echo ""
echo "To run the scraper, use one of these methods:"
echo ""
echo "Method 1: Use the wrapper script (foreground)"
echo "  cd ~/multi-ticket-retriever"
echo "  ./run_scraper.sh --date 2025-01-01"
echo ""
echo "Method 2: Run in background (survives SSH disconnect)"
echo "  cd ~/multi-ticket-retriever"
echo "  nohup ./run_scraper.sh --date 2025-01-01 > scraper.log 2>&1 &"
echo "  # Or use: ./run_background.sh --date 2025-01-01 (if available)"
echo ""
echo "Method 3: Activate venv manually"
echo "  cd ~/multi-ticket-retriever"
echo "  source venv/bin/activate"
echo "  python 'USAN work type.py' --date 2025-01-01"
echo "  deactivate"
echo ""
echo "Method 4: Direct venv Python"
echo "  cd ~/multi-ticket-retriever"
echo "  venv/bin/python 'USAN work type.py' --date 2025-01-01"

