#!/usr/bin/env python3
"""Optional control API: uvicorn server:app or python server.py"""

from __future__ import annotations

import logging
import threading
import uuid
from datetime import datetime, timezone
from typing import Any

import uvicorn
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from ayocollect_scraper.config import Settings, load_settings
from ayocollect_scraper.ingest_client import check_ingest_health
from ayocollect_scraper.scanner import run_scan

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("ayocollect_scraper.api")

app = FastAPI(title="ayocollect-scraper", version="1.0.0")

_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}
_current_job_id: str | None = None


class ScrapeRequest(BaseModel):
    start: str = Field(..., description="YYYY-MM-DD")
    end: str | None = Field(None, description="YYYY-MM-DD (default: start)")
    systems: list[str] | None = None


def verify_api_key(
    settings: Settings = Depends(get_settings),
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> None:
    if not settings.api_key:
        return
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    elif x_api_key:
        token = x_api_key.strip()
    if token != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")


def get_settings() -> Settings:
    return load_settings()


@app.get("/health")
def health(settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    worker: dict[str, Any] | None = None
    worker_error: str | None = None
    try:
        worker = check_ingest_health(settings.worker_url, settings.ingest_secret)
    except Exception as e:
        worker_error = str(e)

    with _lock:
        running = _current_job_id is not None

    return {
        "ok": worker is not None and worker_error is None,
        "worker": worker,
        "workerError": worker_error,
        "jobRunning": running,
        "currentJobId": _current_job_id,
    }


@app.get("/status")
def status() -> dict[str, Any]:
    with _lock:
        jobs = list(_jobs.values())
        current = _jobs.get(_current_job_id) if _current_job_id else None
    return {"current": current, "jobs": jobs[-20:]}


@app.post("/scrape")
def start_scrape(
    body: ScrapeRequest,
    settings: Settings = Depends(get_settings),
    _: None = Depends(verify_api_key),
) -> dict[str, Any]:
    global _current_job_id

    end = body.end or body.start
    job_id = str(uuid.uuid4())
    job = {
        "id": job_id,
        "start": body.start,
        "end": end,
        "systems": body.systems or settings.systems,
        "state": "queued",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "finishedAt": None,
        "error": None,
        "result": None,
        "log": [],
    }

    with _lock:
        if _current_job_id is not None:
            raise HTTPException(status_code=409, detail="A scrape job is already running")
        _jobs[job_id] = job
        _current_job_id = job_id

    def run() -> None:
        global _current_job_id

        def log(msg: str) -> None:
            logger.info(msg)
            with _lock:
                job["log"].append(msg)
                if len(job["log"]) > 500:
                    job["log"] = job["log"][-500:]

        try:
            with _lock:
                job["state"] = "running"
            result = run_scan(settings, body.start, end, body.systems, log)
            with _lock:
                job["state"] = "done"
                job["result"] = {
                    sys: {
                        "checked": s.checked,
                        "fetched": s.fetched,
                        "batches_sent": s.batches_sent,
                        "ingest_errors": s.ingest_errors,
                    }
                    for sys, s in result.systems.items()
                }
        except Exception as e:
            logger.exception("Scrape job failed")
            with _lock:
                job["state"] = "failed"
                job["error"] = str(e)
        finally:
            with _lock:
                job["finishedAt"] = datetime.now(timezone.utc).isoformat()
                _current_job_id = None

    threading.Thread(target=run, daemon=True).start()
    return {"jobId": job_id, "state": "queued"}


if __name__ == "__main__":
    cfg = load_settings()
    uvicorn.run(
        "server:app",
        host=cfg.api_host,
        port=cfg.api_port,
        reload=False,
    )
