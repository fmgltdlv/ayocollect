# Ticket Scraper Instructions

This document provides instructions for using the ticket scraper tools, including how to start scrapes between dates, query the database directly, and query by polygon/bounding box.

## Table of Contents

1. [System Selection (CA vs NV)](#system-selection-ca-vs-nv)
2. [Starting a Scrape Between Dates](#starting-a-scrape-between-dates)
3. [Using Shell Scripts](#using-shell-scripts)
4. [Querying the Database Directly in Terminal](#querying-the-database-directly-in-terminal)
5. [Querying by Polygon/Bounding Box](#querying-by-polygonbounding-box)
6. [Working with GCP VM](#working-with-gcp-vm)

---

## System Selection (CA vs NV)

The scraper supports two underground service alert systems:

- **CA (California)**: Default system, uses `appsca.undergroundservicealert.org`
- **NV (Nevada)**: Uses `appsnv.undergroundservicealert.org`

### Selecting the System

**In CLI mode:**
```bash
# Use California (default)
python3 "USAN work type.py" --date 2024-01-01

# Use Nevada
python3 "USAN work type.py" --date 2024-01-01 --system NV
```

**In GUI mode:**
- Select the system from the dropdown menu at the top of the interface
- Options: "CA" (California) or "NV" (Nevada)
- Default is "CA"

**In shell scripts:**
```bash
# California (default)
./quick_start.sh --start-date 2024-01-01 --system CA

# Nevada
./quick_start.sh --start-date 2024-01-01 --system NV
```

**Note:** The system selection determines which API endpoints are used. Make sure to use the correct system for the tickets you want to scrape.

---

## Starting a Scrape Between Dates

The scraper can collect tickets sequentially by date range. Ticket numbers follow the format `YYYYMMDDXXXXX` (year, month, day, 5-digit sequence).

The scraper supports both **California (CA)** and **Nevada (NV)** underground service alert systems. Use the `--system` parameter to select which system to use.

### Method 1: Using Python Script Directly

**Basic usage with start date only (defaults to CA):**
```bash
python3 "USAN work type.py" --date 2024-01-01
```

**With end date:**
```bash
python3 "USAN work type.py" --date 2024-01-01 --end-date 2024-01-31
```

**Using Nevada system:**
```bash
python3 "USAN work type.py" --date 2024-01-01 --end-date 2024-01-31 --system NV
```

**With all optional parameters:**
```bash
python3 "USAN work type.py" --date 2024-01-01 --end-date 2024-01-31 --max-tickets 1000 --throttle 0.1 --system CA
```

**Parameters:**
- `--date YYYY-MM-DD` (required): Start date for scraping
- `--end-date YYYY-MM-DD` (optional): End date - scraper will stop when this date is reached
- `--max-tickets N` (optional): Maximum number of tickets to check per day
- `--throttle SECONDS` (optional, default: 0.1): Seconds to wait between requests
- `--db PATH` (optional, default: tickets.db): Path to database file
- `--system CA|NV` (optional, default: CA): System to use - CA for California or NV for Nevada

### Method 2: Using Quick Start Script (Linux/Mac)

**Basic usage (defaults to CA):**
```bash
./quick_start.sh --start-date 2024-01-01 --end-date 2024-01-31
```

**Using Nevada system:**
```bash
./quick_start.sh --start-date 2024-01-01 --end-date 2024-01-31 --system NV
```

**With all options:**
```bash
./quick_start.sh --start-date 2024-01-01 --end-date 2024-01-31 --max-tickets 1000 --throttle 0.1 --system CA
```

**Note:** Make sure the script is executable:
```bash
chmod +x quick_start.sh
```

### How It Works

- The scraper starts from the start date and sequentially checks ticket numbers
- It moves to the next day after 2 consecutive missing tickets or when `max-tickets` is reached
- If an end date is provided, it stops when that date is reached
- Tickets are automatically saved to the database every 100 tickets
- The default database file is `tickets.db` in the current directory

---

## Using Shell Scripts

The project includes several shell scripts to simplify running the scraper in different environments.

### `run_scraper.sh` - Basic Wrapper Script

This script activates the virtual environment and runs the Python scraper, passing through all arguments.

**Usage:**
```bash
./run_scraper.sh --date 2024-01-01 --end-date 2024-01-31
```

**Using Nevada system:**
```bash
./run_scraper.sh --date 2024-01-01 --end-date 2024-01-31 --system NV
```

**What it does:**
- Changes to the script directory
- Activates the virtual environment (`venv/bin/activate`)
- Runs the Python scraper with all provided arguments (including `--system`)

**Make it executable:**
```bash
chmod +x run_scraper.sh
```

**Example with all options:**
```bash
./run_scraper.sh --date 2024-01-01 --end-date 2024-01-31 --max-tickets 1000 --throttle 0.1 --system CA
```

### `run_background.sh` - Run in Background

This script runs the scraper in the background using `nohup`, so it continues running even if you disconnect from SSH.

**Usage:**
```bash
./run_background.sh --date 2024-01-01 --end-date 2024-01-31
```

**What it does:**
- Runs `run_scraper.sh` in the background using `nohup`
- Creates a timestamped log file (e.g., `scraper_20240101_120000.log`)
- Saves the process ID to `scraper.pid` for easy reference
- Displays instructions for monitoring and stopping the scraper

**Monitor progress:**
```bash
tail -f scraper_20240101_120000.log
```

**Check if scraper is running:**
```bash
# Using the saved PID
ps aux | grep $(cat scraper.pid)

# Or search for the process
ps aux | grep "USAN work type.py"
```

**Stop the scraper:**
```bash
kill $(cat scraper.pid)
```

Or if you know the PID:
```bash
kill <PID>
```

**Make it executable:**
```bash
chmod +x run_background.sh
```

### `run_headless.sh` - Run Without Display

This script runs the scraper in headless mode, useful for servers without a GUI. It automatically uses `xvfb` (X Virtual Framebuffer) if no display is available.

**Usage:**
```bash
./run_headless.sh --date 2024-01-01 --end-date 2024-01-31
```

**What it does:**
- Checks if a virtual environment exists and uses it, otherwise uses system Python
- Detects if a display is available
- If no display, automatically uses `xvfb-run` to create a virtual display
- Installs `xvfb` if not already installed (requires sudo)
- **Runs in the FOREGROUND** (blocks your terminal until complete)

**Make it executable:**
```bash
chmod +x run_headless.sh
```

**Note:** On first run without a display, the script may prompt for sudo password to install `xvfb`.

### Key Differences: `run_headless.sh` vs `run_background.sh`

These scripts solve **different problems**:

| Feature | `run_headless.sh` | `run_background.sh` |
|---------|-------------------|---------------------|
| **Problem it solves** | No display/GUI available | Process needs to survive SSH disconnect |
| **Runs in** | Foreground (blocks terminal) | Background (returns immediately) |
| **Survives SSH disconnect** | ❌ No | ✅ Yes (uses `nohup`) |
| **Creates log files** | ❌ No | ✅ Yes (timestamped) |
| **Saves PID** | ❌ No | ✅ Yes (to `scraper.pid`) |
| **Uses xvfb** | ✅ Yes (if no display) | ❌ No |
| **When to use** | Server without display, short runs | Long-running scrapes, remote servers |

**In summary:**
- **`run_headless.sh`** = Solves the "no display" problem, but runs in foreground
- **`run_background.sh`** = Solves the "survive disconnect" problem, runs in background

**You can combine them!** If you need both (no display AND background), you can manually run headless in the background (see below).

### Combining Scripts

You can combine these scripts for different use cases:

**Run in background on a headless server:**
```bash
./run_background.sh --date 2024-01-01 --end-date 2024-01-31
```

The background script will automatically use `run_scraper.sh`, which handles the virtual environment.

**Run headless in background (manual combination):**
```bash
# If you need BOTH headless (no display) AND background (survives disconnect)
nohup ./run_headless.sh --date 2024-01-01 --end-date 2024-01-31 > scraper.log 2>&1 &
```

**Note:** If you're using CLI arguments (not GUI mode), you typically don't need `run_headless.sh` because the scraper won't try to open a GUI. Use `run_background.sh` instead for long-running scrapes.

### Quick Reference

| Script | Use Case | Survives SSH Disconnect | Requires Display | Runs In |
|--------|----------|-------------------------|------------------|---------|
| `run_scraper.sh` | Basic wrapper with venv | ❌ | ✅ (if GUI mode) | Foreground |
| `run_background.sh` | Long-running scrapes | ✅ | ✅ (if GUI mode) | Background |
| `run_headless.sh` | Servers without display | ❌ | ❌ (uses xvfb) | Foreground |

**Tip:** For long-running scrapes on remote servers, use `run_background.sh` with CLI arguments (not GUI mode) to avoid display issues. The scraper only needs a display if you're using GUI mode - CLI mode works fine without any display setup.

---

## Querying the Database Directly in Terminal

The database is a SQLite database stored in `tickets.db` (or a custom path you specified). You can query it directly using the `sqlite3` command-line tool.

### Opening the Database

```bash
sqlite3 tickets.db
```

### Database Schema

The database contains three main tables:

1. **`tickets`** - Main ticket information
   - `id` (INTEGER PRIMARY KEY)
   - `ticket_number` (TEXT UNIQUE NOT NULL)
   - `created_at` (TIMESTAMP)
   - `updated_at` (TIMESTAMP)

2. **`ticket_properties`** - Key-value pairs for ticket properties
   - `id` (INTEGER PRIMARY KEY)
   - `ticket_number` (TEXT NOT NULL)
   - `property_key` (TEXT NOT NULL)
   - `property_value` (TEXT)
   - Unique constraint on `(ticket_number, property_key)`

3. **`polygon_coordinates`** - Polygon vertex coordinates for each ticket
   - `id` (INTEGER PRIMARY KEY)
   - `ticket_number` (TEXT NOT NULL)
   - `coordinate_order` (INTEGER NOT NULL)
   - `longitude` (REAL NOT NULL)
   - `latitude` (REAL NOT NULL)

### Useful SQL Queries

**List all tickets:**
```sql
SELECT ticket_number, created_at FROM tickets ORDER BY created_at DESC;
```

**Count total tickets:**
```sql
SELECT COUNT(*) FROM tickets;
```

**Get properties for a specific ticket:**
```sql
SELECT property_key, property_value 
FROM ticket_properties 
WHERE ticket_number = '2024010100001';
```

**Get polygon coordinates for a ticket:**
```sql
SELECT coordinate_order, longitude, latitude 
FROM polygon_coordinates 
WHERE ticket_number = '2024010100001'
ORDER BY coordinate_order;
```

**Find tickets by property:**
```sql
SELECT DISTINCT ticket_number 
FROM ticket_properties 
WHERE property_key = 'work_type' AND property_value LIKE '%excavation%';
```

**Get tickets within a date range (by ticket number):**
```sql
SELECT ticket_number 
FROM tickets 
WHERE ticket_number BETWEEN '2024010100001' AND '2024013123599'
ORDER BY ticket_number;
```

**Count tickets per day:**
```sql
SELECT SUBSTR(ticket_number, 1, 8) AS date, COUNT(*) AS count
FROM tickets
GROUP BY date
ORDER BY date DESC;
```

**Exit sqlite3:**
```sql
.quit
```

### One-Line Queries (Without Opening Interactive Mode)

**Count tickets:**
```bash
sqlite3 tickets.db "SELECT COUNT(*) FROM tickets;"
```

**List recent tickets:**
```bash
sqlite3 tickets.db "SELECT ticket_number FROM tickets ORDER BY created_at DESC LIMIT 10;"
```

**Export to CSV:**
```bash
sqlite3 tickets.db -header -csv "SELECT * FROM tickets;" > tickets_export.csv
```

**Export ticket properties to CSV:**
```bash
sqlite3 tickets.db -header -csv "SELECT * FROM ticket_properties;" > properties_export.csv
```

---

## Querying by Polygon/Bounding Box

The scraper includes two query scripts for finding tickets within a geographic area. Both use bounding box queries (not true polygon intersection, but fast and effective for most use cases).

### Using `query.py` (Simple Version)

This script provides basic bounding box queries and GeoJSON export.

**Query by bounding box coordinates:**
```bash
python3 query.py \
  --min-lat 37.68 \
  --min-lon -122.11 \
  --max-lat 37.69 \
  --max-lon -122.10 \
  --print
```

**Query by points (automatically computes bounding box):**
```bash
python3 query.py \
  --points "37.68,-122.11" "37.69,-122.11" "37.69,-122.10" "37.68,-122.10" \
  --print
```

**Export matching tickets to GeoJSON:**
```bash
python3 query.py \
  --min-lat 37.68 \
  --min-lon -122.11 \
  --max-lat 37.69 \
  --max-lon -122.10 \
  --out-geojson output.geojson
```

**Export last N tickets:**
```bash
python3 query.py --last-n 100 --out-last-geojson last_100.geojson
```

**Parameters:**
- `--db PATH` (default: tickets.db): Database file path
- `--min-lat`, `--min-lon`, `--max-lat`, `--max-lon`: Bounding box coordinates
- `--points "lat,lon" ...`: Alternative - provide points to compute bbox
- `--print`: Print matching ticket numbers to stdout
- `--out-geojson PATH`: Export matching tickets as GeoJSON
- `--last-n N`: Query last N tickets (by rowid)
- `--out-last-geojson PATH`: Export last N tickets as GeoJSON
- `--poly-table NAME` (default: polygon_coordinates): Polygon table name
- `--tickets-table NAME` (default: tickets): Tickets table name
- `--ticket-col NAME` (default: ticket_number): Ticket number column
- `--lat-col NAME` (default: lat): Latitude column (note: may need `latitude`)
- `--lon-col NAME` (default: lon): Longitude column (note: may need `longitude`)
- `--order-col NAME` (default: None): Coordinate order column (recommended: `coordinate_order`)

### Using `query_tickets.py` (Advanced Version)

This script provides more export options including CSV and reduced database exports.

**Query and print ticket numbers:**
```bash
python3 query_tickets.py \
  --min-lat 37.68 \
  --min-lon -122.11 \
  --max-lat 37.69 \
  --max-lon -122.10 \
  --print
```

**Query by points:**
```bash
python3 query_tickets.py \
  --points "37.68,-122.11" "37.69,-122.11" "37.69,-122.10" "37.68,-122.10" \
  --print
```

**Export to GeoJSON:**
```bash
python3 query_tickets.py \
  --min-lat 37.68 \
  --min-lon -122.11 \
  --max-lat 37.69 \
  --max-lon -122.10 \
  --out-geojson output.geojson
```

**Export ticket properties to CSV:**
```bash
python3 query_tickets.py \
  --min-lat 37.68 \
  --min-lon -122.11 \
  --max-lat 37.69 \
  --max-lon -122.10 \
  --out-props-csv properties.csv
```

**Export tickets table to CSV:**
```bash
python3 query_tickets.py \
  --min-lat 37.68 \
  --min-lon -122.11 \
  --max-lat 37.69 \
  --max-lon -122.10 \
  --out-tickets-csv tickets.csv
```

**Export to reduced database (only matching tickets):**
```bash
python3 query_tickets.py \
  --min-lat 37.68 \
  --min-lon -122.11 \
  --max-lat 37.69 \
  --max-lon -122.10 \
  --out-reduced-db filtered_tickets.db
```

**Export last N tickets with all formats:**
```bash
python3 query_tickets.py \
  --last-n 100 \
  --out-last-geojson last_100.geojson \
  --out-last-props-csv last_100_props.csv \
  --out-last-tickets-csv last_100_tickets.csv \
  --out-last-reduced-db last_100.db
```

**Parameters:**
- All parameters from `query.py` plus:
- `--out-props-csv PATH`: Export ticket_properties rows to CSV
- `--out-tickets-csv PATH`: Export tickets rows to CSV
- `--out-reduced-db PATH`: Export filtered database
- `--out-last-props-csv PATH`: Export properties for last N tickets
- `--out-last-tickets-csv PATH`: Export tickets for last N tickets
- `--out-last-reduced-db PATH`: Export reduced DB for last N tickets
- `--props-table NAME` (default: ticket_properties): Properties table name
- `--lat-col NAME` (default: latitude): Latitude column
- `--lon-col NAME` (default: longitude): Longitude column
- `--order-col NAME` (default: coordinate_order): Coordinate order column

### Important Notes on Column Names

The default column names differ between the two query scripts:
- `query.py` defaults: `lat`, `lon` (no order column)
- `query_tickets.py` defaults: `latitude`, `longitude`, `coordinate_order`

If you get column errors, check your database schema:
```bash
sqlite3 tickets.db "PRAGMA table_info(polygon_coordinates);"
```

Then use the appropriate `--lat-col`, `--lon-col`, and `--order-col` flags.

### Example: Finding Tickets in San Francisco Area

```bash
# San Francisco bounding box (approximate)
python3 query_tickets.py \
  --min-lat 37.7 \
  --min-lon -122.5 \
  --max-lat 37.8 \
  --max-lon -122.4 \
  --print \
  --out-geojson sf_tickets.geojson \
  --out-props-csv sf_tickets_props.csv
```

---

## Additional Tips

### Exporting Entire Database to GeoJSON

You can export the entire database to GeoJSON using the main scraper script:

```bash
python3 "USAN work type.py" --export output.geojson
```

Or with a custom database path:

```bash
python3 "USAN work type.py" --export output.geojson --db custom_path.db
```

### Checking Database Size

```bash
sqlite3 tickets.db "SELECT 
  (SELECT COUNT(*) FROM tickets) AS tickets,
  (SELECT COUNT(*) FROM ticket_properties) AS properties,
  (SELECT COUNT(*) FROM polygon_coordinates) AS coordinates;"
```

### Viewing Database Schema

```bash
sqlite3 tickets.db ".schema"
```

### Backup Database

```bash
cp tickets.db tickets_backup.db
```

Or using SQLite's backup command:
```bash
sqlite3 tickets.db ".backup tickets_backup.db"
```

---

## Working with GCP VM

### Downloading Files from GCP Web SSH Terminal

GCP's web SSH terminal includes a download feature that allows you to download files directly to your local machine. The download feature requires **absolute file paths**.

#### Finding the Absolute Path

First, find the absolute path of the file you want to download:

```bash
# Find the absolute path of a file
realpath tickets.db

# Or use pwd to see your current directory, then add the filename
pwd
# Example output: /home/username/multi-ticket-retriever
# So the absolute path would be: /home/username/multi-ticket-retriever/tickets.db

# List files with full paths
ls -la /home/username/multi-ticket-retriever/
```

#### Common File Locations

Based on the project structure, common files you might want to download:

```bash
# Database file (if in current directory)
realpath tickets.db
# Example: /home/username/multi-ticket-retriever/tickets.db

# GeoJSON export
realpath output.geojson
# Example: /home/username/multi-ticket-retriever/output.geojson

# Log files
realpath scraper_*.log
# Example: /home/username/multi-ticket-retriever/scraper_20240101_120000.log
```

#### Using the Download Feature

1. **In the GCP web SSH terminal**, click the gear icon (⚙️) or look for a "Download file" option in the menu
2. **Enter the absolute path** when prompted, for example:
   ```
   /home/username/multi-ticket-retriever/tickets.db
   ```
3. The file will download to your local machine's default download location

#### Alternative: Using `gcloud` Command Line

If you have `gcloud` CLI installed locally, you can download files using `gcloud compute scp`:

```bash
# Download a file from GCP VM to local machine
gcloud compute scp INSTANCE_NAME:/home/username/multi-ticket-retriever/tickets.db ./tickets.db

# Download multiple files
gcloud compute scp INSTANCE_NAME:/home/username/multi-ticket-retriever/*.geojson ./

# Download entire directory
gcloud compute scp --recurse INSTANCE_NAME:/home/username/multi-ticket-retriever ./local-folder
```

Replace `INSTANCE_NAME` with your actual GCP VM instance name.

#### Quick Reference: Getting Absolute Paths

```bash
# Get absolute path of current directory
pwd

# Get absolute path of a specific file
readlink -f tickets.db
# or
realpath tickets.db

# Get absolute paths of all files in current directory
find $(pwd) -maxdepth 1 -type f
```

