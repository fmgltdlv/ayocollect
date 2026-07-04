#!/bin/sh
set -e

report_job_exit() {
  code=$1
  if [ -n "$SCRAPE_JOB_ID" ]; then
    python cli.py job-exit --code "$code" || true
  fi
  exit "$code"
}

trap 'report_job_exit $?' EXIT

if [ "$SCRAPE_MODE" = "yesterday" ]; then
  python cli.py yesterday
elif [ -n "$SCRAPE_START" ]; then
  python cli.py scrape --start "$SCRAPE_START" --end "${SCRAPE_END:-$SCRAPE_START}"
else
  exec python server.py
fi
