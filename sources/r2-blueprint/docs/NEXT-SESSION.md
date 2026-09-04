# Next session

Locked at **v0.14.3**. Working tree clean, `main` pushed, artifact republished.

Two things are queued and one is a standing warning. Read the warning first — it explains why the
first task exists.

---

## 0. The warning: five defects in a row were invisible to every check in this repo

Every one of these shipped, passed both harnesses, and was then found by eye by the person the
drawing is of:

| Defect | Why the checks missed it |
| --- | --- |
| Belt rail across both door openings (v0.12.0) | Every capture rendered the doors **shut** |
| Body crease inside the rear door opening (v0.14.0) | Same |
| Deck band across the cargo opening (v0.14.1) | Every capture rendered the liftgate **shut** |
| C-pillar overhanging the door opening (v0.14.3) | Same, plus nothing measures a panel line |
| NACS ring light through the flank (v0.14.2) | Nothing checks a part against the skin it sits behind |

There is a sixth entry that is not a geometry defect at all. During the v0.14.2 work an unreviewed
edit to the `ZROOF` knot table appeared in the working tree, moved the roofline, and took the fit
from 3.5 mm to 4.8 mm. `tools/fit_check.py` caught it; nothing else would have. **Keep running the
measured baseline on every change.**

**Correction, and it matters.** At the time I blamed a concurrent analysis pass. That was wrong. The
edit came from the **AutoLab engine's `apply.mjs` write path** — its curve-fitter spliced a resampled
14-knot table into `vehicle.js` and left its rollback copy at `src/vehicle.js.autolab-backup`. That
backup contains the *pre-write* table and not the resampled one, which is what proves it. So no agent
disobeyed anything: a tool did exactly its job, and its output landed in a working tree I was editing
by hand. The lesson is about **two writers on one file**, not about agents.

**And it leaves a real open question, which nobody has resolved.** Two measurement systems disagree
about `ZROOF`:

- `tools/fit_check.py` says the resampled table is *worse* — mean 4.8 mm against 3.5 mm — but it
  measures the **top profile of a render**.
- AutoLab fits curves to the drawing and **measures the model directly in Node, with no camera in the
  loop**, which by this project's own §1 argument is the more trustworthy instrument.

The current committed table is mine, because it is the verified state and it renders correctly. Do
not treat that as settled. Run AutoLab's `fit` / `deviate` against both tables and find out which
instrument is wrong before trusting either — this is exactly the situation §5 of
`CODE-ONLY-3D-FROM-PHOTOS.md` warns about, where a confident measurement contradicted the model and
the measurement turned out to be the thing at fault.

The two harnesses have a shape:

- `tools/fit_check.py` measures only the **top profile** of the side silhouette. Every door and
  window line lives 130–400 mm below it. It cannot see any of the work of the last several versions.
- `tools/hole_check.py` renders the car **closed**. Its metric also inverts when a door is open — a
  bar across a doorway *splits* one legitimate paper blob into two smaller ones, so the total moves
  in the improving direction.

Neither is wrong. They just do not cover the class of defect this model actually produces.

---

## 1. Build the aperture-invariant harness — do this first

**The invariant:** no un-cut geometry may lie inside any aperture's boundary.

That single statement covers all four "bar across the opening" defects above, and it is checkable
without a person looking at anything.

Sketch:

```
for each aperture in CUT (doorFL/FR/RL/RR, quarter, frunk, cabin deck, tailgate opening):
    render ?only=body&open=1 with the camera square to that aperture
    project the aperture's boundary (the same CUT description the shader uses)
    assert: no body fragment inside the boundary
```

Notes for whoever builds it:

- The aperture description already exists in one place — `CUT` in `src/vehicle.js`, emitted to GLSL
  by `cutGLSL()` in `src/geom.js`. Read the boundary from there, do not re-declare it, or the check
  can disagree with the thing it is checking.
- `?only=` / `?hide=` isolation is the mechanism (`src/main.js`), and it now works for `running`
  parts too — that was broken until v0.12.1 and silently kept all four wheels in every isolation
  capture.
- Score it as a **delta against a doors-open baseline**, not as an absolute pixel count, for the
  inversion reason above.
- Capture with `run=0&nodrift=1`. The idle animation bobs the body ±6 mm and the wheels ±8 mm, which
  is the same order as the errors being chased.

**Second, smaller tool while you are in there: a panel-line check.** Nothing in the repo measures the
x position of a shut line. The rear door edge in v0.14.0 was verified by hand, by silhouette-measuring
`?only=doorRR` and comparing against the drawing row by row. That worked and should be a script, or
the rest of the shape pass is unverifiable by construction.

---

## 2. The front door — next item in the shape pass

Measured off the panel outlines drawn on Rivian's official orthographic side drawing
(`references for 3D model/official/r2_side.png`), extracted as enclosed regions and warped into our
frame. The rear door and quarter light are done; the front door is not:

