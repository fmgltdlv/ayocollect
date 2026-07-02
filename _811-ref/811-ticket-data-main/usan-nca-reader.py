import csv
import json
import re
import sqlite3
import time
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta, date
from typing import Optional, Tuple, List, Dict

# ====== HTTP config ======
HEADERS = {"User-Agent": "Mozilla/5.0"}
POSR_API = (
    "https://appsca.undergroundservicealert.org/"
    "posr/searchtool/PositiveResponse/GetJobsListForTable?format=json&ticketNumber={ticket}"
)
MAP_URL = (
    "https://onecallca.undergroundservicealert.org/ngen.web/map/index?RequestNumber={base}-000"
)

# ====== Core functions (unchanged behavior) ======
def read_ticket_numbers(csv_path: str, column: Optional[str] = None) -> List[str]:
    """
    Reads ticket numbers from a CSV. If `column` is provided, uses that column;
    otherwise it uses the first column in the file.
    """
    tickets = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            # fallback to simple CSV (no header)
            f.seek(0)
            reader2 = csv.reader(f)
            for row in reader2:
                if row and row[0]:
                    tickets.append(row[0].strip())
            return tickets

        # With header:
        if column and column in reader.fieldnames:
            for row in reader:
                val = (row.get(column) or "").strip()
                if val:
                    tickets.append(val)
        else:
            first_col = reader.fieldnames[0]
            for row in reader:
                val = (row.get(first_col) or "").strip()
                if val:
                    tickets.append(val)
    return tickets

def normalize_ticket_base(ticket_number: str) -> str:
    return ticket_number.split("-")[0]

def ticket_exists(ticket_number: str) -> bool:
    """
    Checks if a ticket exists by trying to fetch POSR details.
    Returns True if ticket exists and has data, False otherwise.
    """
    url = POSR_API.format(ticket=ticket_number)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        # Check if we got valid data (not empty)
        if isinstance(data, dict) and data.get("posrTicket"):
            return True
        return False
    except requests.RequestException:
        # Try with base ticket if full ticket failed
        base = normalize_ticket_base(ticket_number)
        if base != ticket_number:
            try:
                resp = requests.get(POSR_API.format(ticket=base), headers=HEADERS, timeout=15)
                resp.raise_for_status()
                data = resp.json()
                if isinstance(data, dict) and data.get("posrTicket"):
                    return True
            except requests.RequestException:
                pass
        return False

def fetch_posr_details(ticket_number: str) -> Dict:
    """
    Calls the POSR JSON endpoint. Returns a dictionary with all available fields from the response.
    Returns empty dict if ticket not found or error occurs.
    """
    url = POSR_API.format(ticket=ticket_number)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
    except requests.RequestException:
        base = normalize_ticket_base(ticket_number)
        if base != ticket_number:
            try:
                resp = requests.get(POSR_API.format(ticket=base), headers=HEADERS, timeout=15)
                resp.raise_for_status()
            except requests.RequestException:
                return {}
        else:
            return {}

    data = resp.json()
    if not isinstance(data, dict):
        return {}
    
    # Get the posrTicket object
    posr_ticket = data.get("posrTicket", {})
    if not isinstance(posr_ticket, dict):
        return {}
    
    # Extract all fields from posrTicket
    result = {}
    
    # Copy all top-level fields from posrTicket (including nested objects/arrays)
    for key, value in posr_ticket.items():
        result[key] = value
    
    # Handle stations array - extract station codes for convenience
    # (full stations array is already in result)
    stations = posr_ticket.get("stations", [])
    if not isinstance(stations, list):
        stations = []
    
    station_codes = []
    for station in stations:
        if isinstance(station, dict):
            code = station.get("code")
            if code:
                station_codes.append(code)
    
    # Add station_codes as a convenience field (in addition to full stations array)
    result["station_codes"] = station_codes
    
    # Include any other top-level fields from the response (outside posrTicket)
    for key, value in data.items():
        if key != "posrTicket":
            result[key] = value
    
    return result

