# Rivian R2 · General Arrangement

A blueprint-style technical drawing of a Rivian R2 that opens up into 3D exploration. Everything is generated in code with three.js: the vehicle is a procedural model (lofted sections, ribbons for seams and pillars, parametric wheels, chassis and interior), and the blueprint look is a post-processing pipeline (normal / depth / part-id G-buffer plus a composite shader that draws the ink edges, hatching, ground grid and shadow hatch). The sheet furniture (callouts, dimension lines, datum lines, section arrows, detail circle) is an SVG overlay re-projected every frame.

## Run

Module scripts and the CDN import map need an HTTP origin, so serve the folder:

```bash
python3 serve.py 8765
```

then open <http://127.0.0.1:8765/>. three.js (r170) is loaded from jsdelivr, and the IBM Plex Mono font from Google Fonts, so the first load needs network access.

## Controls

- **TOUR** — a 54-second sequence of tool calls with captions; click TOUR or press T to start. Any key, canvas press, sheet click or other tool call interrupts it. See [docs/TOUR.md](docs/TOUR.md) for tools and held capture links.
- **VIEW** — ISO · 3/4 F · 3/4 R · SIDE · FRONT · TOP. Elevations are true orthographic projections; the camera blends projection matrices during the eased transition. Dimension lines and the view title fade in once the camera settles. ISO auto-orbits slowly until you drag.
- Drag to orbit, scroll to zoom (dragging out of an elevation blends back to perspective).
- Hover a part (or a KEY TO ITEMS row) for the orange highlight and tooltip.
- **MOTION** — RUN (ignition: powers the instrumentation, daytime-running glow, idle settle), DRIVE (wheels spin, steering wags, grid streams under the car, speed / rpm / state of charge update), LIGHTS (headlamps, light bar and tail lamps on, with beam pools on the ground), PANELS (dissolves the body shell to show the skateboard chassis), EXPLODE (exploded view with dashed guide lines), OPEN (four doors, frunk lid, liftgate and charge-port door).
- Keyboard: 1–6 select views, arrow keys orbit and `[` / `]` dolly (hold Shift for coarse steps), Space toggles DRIVE, r/d/l/p/e/o trigger the motion buttons, H hides the panels.
- The small square at the top right (or H) dissolves every sheet card away so the drawing stands on its own; each card also has its own − / + to collapse it. Both are remembered per browser.

Deep links for captures and sharing: `?view=side&snap=1`, `?view=iso&explode=1`, `?view=q34f&panels=0`, `?view=front&open=1`, `?lights=1`, `?drive=1`, `?nodrift=1`, `?adv=2` (advance the simulation 2 s before the first frame), `?az=140&el=15`, `?cards=0` (hide the sheet cards), `?bare=1` (hide all sheet furniture), `?sil=1` (flat silhouette, for measurement), `?run=0` (freeze the idle animation — required for measurement, since the body bobs ±6 mm and the wheels ±8 mm), `?only=greenhouse` / `?hide=pillars` (isolate parts by name when tracking down a stray surface), `?min=key,instr,titleblock`, `?debug=1` (state and layout-overflow probe on the console).

## Agent control (WebMCP)

The sheet is operable by an agent, not only by a person with a pointer. `src/webmcp.js` exposes 18
tools over three surfaces that all drive the same handlers:

- **`navigator.modelContext`** — the W3C Web Model Context proposal, where the browser supports it.
  Both the `provideContext({tools})` and `registerTool(tool)` shapes are tried.
- **`window.r2`** — a promise-returning API that works in any browser, in devtools and in
  Playwright/Puppeteer: `await window.r2.frame_part({ part: 'battery' })`.
- **`postMessage`** — the same API across an iframe boundary. Post
  `{source:'r2-blueprint', id, tool, args}`; a `{source:'r2-blueprint-result', id, ok, result}` comes back.

| Tool | What it does |
| --- | --- |
| `get_state` | View, camera pose, which motions are running, what is selected, tour status |
| `start_tour` | Start the tour, optionally from a 1-based step |
| `stop_tour` | Stop in place without restoring the scene |
| `set_view` | One of the six standard views |
| `set_motion` | `run` / `drive` / `lights` / `panels` / `explode` / `open`, on, off or toggle |
| `set_camera` | Absolute azimuth, elevation, distance and an orthographic toggle |
| `orbit_camera` | Relative nudge plus zoom |
| `frame_part` | Point the camera at one component and fit it to the sheet |
| `list_parts` | All 42 components; `detail:true` adds bounding boxes in metres |
| `get_part` | One component's description, bounds, explode vector, visibility |
| `measure` | Centre-to-centre distance between two components |
| `highlight_part` | Select a component and run a leader to it |
| `set_annotations` | Show or hide the sheet furniture |
| `get_specification` | The published R2 figures every curve is fitted to |
| `reset` | Back to how the sheet opens |

