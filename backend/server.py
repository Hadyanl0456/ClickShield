"""ClickShield local Gemini explanation proxy. Python 3.10+, standard library only.
Never expose this HTTP server on a public network. No passwords/form values are accepted.
"""
from __future__ import annotations
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
import re
import time
from urllib import request, error

HERE = Path(__file__).resolve().parent

def load_local_env():
    """Read local developer secrets; never check backend/.env into GitHub."""
    env_path = HERE / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key in {"GEMINI_API_KEY", "GEMINI_MODEL", "CLICKSHIELD_EXTENSION_ID"}:
            os.environ.setdefault(key, value)

load_local_env()
KEY = os.getenv("GEMINI_API_KEY", "").strip()
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite").strip()
EXTENSION_ID = os.getenv("CLICKSHIELD_EXTENSION_ID", "").strip().lower()
PORT = 8765
ALLOWED_ORIGIN = f"chrome-extension://{EXTENSION_ID}" if re.fullmatch(r"[a-p]{32}", EXTENSION_ID) else ""
INDICATORS = {
    "http": "The page uses an unencrypted HTTP connection.",
    "credentials": "The URL contains embedded credentials.",
    "idn": "The domain uses internationalized spelling that may deserve verification.",
    "fee": "An application or scholarship page asks for a payment or fee.",
    "urgency": "Application-related text uses urgency or pressure language.",
    "sensitive": "An application page includes a sensitive form field.",
    "payment-fields": "Payment-related language occurs with sensitive form fields.",
}
RATE_WINDOW = deque()

def validate_payload(payload):
    if not isinstance(payload, dict) or payload.get("level") not in {"low", "caution", "high"}:
        raise ValueError("Invalid risk level")
    ids = payload.get("indicators")
    if not isinstance(ids, list) or not ids or len(ids) > 8:
        raise ValueError("Expected a short list of risk indicator IDs")
    if any(not isinstance(x, str) or x not in INDICATORS for x in ids):
        raise ValueError("Unknown risk indicator")
    # Map IDs to fixed labels; never pass arbitrary webpage text into AI.
    labels = [INDICATORS[x] for x in dict.fromkeys(ids)]
    return payload["level"], labels

def ask_gemini(level, signals):
    if not KEY:
        raise RuntimeError("Gemini API key is not configured. See backend/.env.example.")
    if not re.fullmatch(r"[A-Za-z0-9._-]{3,80}", MODEL):
        raise RuntimeError("Invalid model configuration")
    prompt = (
        "You are ClickShield, a cautious browser-safety explainer. "
        "You receive only the outputs of imperfect heuristic rules, NOT page content or verified facts. "
        "Never claim that a site is definitely safe or fraudulent. "
        "Avoid unnecessary alarm and recommend independent verification. "
        "Do not request personal information, access websites, or suggest testing with credentials. "
        "In no more than 110 words, explain the specific concerns in plain English "
        "and give 2 or 3 practical safe next steps. Avoid probabilities and unsupported claims.\n"
        f"Rule-based category: {level}.\n"
        "Detected signals:\n- " + "\n- ".join(signals)
    )
    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 400},
    }
    req = request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": KEY},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=22) as resp:
            result = json.load(resp)
    except error.HTTPError as exc:
        raise RuntimeError(f"Gemini API request failed (HTTP {exc.code}); check your key, model and quota.") from None
    except (error.URLError, TimeoutError):
        raise RuntimeError("Cannot contact Gemini; check internet connection and retry.") from None
    texts = [p.get("text", "") for c in result.get("candidates", [])[:1]
             for p in c.get("content", {}).get("parts", []) if isinstance(p.get("text"), str)]
    answer = "\n".join(texts).strip()[:1800]
    if not answer:
        raise RuntimeError("Gemini did not return a usable explanation.")
    return answer

class Handler(BaseHTTPRequestHandler):
    server_version = "ClickShieldLocal/0.3"
    def log_message(self, *_):
        # Don't log payloads, URLs from browser tabs, or API keys.
        return

    def permitted(self):
        return bool(ALLOWED_ORIGIN and self.headers.get("Origin", "").lower() == ALLOWED_ORIGIN)

    def send_json(self, status, body, cors=False):
        raw = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(raw)))
        if cors:
            self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "content-type")
        self.end_headers()
        self.wfile.write(raw)

    def do_OPTIONS(self):
        if not self.permitted() or self.path != "/api/explain":
            self.send_json(403, {"error": "Origin not permitted"})
            return
        self.send_json(200, {"ok": True}, cors=True)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"status": "ready", "keyConfigured": bool(KEY), "extensionConfigured": bool(ALLOWED_ORIGIN)})
        else:
            self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/api/explain":
            return self.send_json(404, {"error": "Not found"})
        if not self.permitted():
            return self.send_json(403, {"error": "Extension origin not allowed"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.send_json(400, {"error": "Invalid request size"}, cors=True)
        if size < 2 or size > 4096:
            return self.send_json(413, {"error": "Invalid request size"}, cors=True)
        try:
            level, labels = validate_payload(json.loads(self.rfile.read(size)))
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
            return self.send_json(400, {"error": "Invalid indicator data"}, cors=True)
        now = time.monotonic()
        while RATE_WINDOW and RATE_WINDOW[0] < now - 60:
            RATE_WINDOW.popleft()
        if len(RATE_WINDOW) >= 8:
            return self.send_json(429, {"error": "Too many AI requests. Try again shortly."}, cors=True)
        RATE_WINDOW.append(now)
        try:
            explanation = ask_gemini(level, labels)
        except RuntimeError as exc:
            return self.send_json(503, {"error": str(exc)}, cors=True)
        except Exception:
            return self.send_json(503, {"error": "AI service temporarily unavailable."}, cors=True)
        self.send_json(200, {"explanation": explanation, "source": "Gemini"}, cors=True)

if __name__ == "__main__":
    if not ALLOWED_ORIGIN:
        raise SystemExit("Set CLICKSHIELD_EXTENSION_ID in backend/.env using the ID on chrome://extensions.")
    print(f"ClickShield local AI backend running: http://127.0.0.1:{PORT}")
    print("Local-only demo. Keep this terminal open while testing. Press Ctrl+C to stop.")
    print("Gemini API key configured:", "yes" if KEY else "no")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
