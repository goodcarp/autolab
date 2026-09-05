#!/bin/bash
# Run from this worktree. Uses cap.sh's Chrome recipe, port 8766, and PIL checks.
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
OUT="$PWD/docs/demo/tour"
mkdir -p "$OUT"
SERVER_PID=''
BASE_DIR=$(mktemp -d "$PWD/.tour-baseline.XXXXXX")
PROBE=$(mktemp "$PWD/.tour-probe.XXXXXX.html")
cleanup() {
  [ -z "$SERVER_PID" ] || kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$BASE_DIR"
  rm -f "$PROBE"
}
trap cleanup EXIT
if ! curl -fsS http://127.0.0.1:8766/src/tour.js >/dev/null; then
  python3 serve.py 8766 >"$OUT/server.log" 2>&1 &
  SERVER_PID=$!
  for attempt in {1..30}; do
    if curl -fsS http://127.0.0.1:8766/src/tour.js >/dev/null 2>&1; then break; fi
    sleep 0.1
  done
fi
# Materialize the pre-tour source only inside this worktree; no checkout/worktree is changed.
python3 - "$BASE_DIR" "$PROBE" <<'PY'
import pathlib, subprocess, sys
base, probe = map(pathlib.Path, sys.argv[1:])
rev = '840772b90eec789a4be1183df8173a1669f1004b'
paths = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', rev, 'src']).decode().splitlines()
for name in ['index.html', 'styles.css', *paths]:
    target = base / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(subprocess.check_output(['git', 'show', f'{rev}:{name}']))
js = '''<script type="module">
import './src/main.js';
await document.fonts.ready;
await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const visible = el => {
  if (!el || !el.getClientRects().length) return false;
  for (let p = el; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.display === 'none' || s.opacity === '0') return false;
  }
  return getComputedStyle(el).visibility === 'visible';
};
const rect = id => { const e = document.getElementById(id); return visible(e) ? e.getBoundingClientRect().toJSON() : null; };
const el = document.createElement('pre'); el.id = 'capture-check'; el.hidden = true;
el.textContent = JSON.stringify({
  buttons: [...document.querySelectorAll('button')].filter(visible).map(e => ({text:e.textContent.trim(), label:e.getAttribute('aria-label'), id:e.id})),
  controls: [...document.querySelectorAll('#controls button')].filter(visible).map(e => e.textContent.trim()),
  state: await window.r2.get_state(),
  hot: [...document.querySelectorAll('.key-item.hot')].map(e => e.dataset.part),
  card: rect('tour-card'), controlsRect: rect('controls'), titleblock: rect('titleblock'),
  caption: document.querySelector('.tour-caption')?.textContent,
  fallback: !document.getElementById('fallback').hidden
}); document.body.append(el);
</script>'''
for target, prefix in [(base/'index.html', './'), (probe, './')]:
    source = target.read_text() if target == base/'index.html' else pathlib.Path('index.html').read_text()
    target.write_text(source.replace('</body>', js + '</body>'))
PY
capture() {
  local name="$1" path="$2" qs="$3" size="${4:-1680,1050}"
  "$CHROME" --headless=new --incognito --hide-scrollbars --window-size="$size" \
    --force-device-scale-factor=2 --virtual-time-budget=4000 \
    --screenshot="$OUT/$name.png" --dump-dom \
    "http://127.0.0.1:8766/$path?$qs" >"$OUT/$name.html" 2>"$OUT/$name.log"
  python3 - "$OUT" "$name" <<'PY'
from PIL import Image, ImageStat
from pathlib import Path
import sys
out, name = Path(sys.argv[1]), sys.argv[2]
im = Image.open(out/f'{name}.png').convert('RGB')
s = ImageStat.Stat(im.convert('L'))
print(f'{name}: mean={s.mean[0]:.3f} stddev={s.stddev[0]:.3f}')
assert 5 < s.mean[0] < 253 and s.stddev[0] > 5, f'Blank capture: {name}'
im.resize((im.width//2, im.height//2)).save(out/f'{name}_half.jpg', quality=88)
PY
}
# Header parity captures: run CHIPS_ONLY=1 bash tools/tour_caps.sh to capture just these.
# Start the server first with: python3 serve.py 8766 &
for width in 1440 1024; do
  capture "chip-default-$width" index.html 'cards=1&nodrift=1&adv=2' "$width,900"
  capture "chip-panel-$width" index.html 'cards=1&nodrift=1&adv=2&tools=1' "$width,900"
done
if [ "${CHIPS_ONLY:-0}" = '1' ]; then exit 0; fi

# Every requested step uses the actual index.html and the exact capture query.
N=$(node --input-type=module -e "import { CONFIG } from './src/config.js'; console.log(CONFIG.tour.length)")
for ((step=1; step<=N; step++)); do
  capture "step-$step" index.html "tour=1&step=$step&hold=1&nodrift=1&adv=4&cards=1"
done
capture before "$(basename "$BASE_DIR")/index.html" 'cards=1&nodrift=1&adv=2'
capture default "$(basename "$PROBE")" 'cards=1&nodrift=1&adv=2'
for width in 1440 1024; do
  capture "layout-$width" "$(basename "$PROBE")" 'tour=1&step=4&hold=1&nodrift=1&adv=4&cards=1' "$width,900"
done
python3 - "$OUT" <<'PY'
from pathlib import Path
from html.parser import HTMLParser
import json, sys
out = Path(sys.argv[1])
class Probe(HTMLParser):
    recording = False
    value = ''
    def handle_starttag(self, tag, attrs):
        if dict(attrs).get('id') == 'capture-check': self.recording = True
    def handle_endtag(self, tag):
        if tag == 'pre': self.recording = False
    def handle_data(self, data):
        if self.recording: self.value += data

def read(name):
    p = Probe(); p.feed((out/f'{name}.html').read_text())
    assert p.value, f'No live DOM probe in {name}'
    result = json.loads(p.value)
    assert not result['fallback'], f'WebGL/CDN failure in {name}'
    (out/f'{name}.json').write_text(json.dumps(result, indent=2)+'\n')
    return result
before, after = read('before'), read('default')
assert after['controls'] == before['controls'] + ['TOUR']
assert after['state']['tour']['running'] is False and after['card'] is None
assert before['state']['view'] == after['state']['view'] == 'iso'
assert before['state']['motions'] == after['state']['motions']
print('Before controls:', ', '.join(before['controls']))
print('After controls:', ', '.join(after['controls']))
print('All visible buttons:', after['buttons'])
for width in [1440, 1024]:
    p = read(f'layout-{width}')
    a = p['card']; assert a and p['state']['tour']['step'] == 4 and p['state']['tour']['running']
    assert 'battery' in p['hot']
    for key in ['controlsRect', 'titleblock']:
        b = p[key]
        assert not b or a['right'] <= b['left'] or b['right'] <= a['left'] or a['bottom'] <= b['top'] or b['bottom'] <= a['top'], f'{width}: card overlaps {key}'
    assert a['left'] >= 0 and a['right'] <= width
    print(f'{width}: caption clear of controls/title block; battery row hot')
PY