Every tool returns structured JSON in metres, and errors carry the recovery
(`no part "flux capacitor". Call list_parts for the 42 available ids.`). `measure` doubles as the
self-test for the measurement tooling: front wheel to rear wheel must return the wheelbase, 2.936 m.

## Files

- `index.html`, `styles.css` — the drawing sheet (zones, borders, panels, title block).
- `src/main.js` — state, input, animation loop, URL parameters.
- `src/blueprint.js` — render pipeline: beauty pass (Lambert + shadow map), MRT G-buffer, composite GLSL.
- `src/vehicle.js` — the procedural R2 (dimensions from the published spec; surfacing checked against the photos in `references for 3D model/`). Doors, hood, liftgate and charge-port door are hinged parts; their apertures are cut out of the body lofts in the shaders.
- `build.py` — bundles everything into `dist/r2-blueprint.html` (standalone) and `dist/r2-blueprint.fragment.html` (artifact body).
- `src/geom.js` — section loops, lofts, surface ribbons, caps, helpers.
- `src/camera.js` — orbit rig, view presets, perspective↔orthographic blend.
- `src/overlay.js` — SVG callouts, dimensions, datums, detail circle, section arrows, guide lines, flash burst.
- `src/ui.js`, `src/config.js` — panels and all sheet text (edit names, key items, title block here).
- `src/webmcp.js` — the WebMCP / `window.r2` / postMessage tool surface described above.
- `cap.sh` — headless Chrome capture helper: `./cap.sh out iso 'view=iso&snap=1&adv=2'`. Add `sil=1&bare=1` for a black silhouette on paper.
- `tools/measure_side.py` — compares our side silhouette with a reference *photo*, station by station, correcting for perspective.
- `tools/measure_ortho.py` — reads Rivian's official orthographic dimension drawings in `references for 3D model/official/` and calibrates off their own dimension extension lines, producing the reference profile the body is fitted to.
- `tools/fit_check.py` — diffs our rendered silhouette against that reference in millimetres, station by station. Calibrates on the axle centres and the tyre contact patch, **not** on the overall length: the bumpers project ~35 mm past the body datum, which inflates the scale by 0.75% and silently shortens every height by 13 mm. Current fit: **mean 3.4 mm, shape-only mean 1.6 mm**, roof 1.697 m against a drawn 1.700 m.

  ```bash
  python3 tools/measure_ortho.py side "references for 3D model/official/r2_side.png"
  ./cap.sh out sil  'view=side&snap=1&adv=2&bare=1&sil=1&run=0&nodrift=1'
  ./cap.sh out wsil 'view=side&snap=1&adv=2&bare=1&sil=1&run=0&nodrift=1&only=wheelFL,wheelFR,wheelRL,wheelRR'
  python3 tools/fit_check.py out/sil.png out/wsil.png
  ```
- `tools/cap_size.sh` — captures at a given window size, for the responsive layout. Note that headless Chrome clamps the window to a 500 px minimum, so true phone widths have to be checked with browser device emulation rather than a window size.
- `tools/clearcheck.html` — headless clash and clearance report for the front suspension module.
- `docs/CODE-ONLY-3D-FROM-PHOTOS.md` — what this build taught about reconstructing a vehicle as code from photographs: why measurement beats visual review, how to calibrate without lying to yourself, and the six-layer kernel the geometry is organised into.
- `docs/measure-dont-look.html` — the same report as a standalone page (the source of the published artifact, kept here so it survives independently of the artifact host).

## How the model is built

The body is a set of lofted cross-sections driven by a handful of profile curves at the top of `src/vehicle.js` (`ZB` underbody, `ZT` belt and hood, `ZROOF` windscreen and roof, `HWB`/`HWT`/`HWG` half-widths). Openings — the four doors, the frunk, the quarter windows, the cabin — are not modelled as separate holes but cut out of those lofts in the shader by `cutGLSL` in `src/geom.js`, using one shared `CUT` description. That is why the pillars and surrounds are a single continuous surface rather than parts that have to be made to meet, and why the door skins register with their apertures exactly.
- `build.py` — bundles everything into `dist/r2-blueprint.html` (one self-contained file; three.js still comes from the CDN) plus a body-only `dist/r2-blueprint.fragment.html` for artifact hosting.
