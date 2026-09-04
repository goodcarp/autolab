#!/bin/bash
# usage: cap.sh <outdir> <name> "<query string>"   → full-res PNG + half-size JPG via headless Chrome
OUT="$1"; NAME="$2"; QS="$3"; mkdir -p "$OUT"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --incognito --hide-scrollbars --window-size=1680,1050 --force-device-scale-factor=2 --virtual-time-budget=4000 --screenshot="$OUT/$NAME.png" "http://127.0.0.1:8765/index.html?$QS" >/dev/null 2>&1
python3 -c "from PIL import Image; im=Image.open('$OUT/$NAME.png'); im.resize((im.width//2, im.height//2)).save('$OUT/${NAME}_half.jpg', quality=88)"
