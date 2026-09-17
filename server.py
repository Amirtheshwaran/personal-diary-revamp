#!/usr/bin/env python3
"""
Personal Diary - local server.
Pure standard library (http.server + sqlite3). No pip installs, no network
calls at runtime. Run with `python server.py` and open http://127.0.0.1:8420
"""
import json
import hashlib
import hmac
import os
import secrets
import sqlite3
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
DB_PATH = os.path.join(BASE_DIR, "data", "diary.db")
PORT = 8420

os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

# In-memory session token for this single-user local app. Regenerated on
# every server start, so the app is always locked when you launch it.
SESSION = {"unlocked": False, "token": None}


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            place TEXT NOT NULL DEFAULT '',
            duration TEXT NOT NULL DEFAULT '',
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    """)
    conn.commit()
    conn.close()


def get_config(key, default=None):
    conn = db()
    row = conn.execute("SELECT value FROM config WHERE key = ?", (key,)).fetchone()
    conn.close()
    return row["value"] if row else default


def set_config(key, value):
    conn = db()
    conn.execute(
        "INSERT INTO config (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
    conn.commit()
    conn.close()


def hash_password(password, salt=None):
    if salt is None:
        salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), 200_000)
    return salt, digest.hex()


def verify_password(password):
    stored_salt = get_config("pw_salt")
    stored_hash = get_config("pw_hash")
    if not stored_salt or not stored_hash:
        return False
    _, computed = hash_password(password, stored_salt)
    return hmac.compare_digest(computed, stored_hash)


def password_is_set():
    return bool(get_config("pw_hash"))


def set_password(password):
    salt, digest = hash_password(password)
    set_config("pw_salt", salt)
    set_config("pw_hash", digest)


class Handler(BaseHTTPRequestHandler):
    server_version = "PersonalDiary/1.0"

    def log_message(self, fmt, *args):
        pass  # keep console quiet

    # ---------- helpers ----------
    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def _require_auth(self):
        token = self.headers.get("X-Diary-Token", "")
        if not SESSION["unlocked"] or not token or token != SESSION["token"]:
            self._send_json({"error": "locked"}, 401)
            return False
        return True

    def _serve_static(self, path):
        if path == "/" or path == "":
            path = "/index.html"
        safe_path = os.path.normpath(path).lstrip("/\\")
        full_path = os.path.join(STATIC_DIR, safe_path)
        if not full_path.startswith(STATIC_DIR) or not os.path.isfile(full_path):
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not found")
            return
        mime, _ = mimetypes.guess_type(full_path)
        with open(full_path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", mime or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # ---------- routing ----------
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path == "/api/status":
            return self._send_json({
                "password_set": password_is_set(),
                "unlocked": SESSION["unlocked"],
            })

        if path == "/api/dates":
            if not self._require_auth():
                return
            conn = db()
            rows = conn.execute(
                "SELECT DISTINCT date FROM entries ORDER BY date DESC"
            ).fetchall()
            conn.close()
            return self._send_json({"dates": [r["date"] for r in rows]})

        if path == "/api/entries":
            if not self._require_auth():
                return
            date = (qs.get("date") or [None])[0]
            conn = db()
            if date:
                rows = conn.execute(
                    "SELECT * FROM entries WHERE date = ? ORDER BY time ASC", (date,)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM entries ORDER BY date DESC, time ASC"
                ).fetchall()
            conn.close()
            return self._send_json({"entries": [dict(r) for r in rows]})

        return self._serve_static(path)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        payload = self._read_json()

        if path == "/api/login":
            password = payload.get("password", "")
            if not password_is_set():
                return self._send_json({"error": "no_password_set"}, 400)
            if verify_password(password):
                SESSION["unlocked"] = True
                SESSION["token"] = secrets.token_hex(24)
                return self._send_json({"ok": True, "token": SESSION["token"]})
            return self._send_json({"ok": False, "error": "wrong_password"}, 403)

        if path == "/api/set-initial-password":
            if password_is_set():
                return self._send_json({"error": "already_set"}, 400)
            password = payload.get("password", "")
            if len(password) < 1:
                return self._send_json({"error": "empty_password"}, 400)
            set_password(password)
            SESSION["unlocked"] = True
            SESSION["token"] = secrets.token_hex(24)
            return self._send_json({"ok": True, "token": SESSION["token"]})

        if path == "/api/lock":
            SESSION["unlocked"] = False
            SESSION["token"] = None
            return self._send_json({"ok": True})

        if path == "/api/change-password":
            if not self._require_auth():
                return
            old = payload.get("old_password", "")
            new = payload.get("new_password", "")
            if not verify_password(old):
                return self._send_json({"ok": False, "error": "wrong_password"}, 403)
            if len(new) < 1:
                return self._send_json({"ok": False, "error": "empty_password"}, 400)
            set_password(new)
            return self._send_json({"ok": True})

        if path == "/api/entries":
            if not self._require_auth():
                return
            required = ["date", "time"]
            for key in required:
                if not payload.get(key):
                    return self._send_json({"error": f"missing_{key}"}, 400)
            conn = db()
            cur = conn.execute(
                "INSERT INTO entries (date, time, title, place, duration, note) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    payload.get("date", ""),
                    payload.get("time", ""),
                    payload.get("title", ""),
                    payload.get("place", ""),
                    payload.get("duration", ""),
                    payload.get("note", ""),
                ),
            )
            conn.commit()
            new_id = cur.lastrowid
            row = conn.execute("SELECT * FROM entries WHERE id = ?", (new_id,)).fetchone()
            conn.close()
            return self._send_json({"ok": True, "entry": dict(row)})

        return self._send_json({"error": "not_found"}, 404)

    def do_PUT(self):
        parsed = urlparse(self.path)
        parts = parsed.path.strip("/").split("/")
        payload = self._read_json()

        if len(parts) == 3 and parts[0] == "api" and parts[1] == "entries":
            if not self._require_auth():
                return
            try:
                entry_id = int(parts[2])
            except ValueError:
                return self._send_json({"error": "bad_id"}, 400)
            conn = db()
            existing = conn.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
            if not existing:
                conn.close()
                return self._send_json({"error": "not_found"}, 404)
            fields = {}
            for key in ["date", "time", "title", "place", "duration", "note"]:
                if key in payload:
                    fields[key] = payload[key]
            if fields:
                set_clause = ", ".join(f"{k} = ?" for k in fields)
                conn.execute(
                    f"UPDATE entries SET {set_clause} WHERE id = ?",
                    (*fields.values(), entry_id),
                )
                conn.commit()
            row = conn.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
            conn.close()
            return self._send_json({"ok": True, "entry": dict(row)})

        return self._send_json({"error": "not_found"}, 404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        parts = parsed.path.strip("/").split("/")

        if len(parts) == 3 and parts[0] == "api" and parts[1] == "entries":
            if not self._require_auth():
                return
            try:
                entry_id = int(parts[2])
            except ValueError:
                return self._send_json({"error": "bad_id"}, 400)
            conn = db()
            conn.execute("DELETE FROM entries WHERE id = ?", (entry_id,))
            conn.commit()
            conn.close()
            return self._send_json({"ok": True})

        return self._send_json({"error": "not_found"}, 404)


def main():
    init_db()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Personal Diary running at http://127.0.0.1:{PORT}  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
