"""
DigAlert Ticket Data Fetcher - Standalone GUI
All functions included - no external imports needed (except standard library).
"""

import json
import re
import time
import sqlite3
import os
import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext
from datetime import datetime, timedelta
from typing import Optional, Tuple, List, Dict

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False
    messagebox.showerror(
        "Missing Dependency",
        "The 'requests' library is required.\n\n"
        "Install it with: pip install requests"
    )

# ====== HTTP config ======
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

GET_TICKET_API = (
    "https://newtinb.digalert.org/direct/getTicket.vjs"
    "?ticket={ticket}&revision={revision}"
)

GET_TICKET_API_ALT = (
    "https://newtinb.digalert.org/direct/getTicket.vjs"
    "?t={ticket}&r={revision}"
)

GET_TICKET_CONTACTS_API = (
    "https://newtinb.digalert.org/direct/getTicketContacts.vjs"
    "?ticket={ticket}&revision={revision}"
)

GET_TICKET_CONTACTS_API_ALT = (
    "https://newtinb.digalert.org/direct/getTicketContacts.vjs"
    "?t={ticket}&r={revision}"
)

GET_ELECTRONIC_POSITIVE_RESPONSE_API = (
    "https://newtin.digalert.org/direct/getElectronicPositiveResponse.vjs"
    "?ticket={ticket}"
)

GET_ELECTRONIC_POSITIVE_RESPONSE_API_ALT = (
    "https://newtinb.digalert.org/direct/getElectronicPositiveResponse.vjs"
    "?ticket={ticket}"
)


# ====== Core functions ======

def parse_qm_format(qm_string: str) -> Optional[List[List[float]]]:
    """Parses QM format coordinate string to list of [lon, lat] pairs."""
    if not qm_string or not qm_string.strip():
        return None
    
    parts = qm_string.split(':')
    main_part = parts[0].strip()
    values = main_part.split(',')
    
    if len(values) % 2 != 0:
        return None
    
    coords = []
    try:
        for i in range(0, len(values), 2):
            x = float(values[i].strip())
            y = float(values[i + 1].strip())
            coords.append([x, y])
        
        if coords and (coords[0] != coords[-1]):
            coords.append(coords[0])
        
        return coords if coords else None
    except (ValueError, IndexError):
        return None


def fetch_digalert_ticket(
    ticket_number: str,
    revision: str = "00A",
    session_cookies: Optional[Dict[str, str]] = None
) -> Tuple[Optional[Dict], Optional[str]]:
    """Fetches ticket data from DigAlert getTicket.vjs API."""
    if not REQUESTS_AVAILABLE:
        return None, "requests library not available"
    
    urls = [
        GET_TICKET_API.format(ticket=ticket_number, revision=revision),
        GET_TICKET_API_ALT.format(ticket=ticket_number, revision=revision),
    ]
    
    cookies = session_cookies if session_cookies else {}
    
    for url in urls:
        try:
            resp = requests.get(url, headers=HEADERS, cookies=cookies, timeout=15)
            
            if resp.status_code != 200:
                continue
            
            try:
                data = resp.json()
                if "err" in data:
                    continue
                return data, None
            except json.JSONDecodeError:
                content = resp.text
                json_match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', content, re.DOTALL)
                if json_match:
                    try:
                        data = json.loads(json_match.group(0))
                        if "err" not in data:
                            return data, None
                    except:
                        pass
                continue
                
        except requests.RequestException:
            continue
    
    return None, "Failed to fetch ticket data. May require authentication."


def fetch_digalert_ticket_contacts(
    ticket_number: str,
    revision: str = "00A",
    session_cookies: Optional[Dict[str, str]] = None
) -> Tuple[Optional[Dict], Optional[str]]:
    """Fetches ticket contacts data from DigAlert getTicketContacts.vjs API."""
    if not REQUESTS_AVAILABLE:
        return None, "requests library not available"
    
    urls = [
        GET_TICKET_CONTACTS_API.format(ticket=ticket_number, revision=revision),
        GET_TICKET_CONTACTS_API_ALT.format(ticket=ticket_number, revision=revision),
    ]
    
    cookies = session_cookies if session_cookies else {}
    
    for url in urls:
        try:
            resp = requests.get(url, headers=HEADERS, cookies=cookies, timeout=15)
            
            if resp.status_code != 200:
                continue
            
            try:
                data = resp.json()
                if "err" in data:
                    continue
                return data, None
            except json.JSONDecodeError:
                content = resp.text
                json_match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', content, re.DOTALL)
                if json_match:
                    try:
                        data = json.loads(json_match.group(0))
                        if "err" not in data:
                            return data, None
                    except:
                        pass
                continue
                
        except requests.RequestException:
            continue
    
    return None, "Failed to fetch ticket contacts data. May require authentication."


def fetch_digalert_electronic_positive_response(
    ticket_number: str,
    revision: str = "00A",
    session_cookies: Optional[Dict[str, str]] = None
) -> Tuple[Optional[Dict], Optional[str]]:
    """Fetches electronic positive response data from DigAlert getElectronicPositiveResponse.vjs API."""
    if not REQUESTS_AVAILABLE:
        return None, "requests library not available"
    
    urls = [
        GET_ELECTRONIC_POSITIVE_RESPONSE_API.format(ticket=ticket_number),
        GET_ELECTRONIC_POSITIVE_RESPONSE_API_ALT.format(ticket=ticket_number),
    ]
    
    cookies = session_cookies if session_cookies else {}
    
    for url in urls:
        try:
            resp = requests.get(url, headers=HEADERS, cookies=cookies, timeout=15)
            
            if resp.status_code != 200:
                continue
            
            try:
                data = resp.json()
                if "err" in data:
                    continue
                return data, None
            except json.JSONDecodeError:
                content = resp.text
                json_match = re.search(r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}', content, re.DOTALL)
                if json_match:
                    try:
                        data = json.loads(json_match.group(0))
                        if "err" not in data:
                            return data, None
                    except:
                        pass
                continue
                
        except requests.RequestException:
            continue
    
    return None, "Failed to fetch electronic positive response data. May require authentication."


