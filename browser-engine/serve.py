#!/usr/bin/env python3
"""
serve.py — local dev server for the Optomole browser-engine.

Replaces `python3 -m http.server 8777` and adds a first-class HTTPS mode so the
runtime keeps working even when the browser force-upgrades http://localhost to
https:// (a common Safari/HSTS behaviour that shows up as
"A TLS error caused the secure connection to fail. (boot.js)").

Usage:
    ./serve.py                 # HTTP  on http://127.0.0.1:8777  (default)
    ./serve.py --https         # HTTPS on https://localhost:8777 (self-signed / mkcert)
    ./serve.py --https -p 9000 # pick a port
    ./serve.py --host 0.0.0.0  # bind all interfaces (LAN testing)

Notes:
- In HTTP mode, open the game via 127.0.0.1 (not `localhost`) to dodge any cached
  HSTS pin that would upgrade the connection to HTTPS and break the plain server.
- In HTTPS mode we prefer a locally-trusted cert from `mkcert` (no browser
  warning). If mkcert isn't installed we fall back to an openssl self-signed cert
  covering localhost + 127.0.0.1; you'll get a one-time "not private" warning that
  you must accept before ES module scripts (boot.js) will load.
"""

from __future__ import annotations

import argparse
import http.server
import os
import shutil
import ssl
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CERT_DIR = ROOT / ".certs"
CERT_FILE = CERT_DIR / "localhost.pem"
KEY_FILE = CERT_DIR / "localhost-key.pem"


class Handler(http.server.SimpleHTTPRequestHandler):
    """Static handler rooted at the browser-engine directory, no caching."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # Dev server: never let the browser cache stale module code.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):  # slightly quieter, still useful
        sys.stderr.write("  %s\n" % (fmt % args))


# Ensure ES modules are served with a JS MIME type on every platform/runtime.
Handler.extensions_map = {
    **http.server.SimpleHTTPRequestHandler.extensions_map,
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".json": "application/json",
    ".map": "application/json",
    ".wasm": "application/wasm",
}


def _run(cmd: list[str]) -> bool:
    try:
        subprocess.run(cmd, check=True, capture_output=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def ensure_cert() -> None:
    """Create ./.certs/localhost.pem (+ key) if missing. Prefer mkcert."""
    if CERT_FILE.exists() and KEY_FILE.exists():
        return

    CERT_DIR.mkdir(exist_ok=True)

    if shutil.which("mkcert"):
        print("→ Generating a locally-trusted cert with mkcert…")
        # `mkcert -install` is idempotent; wires the local CA into the trust store.
        _run(["mkcert", "-install"])
        if _run([
            "mkcert",
            "-cert-file", str(CERT_FILE),
            "-key-file", str(KEY_FILE),
            "localhost", "127.0.0.1", "::1",
        ]):
            print("  ✓ Trusted cert ready (no browser warning).")
            return
        print("  ! mkcert failed, falling back to openssl self-signed.")

    if not shutil.which("openssl"):
        sys.exit(
            "No mkcert or openssl found. Install one (e.g. `brew install mkcert`) "
            "or run without --https."
        )

    print("→ Generating a self-signed cert with openssl…")
    ok = _run([
        "openssl", "req", "-x509", "-newkey", "rsa:2048", "-sha256",
        "-days", "825", "-nodes",
        "-keyout", str(KEY_FILE),
        "-out", str(CERT_FILE),
        "-subj", "/CN=localhost",
        "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1",
    ])
    if not ok:
        sys.exit("openssl failed to generate a certificate.")
    print("  ✓ Self-signed cert ready (expect a one-time browser warning).")


def main() -> None:
    ap = argparse.ArgumentParser(description="Optomole browser-engine dev server")
    ap.add_argument("-p", "--port", type=int, default=8777)
    ap.add_argument("--host", default="127.0.0.1",
                    help="bind address (default 127.0.0.1; use 0.0.0.0 for LAN)")
    ap.add_argument("--https", action="store_true", help="serve over TLS")
    args = ap.parse_args()

    httpd = http.server.ThreadingHTTPServer((args.host, args.port), Handler)

    scheme = "http"
    if args.https:
        ensure_cert()
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(certfile=str(CERT_FILE), keyfile=str(KEY_FILE))
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        scheme = "https"

    host_for_url = "localhost" if args.host in ("127.0.0.1", "0.0.0.0", "::") else args.host
    base = f"{scheme}://{host_for_url}:{args.port}"
    print(f"\nOptomole browser-engine serving {ROOT}")
    print(f"  {base}/                       → sample game")
    print(f"  {base}/?manifest=./sample-quest-rpg-manifest.json&template=quest-rpg-progression")
    if not args.https:
        print("  (HTTP mode: use the 127.0.0.1 URL above to avoid HSTS auto-upgrade)")
    print("\nCtrl-C to stop.\n")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        httpd.shutdown()


if __name__ == "__main__":
    main()
