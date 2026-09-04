#!/usr/bin/env python3
"""Tiny dev server: serves this folder with no-store caching (so edits show on reload)."""
import http.server, os, sys
os.chdir(os.path.dirname(os.path.abspath(__file__)))
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate'); self.send_header('Expires', '0')
        super().end_headers()
    def log_message(self, fmt, *args):
        if '404' in (args[1] if len(args) > 1 else ''): super().log_message(fmt, *args)
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
http.server.ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