def fetch_complete_ticket_data(
    ticket_number: str,
    revision: str = "00A",
    session_cookies: Optional[Dict[str, str]] = None
) -> Tuple[Optional[Dict], Optional[str]]:
    """
    Fetches ticket data, contacts data, and electronic positive response data, merging them into one dictionary.
    
    Returns:
        (merged_data_dict, error_message)
    """
    # Fetch ticket data
    ticket_data, error = fetch_digalert_ticket(ticket_number, revision, session_cookies)
    if error or not ticket_data:
        return ticket_data, error
    
    # Fetch contacts data
    contacts_data, contacts_error = fetch_digalert_ticket_contacts(
        ticket_number, revision, session_cookies
    )
    
    # Merge contacts data into ticket data
    if contacts_data:
        # Add contacts data under a 'contacts' key, or merge directly
        # Check if contacts_data is a list or dict
        if isinstance(contacts_data, list):
            ticket_data['contacts'] = contacts_data
        elif isinstance(contacts_data, dict):
            # Merge all contact fields into ticket_data
            for key, value in contacts_data.items():
                # Prefix with 'contact_' if key might conflict
                if key in ticket_data:
                    ticket_data[f'contact_{key}'] = value
                else:
                    ticket_data[key] = value
            # Also keep a separate contacts entry
            ticket_data['contacts_data'] = contacts_data
    else:
        # Log that contacts couldn't be fetched, but continue with ticket data
        ticket_data['contacts_fetch_error'] = contacts_error
    
    # Fetch electronic positive response data
    epr_data, epr_error = fetch_digalert_electronic_positive_response(
        ticket_number, revision, session_cookies
    )
    
    # Store electronic positive response data
    if epr_data:
        ticket_data['electronic_positive_response'] = epr_data
        # Debug: Log EPR data structure
        if isinstance(epr_data, dict) and 'data' in epr_data and 'responses' in epr_data.get('data', {}):
            responses_count = len(epr_data['data']['responses']) if isinstance(epr_data['data']['responses'], list) else 0
            print(f"✓ Fetched EPR for {ticket_number}: {responses_count} responses")
        else:
            print(f"✓ Fetched EPR for {ticket_number}: structure = {type(epr_data)}")
    else:
        # Log that EPR couldn't be fetched, but continue with ticket data
        ticket_data['electronic_positive_response_fetch_error'] = epr_error
        print(f"⚠ EPR fetch failed for {ticket_number}: {epr_error}")
    
    return ticket_data, None


def extract_polygon_from_ticket_data(ticket_data: Dict) -> Optional[List[List[float]]]:
    """Extracts polygon coordinates from DigAlert ticket data."""
    # Try work_area_shape first (QM format)
    if "work_area_shape" in ticket_data and ticket_data["work_area_shape"]:
        qm_string = ticket_data["work_area_shape"]
        coords = parse_qm_format(qm_string)
        if coords:
            return coords
    
    # Fallback to vertices array
    if "vertices" in ticket_data and isinstance(ticket_data["vertices"], list):
        coords = []
        for vertex in ticket_data["vertices"]:
            if isinstance(vertex, dict):
                lat = vertex.get("latitude") or vertex.get("lat")
                lon = vertex.get("longitude") or vertex.get("lon")
                if lat is not None and lon is not None:
                    try:
                        coords.append([float(lon), float(lat)])
                    except (ValueError, TypeError):
                        continue
            elif isinstance(vertex, (list, tuple)) and len(vertex) >= 2:
                try:
                    lat = float(vertex[0])
                    lon = float(vertex[1])
                    coords.append([lon, lat])
                except (ValueError, TypeError, IndexError):
                    continue
        
        if coords:
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            return coords
    
    return None


def build_digalert_feature(ticket_data: Dict, polygon_coords: List[List[float]]) -> Dict:
    """
    Builds a GeoJSON Feature from DigAlert ticket data.
    Includes all fields from getTicket.vjs and getTicketContacts.vjs.
    """
    # Start with core ticket properties
    properties = {
        "ticket_number": ticket_data.get("ticket", ""),
        "revision": ticket_data.get("revision", ""),
        "type": ticket_data.get("type", ""),
        "address": ticket_data.get("address1", ""),
        "city": ticket_data.get("city", ""),
        "county": ticket_data.get("county", ""),
        "state": ticket_data.get("state", ""),
        "zip": ticket_data.get("zip", ""),
        "work_type": ticket_data.get("work_type", ""),
        "caller": ticket_data.get("caller", ""),
        "caller_type": ticket_data.get("caller_type", ""),
        "caller_phone": ticket_data.get("caller_phone", ""),
        "contact": ticket_data.get("contact", ""),
        "contact_email": ticket_data.get("contact_email", ""),
        "work_date": ticket_data.get("work_date", ""),
        "expires": ticket_data.get("expires", ""),
        "area_in_sqft": ticket_data.get("area_in_sqft"),
        "area_in_miles": ticket_data.get("area_in_miles"),
        "centroid_x": ticket_data.get("centroid_x"),
        "centroid_y": ticket_data.get("centroid_y"),
    }
    
    # Add all other fields from getTicket.vjs
    # Exclude geometry-related fields that are already processed
    exclude_fields = {
        "work_area_shape", "vertices", "ticket", "revision",
        "centroid_x", "centroid_y", "area_in_sqft", "area_in_miles"
    }
    
    for key, value in ticket_data.items():
        if key not in exclude_fields and key not in properties:
            # Skip complex nested objects (we'll handle contacts and electronic_positive_response separately)
            if not isinstance(value, (dict, list)) or key in ("contacts", "electronic_positive_response"):
                properties[key] = value
    
    # Handle electronic positive response data - preserve as full object
    if "electronic_positive_response" in ticket_data:
        epr = ticket_data["electronic_positive_response"]
        properties["electronic_positive_response"] = epr
        # Debug: Verify EPR is being included
        if isinstance(epr, dict) and 'data' in epr and 'responses' in epr.get('data', {}):
            responses_count = len(epr['data']['responses']) if isinstance(epr['data']['responses'], list) else 0
            print(f"  → EPR included in feature properties: {responses_count} responses")
    
    # Handle contacts data
    if "contacts" in ticket_data and isinstance(ticket_data["contacts"], list):
        # If contacts is a list, store it as JSON string for GeoJSON compatibility
        properties["contacts"] = json.dumps(ticket_data["contacts"])
        properties["contacts_count"] = len(ticket_data["contacts"])
    elif "contacts_data" in ticket_data:
        # If contacts_data is a dict, merge its fields
        contacts_data = ticket_data["contacts_data"]
        for key, value in contacts_data.items():
            if key not in properties:
                properties[f"contact_{key}"] = value
    
    # Add contacts fetch error if present
    if "contacts_fetch_error" in ticket_data:
        properties["contacts_fetch_error"] = ticket_data["contacts_fetch_error"]
    
    # Add electronic positive response fetch error if present
    if "electronic_positive_response_fetch_error" in ticket_data:
        properties["electronic_positive_response_fetch_error"] = ticket_data["electronic_positive_response_fetch_error"]
    
    feature = {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [polygon_coords]
        },
        "properties": properties
    }
    
    return feature


