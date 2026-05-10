#!/usr/bin/env python3
"""Local development server for RaceNext Results.

Serves the static files from this folder and proxies /api/* to the
RaceNext backend. Because the browser stays on the same origin, no CORS
issue arises and data is fetched live every time.

Usage:
    python3 server.py                  # port 8000, opens the browser
    python3 server.py --port 9000      # custom port
    python3 server.py --no-open        # don't open the browser
    PORT=8080 python3 server.py        # port via environment variable

If the chosen port is busy, the next free one within +20 is used.
Requires Python 3.7+. No third-party dependencies.
"""

from __future__ import annotations

import argparse
import contextlib
import http.server
import json
import os
import socket
import socketserver
import sys
import urllib.error
import urllib.request
import webbrowser

API_BASE = "https://org-api.racenext.app"
ROOT = os.path.dirname(os.path.abspath(__file__))
PROXY_PREFIX = "/api/"
SAFE_REQUEST_HEADERS = ("Authorization", "Content-Type", "Accept",
                        "Accept-Language")
USER_AGENT = "racenext-results-local/1.0 (+server.py)"


class Handler(http.server.SimpleHTTPRequestHandler):
    """Serves static files from ROOT and proxies /api/* to API_BASE."""

    # The default extension map does not know about .webmanifest, which the
    # PWA manifest is served as. Browsers require application/manifest+json
    # (or at least application/json) for it to be picked up.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        """Less noisy access log: drop the date/source-host prefix."""
        sys.stderr.write("  %s\n" % (fmt % args))

    # ---- HTTP method dispatch ----

    def do_OPTIONS(self):
        # CORS preflight is irrelevant for same-origin requests, but the
        # handler answers anyway in case the page is opened from a different
        # origin while still using this server as the API proxy.
        self.send_response(204)
        self._send_cors_headers()
        self.send_header("Access-Control-Allow-Methods",
                         "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers",
                         "Authorization, Content-Type, Accept")
        self.end_headers()

    def do_GET(self):
        if self.path.startswith(PROXY_PREFIX):
            return self._proxy("GET")
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith(PROXY_PREFIX):
            return self._proxy("POST")
        self.send_error(405)

    def do_PUT(self):
        if self.path.startswith(PROXY_PREFIX):
            return self._proxy("PUT")
        self.send_error(405)

    def do_DELETE(self):
        if self.path.startswith(PROXY_PREFIX):
            return self._proxy("DELETE")
        self.send_error(405)

    # ---- helpers ----

    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")

    def _proxy(self, method: str) -> None:
        # Strip the "/api" prefix and forward the rest to the upstream API.
        target = API_BASE + self.path[len("/api"):]
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else None

            request = urllib.request.Request(target, data=body, method=method)
            for header in SAFE_REQUEST_HEADERS:
                value = self.headers.get(header)
                if value:
                    request.add_header(header, value)
            request.add_header("User-Agent", USER_AGENT)

            with urllib.request.urlopen(request, timeout=30) as upstream:
                self.send_response(upstream.status)
                content_type = upstream.headers.get(
                    "Content-Type", "application/json"
                )
                self.send_header("Content-Type", content_type)
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(upstream.read())
        except urllib.error.HTTPError as e:
            # Forward the upstream error so the client can react to it.
            self.send_response(e.code)
            self.send_header(
                "Content-Type",
                e.headers.get("Content-Type") or "application/json",
            )
            self._send_cors_headers()
            self.end_headers()
            with contextlib.suppress(Exception):
                self.wfile.write(e.read())
        except Exception as e:
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(
                json.dumps({"error": "proxy_failed", "detail": str(e)})
                .encode("utf-8")
            )


class ThreadedServer(socketserver.ThreadingTCPServer):
    """Allows a fast restart by reusing the address and serves requests
    from a small pool of daemon threads."""

    allow_reuse_address = True
    daemon_threads = True


def find_free_port(start: int, attempts: int = 20) -> int:
    """Return the first port available for binding, starting at `start`."""
    for port in range(start, start + attempts):
        with contextlib.closing(
            socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        ) as probe:
            try:
                probe.bind(("", port))
                return port
            except OSError:
                continue
    raise SystemExit(
        f"No free port in range {start}..{start + attempts - 1}"
    )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Static + API-proxy dev server for RaceNext Results.",
    )
    default_port = int(os.environ.get("PORT", 8000))
    parser.add_argument(
        "port",
        nargs="?",
        type=int,
        default=default_port,
        help=f"Port to listen on (default: {default_port}).",
    )
    parser.add_argument(
        "--port",
        dest="port_flag",
        type=int,
        help="Same as the positional argument; provided for clarity.",
    )
    parser.add_argument(
        "-n", "--no-open",
        action="store_true",
        help="Do not open a browser window on startup.",
    )
    args = parser.parse_args(argv)
    if args.port_flag is not None:
        args.port = args.port_flag
    return args


def main() -> int:
    args = parse_args()
    port = find_free_port(args.port)
    url = f"http://localhost:{port}/"

    print()
    print("  RaceNext Results — local dev server")
    print("  -----------------------------------")
    print(f"  Static : {ROOT}")
    print(f"  Proxy  : /api/* -> {API_BASE}/*")
    print(f"  URL    : {url}")
    print( "  Stop   : Ctrl+C")
    print()

    with ThreadedServer(("", port), Handler) as httpd:
        if not args.no_open:
            with contextlib.suppress(Exception):
                webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
