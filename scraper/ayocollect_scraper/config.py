from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")


def _bool(val: str | None, default: bool = False) -> bool:
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


@dataclass
class Settings:
    worker_url: str
    ingest_secret: str
    throttle_sec: float
    ingest_batch_size: int
    max_tickets_per_day: int
    consecutive_miss_limit: int
    systems: list[str]
    api_host: str
    api_port: int
    api_key: str | None
    scrape_job_id: int | None = None
    resume_cursors: dict[str, dict[str, int | str]] | None = None


def load_settings() -> Settings:
    worker_url = os.getenv("WORKER_URL", "http://127.0.0.1:8787").rstrip("/")
    ingest_secret = os.getenv("INGEST_SECRET", "").strip()
    if not ingest_secret:
        raise RuntimeError("INGEST_SECRET is required — set it in scraper/.env")

    raw_systems = os.getenv("SYSTEMS", "digalert,usan-ca,usan-nv")
    systems = [s.strip() for s in raw_systems.split(",") if s.strip()]

    job_raw = os.getenv("SCRAPE_JOB_ID", "").strip()
    scrape_job_id = int(job_raw) if job_raw.isdigit() else None

    resume_raw = os.getenv("SCRAPE_RESUME_CURSORS", "").strip()
    resume_cursors = None
    if resume_raw:
        try:
            parsed = json.loads(resume_raw)
            if isinstance(parsed, dict):
                resume_cursors = parsed
        except json.JSONDecodeError:
            resume_cursors = None

    return Settings(
        worker_url=worker_url,
        ingest_secret=ingest_secret,
        throttle_sec=float(os.getenv("THROTTLE_SEC", "0.15")),
        ingest_batch_size=int(os.getenv("INGEST_BATCH_SIZE", "50")),
        max_tickets_per_day=int(os.getenv("MAX_TICKETS_PER_DAY", "3999")),
        consecutive_miss_limit=int(os.getenv("CONSECUTIVE_MISS_LIMIT", "2")),
        systems=systems,
        api_host=os.getenv("SCRAPER_API_HOST", "0.0.0.0"),
        api_port=int(os.getenv("SCRAPER_API_PORT", "8789")),
        api_key=os.getenv("SCRAPER_API_KEY") or None,
        scrape_job_id=scrape_job_id,
        resume_cursors=resume_cursors,
    )
