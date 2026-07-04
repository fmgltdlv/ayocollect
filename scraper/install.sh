#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${1:-$(cd "$(dirname "$0")" && pwd)}"
SERVICE_USER="${SERVICE_USER:-$USER}"

echo "Installing ayocollect scraper into: $INSTALL_DIR"

cd "$INSTALL_DIR"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required" >&2
  exit 1
fi

python3 -m venv venv
# shellcheck disable=SC1091
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo ""
  echo "Created .env from .env.example — edit INGEST_SECRET and DIGALERT_SESSION_COOKIES before running."
fi

echo ""
echo "Quick test:"
echo "  cd \"$INSTALL_DIR\""
echo "  source venv/bin/activate"
echo "  python cli.py health"
echo ""
echo "Run a scan:"
echo "  python cli.py scrape --start 2026-05-01 --end 2026-05-31"
echo ""
echo "Optional API server:"
echo "  python server.py"
echo ""

if [[ "${INSTALL_SYSTEMD:-}" == "1" ]] && command -v systemctl >/dev/null 2>&1; then
  echo "Installing systemd units (requires sudo)..."
  sudo sed "s|@INSTALL_DIR@|$INSTALL_DIR|g; s|@USER@|$SERVICE_USER|g" \
    systemd/ayocollect-scraper.service | sudo tee /etc/systemd/system/ayocollect-scraper.service >/dev/null
  sudo sed "s|@INSTALL_DIR@|$INSTALL_DIR|g; s|@USER@|$SERVICE_USER|g" \
    systemd/ayocollect-scraper-daily.service | sudo tee /etc/systemd/system/ayocollect-scraper-daily.service >/dev/null
  sudo cp systemd/ayocollect-scraper-daily.timer /etc/systemd/system/
  sudo systemctl daemon-reload
  sudo systemctl enable ayocollect-scraper.service
  sudo systemctl enable ayocollect-scraper-daily.timer
  echo "Started API: sudo systemctl start ayocollect-scraper"
  echo "Daily scrape timer enabled (06:15 UTC)"
fi

echo "Done."
