import json
import re
import time
from datetime import datetime
from typing import Optional, Tuple, List, Dict

import requests
from bs4 import BeautifulSoup

import tkinter as tk
from tkinter import ttk, messagebox

# ====== HTTP config ======
HEADERS = {"User-Agent": "Mozilla/5.0"}
POSR_API = (
    "https://appsnv.undergroundservicealert.org/"
    "posr/searchtool/PositiveResponse/GetJobsListForTable?format=json&ticketNumber={ticket}"
)
MAP_URL = (
    "https://onecallnv.undergroundservicealert.org/ngen.web/map/index?RequestNumber={base}-000"
)


# ====== Core helpers ======
def normalize_ticket_base(ticket_number: str) -> str:
    """
    Normalizes a ticket number by stripping off any suffix after '-'.
    Example: '2025010100123-001' -> '2025010100123'
    """
    return ticket_number.split("-")[0]


def fetch_posr_details(ticket_number: str, debug_json: bool = False
                       ) -> Tuple[List[str], Optional[str], Optional[str], Optional[str]]:
    """
    Calls the POSR JSON endpoint.

    Returns:
        (station_codes, work_type, work_activity, created_by)

    If fields are missing, returns None for them.
    """
    url = POSR_API.format(ticket=ticket_number)

    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except requests.RequestException:
        # Fallback: try the base ticket without any suffix
        base = normalize_ticket_base(ticket_number)
        if base != ticket_number:
            try:
                resp = requests.get(POSR_API.format(ticket=base), headers=HEADERS, timeout=15)
                resp.raise_for_status()
            except requests.RequestException:
                return [], None, None, None
        else:
            return [], None, None, None

    data = resp.json()

    if debug_json:
        # If you want to inspect raw JSON, uncomment this line while testing:
        # print(json.dumps(data, indent=2))
        pass

    posr_ticket = data.get("posrTicket", {}) if isinstance(data, dict) else {}

    # Stations
    stations = posr_ticket.get("stations", []) if isinstance(posr_ticket, dict) else []
    station_codes = [s.get("code") for s in stations if isinstance(s, dict) and s.get("code")]

    # Work type (try several common casings)
    work_type = (
        posr_ticket.get("workType")
        or posr_ticket.get("WorkType")
        or posr_ticket.get("work_type")
    )

    # Work activity (try several common casings)
    work_activity = (
        posr_ticket.get("workActivity")
        or posr_ticket.get("WorkActivity")
        or posr_ticket.get("work_activity")
    )

    # Created by / username — try several likely keys.
    created_by = (
        posr_ticket.get("createdBy")
        or posr_ticket.get("CreatedBy")
        or posr_ticket.get("created_by")
        or posr_ticket.get("requester")
        or posr_ticket.get("Requester")
        or posr_ticket.get("createdByUser")
        or posr_ticket.get("CreatedByUser")
        or posr_ticket.get("createdByUserName")
        or posr_ticket.get("CreatedByUserName")
    )

    return station_codes or [], work_type, work_activity, created_by


def fetch_polygon_coords(ticket_number: str) -> Optional[List[List[float]]]:
    """
    Scrapes the polygon from the map page's inline JS:
        var spatialObjectDescription = 'POLYGON((...))';

    Uses the base ticket with '-000' to ensure it loads the master geometry.

    Returns:
        List of [x, y] pairs or None if not found.
    """
    base = normalize_ticket_base(ticket_number)
    url = MAP_URL.format(base=base)

    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except requests.RequestException:
        return None

    soup = BeautifulSoup(resp.text, "html.parser")
    pattern = r"var spatialObjectDescription = 'POLYGON\((.*?)\)';"

    for script in soup.find_all("script"):
        text = script.string or ""
        m = re.search(pattern, text)
        if m:
            poly_str = m.group(1)
            coords: List[List[float]] = []
            for coord in poly_str.strip().replace("(", "").replace(")", "").split(","):
                if coord.strip():
                    parts = coord.split()
                    if len(parts) >= 2:
                        try:
                            x = float(parts[0])
                            y = float(parts[1])
                            coords.append([x, y])
                        except ValueError:
                            # Skip malformed coordinate
                            pass
            return coords if coords else None

    return None


def build_features_for_tickets(
    tickets: List[str],
    throttle_sec: float = 0.1,
    debug_json: bool = False,
    logger=print,
) -> List[Dict]:
    """
    Processes a list of ticket numbers, fetching POSR details + polygon,
    and builds GeoJSON features.
    """
    features: List[Dict] = []

    logger(f"Processing {len(tickets)} ticket(s)…")

    for i, ticket in enumerate(tickets, 1):
        logger(f"\n[{i}/{len(tickets)}] Ticket {ticket}")

        station_codes, work_type, work_activity, created_by = fetch_posr_details(
            ticket, debug_json=debug_json
        )
        poly = fetch_polygon_coords(ticket)

        if poly and station_codes:
            feat = {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [poly]},
                "properties": {
                    "ticket_number": ticket,
                    "station_codes": station_codes,
                    "work_type": work_type,
                    "work_activity": work_activity,
                    "created_by": created_by,
                },
            }
            features.append(feat)
            logger(
                f" ✅ Added {ticket} "
                f"(stations: {len(station_codes)}, created_by: {created_by})"
            )
        else:
            why = []
            if not poly:
                why.append("polygon")
            if not station_codes:
                why.append("stations")
            logger(f" ⚠️ Skipped {ticket} (missing: {', '.join(why)})")

        time.sleep(throttle_sec)

    return features


