#!/bin/bash
# usage: cap_size.sh <outdir> <name> <W> <H> "<query>"  — capture at a specific window size
OUT="$1"; NAME="$2"; W="$3"; H="$4"; QS="$5"; mkdir -p "$OUT"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --incognito --hide-scrollbars \
  --window-size="$W,$H" --force-device-scale-factor=2 --virtual-time-budget=4000 \
  --screenshot="$OUT/$NAME.png" "http://127.0.0.1:8765/index.html?$QS" >/dev/null 2>&1
