from __future__ import annotations

import json
import re
from typing import Any

import requests

from ..polygon import parse_qm_format, coords_to_wkt

HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
TIMEOUT = 15

TICKET_URLS = [
    "https://newtinb.digalert.org/direct/getTicket.vjs?ticket={ticket}&revision={revision}",
    "https://newtinb.digalert.org/direct/getTicket.vjs?t={ticket}&r={revision}",
]
EPR_URLS = [
    "https://newtin.digalert.org/direct/getElectronicPositiveResponse.vjs?ticket={ticket}",
    "https://newtinb.digalert.org/direct/getElectronicPositiveResponse.vjs?ticket={ticket}",
]


def _digalert_has_ticket_data(data: dict[str, Any]) -> bool:
    return bool(
        data.get("ticket")
        or data.get("completed")
        or data.get("place")
        or data.get("street")
        or data.get("work_type")
        or data.get("county")
    )


def fetch_digalert_raw(
    ticket: str,
    revision: str = "00A",
    cookies: dict[str, str] | None = None,
) -> dict[str, Any] | None:
    cookies = cookies or {}
    ticket_json: dict[str, Any] | None = None

    for url_tpl in TICKET_URLS:
        url = url_tpl.format(ticket=ticket, revision=revision)
        try:
            resp = requests.get(url, headers=HEADERS, cookies=cookies, timeout=TIMEOUT)
            resp.raise_for_status()
            body = resp.json()
            if isinstance(body, dict) and body.get("err"):
                continue
            ticket_json = body
            break
        except (requests.RequestException, json.JSONDecodeError):
            continue

    if not ticket_json:
        return None

    if ticket_json.get("data") and isinstance(ticket_json["data"], dict):
        envelope: dict[str, Any] = ticket_json
    else:
        envelope = {"data": ticket_json}

    data = envelope["data"]
    if not isinstance(data, dict) or not _digalert_has_ticket_data(data):
        return None

    if not data.get("responses"):
        for url_tpl in EPR_URLS:
            url = url_tpl.format(ticket=ticket)
            try:
                resp = requests.get(url, headers=HEADERS, cookies=cookies, timeout=TIMEOUT)
                resp.raise_for_status()
                epr = resp.json()
                if epr and isinstance(epr, dict) and epr.get("data"):
                    if epr["data"].get("responses"):
                        data["responses"] = epr["data"]["responses"]
                    if epr["data"].get("revisions"):
                        data["revisions"] = epr["data"]["revisions"]
                    if epr.get("status"):
                        envelope["status"] = epr["status"]
                    if epr.get("message"):
                        envelope["message"] = epr["message"]
                    if epr.get("timestamp"):
                        envelope["timestamp"] = epr["timestamp"]
                    break
            except (requests.RequestException, json.JSONDecodeError):
                continue

    data["ticket"] = data.get("ticket") or ticket
    data["revision"] = data.get("revision") or revision

    qm = data.get("work_area_shape")
    if qm and not data.get("polygon_wkt"):
        coords = parse_qm_format(str(qm))
        if coords:
            data["polygon_wkt"] = coords_to_wkt(coords)

    return envelope


def ticket_exists_digalert(ticket: str, cookies: dict[str, str] | None = None) -> bool:
    return fetch_digalert_raw(ticket, "00A", cookies) is not None
