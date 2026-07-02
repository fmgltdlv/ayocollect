#!/bin/bash
# Run scraper in background (survives SSH disconnect)

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Generate log filename with timestamp
LOG_FILE="scraper_$(date +%Y%m%d_%H%M%S).log"

echo "🚀 Starting scraper in background..."
echo "📝 Log file: $LOG_FILE"
echo ""

# Run with nohup
nohup ./run_scraper.sh "$@" > "$LOG_FILE" 2>&1 &

# Get the process ID
PID=$!

echo "✅ Scraper started with PID: $PID"
echo ""
echo "To monitor progress:"
echo "  tail -f $LOG_FILE"
echo ""
echo "To check if it's running:"
echo "  ps aux | grep $PID"
echo "  or"
echo "  ps aux | grep 'USAN work type.py'"
echo ""
echo "To stop the scraper:"
echo "  kill $PID"
echo ""

# Save PID to file for easy reference
echo $PID > scraper.pid
echo "PID saved to scraper.pid"

