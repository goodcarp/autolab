# AutoLab by AutoMoto

Agent-native, web 4.0 tools for car lovers. This repository is the site that
houses the three AutoLab experiences for
[The WebMCP Challenge](https://webmcp.devpost.com/):

| Path | Experience | Source | WebMCP tools |
| --- | --- | --- | --- |
| `/` | Landing page | `index.html`, `assets/` | 3 |
| `/configure/` | Web 4.0-enabled Vehicle Configurator (with the embedded **Garage** digital twin) | [`sources/universal-vehicle-configurator`](sources/universal-vehicle-configurator) | 18 (+19 inside Garage) |
| `/garage/` | Agentic Owner's Guide | [`sources/r2-blueprint`](sources/r2-blueprint) | 18 |
| `/engine/` | AutoLab 3D Creation Engine | [`sources/autolab-3d-creation-engine`](sources/autolab-3d-creation-engine) | 3 |

Live: **https://autolab.run/**

Every page publishes its tools on `document.modelContext` (falling back to
`navigator.modelContext`) with `registerTool`, and mirrors the same functions on a
window object so any browser, devtools session or Playwright script can drive the
page the way an agent would: `window.autolab` on the landing page and in the
Configurator, `window.r2` in the Owner's Guide and the embedded Garage. Each
mirror has `tools`, `call(name, args)` and one method per tool; the Configurator's
also has `activity()`, the last twenty calls from any path.

## Running it with an agent

- **ChatGPT desktop**: open any AutoLab URL in the app's built-in browser and ask it
  to read the current build.
- **Chrome 149+**: enable `chrome://flags/#enable-webmcp-testing`, restart, load the page.

The header chip on each page reports how many tools registered. **Manual mode**
means the API was not found; the experiences remain fully usable by hand.

## Changes after the submission deadline

The site was published on 2026-09-04 before the WebMCP Challenge deadline. Work
since then is recorded here so the state at the deadline is not misrepresented:

- Owner's Guide: a guided, interruptible tour (`start_tour` / `stop_tour`), `list_visible_parts` (what the camera
  sees, by component and coverage, from an id pass) and `clearance` (real
  surface-to-surface gap) and `frame_point` (look at a coordinate), 18 tools, a header chip that reports registration, a home link, registration
  parity with the other pages (`document.modelContext` first, titles,
  annotations, closed schemas, a late-injection watch), sharper descriptions for
  `measure`, `frame_part` and `set_camera`, and keyboard access.
- Configurator: the `window.autolab` mirror of all 17 tools with an on-page
  agent-activity strip; the opening camera further back; a blueprint scan sweep;
  firmer contact shadows and a rim light. Geometry unchanged.
- Engine: the `apertures` gate and its report on this page, with three named
  survivors on the current model for the author to judge.
- Engine page: the fit table, self-test line and summary are read from
  `engine/out/fit.json`, written by `fit --json` on every assembly, instead of
  typed in. On the current model (body envelope and roof covers fitted to the
  published dimensions, 2026-09-05) all nine published dimensions are within
  tolerance; the submission-time state was five of nine, with the overall
  length 54 mm long.
- Landing page: the Owner's Guide tour can be played in place.

## How this site is assembled

### September 5 model and showroom integration

The current build includes the corrected body envelope and roof covers, all nine
saved dimensional checks within tolerance, and the engine's numeric anchor-offset
support (59/59 self-tests). The configurator combines the latest camera, paint,
wheel, blueprint-scan and agent-tool work with projector optics, procedural surface
detail, live contact shadows, and deferred material attachment (149 tests passing).
The showroom uses the plain rendering pass to avoid a postprocessing/contact-shadow
artifact; Blueprint retains its glow pass. Source revisions are in `ASSEMBLED.txt`.

These are post-deadline changes. The model remains a procedural reconstruction,
and the separately reported aperture findings are not a dimensional-fit failure.

The landing page (`index.html`, `assets/`) and the engine page (`engine/index.html`,
`engine/engine.js`) are authored here. `configure/`, `garage/` and the engine's
generated outputs are produced from `sources/` by one script:

```sh
./build.sh        # needs Node >= 22.12 (corepack for pnpm) and rsync
```

It builds the configurator (`pnpm install && pnpm build`), copies the owner's
guide's static files, runs the engine to cut the section drawings and profile
overlay straight off the model, and writes `ASSEMBLED.txt` with the commit of
each source and the engine's self-test result. The built output is committed so
GitHub Pages serves it without a build step. Serve the folder with any static server:

```sh
python3 -m http.server 8790
```

The configurator is built with a relative base, the owner's guide uses relative
module paths, and `.nojekyll` keeps GitHub Pages from dropping underscore-prefixed
files, so the whole tree works from any sub-path.

## License

Apache License 2.0 for everything authored here and in `sources/`; see
[LICENSE](LICENSE) and [NOTICE](NOTICE). Third-party components (three.js under
MIT; the licensed EX30 reference GLB under MPL-2.0 AND CC-BY-4.0; the fonts under
OFL 1.1) keep their own licenses, listed in NOTICE. See
[sources/README.md](sources/README.md) for what was deliberately left out of the
public copies and why.

## Independence

AutoLab and AutoMoto are independent and unofficial. This project is not
associated with, endorsed by, or sponsored by Rivian or any manufacturer. The
vehicle geometry is an independent reconstruction fitted to published dimensions
and photographs, not manufacturer CAD. Vehicle names and specifications are used
nominatively to identify the products being discussed.