def fetch_polygon_coords(ticket_number: str) -> Optional[List[List[float]]]:
    """
    Scrapes the polygon from the map page's inline JS:
        var spatialObjectDescription = 'POLYGON((...))';
    Uses the base ticket with '-000' to ensure it loads the master geometry.
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
            coords = []
            for coord in poly_str.strip().replace("(", "").replace(")", "").split(","):
                if coord.strip():
                    parts = coord.split()
                    if len(parts) >= 2:
                        try:
                            x = float(parts[0])
                            y = float(parts[1])
                            coords.append([x, y])
                        except ValueError:
                            pass
            return coords if coords else None

    return None

def save_to_database(features: List[Dict], logger=print, db_path: str = "tickets.db"):
    """
    Saves ticket data to a SQLite database.
    Creates tables for tickets, polygons, and ticket properties.
    """
    if not features:
        logger("\n❌ No valid tickets found.")
        return
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # Create tickets table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_number TEXT UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Create ticket_properties table for all POSR fields (flexible key-value store)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS ticket_properties (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_number TEXT NOT NULL,
                property_key TEXT NOT NULL,
                property_value TEXT,
                FOREIGN KEY (ticket_number) REFERENCES tickets(ticket_number) ON DELETE CASCADE,
                UNIQUE(ticket_number, property_key)
            )
        """)
        
        # Create polygon_coordinates table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS polygon_coordinates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_number TEXT NOT NULL,
                coordinate_order INTEGER NOT NULL,
                longitude REAL NOT NULL,
                latitude REAL NOT NULL,
                FOREIGN KEY (ticket_number) REFERENCES tickets(ticket_number) ON DELETE CASCADE
            )
        """)
        
        # Create indexes
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_ticket_number ON tickets(ticket_number)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_properties_ticket ON ticket_properties(ticket_number)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_polygon_ticket ON polygon_coordinates(ticket_number)")
        
        inserted_count = 0
        updated_count = 0
        
        # Prepare batch data
        tickets_data = []
        properties_data = []
        coordinates_data = []
        
        for feature in features:
            props = feature.get("properties", {})
            ticket_number = props.get("ticket_number")
            
            if not ticket_number:
                continue
            
            # Check if this is a new ticket or update
            cursor.execute("SELECT COUNT(*) FROM ticket_properties WHERE ticket_number = ?", (ticket_number,))
            is_new = cursor.fetchone()[0] == 0
            
            if is_new:
                inserted_count += 1
            else:
                updated_count += 1
            
            # Delete existing properties and coordinates for this ticket (to handle updates)
            cursor.execute("DELETE FROM ticket_properties WHERE ticket_number = ?", (ticket_number,))
            cursor.execute("DELETE FROM polygon_coordinates WHERE ticket_number = ?", (ticket_number,))
            
            # Prepare ticket data
            tickets_data.append((ticket_number,))
            
            # Prepare properties data
            for key, value in props.items():
                if key == "ticket_number":  # Skip ticket_number as it's in the main table
                    continue
                
                # Convert value to string for storage (handles lists, dicts, etc.)
                if value is None:
                    str_value = None
                elif isinstance(value, (dict, list)):
                    str_value = json.dumps(value)
                else:
                    str_value = str(value)
                
                properties_data.append((ticket_number, key, str_value))
            
            # Prepare polygon coordinates data
            geometry = feature.get("geometry", {})
            if geometry.get("type") == "Polygon":
                coords = geometry.get("coordinates", [])
                if coords and len(coords) > 0:
                    polygon_ring = coords[0]  # First ring of polygon
                    for order, coord in enumerate(polygon_ring):
                        if len(coord) >= 2:
                            longitude = float(coord[0])
                            latitude = float(coord[1])
                            coordinates_data.append((ticket_number, order, longitude, latitude))
        
        # Batch insert tickets
        if tickets_data:
            cursor.executemany("""
                INSERT OR REPLACE INTO tickets (ticket_number, updated_at)
                VALUES (?, CURRENT_TIMESTAMP)
            """, tickets_data)
        
        # Batch insert properties
        if properties_data:
            cursor.executemany("""
                INSERT INTO ticket_properties (ticket_number, property_key, property_value)
                VALUES (?, ?, ?)
            """, properties_data)
        
        # Batch insert coordinates
        if coordinates_data:
            cursor.executemany("""
                INSERT INTO polygon_coordinates 
                (ticket_number, coordinate_order, longitude, latitude)
                VALUES (?, ?, ?, ?)
            """, coordinates_data)
        
        conn.commit()
        
        # Log save results (silent logger will just do nothing)
        if logger:
            logger(f"✅ Saved {len(tickets_data)} ticket(s) to database")
            if inserted_count > 0:
                logger(f"   Inserted: {inserted_count} new tickets")
            if updated_count > 0:
                logger(f"   Updated: {updated_count} existing tickets")
        
    except sqlite3.Error as e:
        conn.rollback()
        logger(f"\n❌ Database error: {e}")
        raise
    finally:
        conn.close()

def export_database_to_geojson(db_path: str = "tickets.db", output_path: Optional[str] = None, logger=print):
    """
    Exports all tickets from the database to a GeoJSON file.
    """
    if output_path is None:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = f"tickets_export_{ts}.geojson"
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    try:
        # Get all tickets
        cursor.execute("SELECT ticket_number FROM tickets ORDER BY ticket_number")
        tickets = cursor.fetchall()
        
        if not tickets:
            logger(f"\n❌ No tickets found in database: {db_path}")
            return
        
        features = []
        
        for (ticket_number,) in tickets:
            # Get all properties for this ticket
            cursor.execute("""
                SELECT property_key, property_value 
                FROM ticket_properties 
                WHERE ticket_number = ?
            """, (ticket_number,))
            properties = dict(cursor.fetchall())
            
            # Get polygon coordinates
            cursor.execute("""
                SELECT longitude, latitude 
                FROM polygon_coordinates 
                WHERE ticket_number = ?
                ORDER BY coordinate_order
            """, (ticket_number,))
            coords = cursor.fetchall()
            
            # Reconstruct properties (parse JSON strings back to objects)
            props = {"ticket_number": ticket_number}
            for key, value in properties.items():
                if value is None:
                    props[key] = None
                else:
                    # Try to parse as JSON first (for lists, dicts)
                    try:
                        props[key] = json.loads(value)
                    except (json.JSONDecodeError, TypeError):
                        # If not JSON, keep as string
                        props[key] = value
            
            # Build polygon coordinates
            if coords:
                polygon_coords = [[float(lon), float(lat)] for lon, lat in coords]
                feature = {
                    "type": "Feature",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [polygon_coords]
                    },
                    "properties": props
                }
                features.append(feature)
        
        # Write GeoJSON
        feature_collection = {
            "type": "FeatureCollection",
            "features": features
        }
        
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(feature_collection, f, indent=2)
        
        logger(f"\n✅ Exported {len(features)} tickets to: {output_path}")
        
    except sqlite3.Error as e:
        logger(f"\n❌ Database error: {e}")
        raise
    finally:
        conn.close()

def format_ticket_number(date_obj: date, sequence: int) -> str:
    """
    Formats ticket number as YYYYMMDDXXXXX
    """
    date_str = date_obj.strftime("%Y%m%d")
    seq_str = f"{sequence:05d}"
    return f"{date_str}{seq_str}"

def run_sequential_scrape(start_date: date, throttle_sec: float = 0.1, logger=print, stop_flag=None, end_date: Optional[date] = None, max_tickets_per_day: Optional[int] = None):
    """
    Sequentially scrapes tickets starting from start_date.
    Format: YYYYMMDDXXXXX (year, month, day, 5-digit sequence starting at 00001)
    Moves to next day after 2 consecutive missing tickets or max_tickets_per_day (if set).
    Stops when end_date is reached (if provided).
    """
    features: List[Dict] = []
    unsaved_features: List[Dict] = []  # Features waiting to be saved
    current_date = start_date
    total_processed = 0
    total_found = 0
    save_batch_size = 100  # Save every 100 tickets
    
    logger(f"▶ Starting sequential scrape from {start_date.strftime('%Y-%m-%d')}")
    if end_date:
        logger(f"   End date: {end_date.strftime('%Y-%m-%d')}")
    if max_tickets_per_day:
        logger(f"   Max tickets per day: {max_tickets_per_day}")
    logger(f"   Throttle: {throttle_sec} sec between requests")
    logger(f"   Auto-save: Every {save_batch_size} tickets")
    logger("")
    
    while True:
        if stop_flag and stop_flag.get("value"):
            logger("\n⏹ Stopped by user.")
            break
        
        # Check if we've reached the end date
        if end_date and current_date > end_date:
            logger(f"\n📅 Reached end date ({end_date.strftime('%Y-%m-%d')}). Stopping.")
            break
            
        consecutive_failures = 0
        sequence = 1
        date_tickets_found = 0
        date_tickets_checked = 0
        date_tickets_skipped = 0
        date_features: List[Dict] = []  # Features for this day only
        
        while consecutive_failures < 2:
            if stop_flag and stop_flag.get("value"):
                logger("\n⏹ Stopped by user.")
                break
            
            # Check if we've reached max tickets per day
            if max_tickets_per_day and date_tickets_checked >= max_tickets_per_day:
                break
                
            ticket = format_ticket_number(current_date, sequence)
            total_processed += 1
            date_tickets_checked += 1
            
            # Check if ticket exists
            if ticket_exists(ticket):
                consecutive_failures = 0  # Reset failure counter
                
                # Fetch full details
                posr_data = fetch_posr_details(ticket)
                station_codes = posr_data.get("station_codes", [])
                poly = fetch_polygon_coords(ticket)
                
                if poly and station_codes:
                    # Create properties with all available fields from POSR data
                    properties = {
                        "ticket_number": ticket,
                    }
                    # Add all fields from posr_data to properties
                    for key, value in posr_data.items():
                        # Skip stations array (we already have station_codes)
                        if key != "stations":
                            properties[key] = value
                    
                    feat = {
                        "type": "Feature",
                        "geometry": {"type": "Polygon", "coordinates": [poly]},
                        "properties": properties,
                    }
                    date_features.append(feat)
                    features.append(feat)
                    unsaved_features.append(feat)  # Add to unsaved queue
                    total_found += 1
                    date_tickets_found += 1
                    
                    # Save every 100 tickets
                    if len(unsaved_features) >= save_batch_size:
                        save_to_database(unsaved_features, logger=lambda x: None)  # Silent save
                        unsaved_features.clear()  # Clear the saved batch
                else:
                    date_tickets_skipped += 1
            else:
                consecutive_failures += 1
                if consecutive_failures >= 2:
                    break
            
            sequence += 1
            time.sleep(throttle_sec)
        
        # Log day summary (only once per day)
        reason = ""
        if max_tickets_per_day and date_tickets_checked >= max_tickets_per_day:
            reason = f" (max tickets: {max_tickets_per_day})"
        elif consecutive_failures >= 2:
            reason = " (2 consecutive failures)"
        
        logger(f"📅 {current_date.strftime('%Y-%m-%d')}: Checked {date_tickets_checked}, Found {date_tickets_found}, Skipped {date_tickets_skipped}{reason}")
        
        # Save any remaining unsaved tickets at end of day (if less than 100 accumulated)
        if unsaved_features:
            save_to_database(unsaved_features, logger=lambda x: None)  # Silent save
            unsaved_features.clear()
        
        # Move to next day
        current_date += timedelta(days=1)
    
    logger(f"\n📊 Summary: Processed {total_processed} tickets, found {total_found} valid tickets")
    
    # Save any remaining unsaved tickets
    if unsaved_features:
        save_to_database(unsaved_features, logger=logger)
        unsaved_features.clear()
    
    return features

def run_scrape(csv_path: str, column: Optional[str], throttle_sec: float = 0.1, logger=print):
    tickets = read_ticket_numbers(csv_path, column)
    logger(f"Found {len(tickets)} ticket(s) in CSV.")
    features: List[Dict] = []

    for i, ticket in enumerate(tickets, 1):
        logger(f"\n[{i}/{len(tickets)}] Processing {ticket} …")

        posr_data = fetch_posr_details(ticket)
        station_codes = posr_data.get("station_codes", [])
        poly = fetch_polygon_coords(ticket)

        if poly and station_codes:
            # Create properties with all available fields from POSR data
            properties = {
                "ticket_number": ticket,
            }
            # Add all fields from posr_data to properties
            for key, value in posr_data.items():
                # Skip stations array (we already have station_codes)
                if key != "stations":
                    properties[key] = value
            
            feat = {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [poly]},
                "properties": properties,
            }
            features.append(feat)
            logger(f" ✅ Added {ticket} (stations: {len(station_codes)})")
        else:
            why = []
            if not poly: why.append("polygon")
            if not station_codes: why.append("stations")
            logger(f" ⚠️ Skipped {ticket} (missing: {', '.join(why)})")

        time.sleep(throttle_sec)

    save_to_database(features, logger=logger)

# ====== Sequential GUI ======
def _launch_gui():
    import tkinter as tk
    from tkinter import ttk
    import threading

    root = tk.Tk()
    root.title("Sequential Ticket Scraper")
    root.geometry("700x550")

    # --- Vars ---
    start_date_var = tk.StringVar(value=date.today().strftime("%Y-%m-%d"))
    end_date_var = tk.StringVar(value="")
    max_tickets_var = tk.StringVar(value="")
    throttle_var = tk.DoubleVar(value=0.1)
    stop_flag = {"value": False}
    is_running = False

    # --- Helpers ---
    def log(msg: str, end="\n"):
        output_box.configure(state="normal")
        output_box.insert("end", msg + end)
        output_box.see("end")
        output_box.configure(state="disabled")
        root.update_idletasks()

    def validate_date(date_str: str) -> Optional[date]:
        """Validates and returns date object, or None if invalid."""
        try:
            return datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            return None

    def run_sequential():
        nonlocal is_running
        
        date_str = start_date_var.get().strip()
        start_dt = validate_date(date_str)
        
        if not start_dt:
            log("❌ Invalid start date format. Please use YYYY-MM-DD")
            return
        
        # Validate end date if provided
        end_dt = None
        end_date_str = end_date_var.get().strip()
        if end_date_str:
            end_dt = validate_date(end_date_str)
            if not end_dt:
                log("❌ Invalid end date format. Please use YYYY-MM-DD or leave empty")
                return
            if end_dt < start_dt:
                log("❌ End date must be after start date")
                return
        
        # Validate max tickets per day if provided
        max_tickets = None
        max_tickets_str = max_tickets_var.get().strip()
        if max_tickets_str:
            try:
                max_tickets = int(max_tickets_str)
                if max_tickets <= 0:
                    log("❌ Max tickets per day must be a positive number")
                    return
            except ValueError:
                log("❌ Max tickets per day must be a valid number")
                return
        
        if is_running:
            log("⚠️ Already running!")
            return
        
        # Disable controls
        is_running = True
        stop_flag["value"] = False
        run_btn.configure(state="disabled")
        date_entry.configure(state="disabled")
        end_date_entry.configure(state="disabled")
        max_tickets_entry.configure(state="disabled")
        throttle_spin.configure(state="disabled")
        stop_btn.configure(state="normal")
        
        def run_in_thread():
            try:
                run_sequential_scrape(
                    start_dt,
                    throttle_var.get(),
                    logger=log,
                    stop_flag=stop_flag,
                    end_date=end_dt,
                    max_tickets_per_day=max_tickets
                )
                log("🏁 Done.")
            except Exception as e:
                log(f"💥 Error: {e}")
                import traceback
                log(traceback.format_exc())
            finally:
                # Re-enable controls
                root.after(0, lambda: run_btn.configure(state="normal"))
                root.after(0, lambda: date_entry.configure(state="normal"))
                root.after(0, lambda: end_date_entry.configure(state="normal"))
                root.after(0, lambda: max_tickets_entry.configure(state="normal"))
                root.after(0, lambda: throttle_spin.configure(state="normal"))
                root.after(0, lambda: stop_btn.configure(state="disabled"))
                is_running = False
        
        thread = threading.Thread(target=run_in_thread, daemon=True)
        thread.start()

    def stop_scraping():
        stop_flag["value"] = True
        log("⏹ Stop requested...")

    def export_database():
        from tkinter import filedialog
        output_file = filedialog.asksaveasfilename(
            title="Export Database to GeoJSON",
            defaultextension=".geojson",
            filetypes=[("GeoJSON files", "*.geojson"), ("All files", "*.*")]
        )
        if output_file:
            try:
                export_database_to_geojson(db_path="tickets.db", output_path=output_file, logger=log)
            except Exception as e:
                log(f"💥 Export error: {e}")
                import traceback
                log(traceback.format_exc())

    # --- Layout ---
    frm = ttk.Frame(root, padding=12)
    frm.pack(fill="both", expand=True)

    # Title
    title_label = ttk.Label(frm, text="Sequential Ticket Scraper", font=("", 12, "bold"))
    title_label.grid(row=0, column=0, columnspan=3, sticky="w", pady=(0, 10))

    # Row 1: Start date
    ttk.Label(frm, text="Start Date (YYYY-MM-DD):").grid(row=1, column=0, sticky="w", pady=(0, 5))
    date_entry = ttk.Entry(frm, textvariable=start_date_var, width=15)
    date_entry.grid(row=1, column=1, sticky="w", padx=6, pady=(0, 5))
    ttk.Label(frm, text="Format: YYYYMMDDXXXXX (e.g., 2025010100001)", font=("", 8)).grid(row=1, column=2, sticky="w", pady=(0, 5))

    # Row 2: End date
    ttk.Label(frm, text="End Date (YYYY-MM-DD, optional):").grid(row=2, column=0, sticky="w", pady=(5, 5))
    end_date_entry = ttk.Entry(frm, textvariable=end_date_var, width=15)
    end_date_entry.grid(row=2, column=1, sticky="w", padx=6, pady=(5, 5))
    ttk.Label(frm, text="Leave empty to continue indefinitely", font=("", 8)).grid(row=2, column=2, sticky="w", pady=(5, 5))

    # Row 3: Max tickets per day
    ttk.Label(frm, text="Max Tickets Per Day (optional):").grid(row=3, column=0, sticky="w", pady=(5, 5))
    max_tickets_entry = ttk.Entry(frm, textvariable=max_tickets_var, width=15)
    max_tickets_entry.grid(row=3, column=1, sticky="w", padx=6, pady=(5, 5))
    ttk.Label(frm, text="Leave empty for no limit", font=("", 8)).grid(row=3, column=2, sticky="w", pady=(5, 5))

    # Row 4: Throttle
    ttk.Label(frm, text="Throttle (seconds between requests):").grid(row=4, column=0, sticky="w", pady=(5, 5))
    throttle_spin = ttk.Spinbox(frm, from_=0.0, to=5.0, increment=0.1, textvariable=throttle_var, width=10)
    throttle_spin.grid(row=4, column=1, sticky="w", padx=6, pady=(5, 5))

    # Row 5: Info
    info_text = "Will check tickets sequentially starting from 00001.\nMoves to next day after 2 consecutive missing tickets or max tickets per day (if set)."
    ttk.Label(frm, text=info_text, font=("", 8), foreground="gray").grid(row=5, column=0, columnspan=3, sticky="w", pady=(5, 10))

    # Row 6: Buttons
    button_frame = ttk.Frame(frm)
    button_frame.grid(row=6, column=0, columnspan=3, sticky="ew", pady=(0, 10))
    run_btn = ttk.Button(button_frame, text="▶ Start Scraping", command=run_sequential)
    run_btn.pack(side="left", padx=(0, 6))
    stop_btn = ttk.Button(button_frame, text="⏹ Stop", command=stop_scraping, state="disabled")
    stop_btn.pack(side="left", padx=(0, 6))
    export_btn = ttk.Button(button_frame, text="📤 Export Database", command=export_database)
    export_btn.pack(side="left")

    # Row 7: Output label
    ttk.Label(frm, text="Output:", font=("", 9, "bold")).grid(row=7, column=0, columnspan=3, sticky="w", pady=(5, 2))

    # Row 8: Output box
    output_frame = ttk.Frame(frm)
    output_frame.grid(row=8, column=0, columnspan=3, sticky="nsew")
    output_box = tk.Text(output_frame, height=20, wrap="word", state="disabled", font=("Consolas", 9))
    output_box.pack(side="left", fill="both", expand=True)
    scroll = ttk.Scrollbar(output_frame, command=output_box.yview)
    output_box.configure(yscrollcommand=scroll.set)
    scroll.pack(side="right", fill="y")

    # Grid weights
    frm.columnconfigure(2, weight=1)
    frm.rowconfigure(8, weight=1)

    # Initial message
    log("Ready to start sequential scraping.")
    log("Enter a start date and click 'Start Scraping' to begin.")
    log("")

    root.mainloop()

# ====== Entry point: GUI by default ======
if __name__ == "__main__":
    import argparse
    import sys
    parser = argparse.ArgumentParser(description="Sequential ticket scraper for California underground service alerts.")
    parser.add_argument("--csv", help="Path to CSV file with ticket numbers (legacy CSV mode).")
    parser.add_argument("--column", help="Column name containing tickets (for CSV mode).")
    parser.add_argument("--throttle", type=float, default=0.1, help="Seconds to sleep between requests (default 0.1)")
    parser.add_argument("--date", help="Start date in YYYY-MM-DD format (for sequential mode).")
    parser.add_argument("--end-date", help="End date in YYYY-MM-DD format (for sequential mode, optional).")
    parser.add_argument("--max-tickets", type=int, help="Maximum tickets to check per day (for sequential mode, optional).")
    parser.add_argument("--export", help="Export database to GeoJSON file. Specify output file path.")
    parser.add_argument("--db", default="tickets.db", help="Database file path (default: tickets.db)")
    args = parser.parse_args()

    if args.export:
        # Export mode
        export_database_to_geojson(db_path=args.db, output_path=args.export, logger=print)
    elif args.csv:
        # Legacy CSV mode
        run_scrape(args.csv, args.column, args.throttle, logger=print)
    elif args.date:
        # CLI sequential mode
        try:
            start_dt = datetime.strptime(args.date, "%Y-%m-%d").date()
            end_dt = None
            if args.end_date:
                end_dt = datetime.strptime(args.end_date, "%Y-%m-%d").date()
                if end_dt < start_dt:
                    print("❌ End date must be after start date")
                    sys.exit(1)
            max_tickets = args.max_tickets
            if max_tickets is not None and max_tickets <= 0:
                print("❌ Max tickets per day must be a positive number")
                sys.exit(1)
            run_sequential_scrape(start_dt, args.throttle, logger=print, end_date=end_dt, max_tickets_per_day=max_tickets)
        except ValueError as e:
            print(f"❌ Invalid date format. Use YYYY-MM-DD: {e}")
            sys.exit(1)
    else:
        # GUI mode (default) - try to launch GUI, fallback to CLI help if unavailable
        try:
            _launch_gui()
        except Exception as e:
            # If GUI fails (no display, tkinter not available, etc.), show help
            print("⚠️ GUI mode unavailable (no display or tkinter not installed)")
            print(f"Error: {e}")
            print("\nPlease use CLI mode with arguments:")
            print("  --date YYYY-MM-DD          Start date for sequential scraping")
            print("  --end-date YYYY-MM-DD      End date (optional)")
            print("  --max-tickets N            Max tickets per day (optional)")
            print("  --throttle SECONDS          Delay between requests (default 0.1)")
            print("  --export FILE              Export database to GeoJSON")
            print("  --db PATH                   Database file path (default: tickets.db)")
            print("\nExample:")
            print("  python3 'USAN work type.py' --date 2025-01-01 --end-date 2025-01-31")
            sys.exit(1)
