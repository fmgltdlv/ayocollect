from __future__ import annotations

from datetime import date, datetime, timedelta


def add_days(date_str: str, days: int) -> str:
    d = datetime.strptime(date_str, "%Y-%m-%d").date()
    return (d + timedelta(days=days)).isoformat()


def compare_dates(a: str, b: str) -> int:
    if a < b:
        return -1
    if a > b:
        return 1
    return 0


def format_usan_ticket(day: str, seq: int) -> str:
    ymd = day.replace("-", "")
    return f"{ymd}{seq:05d}-000"


def julian_day(d: date) -> int:
    return int(d.strftime("%j"))


def format_digalert_ticket(day: str, counter: int) -> str:
    d = datetime.strptime(day, "%Y-%m-%d").date()
    yy = str(d.year)[-2:]
    jdd = f"{julian_day(d):03d}"
    xxx = f"{counter:03d}" if counter <= 999 else str(counter)
    return f"A{yy}{jdd}0{xxx}"
