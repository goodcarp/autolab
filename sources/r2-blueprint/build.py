#!/usr/bin/env python3
"""Bundle the app into one self-contained HTML file (dist/r2-blueprint.html).
Internal ES modules are concatenated into a single module script; three.js still comes from the CDN import map."""
import re, os, sys
ROOT = os.path.dirname(os.path.abspath(__file__))
ORDER = ['geom.js', 'config.js', 'camera.js', 'vehicle.js', 'blueprint.js', 'overlay.js', 'ui.js', 'tour.js', 'webmcp.js', 'main.js']
ext_imports = []
body = []
for name in ORDER:
    src = open(os.path.join(ROOT, 'src', name)).read()
    out = []
    for line in src.split('\n'):
        m = re.match(r"\s*import\s+(.+?)\s+from\s+'([^']+)';?\s*$", line)
        if m:
            spec = m.group(2)
            if spec.startswith('./'):
                continue  # internal module: symbols are now in the same scope
            if line.strip() not in ext_imports: ext_imports.append(line.strip())
            continue
        line = re.sub(r'^export\s+(const|let|function|class)\b', r'\1', line)
        out.append(line)
    body.append(f'// ===== {name} =====\n' + '\n'.join(out))
html = open(os.path.join(ROOT, 'index.html')).read()
css = open(os.path.join(ROOT, 'styles.css')).read()
# body-only document for artifact hosting (no doctype/html/head/body tags), plus a full standalone variant
title = re.search(r'<title>(.*?)</title>', html).group(1)
importmap = re.search(r'<script type="importmap">(.*?)</script>', html, re.S).group(1)
inner = re.search(r'<body>(.*?)<script type="module" src="src/main.js"[^>]*></script>', html, re.S).group(1)
script = '\n'.join(ext_imports) + '\n' + '\n'.join(body)
fragment = f'<title>{title}</title>\n<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">\n<style>\n{css}\n</style>\n<script type="importmap">{importmap}</script>\n{inner}\n<script type="module">\n{script}\n</script>\n'
os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
open(os.path.join(ROOT, 'dist', 'r2-blueprint.fragment.html'), 'w').write(fragment)
standalone = f'<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n</head><body>\n{fragment}</body></html>\n'
open(os.path.join(ROOT, 'dist', 'r2-blueprint.html'), 'w').write(standalone)
print('bundled', len(standalone), 'bytes;', len(ext_imports), 'external imports')
