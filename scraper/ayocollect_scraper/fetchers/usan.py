from __future__ import annotations

from typing import Any

import requests

from ..polygon import scrape_usan_polygon_wkt

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
TIMEOUT = 15

URLS = {
    "ca": {
        "posr": "https://appsca.undergroundservicealert.org/posr/searchtool/PositiveResponse/GetJobsListForTable?format=json&ticketNumber={ticket}",
        "map": "https://onecallca.undergroundservicealert.org/ngen.web/map/index?RequestNumber={base}-000",
    },
    "nv": {
        "posr": "https://appsnv.undergroundservicealert.org/posr/searchtool/PositiveResponse/GetJobsListForTable?format=json&ticketNumber={ticket}",
        "map": "https://onecallnv.undergroundservicealert.org/ngen.web/map/index?RequestNumber={base}-000",
    },
}


def normalize_base(ticket: str) -> str:
    return ticket.split("-")[0]


def fetch_usan_posr(system: str, ticket: str) -> dict[str, Any] | None:
    system = system.lower()
    if system not in URLS:
        raise ValueError(f"system must be ca or nv, got {system}")
    urls = URLS[system]
    candidates = list(dict.fromkeys([ticket, normalize_base(ticket)]))
    for t in candidates:
        url = urls["posr"].format(ticket=t)
        try:
            resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, dict) and data.get("posrTicket"):
                return data
        except (requests.RequestException, ValueError):
            continue
    return None


def fetch_usan_polygon_wkt(system: str, ticket: str) -> str | None:
    system = system.lower()
    base = normalize_base(ticket)
    url = URLS[system]["map"].format(base=base)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        if not resp.ok:
            return None
        return scrape_usan_polygon_wkt(resp.text)
    except requests.RequestException:
        return None


def ticket_exists_usan(system: str, ticket: str) -> bool:
    return fetch_usan_posr(system, ticket) is not None