def save_geojson(features: List[Dict], out_path: Optional[str] = None, logger=print) -> Optional[str]:
    """
    Saves the features as a GeoJSON FeatureCollection.

    If out_path is None, uses a timestamped filename.
    Returns the filename if saved, otherwise None.
    """
    if not features:
        logger("\n❌ No valid features to save.")
        return None

    if out_path is None or not out_path.strip():
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_path = f"tickets_{ts}.geojson"

    fc = {"type": "FeatureCollection", "features": features}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(fc, f, indent=2)

    logger(f"\n✅ Saved GeoJSON file: {out_path}")
    return out_path


# ====== GUI ======
def launch_gui():
    root = tk.Tk()
    root.title("Ticket Polygon + POSR Tester (with created_by)")
    root.geometry("700x500")

    # --- Variables ---
    tickets_text_var = tk.StringVar()
    throttle_var = tk.DoubleVar(value=0.1)
    outfile_var = tk.StringVar()

    # --- Layout frame ---
    frm = ttk.Frame(root, padding=10)
    frm.pack(fill="both", expand=True)

    # --- Tickets input ---
    ttk.Label(frm, text="Ticket numbers (one per line or comma-separated):").grid(
        row=0, column=0, columnspan=3, sticky="w"
    )

    tickets_text = tk.Text(frm, height=6, wrap="word")
    tickets_text.grid(row=1, column=0, columnspan=3, sticky="nsew", pady=(2, 8))

    # --- Throttle ---
    ttk.Label(frm, text="Throttle (seconds between tickets):").grid(
        row=2, column=0, sticky="w"
    )
    throttle_spin = ttk.Spinbox(frm, from_=0.0, to=5.0, increment=0.1, textvariable=throttle_var)
    throttle_spin.grid(row=2, column=1, sticky="w")

    # --- Outfile ---
    ttk.Label(frm, text="Output GeoJSON path (optional):").grid(
        row=3, column=0, sticky="w", pady=(8, 0)
    )
    outfile_entry = ttk.Entry(frm, textvariable=outfile_var)
    outfile_entry.grid(row=3, column=1, columnspan=2, sticky="ew", pady=(8, 0))

    # --- Run button ---
    run_btn = ttk.Button(frm, text="Run")
    run_btn.grid(row=4, column=0, columnspan=3, sticky="ew", pady=(10, 10))

    # --- Output log ---
    ttk.Label(frm, text="Output:").grid(row=5, column=0, columnspan=3, sticky="w")
    output_box = tk.Text(frm, height=12, wrap="word", state="disabled")
    output_box.grid(row=6, column=0, columnspan=3, sticky="nsew")
    scroll = ttk.Scrollbar(frm, command=output_box.yview)
    output_box.configure(yscrollcommand=scroll.set)
    scroll.grid(row=6, column=3, sticky="ns")

    # Grid weights
    frm.columnconfigure(0, weight=0)
    frm.columnconfigure(1, weight=1)
    frm.columnconfigure(2, weight=0)
    frm.rowconfigure(6, weight=1)

    # --- Logger helper ---
    def log(msg: str):
        output_box.configure(state="normal")
        output_box.insert("end", msg + "\n")
        output_box.see("end")
        output_box.configure(state="disabled")
        root.update_idletasks()

    # --- Run handler ---
    def on_run():
        raw = tickets_text.get("1.0", "end").strip()
        if not raw:
            messagebox.showerror("Error", "Please enter at least one ticket number.")
            return

        # Split by newline or comma
        parts = []
        for line in raw.splitlines():
            for piece in line.split(","):
                val = piece.strip()
                if val:
                    parts.append(val)

        tickets = list(dict.fromkeys(parts))  # de-duplicate, keep order

        if not tickets:
            messagebox.showerror("Error", "No valid ticket numbers found.")
            return

        try:
            throttle = float(throttle_var.get())
        except ValueError:
            throttle = 0.1
            throttle_var.set(throttle)

        out_path = outfile_var.get().strip() or None

        run_btn.configure(state="disabled")
        output_box.configure(state="normal")
        output_box.delete("1.0", "end")
        output_box.configure(state="disabled")

        log(f"▶ Running for {len(tickets)} ticket(s)")
        log(f"   Throttle: {throttle} sec")

        try:
            features = build_features_for_tickets(
                tickets,
                throttle_sec=throttle,
                debug_json=False,  # flip to True if you want to inspect JSON and add a print
                logger=log,
            )
            filename = save_geojson(features, out_path=out_path, logger=log)
            if filename:
                log("🏁 Done.")
            else:
                log("🏁 Done (no features saved).")
        except Exception as e:
            log(f"💥 Error: {e}")
            messagebox.showerror("Error", str(e))
        finally:
            run_btn.configure(state="normal")

    run_btn.configure(command=on_run)

    root.mainloop()


if __name__ == "__main__":
    launch_gui()
