from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from .config import Settings
from .fetchers.digalert import fetch_digalert_raw
from .fetchers.usan import fetch_usan_polygon_wkt, fetch_usan_posr
from .ingest_client import post_batch
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


class BatchBuffer:
    def __init__(
        self,
        settings: Settings,
        system: str,
        start_date: str,
        log: LogFn,
    ):
        self.settings = settings
        self.system = system
        self.start_date = start_date
        self.log = log
        self.items: list[Any] = []
        self.batch_num = 0
        self.stats = ScanStats(system=system)

    def add(self, item: Any) -> None:
        self.items.append(item)
        self.stats.fetched += 1
        if len(self.items) >= self.settings.ingest_batch_size:
            self.flush()

    def flush(self) -> None:
        if not self.items:
            return
        self.batch_num += 1
        batch_id = f"{self.start_date}-{self.system}-{self.batch_num}"
        try:
            result = post_batch(
                self.settings.worker_url,
                self.settings.ingest_secret,
                self.system,
                batch_id,
                self.items,
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
) -> ScanStats:
    emit = log or logger.info
    buf = BatchBuffer(settings, system_key, start_date, emit)
    current = start_date

    while compare_dates(current, end_date) <= 0:
        seq = 1
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
) -> ScanStats:
    emit = log or logger.info
    if not settings.digalert_cookies:
        emit("WARNING: DIGALERT_SESSION_COOKIES empty — DigAlert may return no tickets")

    buf = BatchBuffer(settings, "digalert", start_date, emit)
    current = start_date

    while compare_dates(current, end_date) <= 0:
        counter = 1
        misses = 0
        day_checked = 0

        while misses < settings.consecutive_miss_limit:
            if day_checked >= settings.max_tickets_per_day:
                break

            ticket = format_digalert_ticket(current, counter)
            buf.stats.checked += 1
            day_checked += 1

            envelope = fetch_digalert_raw(ticket, "00A", settings.digalert_cookies)
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


def run_scan(
    settings: Settings,
    start_date: str,
    end_date: str,
    systems: list[str] | None = None,
    log: LogFn | None = None,
) -> ScanResult:
    emit = log or logger.info
    selected = systems or settings.systems
    result = ScanResult(start_date=start_date, end_date=end_date)

    emit(f"Scan {start_date} → {end_date} systems={','.join(selected)}")
    emit(f"Worker: {settings.worker_url}")

    if "digalert" in selected:
        result.systems["digalert"] = scan_digalert(settings, start_date, end_date, emit)

    if "usan-ca" in selected:
        result.systems["usan-ca"] = scan_usan_system(
            settings, "usan-ca", "ca", start_date, end_date, emit
        )

    if "usan-nv" in selected:
        result.systems["usan-nv"] = scan_usan_system(
            settings, "usan-nv", "nv", start_date, end_date, emit
        )

    for sys, stats in result.systems.items():
        emit(
            f"Done {sys}: checked={stats.checked} fetched={stats.fetched} "
            f"batches={stats.batches_sent} ingest_errors={stats.ingest_errors}"
        )

    return result


def yesterday_iso() -> str:
    now = datetime.now(timezone.utc).date()
    from datetime import timedelta

    return (now - timedelta(days=1)).isoformat()
