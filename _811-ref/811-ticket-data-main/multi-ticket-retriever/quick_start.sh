#!/bin/bash
# Quick start script for ticket scraper

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Default values
START_DATE=$(date +%Y-%m-%d)
END_DATE=""
MAX_TICKETS=""
THROTTLE=0.1
SYSTEM="CA"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --start-date)
            START_DATE="$2"
            shift 2
            ;;
        --end-date)
            END_DATE="$2"
            shift 2
            ;;
        --max-tickets)
            MAX_TICKETS="$2"
            shift 2
            ;;
        --throttle)
            THROTTLE="$2"
            shift 2
            ;;
        --system)
            SYSTEM="$2"
            shift 2
            ;;
        --export)
            python3 "USAN work type.py" --export "$2"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD] [--max-tickets N] [--throttle SECONDS] [--system CA|NV]"
            exit 1
            ;;
    esac
done

# Build command
CMD="python3 'USAN work type.py' --date $START_DATE --throttle $THROTTLE --system $SYSTEM"

if [ -n "$END_DATE" ]; then
    CMD="$CMD --end-date $END_DATE"
fi

if [ -n "$MAX_TICKETS" ]; then
    CMD="$CMD --max-tickets $MAX_TICKETS"
fi

# Execute
echo "🚀 Starting ticket scraper..."
echo "Command: $CMD"
echo ""
eval $CMD

