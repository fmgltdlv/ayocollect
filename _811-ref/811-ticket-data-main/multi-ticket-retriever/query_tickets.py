#!/usr/bin/env python3
import argparse
import csv
import json
import os
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
    poly_table: str,
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
        FROM {poly_table}
        WHERE {lon_col} BETWEEN ? AND ?
          AND {lat_col} BETWEEN ? AND ?
        ORDER BY {ticket_col};
    """
    cur = conn.cursor()
    cur.execute(sql, (min_lon, max_lon, min_lat, max_lat))
    return [str(r[0]) for r in cur.fetchall()]


def fetch_polygon_ring(
    conn: sqlite3.Connection,
    poly_table: str,
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
            FROM {poly_table}
            WHERE {ticket_col} = ?
            ORDER BY {order_col} ASC
        """
    else:
        sql = f"""
            SELECT {lon_col}, {lat_col}
            FROM {poly_table}
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
    poly_table: str,
    ticket_col: str,
    lat_col: str,
    lon_col: str,
    tickets: List[str],
    order_col: Optional[str] = None,
) -> None:
    features = []
    for t in tickets:
        ring = fetch_polygon_ring(conn, poly_table, ticket_col, lat_col, lon_col, t, order_col=order_col)
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


def export_rows_for_tickets_to_csv(
    conn: sqlite3.Connection,
    table: str,
    ticket_col: str,
    tickets: List[str],
    out_csv: str,
) -> None:
    cols = get_cols(conn, table)
    if ticket_col not in cols:
        raise SystemExit(
            f"Column '{ticket_col}' not found in table '{table}'. Found columns: {cols}."
        )

    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(cols)

        if not tickets:
            print(f"Wrote {out_csv} (0 rows)")
            return

        placeholders = ",".join(["?"] * len(tickets))
        sql = f"""
            SELECT {", ".join(cols)}
            FROM {table}
            WHERE {ticket_col} IN ({placeholders})
            ORDER BY {ticket_col};
        """
        cur = conn.cursor()
        cur.execute(sql, tickets)
        rows = cur.fetchall()
        w.writerows(rows)

    print(f"Wrote {out_csv} ({len(rows)} rows)")


def copy_table_schema(dst: sqlite3.Connection, src: sqlite3.Connection, table: str) -> None:
    cur = src.cursor()
    cur.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    )
    row = cur.fetchone()
    if not row or not row[0]:
        raise SystemExit(f"Could not find CREATE TABLE statement for '{table}' in source DB.")
    dst.execute(row[0])


def export_reduced_db(
    src_db_path: str,
    out_db_path: str,
    tickets: List[str],
    ticket_col: str,
    tables: List[str],
) -> None:
    if os.path.exists(out_db_path):
        raise SystemExit(f"Refusing to overwrite existing file: {out_db_path}")

    src = sqlite3.connect(src_db_path)
    dst = sqlite3.connect(out_db_path)

    try:
        dst.execute("PRAGMA journal_mode=OFF;")
        dst.execute("PRAGMA synchronous=OFF;")
        dst.execute("PRAGMA temp_store=MEMORY;")

        # Create tables with identical schema
        for t in tables:
            copy_table_schema(dst, src, t)

        if not tickets:
            dst.commit()
            print(f"Wrote {out_db_path} (0 tickets; schema only)")
            return

        placeholders = ",".join(["?"] * len(tickets))

        # Copy only matching rows
        for t in tables:
            cols = get_cols(src, t)
            if ticket_col not in cols:
                raise SystemExit(
                    f"Table '{t}' does not contain ticket column '{ticket_col}'. "
                    f"Columns: {cols}"
                )

            col_list = ", ".join(cols)
            sql = f"""
                INSERT INTO {t} ({col_list})
                SELECT {col_list}
                FROM main.{t}
                WHERE {ticket_col} IN ({placeholders});
            """
            dst.execute("ATTACH DATABASE ? AS main", (src_db_path,))
            # NOTE: can't attach with parameter in SQL directly across sqlite versions reliably.
            # We'll instead query from src and insert into dst in Python.
            dst.execute("DETACH DATABASE main")

            cur = src.cursor()
            cur.execute(
                f"SELECT {col_list} FROM {t} WHERE {ticket_col} IN ({placeholders})",
                tickets,
            )
            rows = cur.fetchall()
            if rows:
                dst.executemany(
                    f"INSERT INTO {t} ({col_list}) VALUES ({','.join(['?']*len(cols))})",
                    rows,
                )

        dst.commit()
        dst.execute("VACUUM;")
        print(f"Wrote {out_db_path} (tickets={len(tickets)})")

    finally:
        src.close()
        dst.close()


def main():
    ap = argparse.ArgumentParser(description="Query tickets.db by bounding box and export data.")
    ap.add_argument("--db", default="tickets.db", help="Path to SQLite DB (default: tickets.db)")

    ap.add_argument("--poly-table", default="polygon_coordinates", help="Polygon vertices table")
    ap.add_argument("--tickets-table", default="tickets", help="Tickets table")
    ap.add_argument("--props-table", default="ticket_properties", help="Ticket properties table")

    ap.add_argument("--ticket-col", default="ticket_number", help="Ticket number column name (shared key)")
    ap.add_argument("--lat-col", default="latitude", help="Latitude column name (polygon table)")
    ap.add_argument("--lon-col", default="longitude", help="Longitude column name (polygon table)")
    ap.add_argument("--order-col", default="coordinate_order", help="Vertex order column name (polygon table)")

    ap.add_argument("--min-lat", type=float)
    ap.add_argument("--min-lon", type=float)
    ap.add_argument("--max-lat", type=float)
    ap.add_argument("--max-lon", type=float)
    ap.add_argument("--points", nargs="+", help='Points as "lat,lon" (space-separated)')

    ap.add_argument("--print", action="store_true", help="Print matching ticket numbers")
    ap.add_argument("--out-geojson", help="Export matching ticket polygons to this GeoJSON path")
    ap.add_argument("--out-props-csv", help="Export full ticket_properties rows for matching tickets to CSV")
    ap.add_argument("--out-tickets-csv", help="Export full tickets rows for matching tickets to CSV")

    ap.add_argument("--out-reduced-db", help="Export a reduced SQLite DB containing only matching tickets")

    ap.add_argument("--last-n", type=int, help="Operate on last N tickets (by rowid in tickets table)")
    ap.add_argument("--out-last-geojson", help="GeoJSON output path for last-N export")
    ap.add_argument("--out-last-props-csv", help="CSV output path for ticket_properties for last-N tickets")
    ap.add_argument("--out-last-tickets-csv", help="CSV output path for tickets rows for last-N tickets")
    ap.add_argument("--out-last-reduced-db", help="Reduced DB output path for last-N tickets")

    args = ap.parse_args()

    conn = sqlite3.connect(args.db)

    # Validate polygon columns
    poly_cols = set(get_cols(conn, args.poly_table))
    for c in (args.ticket_col, args.lat_col, args.lon_col):
        if c not in poly_cols:
            raise SystemExit(
                f"Column '{c}' not found in {args.poly_table}. Found columns: {sorted(poly_cols)}\n"
                f"Pass the correct name via --ticket-col/--lat-col/--lon-col."
            )
    if args.order_col and args.order_col not in poly_cols:
        print(f"Warning: order column '{args.order_col}' not found; exporting without vertex ordering.")
        args.order_col = None

    # Determine ticket set
    if args.last_n:
        tickets = last_n_tickets(conn, args.tickets_table, args.ticket_col, args.last_n)
        mode_prefix = "last-n"
    else:
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
        mode_prefix = "bbox"

    # Print tickets
    if args.print:
        for t in tickets:
            print(t)

    # GeoJSON
    out_geojson = args.out_last_geojson if args.last_n else args.out_geojson
    if out_geojson:
        export_geojson(
            conn,
            out_geojson,
            args.poly_table,
            args.ticket_col,
            args.lat_col,
            args.lon_col,
            tickets,
            order_col=args.order_col,
        )

    # CSV exports
    out_props = args.out_last_props_csv if args.last_n else args.out_props_csv
    if out_props:
        export_rows_for_tickets_to_csv(conn, args.props_table, args.ticket_col, tickets, out_props)

    out_tickets = args.out_last_tickets_csv if args.last_n else args.out_tickets_csv
    if out_tickets:
        export_rows_for_tickets_to_csv(conn, args.tickets_table, args.ticket_col, tickets, out_tickets)

    # Reduced DB export
    out_db = args.out_last_reduced_db if args.last_n else args.out_reduced_db
    if out_db:
        conn.close()  # close before we open new connections inside export
        export_reduced_db(
            src_db_path=args.db,
            out_db_path=out_db,
            tickets=tickets,
            ticket_col=args.ticket_col,
            tables=[args.tickets_table, args.props_table, args.poly_table],
        )
        return

    conn.close()


if __name__ == "__main__":
    main()
