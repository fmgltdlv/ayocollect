"""CLI: python cli.py scrape --start 2026-05-01 --end 2026-05-31"""

from __future__ import annotations

import argparse
import logging
import sys

from .config import load_settings
from .ingest_client import check_ingest_health, report_container_exit
from .scanner import run_scan, yesterday_iso


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    parser = argparse.ArgumentParser(description="ayocollect dedicated 811 scraper")
    sub = parser.add_subparsers(dest="command", required=True)

    p_health = sub.add_parser("health", help="Check Worker ingest endpoint")
    p_health.add_argument("--worker-url", help="Override WORKER_URL")

    p_scrape = sub.add_parser("scrape", help="Scan date range and POST batches to Worker")
    p_scrape.add_argument("--start", required=True, help="Start date YYYY-MM-DD")
    p_scrape.add_argument("--end", help="End date YYYY-MM-DD (default: same as start)")
    p_scrape.add_argument(
        "--systems",
        help="Comma-separated: digalert,usan-ca,usan-nv (default from .env)",
    )
    p_scrape.add_argument("--worker-url", help="Override WORKER_URL")

    p_yday = sub.add_parser("yesterday", help="Scrape yesterday for all configured systems")
    p_yday.add_argument(
        "--systems",
        help="Comma-separated: digalert,usan-ca,usan-nv",
    )

    p_exit = sub.add_parser("job-exit", help="Report container process exit to the API job record")
    p_exit.add_argument("--code", type=int, default=0, help="Process exit code")

    args = parser.parse_args()

    try:
        settings = load_settings()
    except RuntimeError as e:
        print(f"Config error: {e}", file=sys.stderr)
        return 1

    if getattr(args, "worker_url", None):
        settings.worker_url = args.worker_url.rstrip("/")

    if args.command == "health":
        try:
            info = check_ingest_health(settings.worker_url, settings.ingest_secret)
            print(info)
            return 0
        except Exception as e:
            print(f"Health check failed: {e}", file=sys.stderr)
            return 1

    if args.command == "yesterday":
        day = yesterday_iso()
        systems = None
        if args.systems:
            systems = [s.strip() for s in args.systems.split(",") if s.strip()]
        run_scan(settings, day, day, systems)
        return 0

    if args.command == "job-exit":
        if settings.scrape_job_id is None:
            return 0
        try:
            report_container_exit(
                settings.worker_url,
                settings.ingest_secret,
                settings.scrape_job_id,
                args.code,
            )
            return 0
        except Exception as e:
            print(f"Job exit report failed: {e}", file=sys.stderr)
            return 1

    if args.command == "scrape":
        end = args.end or args.start
        systems = None
        if args.systems:
            systems = [s.strip() for s in args.systems.split(",") if s.strip()]
        run_scan(settings, args.start, end, systems)
        return 0

    return 1
