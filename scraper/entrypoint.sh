#!/bin/sh
set -e

if [ "$SCRAPE_MODE" = "yesterday" ]; then
  exec python cli.py yesterday
elif [ -n "$SCRAPE_START" ]; then
  exec python cli.py scrape --start "$SCRAPE_START" --end "${SCRAPE_END:-$SCRAPE_START}"
else
  exec python server.py
fi
