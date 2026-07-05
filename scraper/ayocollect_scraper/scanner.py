from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from .config import Settings
from .fetchers.digalert import fetch_digalert_raw
from .fetchers.usan import fetch_usan_polygon_wkt, fetch_usan_posr
from .ingest_client import complete_container_job, post_batch
from .sequence import add_days, compare_dates, format_digalert_ticket, format_usan_ticket

LogFn = Callable[[str], None]

logger = logging.getLogger("ayocollect_scraper")


@dataclass
class ScanStats:
    system: str
    fetched: int = 0
    checked: int = 0
    batches_sent: int = 0
    ingest_errors: int = 0


@dataclass
class ScanResult:
    start_date: str
    end_date: str
    systems: dict[str, ScanStats] = field(default_factory=dict)


ResumeCursor = dict[str, int | str]


class BatchBuffer:
    def __init__(
        self,
        settings: Settings,
        system: str,
        log: LogFn,
    ):
        self.settings = settings
        self.system = system
        self.log = log
        self.items: list[Any] = []
        self.batch_num = 0
        self.stats = ScanStats(system=system)
        self.current_day = ""

    def set_day(self, day: str) -> None:
        self.current_day = day

    def add(self, item: Any) -> None:
        self.items.append(item)
        self.stats.fetched += 1
        if len(self.items) >= self.settings.ingest_batch_size:
            self.flush()

    def flush(self) -> None:
        if not self.items:
            return
        self.batch_num += 1
        batch_id = f"{self.current_day or 'unknown'}-{self.system}-{self.batch_num}"
        try:
            result = post_batch(
                self.settings.worker_url,
                self.settings.ingest_secret,
                self.system,
                batch_id,
                self.items,
                job_id=self.settings.scrape_job_id,
            )
            self.stats.batches_sent += 1
            self.log(
                f"{self.system} batch {batch_id}: accepted={result.get('accepted')} "
                f"failed={result.get('failed')}"
            )
            if result.get("failed"):
                for err in result.get("errors") or []:
                    self.log(f"  ingest error {err.get('ticket')}: {err.get('error')}")
        except Exception as e:
            self.stats.ingest_errors += 1
            self.log(f"{self.system} batch {batch_id} FAILED: {e}")
        finally:
            self.items.clear()


def scan_usan_system(
    settings: Settings,
    system_key: str,
    usan_code: str,
    start_date: str,
    end_date: str,
    log: LogFn | None = None,
    resume: ResumeCursor | None = None,
) -> ScanStats:
    emit = log or logger.info
    buf = BatchBuffer(settings, system_key, emit)
    current = start_date
    resume_pending = resume is not None

    while compare_dates(current, end_date) <= 0:
        if resume_pending and resume:
            current = str(resume.get("date", current))
            seq = int(resume.get("seq", 1))
            resume_pending = False
            if compare_dates(current, end_date) > 0:
                break
        else:
            seq = 1
        buf.set_day(current)
        misses = 0
        day_checked = 0

        while misses < settings.consecutive_miss_limit:
            if day_checked >= settings.max_tickets_per_day:
                break

            ticket = format_usan_ticket(current, seq)
            buf.stats.checked += 1
            day_checked += 1

            payload = fetch_usan_posr(usan_code, ticket)
            if payload:
                misses = 0
                polygon = fetch_usan_polygon_wkt(usan_code, ticket)
                buf.add({"payload": payload, "polygonWkt": polygon})
            else:
                misses += 1

            seq += 1
            time.sleep(settings.throttle_sec)

        emit(
            f"{system_key} {current}: checked {day_checked}, "
            f"fetched {buf.stats.fetched} total so far"
        )
        current = add_days(current, 1)

    buf.flush()
    return buf.stats