# ====== SQLite Database Functions ======

def init_database(db_path: str = "digalert_tickets.db") -> sqlite3.Connection:
    """
    Initializes SQLite database with tickets table.
    Returns database connection.
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Create tickets table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_number TEXT NOT NULL,
            revision TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            geometry_json TEXT NOT NULL,
            -- Core fields
            type TEXT,
            address TEXT,
            city TEXT,
            county TEXT,
            state TEXT,
            zip TEXT,
            work_type TEXT,
            caller TEXT,
            caller_type TEXT,
            caller_phone TEXT,
            contact TEXT,
            contact_email TEXT,
            work_date TEXT,
            expires TEXT,
            area_in_sqft REAL,
            area_in_miles REAL,
            centroid_x REAL,
            centroid_y REAL,
            -- All other fields stored as JSON
            all_data_json TEXT,
            UNIQUE(ticket_number, revision)
        )
    """)
    
    # Create indexes for fast queries
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_ticket_number ON tickets(ticket_number)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_revision ON tickets(revision)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_work_date ON tickets(work_date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_city ON tickets(city)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_county ON tickets(county)")
    
    conn.commit()
    return conn


def save_ticket_to_database(
    feature: Dict,
    db_path: str = "digalert_tickets.db",
    logger=print
) -> bool:
    """
    Saves a single ticket feature to SQLite database.
    Uses INSERT OR REPLACE to update existing tickets.
    """
    try:
        conn = init_database(db_path)
        cursor = conn.cursor()
        
        props = feature.get("properties", {})
        geometry = feature.get("geometry", {})
        
        # Extract core fields
        ticket_number = props.get("ticket_number", "")
        revision = props.get("revision", "")
        
        if not ticket_number:
            logger("⚠️  Skipping ticket with no ticket_number")
            return False
        
        # Store geometry as JSON
        geometry_json = json.dumps(geometry)
        
        # Store all properties as JSON for flexible querying
        all_data_json = json.dumps(props)
        
        # Insert or replace
        cursor.execute("""
            INSERT OR REPLACE INTO tickets (
                ticket_number, revision, updated_at,
                geometry_json, type, address, city, county, state, zip,
                work_type, caller, caller_type, caller_phone,
                contact, contact_email, work_date, expires,
                area_in_sqft, area_in_miles, centroid_x, centroid_y,
                all_data_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            ticket_number,
            revision,
            datetime.now().isoformat(),
            geometry_json,
            props.get("type"),
            props.get("address"),
            props.get("city"),
            props.get("county"),
            props.get("state"),
            props.get("zip"),
            props.get("work_type"),
            props.get("caller"),
            props.get("caller_type"),
            props.get("caller_phone"),
            props.get("contact"),
            props.get("contact_email"),
            props.get("work_date"),
            props.get("expires"),
            props.get("area_in_sqft"),
            props.get("area_in_miles"),
            props.get("centroid_x"),
            props.get("centroid_y"),
            all_data_json
        ))
        
        conn.commit()
        conn.close()
        return True
        
    except Exception as e:
        logger(f"❌ Database error: {e}")
        return False


def save_tickets_to_database(
    features: List[Dict],
    db_path: str = "digalert_tickets.db",
    logger=print
) -> Tuple[int, str]:
    """
    Saves multiple tickets to database.
    Returns (count_saved, db_path)
    """
    if not features:
        logger("\n❌ No valid features to save.")
        return 0, db_path
    
    saved_count = 0
    for feature in features:
        if save_ticket_to_database(feature, db_path, logger):
            saved_count += 1
    
    logger(f"\n✅ Saved {saved_count}/{len(features)} tickets to database: {db_path}")
    return saved_count, db_path


def export_database_to_geojson(
    db_path: str = "digalert_tickets.db",
    out_path: Optional[str] = None,
    where_clause: Optional[str] = None,
    logger=print
) -> Optional[str]:
    """
    Exports tickets from database to GeoJSON for Leaflet.
    
    Args:
        db_path: Path to SQLite database
        out_path: Output GeoJSON file path (auto-generated if None)
        where_clause: Optional SQL WHERE clause (e.g., "WHERE city = 'LOS ANGELES'")
        logger: Logging function
    
    Returns:
        Path to exported GeoJSON file, or None if error
    """
    try:
        if not os.path.exists(db_path):
            logger(f"❌ Database not found: {db_path}")
            return None
        
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Build query
        query = "SELECT geometry_json, all_data_json FROM tickets"
        if where_clause:
            query += " " + where_clause
        query += " ORDER BY ticket_number, revision"
        
        cursor.execute(query)
        rows = cursor.fetchall()
        conn.close()
        
        if not rows:
            logger("⚠️  No tickets found in database")
            return None
        
        # Build GeoJSON FeatureCollection
        features = []
        for geometry_json, all_data_json in rows:
            try:
                geometry = json.loads(geometry_json)
                properties = json.loads(all_data_json)
                
                features.append({
                    "type": "Feature",
                    "geometry": geometry,
                    "properties": properties
                })
            except json.JSONDecodeError as e:
                logger(f"⚠️  Error parsing ticket data: {e}")
                continue
        
        if not features:
            logger("❌ No valid features to export")
            return None
        
        # Generate output path
        if out_path is None or not out_path.strip():
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            out_path = f"digalert_export_{ts}.geojson"
        
        # Save GeoJSON
        fc = {"type": "FeatureCollection", "features": features}
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(fc, f, indent=2)
        
        logger(f"✅ Exported {len(features)} features to: {out_path}")
        return out_path
        
    except Exception as e:
        logger(f"❌ Export error: {e}")
        return None


def get_database_stats(db_path: str = "digalert_tickets.db") -> Dict:
    """Returns statistics about the database."""
    try:
        if not os.path.exists(db_path):
            return {"error": "Database not found"}
        
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Total tickets
        cursor.execute("SELECT COUNT(*) FROM tickets")
        total = cursor.fetchone()[0]
        
        # Unique ticket numbers
        cursor.execute("SELECT COUNT(DISTINCT ticket_number) FROM tickets")
        unique_tickets = cursor.fetchone()[0]
        
        # Date range
        cursor.execute("SELECT MIN(work_date), MAX(work_date) FROM tickets WHERE work_date IS NOT NULL")
        date_range = cursor.fetchone()
        
        # Cities
        cursor.execute("SELECT COUNT(DISTINCT city) FROM tickets WHERE city IS NOT NULL")
        cities = cursor.fetchone()[0]
        
        # Counties
        cursor.execute("SELECT COUNT(DISTINCT county) FROM tickets WHERE county IS NOT NULL")
        counties = cursor.fetchone()[0]
        
        conn.close()
        
        return {
            "total_tickets": total,
            "unique_ticket_numbers": unique_tickets,
            "date_range": date_range,
            "cities": cities,
            "counties": counties
        }
    except Exception as e:
        return {"error": str(e)}


def get_recent_tickets(db_path: str = "digalert_tickets.db", limit: int = 20) -> List[Dict]:
    """
    Fetches the most recent tickets from the database.
    Returns list of ticket dictionaries with key fields.
    """
    try:
        if not os.path.exists(db_path):
            return []
        
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Get last 20 tickets ordered by updated_at (most recent first)
        cursor.execute("""
            SELECT 
                ticket_number, revision, type, address, city, county, state, zip,
                work_type, caller, contact, work_date, expires, updated_at
            FROM tickets
            ORDER BY updated_at DESC
            LIMIT ?
        """, (limit,))
        
        rows = cursor.fetchall()
        conn.close()
        
        # Convert to list of dictionaries
        tickets = []
        for row in rows:
            tickets.append({
                "ticket_number": row[0] or "",
                "revision": row[1] or "",
                "type": row[2] or "",
                "address": row[3] or "",
                "city": row[4] or "",
                "county": row[5] or "",
                "state": row[6] or "",
                "zip": row[7] or "",
                "work_type": row[8] or "",
                "caller": row[9] or "",
                "contact": row[10] or "",
                "work_date": row[11] or "",
                "expires": row[12] or "",
                "updated_at": row[13] or ""
            })
        
        return tickets
    except Exception as e:
        return []


def save_geojson(features: List[Dict], out_path: Optional[str] = None, logger=print) -> Optional[str]:
    """
    Legacy function - now saves to database instead.
    Kept for compatibility but redirects to database.
    """
    if not features:
        logger("\n❌ No valid features to save.")
        return None
    
    db_path = "digalert_tickets.db"
    saved_count, _ = save_tickets_to_database(features, db_path, logger)
    
    if saved_count > 0:
        # Also export to GeoJSON for immediate use
        return export_database_to_geojson(db_path, out_path, logger=logger)
    
    return None


# ====== Ticket Generation Functions ======

def get_julian_day(date: datetime) -> int:
    """Returns Julian day (day of year, 1-366) for a given date."""
    return date.timetuple().tm_yday


def generate_ticket_number(year: int, julian_day: int, counter: int) -> str:
    """
    Generates DigAlert ticket number.
    Format: AYYJDD0XXX
    - A = prefix letter
    - YY = 2-digit year
    - JDD = 3-digit Julian day (001-366)
    - 0 = separator
    - XXX = 3-digit counter (001-999)
    """
    yy = str(year)[-2:].zfill(2)  # Last 2 digits of year
    jdd = str(julian_day).zfill(3)  # Julian day, 3 digits
    xxx = str(counter).zfill(3)  # Counter, 3 digits
    return f"A{yy}{jdd}0{xxx}"


def generate_tickets_for_date_range(
    start_date: datetime,
    end_date: datetime,
    counter_start: int = 1,
    counter_end: int = 999
) -> List[str]:
    """
    Generates all ticket numbers for a date range.
    
    Args:
        start_date: Start date (inclusive)
        end_date: End date (inclusive)
        counter_start: Starting counter (default: 1)
        counter_end: Ending counter (default: 999)
    
    Returns:
        List of ticket numbers
    """
    tickets = []
    current_date = start_date
    
    while current_date <= end_date:
        year = current_date.year
        julian_day = get_julian_day(current_date)
        
        for counter in range(counter_start, counter_end + 1):
            ticket = generate_ticket_number(year, julian_day, counter)
            tickets.append(ticket)
        
        current_date += timedelta(days=1)
    
    return tickets


def batch_fetch_tickets(
    tickets: List[str],
    revision: str = "00A",
    session_cookies: Optional[Dict[str, str]] = None,
    throttle_sec: float = 0.5,
    db_path: str = "digalert_tickets.db",
    logger=print
) -> Tuple[int, int, int]:
    """
    Fetches multiple tickets and saves them to database immediately.
    
    Returns:
        (successful_count, no_polygon_count, failed_count)
    """
    total = len(tickets)
    successful = 0
    failed = 0
    no_polygon = 0
    
    logger(f"Processing {total} tickets...")
    logger(f"Throttle: {throttle_sec} seconds between requests")
    logger(f"Saving to database: {db_path}")
    logger("")
    
    for i, ticket in enumerate(tickets, 1):
        logger(f"[{i}/{total}] {ticket}...")
        
        ticket_data, error = fetch_complete_ticket_data(
            ticket, revision, session_cookies=session_cookies
        )
        
        if error or not ticket_data:
            logger(f"   ❌ Failed: {error or 'Unknown error'}")
            failed += 1
            time.sleep(throttle_sec)
            continue
        
        polygon_coords = extract_polygon_from_ticket_data(ticket_data)
        
        if polygon_coords:
            feature = build_digalert_feature(ticket_data, polygon_coords)
            # Save immediately to database
            if save_ticket_to_database(feature, db_path, lambda msg: None):  # Silent logger for individual saves
                successful += 1
                logger(f"   ✅ Success ({len(polygon_coords)} coords) - Saved to DB")
            else:
                failed += 1
                logger(f"   ⚠️  Failed to save to database")
        else:
            no_polygon += 1
            logger(f"   ⚠️  No polygon data")
        
        time.sleep(throttle_sec)
    
    logger("")
    logger("=" * 70)
    logger("BATCH PROCESSING COMPLETE")
    logger("=" * 70)
    logger(f"Total tickets: {total}")
    logger(f"✅ Successful: {successful}")
    logger(f"⚠️  No polygon: {no_polygon}")
    logger(f"❌ Failed: {failed}")
    logger("=" * 70)
    
    return successful, no_polygon, failed


# ====== GUI ======

def launch_gui():
    if not REQUESTS_AVAILABLE:
        return
    
    root = tk.Tk()
    root.title("DigAlert Ticket Data Fetcher")
    root.geometry("1000x750")

    # Create notebook for tabs
    notebook = ttk.Notebook(root)
    notebook.pack(fill="both", expand=True, padx=10, pady=10)

    # Shared output box (will be created in each tab)
    shared_output = None

    # ====== TAB 1: Single Ticket ======
    single_frame = ttk.Frame(notebook, padding=10)
    notebook.add(single_frame, text="Single Ticket")

    ticket_var = tk.StringVar()
    revision_var = tk.StringVar(value="00A")
    outfile_var = tk.StringVar()

    title_label = ttk.Label(
        single_frame, text="Single Ticket Fetcher", font=("Arial", 14, "bold")
    )
    title_label.grid(row=0, column=0, columnspan=4, pady=(0, 15))

    ttk.Label(single_frame, text="Ticket Number:").grid(row=1, column=0, sticky="w", pady=5)
    ticket_entry = ttk.Entry(single_frame, textvariable=ticket_var, width=20)
    ticket_entry.grid(row=1, column=1, sticky="w", pady=5, padx=(5, 0))

    ttk.Label(single_frame, text="Revision:").grid(row=1, column=2, sticky="w", pady=5, padx=(20, 0))
    revision_entry = ttk.Entry(single_frame, textvariable=revision_var, width=10)
    revision_entry.grid(row=1, column=3, sticky="w", pady=5, padx=(5, 0))

    ttk.Label(single_frame, text="Session Cookies (optional, JSON format):").grid(
        row=2, column=0, columnspan=4, sticky="w", pady=(15, 5)
    )
    cookies_text_single = scrolledtext.ScrolledText(single_frame, height=4, wrap="word", width=80)
    cookies_text_single.grid(row=3, column=0, columnspan=4, sticky="ew", pady=(0, 10))
    cookies_text_single.insert("1.0", '{"cookie_name": "cookie_value"}')

    ttk.Label(
        single_frame,
        text="Example: {\"session_id\": \"abc123\", \"auth_token\": \"xyz789\"}",
        font=("Arial", 8),
        foreground="gray"
    ).grid(row=4, column=0, columnspan=4, sticky="w", pady=(0, 10))

    ttk.Label(single_frame, text="Database:").grid(
        row=5, column=0, sticky="w", pady=5
    )
    db_path_label = ttk.Label(single_frame, text="digalert_tickets.db", foreground="blue")
    db_path_label.grid(row=5, column=1, columnspan=3, sticky="w", pady=5, padx=(5, 0))
    
    ttk.Label(single_frame, text="Export GeoJSON (optional):").grid(
        row=6, column=0, sticky="w", pady=5
    )
    outfile_entry = ttk.Entry(single_frame, textvariable=outfile_var, width=50)
    outfile_entry.grid(row=6, column=1, columnspan=3, sticky="ew", pady=5, padx=(5, 0))

    fetch_btn = ttk.Button(single_frame, text="Fetch & Save to Database", width=30)
    fetch_btn.grid(row=7, column=0, columnspan=4, pady=(15, 10))
    
    # Export button
    export_btn = ttk.Button(single_frame, text="Export Database to GeoJSON", width=30)
    export_btn.grid(row=8, column=0, columnspan=4, pady=(5, 10))

    ttk.Label(single_frame, text="Results:").grid(
        row=9, column=0, columnspan=4, sticky="w", pady=(10, 5)
    )
    output_box_single = scrolledtext.ScrolledText(single_frame, height=16, wrap="word", state="disabled")
    output_box_single.grid(row=10, column=0, columnspan=4, sticky="nsew", pady=(0, 10))

    single_frame.columnconfigure(1, weight=1)
    single_frame.rowconfigure(10, weight=1)
    
    def on_export():
        db_path = "digalert_tickets.db"
        if not os.path.exists(db_path):
            messagebox.showerror("Error", f"Database not found: {db_path}")
            return
        
        # Show export dialog
        from tkinter import filedialog
        filename = filedialog.asksaveasfilename(
            defaultextension=".geojson",
            filetypes=[("GeoJSON files", "*.geojson"), ("All files", "*.*")],
            initialfile=f"digalert_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.geojson"
        )
        
        if filename:
            log_single("💾 Exporting database to GeoJSON...")
            result = export_database_to_geojson(db_path, filename, logger=log_single)
            if result:
                messagebox.showinfo("Success", f"Exported to:\n{result}")
            else:
                messagebox.showerror("Error", "Export failed")
    
    export_btn.configure(command=on_export)

    def log_single(msg: str):
        output_box_single.configure(state="normal")
        output_box_single.insert("end", msg + "\n")
        output_box_single.see("end")
        output_box_single.configure(state="disabled")
        root.update_idletasks()

    def on_fetch():
        ticket = ticket_var.get().strip().upper()
        revision = revision_var.get().strip().upper() or "00A"
        cookies_text_content = cookies_text_single.get("1.0", "end").strip()
        out_path = outfile_var.get().strip() or None

        if not ticket:
            messagebox.showerror("Error", "Please enter a ticket number.")
            return

        session_cookies = None
        if cookies_text_content and cookies_text_content != '{"cookie_name": "cookie_value"}':
            try:
                session_cookies = json.loads(cookies_text_content)
                if not isinstance(session_cookies, dict):
                    raise ValueError("Cookies must be a JSON object")
            except json.JSONDecodeError as e:
                messagebox.showerror("Error", f"Invalid JSON format for cookies:\n{e}")
                return
            except Exception as e:
                messagebox.showerror("Error", f"Error parsing cookies:\n{e}")
                return

        output_box_single.configure(state="normal")
        output_box_single.delete("1.0", "end")
        output_box_single.configure(state="disabled")

        fetch_btn.configure(state="disabled")
        log_single("=" * 70)
        log_single(f"Fetching ticket: {ticket} (revision: {revision})")
        if session_cookies:
            log_single("Using session cookies for authentication")
        else:
            log_single("⚠️  No session cookies - request may fail if authentication required")
        log_single("=" * 70)
        log_single("")

        try:
            log_single("📥 Fetching ticket data from API...")
            log_single("   - getTicket.vjs")
            ticket_data, error = fetch_complete_ticket_data(
                ticket, revision, session_cookies=session_cookies
            )
            
            if not error and ticket_data:
                log_single("   - getTicketContacts.vjs")
                if "contacts_fetch_error" in ticket_data:
                    log_single(f"      ⚠️  Contacts fetch failed: {ticket_data['contacts_fetch_error']}")
                elif "contacts" in ticket_data or "contacts_data" in ticket_data:
                    log_single("      ✅ Contacts data fetched")

            if error:
                log_single(f"❌ Error: {error}")
                log_single("")
                log_single("💡 Tips:")
                log_single("  - The API requires authentication (session cookies)")
                log_single("  - Get cookies from browser DevTools → Application → Cookies")
                log_single("  - Format: {\"cookie_name\": \"cookie_value\", ...}")
                messagebox.showerror("Error", error)
                return

            if not ticket_data:
                log_single("❌ No data returned from API")
                messagebox.showerror("Error", "No data returned from API")
                return

            log_single("✅ Successfully fetched ticket data")
            log_single("")

            log_single("📋 Ticket Information:")
            log_single(f"   Ticket: {ticket_data.get('ticket', 'N/A')}")
            log_single(f"   Revision: {ticket_data.get('revision', 'N/A')}")
            log_single(f"   Type: {ticket_data.get('type', 'N/A')}")
            log_single(f"   Address: {ticket_data.get('address1', 'N/A')}")
            log_single(f"   City: {ticket_data.get('city', 'N/A')}, {ticket_data.get('state', 'N/A')} {ticket_data.get('zip', 'N/A')}")
            log_single(f"   County: {ticket_data.get('county', 'N/A')}")
            log_single(f"   Work Type: {ticket_data.get('work_type', 'N/A')}")
            log_single(f"   Caller: {ticket_data.get('caller', 'N/A')}")
            log_single(f"   Contact: {ticket_data.get('contact', 'N/A')}")
            log_single(f"   Work Date: {ticket_data.get('work_date', 'N/A')}")
            log_single(f"   Expires: {ticket_data.get('expires', 'N/A')}")
            
            # Show contacts info if available
            if "contacts" in ticket_data:
                contacts_count = ticket_data.get("contacts_count", len(ticket_data["contacts"]) if isinstance(ticket_data.get("contacts"), list) else 0)
                log_single(f"   Contacts: {contacts_count} contact(s) found")
            elif "contacts_data" in ticket_data:
                log_single("   Contacts: Contact data merged into ticket")
            
            log_single("")
            log_single(f"   Total fields parsed: {len(ticket_data)}")
            log_single("")
            log_single("📊 All Fields from getTicket.vjs and getTicketContacts.vjs:")
            log_single("   (All fields are included in the GeoJSON properties)")
            # Show sample of field names
            field_names = sorted([k for k in ticket_data.keys() if k not in ["work_area_shape", "vertices"]])
            for i, field in enumerate(field_names[:30]):  # Show first 30
                log_single(f"   - {field}")
            if len(field_names) > 30:
                log_single(f"   ... and {len(field_names) - 30} more fields")
            log_single("")

            log_single("🔍 Extracting polygon coordinates...")
            polygon_coords = extract_polygon_from_ticket_data(ticket_data)

            if not polygon_coords:
                log_single("⚠️  No polygon data found")
                log_single("")
                log_single("Available fields in response:")
                for key in sorted(ticket_data.keys())[:20]:
                    log_single(f"   - {key}")
                if len(ticket_data) > 20:
                    log_single(f"   ... and {len(ticket_data) - 20} more fields")
                messagebox.showwarning(
                    "Warning", "Ticket data fetched but no polygon coordinates found."
                )
                return

            log_single(f"✅ Found polygon with {len(polygon_coords)} coordinate pairs")
            log_single(f"   First point: {polygon_coords[0]}")
            log_single(f"   Last point: {polygon_coords[-1]}")
            log_single("")

            log_single("📦 Building GeoJSON feature...")
            feature = build_digalert_feature(ticket_data, polygon_coords)
            log_single("✅ Feature created")
            log_single("")

            log_single("💾 Saving to database...")
            db_path = "digalert_tickets.db"
            success = save_ticket_to_database(feature, db_path, log_single)
            
            if success:
                log_single("")
                log_single("=" * 70)
                log_single("✅ SUCCESS!")
                log_single(f"   Saved to database: {db_path}")
                
                # Export to GeoJSON if path provided
                if out_path:
                    log_single("")
                    log_single("💾 Exporting to GeoJSON...")
                    geojson_path = export_database_to_geojson(
                        db_path, out_path, 
                        where_clause=f"WHERE ticket_number = '{ticket}' AND revision = '{revision}'",
                        logger=log_single
                    )
                    if geojson_path:
                        log_single(f"   Exported to: {geojson_path}")
                
                log_single("=" * 70)
                
                # Show database stats
                stats = get_database_stats(db_path)
                if "error" not in stats:
                    log_single("")
                    log_single("📊 Database Statistics:")
                    log_single(f"   Total tickets: {stats.get('total_tickets', 0)}")
                    log_single(f"   Unique tickets: {stats.get('unique_ticket_numbers', 0)}")
                    log_single(f"   Cities: {stats.get('cities', 0)}")
                    log_single(f"   Counties: {stats.get('counties', 0)}")
                
                messagebox.showinfo("Success", f"Ticket saved to database:\n{db_path}")
            else:
                log_single("⚠️  Failed to save to database")
                messagebox.showwarning("Warning", "Failed to save to database")

        except Exception as e:
            log_single(f"💥 Unexpected error: {e}")
            import traceback
            log_single(traceback.format_exc())
            messagebox.showerror("Error", f"Unexpected error:\n{e}")
        finally:
            fetch_btn.configure(state="normal")

    fetch_btn.configure(command=on_fetch)
    ticket_entry.focus()

    # ====== TAB 2: Batch Processing ======
    batch_frame = ttk.Frame(notebook, padding=10)
    notebook.add(batch_frame, text="Batch Processing")

    batch_title = ttk.Label(
        batch_frame, text="Automated Batch Scraper", font=("Arial", 14, "bold")
    )
    batch_title.grid(row=0, column=0, columnspan=4, pady=(0, 15))

    # Date range
    ttk.Label(batch_frame, text="Start Date (YYYY-MM-DD):").grid(row=1, column=0, sticky="w", pady=5)
    start_date_var = tk.StringVar()
    start_date_entry = ttk.Entry(batch_frame, textvariable=start_date_var, width=15)
    start_date_entry.grid(row=1, column=1, sticky="w", pady=5, padx=(5, 0))
    start_date_entry.insert(0, datetime.now().strftime("%Y-%m-%d"))

    ttk.Label(batch_frame, text="End Date (YYYY-MM-DD):").grid(row=1, column=2, sticky="w", pady=5, padx=(20, 0))
    end_date_var = tk.StringVar()
    end_date_entry = ttk.Entry(batch_frame, textvariable=end_date_var, width=15)
    end_date_entry.grid(row=1, column=3, sticky="w", pady=5, padx=(5, 0))
    end_date_entry.insert(0, datetime.now().strftime("%Y-%m-%d"))

    # Counter range
    ttk.Label(batch_frame, text="Counter Start:").grid(row=2, column=0, sticky="w", pady=5)
    counter_start_var = tk.StringVar(value="1")
    counter_start_entry = ttk.Entry(batch_frame, textvariable=counter_start_var, width=10)
    counter_start_entry.grid(row=2, column=1, sticky="w", pady=5, padx=(5, 0))

    ttk.Label(batch_frame, text="Counter End:").grid(row=2, column=2, sticky="w", pady=5, padx=(20, 0))
    counter_end_var = tk.StringVar(value="999")
    counter_end_entry = ttk.Entry(batch_frame, textvariable=counter_end_var, width=10)
    counter_end_entry.grid(row=2, column=3, sticky="w", pady=5, padx=(5, 0))

    # Revision
    ttk.Label(batch_frame, text="Revision:").grid(row=3, column=0, sticky="w", pady=5)
    batch_revision_var = tk.StringVar(value="00A")
    batch_revision_entry = ttk.Entry(batch_frame, textvariable=batch_revision_var, width=10)
    batch_revision_entry.grid(row=3, column=1, sticky="w", pady=5, padx=(5, 0))

    # Throttle
    ttk.Label(batch_frame, text="Throttle (seconds):").grid(row=3, column=2, sticky="w", pady=5, padx=(20, 0))
    throttle_var = tk.StringVar(value="0.5")
    throttle_entry = ttk.Entry(batch_frame, textvariable=throttle_var, width=10)
    throttle_entry.grid(row=3, column=3, sticky="w", pady=5, padx=(5, 0))

    # Cookies
    ttk.Label(batch_frame, text="Session Cookies (optional, JSON format):").grid(
        row=4, column=0, columnspan=4, sticky="w", pady=(15, 5)
    )
    cookies_text_batch = scrolledtext.ScrolledText(batch_frame, height=3, wrap="word", width=80)
    cookies_text_batch.grid(row=5, column=0, columnspan=4, sticky="ew", pady=(0, 10))
    cookies_text_batch.insert("1.0", '{"cookie_name": "cookie_value"}')

    # Database info
    ttk.Label(batch_frame, text="Database:").grid(row=6, column=0, sticky="w", pady=5)
    batch_db_label = ttk.Label(batch_frame, text="digalert_tickets.db", foreground="blue")
    batch_db_label.grid(row=6, column=1, columnspan=3, sticky="w", pady=5, padx=(5, 0))
    
    # Output file (optional export)
    ttk.Label(batch_frame, text="Export GeoJSON (optional):").grid(row=7, column=0, sticky="w", pady=5)
    batch_outfile_var = tk.StringVar()
    batch_outfile_entry = ttk.Entry(batch_frame, textvariable=batch_outfile_var, width=50)
    batch_outfile_entry.grid(row=7, column=1, columnspan=3, sticky="ew", pady=5, padx=(5, 0))

    # Batch fetch button
    batch_fetch_btn = ttk.Button(batch_frame, text="Start Batch Processing", width=30)
    batch_fetch_btn.grid(row=8, column=0, columnspan=4, pady=(15, 10))
    
    # Export button
    batch_export_btn = ttk.Button(batch_frame, text="Export Database to GeoJSON", width=30)
    batch_export_btn.grid(row=9, column=0, columnspan=4, pady=(5, 10))

    # Output
    ttk.Label(batch_frame, text="Results:").grid(row=10, column=0, columnspan=4, sticky="w", pady=(10, 5))
    output_box_batch = scrolledtext.ScrolledText(batch_frame, height=16, wrap="word", state="disabled")
    output_box_batch.grid(row=11, column=0, columnspan=4, sticky="nsew", pady=(0, 10))

    batch_frame.columnconfigure(1, weight=1)
    batch_frame.rowconfigure(11, weight=1)
    
    def on_batch_export():
        db_path = "digalert_tickets.db"
        if not os.path.exists(db_path):
            messagebox.showerror("Error", f"Database not found: {db_path}")
            return
        
        from tkinter import filedialog
        filename = filedialog.asksaveasfilename(
            defaultextension=".geojson",
            filetypes=[("GeoJSON files", "*.geojson"), ("All files", "*.*")],
            initialfile=f"digalert_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.geojson"
        )
        
        if filename:
            log_batch("💾 Exporting database to GeoJSON...")
            result = export_database_to_geojson(db_path, filename, logger=log_batch)
            if result:
                messagebox.showinfo("Success", f"Exported to:\n{result}")
            else:
                messagebox.showerror("Error", "Export failed")
    
    batch_export_btn.configure(command=on_batch_export)

    def log_batch(msg: str):
        output_box_batch.configure(state="normal")
        output_box_batch.insert("end", msg + "\n")
        output_box_batch.see("end")
        output_box_batch.configure(state="disabled")
        root.update_idletasks()

    def on_batch_fetch():
        try:
            start_date_str = start_date_var.get().strip()
            end_date_str = end_date_var.get().strip()
            counter_start = int(counter_start_var.get().strip() or "1")
            counter_end = int(counter_end_var.get().strip() or "999")
            revision = batch_revision_var.get().strip().upper() or "00A"
            throttle = float(throttle_var.get().strip() or "0.5")
            out_path = batch_outfile_var.get().strip() or None
            cookies_text_content = cookies_text_batch.get("1.0", "end").strip()

            # Parse dates
            start_date = datetime.strptime(start_date_str, "%Y-%m-%d")
            end_date = datetime.strptime(end_date_str, "%Y-%m-%d")

            if start_date > end_date:
                messagebox.showerror("Error", "Start date must be before end date")
                return

            if counter_start < 1 or counter_end > 999 or counter_start > counter_end:
                messagebox.showerror("Error", "Counter range must be 1-999 and start <= end")
                return

            # Parse cookies
            session_cookies = None
            if cookies_text_content and cookies_text_content != '{"cookie_name": "cookie_value"}':
                try:
                    session_cookies = json.loads(cookies_text_content)
                    if not isinstance(session_cookies, dict):
                        raise ValueError("Cookies must be a JSON object")
                except Exception as e:
                    messagebox.showerror("Error", f"Invalid cookies format:\n{e}")
                    return

            # Generate tickets
            output_box_batch.configure(state="normal")
            output_box_batch.delete("1.0", "end")
            output_box_batch.configure(state="disabled")

            log_batch("=" * 70)
            log_batch("BATCH PROCESSING")
            log_batch("=" * 70)
            log_batch(f"Date Range: {start_date_str} to {end_date_str}")
            log_batch(f"Counter Range: {counter_start} to {counter_end}")
            log_batch(f"Revision: {revision}")
            log_batch(f"Throttle: {throttle} seconds")
            log_batch("")
            log_batch("Generating ticket numbers...")

            tickets = generate_tickets_for_date_range(
                start_date, end_date, counter_start, counter_end
            )

            log_batch(f"✅ Generated {len(tickets)} ticket numbers")
            log_batch(f"   Example: {tickets[0] if tickets else 'N/A'}")
            log_batch("")

            if len(tickets) > 1000:
                response = messagebox.askyesno(
                    "Warning",
                    f"This will process {len(tickets)} tickets.\n"
                    f"Estimated time: ~{len(tickets) * throttle / 60:.1f} minutes\n\n"
                    "Continue?"
                )
                if not response:
                    return

            batch_fetch_btn.configure(state="disabled")

            # Process tickets (saves to database immediately)
            db_path = "digalert_tickets.db"
            successful, no_polygon, failed = batch_fetch_tickets(
                tickets, revision, session_cookies, throttle, db_path, log_batch
            )

            # Show stats
            saved_count = successful  # Number of tickets successfully saved
            if saved_count > 0:
                stats = get_database_stats(db_path)
                if "error" not in stats:
                    log_batch("")
                    log_batch("📊 Database Statistics:")
                    log_batch(f"   Total tickets: {stats.get('total_tickets', 0)}")
                    log_batch(f"   Unique tickets: {stats.get('unique_ticket_numbers', 0)}")
                    
                    # Export to GeoJSON if path provided
                    if out_path:
                        log_batch("")
                        log_batch("💾 Exporting to GeoJSON...")
                        geojson_path = export_database_to_geojson(db_path, out_path, logger=log_batch)
                        if geojson_path:
                            messagebox.showinfo(
                                "Success",
                                f"Batch processing complete!\n\n"
                                f"Saved {saved_count} tickets to database:\n{db_path}\n\n"
                                f"Exported to GeoJSON:\n{geojson_path}"
                            )
                        else:
                            messagebox.showinfo(
                                "Success",
                                f"Batch processing complete!\n\n"
                                f"Saved {saved_count} tickets to database:\n{db_path}"
                            )
                    else:
                        messagebox.showinfo(
                            "Success",
                            f"Batch processing complete!\n\n"
                            f"Saved {saved_count} tickets to database:\n{db_path}\n\n"
                            f"Use 'Export Database to GeoJSON' button to export."
                        )
                else:
                    messagebox.showwarning("Warning", "Features processed but database save failed")
            else:
                messagebox.showwarning("Warning", "No features were successfully processed")

        except ValueError as e:
            messagebox.showerror("Error", f"Invalid input:\n{e}")
        except Exception as e:
            log_batch(f"💥 Error: {e}")
            import traceback
            log_batch(traceback.format_exc())
            messagebox.showerror("Error", f"Unexpected error:\n{e}")
        finally:
            batch_fetch_btn.configure(state="normal")

    batch_fetch_btn.configure(command=on_batch_fetch)

    # ====== TAB 3: Recent Tickets View ======
    recent_frame = ttk.Frame(notebook, padding=10)
    notebook.add(recent_frame, text="Recent Tickets")

    recent_title = ttk.Label(
        recent_frame, text="Last 20 Tickets", font=("Arial", 14, "bold")
    )
    recent_title.grid(row=0, column=0, columnspan=2, pady=(0, 15))

    # Refresh button
    refresh_btn = ttk.Button(recent_frame, text="Refresh", width=15)
    refresh_btn.grid(row=0, column=2, sticky="e", pady=(0, 15))

    # Create Treeview for table
    columns = ("Ticket", "Revision", "Type", "County", "City", "Address", "Work Type", "Caller", "Work Date", "Expires")
    tree = ttk.Treeview(recent_frame, columns=columns, show="headings", height=20)
    
    # Configure column headings and widths
    tree.heading("Ticket", text="Ticket")
    tree.heading("Revision", text="Rev")
    tree.heading("Type", text="Type")
    tree.heading("County", text="County")
    tree.heading("City", text="City")
    tree.heading("Address", text="Address")
    tree.heading("Work Type", text="Work Type")
    tree.heading("Caller", text="Caller")
    tree.heading("Work Date", text="Work Date")
    tree.heading("Expires", text="Expires")
    
    # Set column widths
    tree.column("Ticket", width=100, anchor="center")
    tree.column("Revision", width=50, anchor="center")
    tree.column("Type", width=60, anchor="center")
    tree.column("County", width=120, anchor="w")
    tree.column("City", width=120, anchor="w")
    tree.column("Address", width=200, anchor="w")
    tree.column("Work Type", width=150, anchor="w")
    tree.column("Caller", width=150, anchor="w")
    tree.column("Work Date", width=120, anchor="center")
    tree.column("Expires", width=120, anchor="center")
    
    # Scrollbars
    v_scrollbar = ttk.Scrollbar(recent_frame, orient="vertical", command=tree.yview)
    h_scrollbar = ttk.Scrollbar(recent_frame, orient="horizontal", command=tree.xview)
    tree.configure(yscrollcommand=v_scrollbar.set, xscrollcommand=h_scrollbar.set)
    
    # Grid layout
    tree.grid(row=1, column=0, columnspan=3, sticky="nsew")
    v_scrollbar.grid(row=1, column=3, sticky="ns")
    h_scrollbar.grid(row=2, column=0, columnspan=3, sticky="ew")
    
    recent_frame.columnconfigure(0, weight=1)
    recent_frame.rowconfigure(1, weight=1)

    def load_recent_tickets():
        """Loads and displays the last 20 tickets from database."""
        # Clear existing items
        for item in tree.get_children():
            tree.delete(item)
        
        tickets = get_recent_tickets("digalert_tickets.db", limit=20)
        
        if not tickets:
            tree.insert("", "end", values=("No tickets found", "", "", "", "", "", "", "", "", ""))
            return
        
        # Format dates for display
        for ticket in tickets:
            work_date = ticket.get("work_date", "")
            if work_date:
                try:
                    # Parse ISO format and format for display
                    dt = datetime.fromisoformat(work_date.replace("Z", "+00:00"))
                    work_date = dt.strftime("%Y-%m-%d %H:%M")
                except:
                    pass
            
            expires = ticket.get("expires", "")
            if expires:
                try:
                    dt = datetime.fromisoformat(expires.replace("Z", "+00:00"))
                    expires = dt.strftime("%Y-%m-%d %H:%M")
                except:
                    pass
            
            # Insert row
            tree.insert("", "end", values=(
                ticket.get("ticket_number", ""),
                ticket.get("revision", ""),
                ticket.get("type", ""),
                ticket.get("county", ""),
                ticket.get("city", ""),
                ticket.get("address", ""),
                ticket.get("work_type", ""),
                ticket.get("caller", ""),
                work_date,
                expires
            ))
    
    def on_refresh():
        """Refresh the tickets table."""
        load_recent_tickets()
        messagebox.showinfo("Refreshed", "Ticket list refreshed")
    
    refresh_btn.configure(command=on_refresh)
    
    # Load tickets on tab creation
    load_recent_tickets()

    root.mainloop()


if __name__ == "__main__":
    launch_gui()