| | drawing | model now | delta |
| --- | --- | --- | --- |
| front door skin | x −0.252 … **+0.858** | −0.240 … **+0.71** | **148 mm short at the front** |
| front door glass | x −0.299 … +0.531 | −0.299 … ~0.60 | ~70 mm |

The front edge was deliberately **not** moved in v0.14.0: the A-pillar, mirror sail and cowl are all
fitted around `CUT.frontX1 = 0.71`, so moving it is a real change rather than a constant edit.

Expect the same two lessons to apply:

- **A shut line is a curve, not a number.** The rear door's trailing edge rakes from −1.243 at the
  belt to −0.885 at the rocker, following the wheel arch. `CUT.rearShut` holds that table, `rakeX()`
  evaluates it in JS and `cutGLSL` emits it as a ramp, so geometry and cut read the same numbers.
  Check whether the front door's leading edge rakes too before assuming it is vertical — the drawing
  row-by-row extraction will say.
- **An aperture and a window are not the same shape.** v0.14.3: the rear door is framed, its trailing
  edge runs unbroken from rocker to roof rail, and the C-pillar sits behind it. Cutting the body only
  as far as the glass left 324 mm of shell where the door's own frame belongs. `CUT.rearFrameX0` is
  the aperture; `CUT.rearGlassX0` is where the glazing starts. The front door probably needs the same
  separation.

Anything that has to stop at a raked edge must read it from `rakeX()` — the inner door card, the
door's crease and the **body's** rear-quarter crease all had to be fixed after the fact because they
were laid out across the door's bounding box.

---

## 3. Everything else still owed

- **Liftgate resurfacing.** A small fold remains at the D-pillar base. Root cause is a closed-ring
  loft being asked to model a rear screen; it wants rebuilding as a panel, not another knot nudged.
  Artifact comment thread `ed64fa7e` is deliberately left **open** against this.
- **Wheel arch.** Ours and the drawing's disagree. The drawing's rear door edge sits ~20 mm off its
  arch; ours lands on it. Measure the drawing's arch before moving anything.
- **Aperture edge tessellation.** The body loft's 35 mm stations show as stair-steps along a cut
  edge. Pre-existing, but a raked edge shows it more than a vertical one did.
- **DLO heights.** The drawing's window tops rise ~50 mm toward the rear; ours are a flat
  `DLO_TOP = 1.565`.
- **Sheet text.** `src/config.js` still carries placeholder names in the title block and header —
  "CARPENTER MOTOR ARCHIVE", drawn/checked initials. Alexander's to set, and they are the first thing
  a viewer of the sheet reads.
- **Roof width** is the one body dimension still resting on a published figure rather than a
  measurement. A tape across the roof at the B-pillar would settle it.

---

## 4. Taking it to the AutoLab site and the configurator

Both targets are real projects on the Desktop, and they want different things from this repo. Surveyed
and fact-checked 2026-09-04; every claim below was read out of the source.

### `~/Desktop/AutoLab 3D Creation Engine` — it already consumes this model

It is **not a web app and renders nothing**, deliberately: a headless Node ESM measurement CLI whose
own README argues that a silhouette taken from a screenshot measures the renderer as much as the
model. `src/load.mjs:18` already points `DEFAULT_MODEL` at **this repo's `src/vehicle.js`**, imports
it in Node, flattens it to world-space triangles and reports dimensions, sections, clearances,
silhouette deviation and curve fits as JSON.

Two consequences, and the first one changes task 1 above:

- **Check AutoLab before building the panel-line check.** It has `silhouette.mjs`, `section.mjs`,
  `boundary.mjs`, `clearance.mjs`, `fit.mjs` and a 543-line `selftest.mjs`. Measuring the model
  directly in Node, with no camera in the loop, is strictly better than measuring a render — it may
  already do what section 1's second tool was going to do, and better.
- **Do not break the contract it depends on.** `src/load.mjs:29-51` requires `buildVehicle()` to be
  exported and to return `{ root, order }` with parts shaped `{name, label, category, desc, meshes[]}`;
  `SPEC` is picked up optionally. `src/curves.mjs:52` parses our curve layer out of the **source text**
  (`const NAME = interp([...])` with a literal array), and understands our `S.NOSE` / `S.TAIL` /
  `T(...)` anchors. Renaming those, or computing a curve instead of writing a literal, silently
  disables half the engine. It also hardcodes our part names (`wheelFL`…) and axle numbers.

There is no viewer surface there to slot into. A viewer on that site would be net-new.

### `~/Desktop/Universal Vehicle Configurator` — "AutoLab by AutoMoto", the WebMCP Challenge entry

A real, working React 19 + TypeScript + Vite app using three.js through `@react-three/fiber`, with
tests, CI, a netlify config and a committed `dist/`. It has a geometry seam where a vehicle's shape
is produced, and a catalog singleton that is not abstracted per-vehicle.

### How to embed the viewer — iframe, not inline

**Use `dist/r2-blueprint.html` in an iframe.** Inlining `dist/r2-blueprint.fragment.html` into an app
page is a fork, not an embed, and three separate things make that true:

