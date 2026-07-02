#!/usr/bin/env python3
import argparse
import json
import sqlite3
from typing import List, Tuple, Optional


def get_cols(conn: sqlite3.Connection, table: str) -> List[str]:
    cur = conn.cursor()
    cur.execute(f"PRAGMA table_info({table})")
    return [row[1] for row in cur.fetchall()]


def bbox_from_points(points: List[Tuple[float, float]]) -> Tuple[float, float, float, float]:
    # points are (lat, lon)
    lats = [p[0] for p in points]
    lons = [p[1] for p in points]
    return min(lats), min(lons), max(lats), max(lons)


def query_ticket_numbers_bbox(
    conn: sqlite3.Connection,
    table: str,
    ticket_col: str,
    lat_col: str,
    lon_col: str,
    min_lat: float,
    min_lon: float,
    max_lat: float,
    max_lon: float,
) -> List[str]:
    sql = f"""
        SELECT DISTINCT {ticket_col}
        FROM {table}
        WHERE {lon_col} BETWEEN ? AND ?
          AND {lat_col} BETWEEN ? AND ?
        ORDER BY {ticket_col};
    """
    cur = conn.cursor()
    cur.execute(sql, (min_lon, max_lon, min_lat, max_lat))
    return [str(r[0]) for r in cur.fetchall()]


def fetch_polygon_ring(
    conn: sqlite3.Connection,
    table: str,
    ticket_col: str,
    lat_col: str,
    lon_col: str,
    ticket_number: str,
    order_col: Optional[str] = None,
) -> List[List[float]]:
    cur = conn.cursor()
    if order_col:
        sql = f"""
            SELECT {lon_col}, {lat_col}
            FROM {table}
            WHERE {ticket_col} = ?
            ORDER BY {order_col} ASC
        """
    else:
        sql = f"""
            SELECT {lon_col}, {lat_col}
            FROM {table}
            WHERE {ticket_col} = ?
        """
    cur.execute(sql, (ticket_number,))
    ring = [[float(lon), float(lat)] for (lon, lat) in cur.fetchall()]

    # close ring if needed
    if ring and ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


def export_geojson(
    conn: sqlite3.Connection,
    out_path: str,
    table: str,
    ticket_col: str,
    lat_col: str,
    lon_col: str,
    tickets: List[str],
    order_col: Optional[str] = None,
) -> None:
    features = []
    for t in tickets:
        ring = fetch_polygon_ring(conn, table, ticket_col, lat_col, lon_col, t, order_col=order_col)
        if not ring:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {ticket_col: t},
                "geometry": {"type": "Polygon", "coordinates": [ring]},
            }
        )

    fc = {"type": "FeatureCollection", "features": features}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(fc, f)
    print(f"Wrote {out_path} ({len(features)} features)")


def last_n_tickets(conn: sqlite3.Connection, tickets_table: str, ticket_col: str, n: int) -> List[str]:
    cur = conn.cursor()
    cur.execute(
        f"""
        SELECT DISTINCT {ticket_col}
        FROM {tickets_table}
        ORDER BY rowid DESC
        LIMIT ?
        """,
        (n,),
    )
    return [str(r[0]) for r in cur.fetchall()]


def main():
    ap = argparse.ArgumentParser(description="Query tickets.db by bounding box and optionally export GeoJSON.")
    ap.add_argument("--db", default="tickets.db", help="Path to SQLite DB (default: tickets.db)")

    ap.add_argument("--poly-table", default="polygon_coordinates", help="Polygon vertices table")
    ap.add_argument("--tickets-table", default="tickets", help="Tickets table (for last-N mode)")

    ap.add_argument("--ticket-col", default="ticket_number", help="Ticket number column name")
    ap.add_argument("--lat-col", default="lat", help="Latitude column name")
    ap.add_argument("--lon-col", default="lon", help="Longitude column name")
    ap.add_argument("--order-col", default=None, help="Vertex order column name (optional but recommended)")

    # Bounding box args
    ap.add_argument("--min-lat", type=float, help="Min latitude")
    ap.add_argument("--min-lon", type=float, help="Min longitude")
    ap.add_argument("--max-lat", type=float, help="Max latitude")
    ap.add_argument("--max-lon", type=float, help="Max longitude")

    # Convenience: provide 4 points (lat,lon) and compute bbox
    ap.add_argument(
        "--points",
        nargs="+",
        help='Four or more points as "lat,lon" (space-separated). Example: --points "37.68,-122.11" "37.69,-122.10" ...',
    )

    # Output
    ap.add_argument("--print", action="store_true", help="Print matching ticket numbers")
    ap.add_argument("--out-geojson", help="If set, export matching tickets to this GeoJSON path")

    # Last-N export mode
    ap.add_argument("--last-n", type=int, help="Export last N tickets (by rowid in tickets table)")
    ap.add_argument("--out-last-geojson", help="GeoJSON output path for last-N export")

    args = ap.parse_args()

    conn = sqlite3.connect(args.db)

    # Quick schema sanity (helpful if column names differ)
    poly_cols = set(get_cols(conn, args.poly_table))
    for c in (args.ticket_col, args.lat_col, args.lon_col):
        if c not in poly_cols:
            raise SystemExit(
                f"Column '{c}' not found in {args.poly_table}. Found columns: {sorted(poly_cols)}\n"
                f"Pass the correct name via --ticket-col/--lat-col/--lon-col."
            )

    # Mode 1: last-N export
    if args.last_n:
        if not args.out_last_geojson:
            raise SystemExit("--last-n requires --out-last-geojson")
        tickets = last_n_tickets(conn, args.tickets_table, args.ticket_col, args.last_n)
        export_geojson(
            conn,
            args.out_last_geojson,
            args.poly_table,
            args.ticket_col,
            args.lat_col,
            args.lon_col,
            tickets,
            order_col=args.order_col,
        )
        return

    # Mode 2: bbox query
    if args.points:
        pts = []
        for s in args.points:
            lat_s, lon_s = s.split(",")
            pts.append((float(lat_s), float(lon_s)))
        min_lat, min_lon, max_lat, max_lon = bbox_from_points(pts)
    else:
        needed = (args.min_lat, args.min_lon, args.max_lat, args.max_lon)
        if any(v is None for v in needed):
            raise SystemExit("Provide either --points ... OR all of --min-lat/--min-lon/--max-lat/--max-lon")
        min_lat, min_lon, max_lat, max_lon = args.min_lat, args.min_lon, args.max_lat, args.max_lon

    tickets = query_ticket_numbers_bbox(
        conn,
        args.poly_table,
        args.ticket_col,
        args.lat_col,
        args.lon_col,
        min_lat,
        min_lon,
        max_lat,
        max_lon,
    )

    if args.print:
        for t in tickets:
            print(t)

    if args.out_geojson:
        export_geojson(
            conn,
            args.out_geojson,
            args.poly_table,
            args.ticket_col,
            args.lat_col,
            args.lon_col,
            tickets,
            order_col=args.order_col,
        )


if __name__ == "__main__":
    main()
