#!/usr/bin/env python3
"""Serve the built site the way the laboratory needs it served.

    python3 scripts/serve.py [--port 8000] [--no-isolation]

Real threads in a page need shared memory, and a browser allows shared memory only to a page
that is cross-origin isolated: two response headers, on the page and on everything it loads.
This server sends them, so a local build runs the experiments live at once. With
``--no-isolation`` it sends neither, which is how GitHub Pages serves the site: the page then
installs its service worker, which adds the headers itself, and reloads once. Use that mode to
see what a reader sees, and the default to work on an experiment.
"""

from __future__ import annotations

import argparse
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".webmanifest": "application/manifest+json",
    }
    isolate = True

    def end_headers(self):
        if self.isolate:
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--dir", default=str(ROOT / "_build" / "html"))
    parser.add_argument(
        "--no-isolation", action="store_true", help="serve as GitHub Pages does, without the headers"
    )
    args = parser.parse_args()
    Handler.isolate = not args.no_isolation
    handler = partial(Handler, directory=args.dir)
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        how = (
            "without isolation headers (the service worker adds them)"
            if args.no_isolation
            else "with isolation headers"
        )
        print(f"  http://127.0.0.1:{args.port}/  {how}")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
