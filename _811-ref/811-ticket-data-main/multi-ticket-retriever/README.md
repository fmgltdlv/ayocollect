# Multi-Ticket Retriever

A simple tool to scrape underground service alert tickets and query them by geographic area.

## Quick Start

### 1. Scrape Tickets and Save to Database

Run the scraper to collect tickets and save them to a SQLite database:

```bash
# California (default)
python3 "USAN work type.py" --date 2024-01-01 --end-date 2024-01-31

# Nevada
python3 "USAN work type.py" --date 2024-01-01 --end-date 2024-01-31 --system NV
```

**Parameters:**
- `--date YYYY-MM-DD` - Start date (required)
- `--end-date YYYY-MM-DD` - End date (optional)
- `--system CA|NV` - System to use: CA (Northern California) or NV (Nevada). Default: CA
- `--db PATH` - Database file path (default: `tickets.db`)

Tickets are automatically saved to `tickets.db` (or your specified database file) as they are scraped.

### 2. Query Tickets by Geographic Area

Query the database for tickets within a specific area using a bounding box:

```bash
python3 query_tickets.py \
  --min-lat 37.68 \
  --min-lon -122.11 \
  --max-lat 37.69 \
  --max-lon -122.10 \
  --out-geojson results.geojson
```

**Or use points to define the bounding box:**

```bash
python3 query_tickets.py \
  --points "37.68,-122.11" "37.69,-122.11" "37.69,-122.10" "37.68,-122.10" \
  --out-geojson results.geojson
```

**Query Parameters:**
- `--min-lat`, `--min-lon`, `--max-lat`, `--max-lon` - Bounding box coordinates
- `--points "lat,lon" ...` - Alternative: provide points to compute bounding box
- `--out-geojson PATH` - Export matching tickets as GeoJSON
- `--db PATH` - Database file path (default: `tickets.db`)

**Using a GeoJSON file as input:**

If you have a GeoJSON file with a polygon or bounding box, you can extract the coordinates and use them:

1. Open your GeoJSON file and find the bounding box coordinates
2. Use those coordinates in the query:

```bash
python3 query_tickets.py \
  --min-lat <min_latitude> \
  --min-lon <min_longitude> \
  --max-lat <max_latitude> \
  --max-lon <max_longitude> \
  --out-geojson results.geojson
```

**Tip:** You can use online tools like [geojson.io](https://geojson.io) to view your GeoJSON and get the bounding box coordinates from the map bounds.

### 3. View Results

The results are exported as a GeoJSON file that you can:
- Open in GIS software (QGIS, ArcGIS, etc.)
- View in online tools (geojson.io)
- Use in web mapping applications

## Complete Example

```bash
# 1. Scrape tickets for January 2024 (California)
python3 "USAN work type.py" --date 2024-01-01 --end-date 2024-01-31

# 2. Query tickets in San Francisco area and export to GeoJSON
python3 query_tickets.py \
  --min-lat 37.7 \
  --min-lon -122.5 \
  --max-lat 37.8 \
  --max-lon -122.4 \
  --out-geojson sf_tickets.geojson

# 3. Open sf_tickets.geojson in your preferred GIS tool
```

## Running in GCP (Background Mode)

When running on a GCP VM, you can run the scraper in the background so it continues even if you disconnect from SSH:

### Start the scraper in background:

```bash
# Make sure the script is executable
chmod +x run_background.sh

# Start scraping in background (survives SSH disconnect)
./run_background.sh --date 2024-01-01 --end-date 2024-01-31 --system CA
```

The script will:
- Start the scraper in the background using `nohup`
- Create a timestamped log file (e.g., `scraper_20240101_120000.log`)
- Save the process ID to `scraper.pid` for easy reference
- Continue running even after you close the SSH terminal

### Monitor progress:

```bash
# View the log file in real-time
tail -f scraper_20240101_120000.log

# Or view the most recent log file
tail -f scraper_*.log
```

### Check if scraper is running:

```bash
# Using the saved PID
ps aux | grep $(cat scraper.pid)

# Or search for the process
ps aux | grep "USAN work type.py"
```

### Stop the scraper:

```bash
# Using the saved PID
kill $(cat scraper.pid)

# Or if you know the PID
kill <PID>
```

**Note:** The scraper automatically saves tickets to the database every 100 tickets, so your progress is saved even if you need to stop and restart the process.

## Additional Options

**Print matching ticket numbers:**
```bash
python3 query_tickets.py --min-lat 37.68 --min-lon -122.11 --max-lat 37.69 --max-lon -122.10 --print
```

**Export to CSV (ticket properties):**
```bash
python3 query_tickets.py \
  --min-lat 37.68 --min-lon -122.11 --max-lat 37.69 --max-lon -122.10 \
  --out-props-csv properties.csv
```

**Export to reduced database (only matching tickets):**
```bash
python3 query_tickets.py \
  --min-lat 37.68 --min-lon -122.11 --max-lat 37.69 --max-lon -122.10 \
  --out-reduced-db filtered_tickets.db
```

## Requirements

- Python 3
- See `requirements.txt` for Python dependencies

## More Information

See `INSTRUCTIONS.md` for detailed documentation on all features and options.

