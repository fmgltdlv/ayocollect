from fastapi import FastAPI, Request, Header
from starlette.responses import Response
import hmac, hashlib, base64, os, json, time
import datetime, pathlib, subprocess, shutil

app = FastAPI()

# --- Config ---
SECRET = os.getenv("USANORTH_WEBHOOK_SECRET", "replace-me")
LOG_DIR = pathlib.Path(os.getenv("WEBHOOK_LOG_DIR", "/app/webhook_logs"))
LOG_DIR.mkdir(parents=True, exist_ok=True)

# Log at startup so you can see if SECRET is still the default
print(f"[boot] secret_len={len(SECRET)} (should be > 8), log_dir={LOG_DIR}")

# ---------- tolerant signature helpers ----------
SIG_HEADER_CANDIDATES = [
    "x-onecall-webhook-signature",
    "x-webhook-signature",
    "x-signature",
    "x-usanorth-signature",
    "x-usa-north-signature",
]

TS_HEADER_CANDIDATES = [
    "x-onecall-webhook-timestamp",
    "x-webhook-timestamp",
    "x-timestamp",
]

def _get_header(headers, names):
    for n in names:
        v = headers.get(n)
        if v:
            return v
    return None

def _strip_sha256_prefix(v: str) -> str:
    v = v.strip()
    return v.split("=", 1)[1] if v.lower().startswith("sha256=") else v

def _b64_or_b64url_decode(s: str):
    try:
        return base64.b64decode(s, validate=True)
    except Exception:
        pass
    # try urlsafe b64 (add padding)
    try:
        pad = "=" * ((4 - len(s) % 4) % 4)
        return base64.urlsafe_b64decode(s + pad)
    except Exception:
        return None

def _parse_incoming_sig(sig_header: str):
    raw = _strip_sha256_prefix(sig_header)
    # try hex
    try:
        return bytes.fromhex(raw)
    except ValueError:
        pass
    # try base64 / base64url
    b = _b64_or_b64url_decode(raw)
    return b

def _hmac_sha256(secret: bytes, data: bytes) -> bytes:
    return hmac.new(secret, data, hashlib.sha256).digest()

async def verify_request(request: Request) -> bool:
    if not SECRET or SECRET == "replace-me":
        print("‼️ SECRET not configured")
        return False

    headers = {k.lower(): v for k, v in request.headers.items()}
    raw = await request.body()

    sig_header = _get_header(headers, SIG_HEADER_CANDIDATES)
    if not sig_header:
        print("❌ Missing signature header; got headers:", {k: headers[k] for k in SIG_HEADER_CANDIDATES if k in headers})
        return False

    incoming = _parse_incoming_sig(sig_header)
    if not incoming:
        print("❌ Unparseable signature header:", sig_header)
        return False

    # Variant A: body-only
    expected_body = _hmac_sha256(SECRET.encode("utf-8"), raw)

    # Variant B: "timestamp.body"
    ts_header = _get_header(headers, TS_HEADER_CANDIDATES)
    expected_ts = None
    if ts_header:
        try:
            signed = (ts_header + "." + raw.decode("utf-8")).encode("utf-8")
            expected_ts = _hmac_sha256(SECRET.encode("utf-8"), signed)
        except UnicodeDecodeError:
            # If body isn't valid UTF-8, this variant probably isn't used
            expected_ts = None

    ok = hmac.compare_digest(incoming, expected_body) or (
        expected_ts is not None and hmac.compare_digest(incoming, expected_ts)
    )

    if not ok:
        print("❌ Signature mismatch")
        print("   incoming(hex) =", incoming.hex())
        print("   body(hex)     =", expected_body.hex())
        if expected_ts:
            print("   ts(hex)       =", expected_ts.hex())
        print("   used header   =", sig_header)
        if ts_header:
            print("   ts header     =", ts_header)
    return ok

# ---------- routes ----------
@app.get("/healthz")
def health():
    return {"ok": True}

@app.post("/webhooks/usanorth")
@app.post("/webhooks/usanorth/")  # accept trailing slash too
async def usanorth_webhook(request: Request):
    raw = await request.body()
    if not await verify_request(request):
        return Response(status_code=401)

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        print("⚠️ Invalid JSON body")
        return Response(status_code=400)

    msg = payload.get("message") or {}
    ticket_number = (
        msg.get("ticketNumber")
        or payload.get("ticketNumber")
        or msg.get("ticket_number")
        or payload.get("ticket_number")
        or "unknown"
    )
    sequence = msg.get("sequenceNumber") or msg.get("sequence_number")
    station = msg.get("stationCode") or msg.get("station_code")
    notification_id = payload.get("webhookNotificationId") or payload.get("webhook_notification_id")

    print("✅ Webhook received", {
        "webhookNotificationId": notification_id,
        "ticketNumber": ticket_number,
        "sequenceNumber": sequence,
        "stationCode": station
    })

    timestamp = datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%S%fZ")

    name_bits = [timestamp]
    if ticket_number: name_bits.append(str(ticket_number))
    if sequence is not None: name_bits.append(f"seq{sequence}")
    if notification_id is not None: name_bits.append(f"id{notification_id}")
    json_filename = "_".join(name_bits) + ".json"

    try:
        json_path = LOG_DIR / json_filename
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
        print(f"📁 Saved payload to {json_path}")
    except Exception as e:
        print(f"⚠️ Failed to write payload JSON: {e}")

    def write_b64(b64val: str | None, out_path: pathlib.Path):
        if not b64val:
            return None
        try:
            data = base64.b64decode(b64val)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_bytes(data)
            print(f"📄 Saved {out_path.name} -> {out_path}")
            return str(out_path)
        except Exception as e:
            print(f"⚠️ Decode failed for {out_path.name}: {e}")
            return None

    base = LOG_DIR / ("_".join([timestamp, str(ticket_number)]) if ticket_number else timestamp)

    xml_path = write_b64(msg.get("XMLBase64") or msg.get("xml_base64"), base.with_suffix(".xml"))
    gml_path = write_b64(msg.get("GMLBase64") or msg.get("gml_base64"), base.with_suffix(".gml"))
    gif_path = write_b64(msg.get("GIFBase64") or msg.get("gif_base64"), base.with_suffix(".gif"))

    if gml_path and shutil.which("ogr2ogr"):
        geojson_path = str(base.with_suffix(".geojson"))
        try:
            subprocess.check_call(["ogr2ogr", "-f", "GeoJSON", geojson_path, gml_path])
            print(f"🗺️  Converted GML to GeoJSON -> {geojson_path}")
        except subprocess.CalledProcessError as e:
            print(f"⚠️ ogr2ogr failed: {e}")

    return Response(status_code=204)
