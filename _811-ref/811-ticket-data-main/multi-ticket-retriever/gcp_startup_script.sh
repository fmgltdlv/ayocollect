#!/bin/bash
# GCP Startup Script - Runs automatically when VM starts
# Add this as a startup script in the VM instance metadata

set -e

echo "🚀 GCP Startup Script - Ticket Scraper Setup"

# Update system
apt-get update
apt-get install -y python3 python3-pip python3-venv

# Create application directory
mkdir -p /opt/multi-ticket-retriever
chmod 755 /opt/multi-ticket-retriever

# Note: Application files should be uploaded separately
# or cloned from a repository
# Then create venv and install dependencies:
# cd /opt/multi-ticket-retriever
# python3 -m venv venv
# source venv/bin/activate
# pip install -r requirements.txt
# deactivate

echo "✅ Startup script complete"

# Uncomment to run scraper automatically on startup:
# cd /opt/multi-ticket-retriever
# source venv/bin/activate
# nohup python "USAN work type.py" --date $(date +%Y-%m-%d) > /var/log/multi-ticket-retriever.log 2>&1 &
# deactivate

