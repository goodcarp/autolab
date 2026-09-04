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

# --refresh: re-take sources/ from the committed HEAD of each working repository
# (tracked files only), applying the public-copy exclusions. Override a source
# with UVC_SRC / R2_SRC / ENGINE_SRC (any checkout or worktree; its HEAD is used).
if [ "${1:-}" = "--refresh" ]; then
  DESKTOP="$(cd "$HERE/.." && pwd)"
  UVC_SRC="${UVC_SRC:-$DESKTOP/Universal Vehicle Configurator}"
  R2_SRC="${R2_SRC:-$DESKTOP/r2-blueprint}"
  ENGINE_SRC="${ENGINE_SRC:-$DESKTOP/AutoLab 3D Creation Engine}"
  refresh() { name="$1"; src="$2"; rm -rf "$SRC/$name"; mkdir -p "$SRC/$name"
    git -C "$src" archive --format=tar HEAD | tar -x -C "$SRC/$name"
    echo "$name  $(git -C "$src" rev-parse HEAD)  $(git -C "$src" log -1 --format=%ci)  [$(git -C "$src" rev-parse --abbrev-ref HEAD)]" >> "$SRC/SOURCES.txt"; }
  : > "$SRC/SOURCES.txt"
  refresh universal-vehicle-configurator "$UVC_SRC"
  refresh r2-blueprint "$R2_SRC"
  refresh autolab-3d-creation-engine "$ENGINE_SRC"
  rm -rf "$SRC/r2-blueprint/references for 3D model"
  rm -f "$SRC/universal-vehicle-configurator/.devpost-hackathon-state.json"
  echo "▸ sources refreshed:"; sed 's/^/  /' "$SRC/SOURCES.txt"
fi

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