- `src/main.js` is a top-level script that binds to fixed document ids, writes `html`/`body` CSS,
  installs a **window**-level `keydown` handler, and starts a rAF loop it never stops. There is no
  `mount(el)` / `unmount()`, no `dispose`, no `ResizeObserver` and no visibility handling — two full
  scene passes plus a composite and a 2048² shadow map keep running off-screen.
- The responsive rules in `styles.css` are **viewport** media queries, not container queries. Inlined
  into a 400 px slot on a 1900 px page, they resolve against the host viewport and lay out the full
  wide sheet on top of itself.
- Resize is `window`-only, so a container that changes size without a window resize leaves a stale
  canvas. Inside an iframe this is all correct for free.

```html
<iframe src=".../dist/r2-blueprint.html?view=iso&nodrift=1&cards=0"
        style="width:100%;aspect-ratio:16/10;border:0"></iframe>
```

Give it an explicit **wide** box. The sheet has no intrinsic height (`#sheet{position:absolute;inset:0}`),
so a zero-height container renders a blank strip rather than an error, and the framing is
**width-locked** (`camera.js` `frame()` uses each preset's `fitW` and derives distance from the
aspect), so a tall narrow box only adds empty paper.

Drive it afterwards over the postMessage bridge in `src/webmcp.js`:

```js
frame.contentWindow.postMessage({source:'r2-blueprint', id, tool:'set_view', args:{view:'side'}}, origin)
// reply: {source:'r2-blueprint-result', id, ok, result}
```

Nothing emits a ready event, so retry the first call until a reply arrives (`iframe.onload` is a
usable first signal — module scripts are deferred, so it fires after the CDN graph resolves).

**The trap:** only 10 of the 21 URL parameters have a tool equivalent. `sil`, `hide`, `only`, `bare`,
`min`, `debug`, `pbr`, `paint`, `adv`, `snap` and `nodrift` are **first-paint only** — to change any
of them you must reload the iframe with a new `src`, not post a message.

### Fix before it goes in front of anyone else

- ~~The title block claims release control it does not have~~ — **partly fixed.** STATUS is now
  `WORK IN PROGRESS` and CHECKED is `—`, so the sheet no longer says it has been through change
  control or that an AI signed it off. **Still Alexander's to set:** the header name
  ("CARPENTER MOTOR ARCHIVE"), the drawing number and the revision letter. Nothing should invent those
  for him. After any change, re-run `python3 build.py` — `dist/` is committed and nothing rebuilds it.
- ~~`?pbr=1` blank-pages both dist builds~~ — **fixed.** The dynamic import is guarded, so in a bundle
  `?pbr=1` now does nothing instead of destroying the page. The probe itself is still source-only, by
  design: it is a throwaway experiment and does not belong in the shipped bundle.
- ~~`?cards=0` writes `localStorage` permanently~~ — **fixed.** `?cards=` no longer persists and
  `?cards=1` now works, so a deep link cannot flip a browser's stored preference.
- ~~The postMessage channel has no origin check~~ — **fixed.** It now accepts messages only from the
  embedding page (`window.parent`), an opener, or same-origin, and replies to the sender's origin
  instead of `'*'`.
- **`?bare=1` is still a one-way door.** It writes inline `display:none` onto eight elements and
  nothing clears them — not the H key, not `set_annotations`, not `reset`. It is a capture flag, so
  this is noted rather than fixed; do not offer it as a user-facing toggle.
- **Eleven of the twenty-one URL parameters have no tool equivalent** (`sil`, `hide`, `only`, `bare`,
  `min`, `debug`, `pbr`, `paint`, `adv`, `snap`, `nodrift`) and so are first-paint only: changing any
  of them means reloading the iframe with a new `src`. If the configurator needs silhouette mode or
  part isolation at runtime, they want tools adding in `src/webmcp.js` — that is a small job and it
  is not done.
- ~~`src/vehicle.js.autolab-backup` is tracked~~ — **resolved.** It is not clutter: AutoLab's
  `apply.mjs` writes it as its rollback copy before splicing a curve, so it must stay on disk. It is
  now gitignored and untracked, which is what it should always have been — a generated artifact, not
  source. Its presence is also the evidence that identified the `ZROOF` writer (see section 0).
- Do not present the model as dimensionally authoritative below the roofline. The 3.5 mm figure comes
  from a harness that measures only the top profile.

---

## Where things stand, measured

- Fit against the official drawing: **mean 3.5 mm, shape-only 1.6 mm**, roof 1.697 m against a
  drawn 1.700 m. Two outliers, both at the tail, where the drawing's overhang warp is least reliable.
- See-through pixels strictly inside the silhouette: **379**, all of it the 1-px highlight along the
  hood shut line, which is a real 6 mm panel gap.
- Geometry render is byte-identical across repeat captures; the full sheet is not, because the
  instrument panel shows a live frame rate.