def scan_digalert(
    settings: Settings,
    start_date: str,
    end_date: str,
    log: LogFn | None = None,
    resume: ResumeCursor | None = None,
) -> ScanStats:
    emit = log or logger.info

    buf = BatchBuffer(settings, "digalert", emit)
    current = start_date
    resume_pending = resume is not None

    while compare_dates(current, end_date) <= 0:
        if resume_pending and resume:
            current = str(resume.get("date", current))
            counter = int(resume.get("counter", 1))
            resume_pending = False
            if compare_dates(current, end_date) > 0:
                break
        else:
            counter = 1
        buf.set_day(current)
        misses = 0
        day_checked = 0

        while misses < settings.consecutive_miss_limit:
            if day_checked >= settings.max_tickets_per_day:
                break

            ticket = format_digalert_ticket(current, counter)
            buf.stats.checked += 1
            day_checked += 1

            envelope = fetch_digalert_raw(ticket, "00A")
            if envelope:
                misses = 0
                buf.add(envelope)
            else:
                misses += 1

            counter += 1
            time.sleep(settings.throttle_sec)

        emit(
            f"digalert {current}: checked {day_checked}, "
            f"fetched {buf.stats.fetched} total so far"
        )
        current = add_days(current, 1)

    buf.flush()
    return buf.stats


def _thread_safe_log(base: LogFn) -> LogFn:
    lock = threading.Lock()

    def emit(message: str) -> None:
        with lock:
            base(message)

    return emit


def _scan_system_task(
    settings: Settings,
    system_key: str,
    start_date: str,
    end_date: str,
    log: LogFn,
    resume: ResumeCursor | None = None,
) -> tuple[str, ScanStats]:
    if system_key == "digalert":
        stats = scan_digalert(settings, start_date, end_date, log, resume=resume)
    elif system_key == "usan-ca":
        stats = scan_usan_system(settings, "usan-ca", "ca", start_date, end_date, log, resume=resume)
    elif system_key == "usan-nv":
        stats = scan_usan_system(settings, "usan-nv", "nv", start_date, end_date, log, resume=resume)
    else:
        raise ValueError(f"Unknown system {system_key}")
    return system_key, stats


def run_scan(
    settings: Settings,
    start_date: str,
    end_date: str,
    systems: list[str] | None = None,
    log: LogFn | None = None,
    resume_cursors: dict[str, ResumeCursor] | None = None,
) -> ScanResult:
    emit = log or logger.info
    selected = systems or settings.systems
    result = ScanResult(start_date=start_date, end_date=end_date)

    emit(f"Scan {start_date} → {end_date} systems={','.join(selected)} (parallel)")
    if resume_cursors:
        emit(f"Resume cursors: {resume_cursors}")
    emit(f"Worker: {settings.worker_url}")

    parallel_log = _thread_safe_log(emit)
    with ThreadPoolExecutor(max_workers=len(selected)) as pool:
        futures = [
            pool.submit(
                _scan_system_task,
                settings,
                system_key,
                start_date,
                end_date,
                parallel_log,
                (resume_cursors or {}).get(system_key),
            )
            for system_key in selected
        ]
        for future in as_completed(futures):
            system_key, stats = future.result()
            result.systems[system_key] = stats

    for sys in selected:
        stats = result.systems[sys]
        emit(
            f"Done {sys}: checked={stats.checked} fetched={stats.fetched} "
            f"batches={stats.batches_sent} ingest_errors={stats.ingest_errors}"
        )

    if settings.scrape_job_id is not None:
        ingest_errors = sum(s.ingest_errors for s in result.systems.values())
        try:
            complete_container_job(
                settings.worker_url,
                settings.ingest_secret,
                settings.scrape_job_id,
                {
                    sys: {
                        "fetched": stats.fetched,
                        "checked": stats.checked,
                        "ingest_errors": stats.ingest_errors,
                    }
                    for sys, stats in result.systems.items()
                },
                ok=ingest_errors == 0,
                last_error=(
                    f"Scraper finished with {ingest_errors} ingest error(s)"
                    if ingest_errors
                    else None
                ),
            )
            emit(f"Job #{settings.scrape_job_id} marked complete")
        except Exception as e:
            emit(f"Job #{settings.scrape_job_id} completion report FAILED: {e}")

    return result


def yesterday_iso() -> str:
    now = datetime.now(timezone.utc).date()
    from datetime import timedelta

    return (now - timedelta(days=1)).isoformat()
