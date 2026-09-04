#!/bin/bash
# Assemble the AutoLab by AutoMoto site from the source trees in sources/.
#
#   configure/  <- sources/universal-vehicle-configurator   (pnpm install && pnpm build)
#   garage/     <- sources/r2-blueprint                     (static; copied as-is)
#   engine/     <- sources/autolab-3d-creation-engine       (docs, spec, reference, measured SVGs)
#
# The landing page (index.html, assets/), engine/index.html and engine/engine.js are
# authored in this repository. Everything under configure/, garage/ and
# engine/{docs,out,specs,reference} is generated or copied, never hand-edited.
#
# Requirements: Node >= 22.12, corepack (ships with Node) for pnpm, rsync.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/sources"
UVC="$SRC/universal-vehicle-configurator"
R2="$SRC/r2-blueprint"
ENGINE="$SRC/autolab-3d-creation-engine"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
PNPM="${PNPM:-corepack pnpm}"

echo "▸ configure/  <- $UVC"
( cd "$UVC" && $PNPM install --frozen-lockfile --silent && $PNPM build )
rm -rf "$HERE/configure"; mkdir -p "$HERE/configure"
rsync -a --exclude '_redirects' "$UVC/dist/" "$HERE/configure/"

echo "▸ garage/     <- $R2"
rm -rf "$HERE/garage"; mkdir -p "$HERE/garage/docs"
rsync -a "$R2/index.html" "$R2/styles.css" "$HERE/garage/"
rsync -a --exclude '*.autolab-backup' "$R2/src/" "$HERE/garage/src/"
rsync -a "$R2/docs/" "$HERE/garage/docs/"

echo "▸ engine/     <- $ENGINE"
mkdir -p "$HERE/engine/out" "$HERE/engine/docs" "$HERE/engine/specs" "$HERE/engine/reference"
rsync -a "$ENGINE/README.md" "$HERE/engine/docs/README.md"
rsync -a "$ENGINE/docs/" "$HERE/engine/docs/"
rsync -a "$ENGINE/specs/" "$HERE/engine/specs/"
rsync -a "$ENGINE/reference/" "$HERE/engine/reference/"
# Measured outputs: sections and the profile overlay, read straight off the model.
( cd "$ENGINE" && $PNPM install --frozen-lockfile --silent )
# The engine resolves reference/ and specs/ relative to its own directory.
export MODEL_PATH="$R2/src/vehicle.js"
OUT="$HERE/engine/out"; rm -f "$OUT"/*.svg
( cd "$ENGINE"
  node src/cli.mjs section 0     --svg "$OUT/section-x0.svg"      >/dev/null
  node src/cli.mjs section 1     --svg "$OUT/section-x1.svg"      >/dev/null
  node src/cli.mjs section 0.6   --svg "$OUT/section-cowl.svg"    >/dev/null
  node src/cli.mjs section -1.2  --svg "$OUT/section-xneg1p2.svg" >/dev/null
  node src/cli.mjs deviate       --svg "$OUT/profile-overlay.svg" >/dev/null
)
SELFTEST="$(cd "$ENGINE" && node src/cli.mjs selftest 2>&1 | tail -1)"

{
  echo "assembled: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "sources:"; sed 's/^/  /' "$SRC/SOURCES.txt"
  echo "engine selftest: $SELFTEST"
} > "$HERE/ASSEMBLED.txt"
touch "$HERE/.nojekyll"
cat "$HERE/ASSEMBLED.txt"
