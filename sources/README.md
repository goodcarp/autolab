# Sources

Clean copies of the three AutoLab source trees, taken from each repository's
committed `HEAD` with `git archive` (tracked files only; no build output, no
`node_modules`, no local tool state). Commits are recorded in `SOURCES.txt`.

| Directory | What it is | Run it |
| --- | --- | --- |
| `universal-vehicle-configurator/` | Web 4.0-enabled Vehicle Configurator, with the Garage digital twin embedded under `public/garage/` | `pnpm install && pnpm dev` |
| `r2-blueprint/` | Agentic Owner's Guide: the general-arrangement drawing and 3D digital twin | `python3 serve.py 8765` |
| `autolab-3d-creation-engine/` | AutoLab 3D Creation Engine: Node.js measurement instruments | `pnpm install && MODEL_PATH=../r2-blueprint/src/vehicle.js npm run selftest` |

Each directory keeps its own README with the full instructions.

## What was left out, and why

- `r2-blueprint/references for 3D model/` — the photographs and manufacturer
  dimension drawings the model was fitted against. They are third-party images
  and are not redistributed here. The two measurement scripts that read them
  (`tools/measure_ortho.py`, `tools/measure_side.py`) still ship; point them at
  your own reference images. The engine's calibrated reference profiles derived
  from those drawings are included under `autolab-3d-creation-engine/reference/`
  with their provenance.
- `universal-vehicle-configurator/.devpost-hackathon-state.json` — local
  submission-tool state, not part of the project.

## Engine model path

The engine defaults `MODEL_PATH` to `~/Desktop/r2-blueprint/src/vehicle.js`, the
author's working checkout. In this repository, set it to the sibling copy:

```sh
cd sources/autolab-3d-creation-engine
pnpm install
MODEL_PATH=../r2-blueprint/src/vehicle.js npm run selftest
MODEL_PATH=../r2-blueprint/src/vehicle.js npm run fit
```

The model file is read and never written.
