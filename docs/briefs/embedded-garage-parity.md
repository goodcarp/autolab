# Brief: bring the configurator's embedded Garage up to the standalone Owner's Guide

For Astra (GPT-6 Astra, through Codex) when credits return on 2026-09-07, or for
whoever picks it up. Written by Fable on 2026-09-05.

## The gap

The configurator embeds a copy of the Owner's Guide at
`sources/universal-vehicle-configurator/public/garage/` (14 tools: the guide's
13 at the time plus the `set_vehicle_context` bridge). Since then the standalone
guide (`sources/r2-blueprint/`) gained, all merged and live:

- the guided tour (`src/tour.js`, `CONFIG.tour`, `start_tour` / `stop_tour`,
  the caption card, the TOUR button, `?tour=1` deep links);
- the header chip and home link, registration parity (`document.modelContext`
  first, `registerTool` with titles, annotations, closed schemas, a 12-second
  late-injection watch), `window.r2.registered` / `.api`;
- `list_visible_parts` (id pass at the sampling grid's resolution),
  `clearance` (surface-to-surface), `frame_point` (look at a coordinate);
- keyboard access (focusable key rows, canvas name, Space scoped);
- the minified three build with module preloads.

The embedded copy's `webmcp.js` differs from the guide's by 651 lines: it has
its own schema validation, annotation sets and the bridge tool. `main.js`,
`ui.js`, `config.js`, `index.html` and `styles.css` differ too. `vehicle.js`
and `geom.js` are identical (they are promoted by `scripts/promote-garage-model.mjs`).

## The ask

Make the embedded Garage carry the same 18 tools and the tour, so "Take me
into the Garage and start the tour" works from the configurator, without losing
the bridge or the configurator-specific validation.

Preferred shape: stop maintaining a fork. Have the embedded copy import the
guide's modules unchanged (`tour.js`, the tool table, the id pass, the
clearance instrument) and add the bridge tool and the configurator's
validation as a layer on top, so the next guide change is a promote, not a port.
If that is not reachable in a day, port the tour and the three instruments and
leave a note saying which files are forks.

## Acceptance

- `tests/unit/garage/webmcp.test.ts` lists 19 tools (18 + bridge); all
  existing UVC tests stay green (`corepack pnpm test:run`, typecheck, lint, build).
- From the configurator page, `window.autolab.set_autolab_workspace` to the
  Garage, then the Garage's `start_tour` runs nine steps and any configurator
  control stops it; captured at desktop and phone widths.
- `model:check` still passes (the model copy is unchanged by this work).
- No local absolute paths in anything that ships.

Verification harness: Playwright lives in the configurator's node_modules; the
site is served from `~/Desktop/autolab` with `python3 -m http.server`.
