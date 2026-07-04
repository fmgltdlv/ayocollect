from __future__ import annotations

import re
from typing import Iterable


def parse_qm_format(qm: str) -> list[tuple[float, float]] | None:
    if not qm or not qm.strip():
        return None
    main = qm.split(":")[0].strip()
    values = main.split(",")
    if len(values) % 2 != 0:
        return None
    coords: list[tuple[float, float]] = []
    for i in range(0, len(values), 2):
        lon = float(values[i].strip())
        lat = float(values[i + 1].strip())
        coords.append((lon, lat))
    if coords and coords[0] != coords[-1]:
        coords.append(coords[0])
    return coords or None


def coords_to_wkt(coords: Iterable[tuple[float, float]]) -> str:
    ring = ", ".join(f"{lon} {lat}" for lon, lat in coords)
    return f"POLYGON(({ring}))"


def scrape_usan_polygon_wkt(html: str) -> str | None:
    pattern = r"var spatialObjectDescription = 'POLYGON\((.*?)\)';"
    match = re.search(pattern, html)
    if not match:
        return None
    inner = match.group(1).strip()
    coords: list[tuple[float, float]] = []
    for coord in inner.replace("(", "").replace(")", "").split(","):
        parts = coord.strip().split()
        if len(parts) >= 2:
            x, y = float(parts[0]), float(parts[1])
            coords.append((x, y))
    if not coords:
        return None
    if coords[0] != coords[-1]:
        coords.append(coords[0])
    return coords_to_wkt(coords)
