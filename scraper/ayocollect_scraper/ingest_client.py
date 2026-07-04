from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

import requests

INGEST_PATHS = {
    "digalert": "/api/ingest/digalert",
    "usan-ca": "/api/ingest/usan-ca",
    "usan-nv": "/api/ingest/usan-nv",
}


class IngestError(Exception):
    pass


def post_batch(
    worker_url: str,
    ingest_secret: str,
    system: str,
    batch_id: str,
    tickets: list[Any],
    scraped_at: str | None = None,
    job_id: int | None = None,
    retries: int = 3,
) -> dict[str, Any]:
    if system not in INGEST_PATHS:
        raise ValueError(f"Unknown system {system}")

    path = INGEST_PATHS[system]
    url = f"{worker_url.rstrip('/')}{path}"
    body = {
        "batchId": batch_id,
        "scrapedAt": scraped_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "tickets": tickets,
    }
    if job_id is not None:
        body["jobId"] = job_id
    headers = {
        "Authorization": f"Bearer {ingest_secret}",
        "Content-Type": "application/json",
    }

    last_err: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            resp = requests.post(url, json=body, headers=headers, timeout=120)
            data = resp.json() if resp.content else {}
            if not resp.ok:
                raise IngestError(f"HTTP {resp.status_code}: {data}")
            return data
        except (requests.RequestException, IngestError, ValueError) as e:
            last_err = e
            if attempt < retries:
                time.sleep(0.5 * attempt)
    raise IngestError(str(last_err))


def check_ingest_health(worker_url: str, ingest_secret: str) -> dict[str, Any]:
    url = f"{worker_url.rstrip('/')}/api/ingest/health"
    resp = requests.get(
        url,
        headers={"Authorization": f"Bearer {ingest_secret}"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def complete_container_job(
    worker_url: str,
    ingest_secret: str,
    job_id: int,
    systems: dict[str, dict[str, int]] | None = None,
    ok: bool = True,
    last_error: str | None = None,
) -> dict[str, Any]:
    url = f"{worker_url.rstrip('/')}/api/ingest/job-complete"
    body: dict[str, Any] = {
        "jobId": job_id,
        "ok": ok,
        "systems": systems or {},
    }
    if last_error:
        body["lastError"] = last_error
    resp = requests.post(
        url,
        json=body,
        headers={
            "Authorization": f"Bearer {ingest_secret}",
            "Content-Type": "application/json",
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def report_container_exit(
    worker_url: str,
    ingest_secret: str,
    job_id: int,
    exit_code: int,
) -> None:
    if exit_code == 0:
        complete_container_job(worker_url, ingest_secret, job_id, ok=True)
    else:
        complete_container_job(
            worker_url,
            ingest_secret,
            job_id,
            ok=False,
            last_error=f"Scraper container exited with code {exit_code}",
        )
