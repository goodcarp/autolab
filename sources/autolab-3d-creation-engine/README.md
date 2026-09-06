# AutoLab 3D Creation Engine

A ruler that measures the model directly, instead of measuring a picture of it.

Everything here reads geometry. Nothing goes through a camera, so nothing here
can be wrong because of one.

```bash
npm install
npm run selftest          # calibrate, then gate on the wheelbase
npm run fit               # measured against published dimensions
```

## The instruments

| Command | Question |
| --- | --- |
| `node src/cli.mjs selftest` | Are the instruments calibrated? Refuses to certify a model whose axle-to-axle distance is not its published wheelbase. |
| `node src/cli.mjs dims` | The measurements a specification actually names, each carrying the landmarks it was taken from. |
| `node src/cli.mjs fit [--json]` | Every published dimension against the model, with tolerances, and the part that owns each extreme; `--json` for a page or an agent. |
| `node src/cli.mjs extremes` | Which part owns each end of the envelope. Turns "54 mm too long" into "the headlamps". |
| `node src/cli.mjs parts` | Every part, its category, triangle count and envelope. |
| `node src/cli.mjs section <x> --svg out/s.svg` | A cross-section, drawn to scale on a millimetre grid, for laying over a drawing. |
| `node src/cli.mjs clearance <a> <b>` | Nearest surface-to-surface distance, not centre-to-centre. |
| `node src/cli.mjs overlaps` | Which parts' envelopes intersect. |
| `node src/cli.mjs apertures [--band 50] [--edge 65]` | Does any fixed geometry sit at the skin, well inside a door, hood or liftgate opening, at four open fractions? Names the part, how far inside and how deep; exits non-zero on any survivor. See [APERTURES](docs/APERTURES.md) and the [current findings](docs/aperture-results.md). |
| `node src/cli.mjs symmetry` | Shape symmetry about the centreline, section by section. |
| `node src/cli.mjs reference` | What the drawing's calibration actually supports, checked against the spec. |
| `node src/cli.mjs knots top --tol 3` | A knot list fitted to the reference, as pasteable `interp([...])` source. |
| `node src/cli.mjs deviate --svg out/o.svg` | The model's outline against the drawing, broken down by region. |
| `node src/cli.mjs curves` | The curve layer: which curves are writable, and how anchored. |
| `node src/cli.mjs propose ZROOF --frame axles` | Fit a curve to the drawing, build that model, measure it, show the diff. |
| `node src/cli.mjs propose ZROOF --frame axles --write` | Apply it. Refuses a repository with uncommitted work. |

`MODEL_PATH` picks the model. It defaults to `~/Desktop/r2-blueprint/src/vehicle.js`,
which is **read and never written** — that repository stays canonical. Any module
exporting `buildVehicle()` works.

## What it found on its first run

```
!length_m             4.722      4.776      +54mm     ±10mm
!height_m             1.699      1.7097     +10.7mm   ±10mm
!frontOverhang_m      0.842      0.876      +34mm     ±10mm
!rearOverhang_m       0.944      0.964      +20mm     ±10mm

  x  min -2.432 m  tailgate        max 2.344 m  headlamps
  y  min  0     m  wheelFL         max 1.7097 m roofGlass
```

The headlamps stand 34 mm proud of the nose and the tailgate 20 mm past the
tail, which is the whole of the +54 mm. The roof glass is 10.7 mm above the
published height. Wheelbase, both tracks and width over mirrors are exact.

That took one command, and none of it required looking at the car.

## The reference side

The image work is `r2-blueprint/tools/measure_ortho.py`, which is not
duplicated here: it anchors y on the ground and roof, anchors x on the two
axles, and warps the overhangs so the nose and tail land on the published
length. Its output is snapshotted in `reference/` because it writes to `/tmp`.

What this engine adds is the half that was open — turning that reference into
something the curve layer can consume, and saying how far the model is from it.

**Calibration is checked, not assumed.** `reference` re-runs finding 02 on load:

```
height  drawn 1.700  published 1.699   0.06%   trusted
length  drawn 4.516  published 4.722   4.36%   NOT trusted
```

A knot list fitted to this drawing inherits that, and says so.

**Knots are fitted with the model's own interpolator.** `knots.mjs` imports
`interp` from `geom.js` rather than reimplementing monotone-cubic, so a fitted
list reproduces in the model exactly rather than approximately. Greedy
insertion puts a knot where the curve is most wrong, so they land on features
without anyone pointing at them:

```
tol 10mm -> 21 knots | max  8.88mm | mean 2.35mm
tol  5mm -> 30 knots | max  4.31mm | mean 1.42mm
tol  3mm -> 36 knots | max  2.82mm | mean 0.65mm
```

**Deviation is reported by region, because one number cannot judge an outline.**

```
TOP     median 0.89 mm · p95 10.75 mm
   between axles   median   0.58 mm
   rear wheel      median   0.41 mm
BOTTOM  median 81.98 mm · p95 105.82 mm
   rear wheel      median  14.92 mm
   between axles   median  97.61 mm
```

The roofline is within a millimetre for most of the car. The lower outline is
not one feature: at the axles it is the tyre contact patch and both agree; between
them the drawing shows 343 mm where this model's lowest element sits at 244 mm,
which is exactly the published ground clearance. Those may both be right — a
clearance figure is a minimum anywhere, and the visible line at mid-wheelbase
may be the rocker. The engine surfaces that and leaves the judgement alone.

## Closing the loop

`propose` fits a curve to the drawing, splices it into a **copy** of the model,
builds that copy, measures it against the reference, and prints a diff. It
writes nothing unless asked, and refuses to write into a repository with
uncommitted changes — the near-miss that rule exists for happened on this
project, when two agents shared a working directory.

Three things it will not do:

**It will not extrapolate.** Fitting `ZROOF` over its own domain asks for
stations the drawing does not cover; the first version clamped to the endpoint
and turned a flat run of the last value into real-looking knots, producing a
roofline at the tail of 0.976 m from a drawing that says nothing about that
station. `resample` now refuses, and `propose` intersects the domains.

**It will not reformat.** A knot whose value is unchanged is written with the
author's own text, character for character: `T(2.60)` stays `T(2.60)`. Knots
outside the fitting window are preserved untouched, because a reference that
covers part of a curve has no opinion about the rest. Re-rendering all eight
curves from their own values produces the file back byte for byte — which is
the property that makes a proposed diff worth reading.

**It will not fit a curve it cannot verify.** Which curve corresponds to which
measurement is derived, not declared: shift the curve a millimetre in a scratch
copy, rebuild, and see which stations respond.

```
ZROOF  authority -2.392 .. 1.031   drives top      8 parts respond
ZT     authority -2.408 .. 2.288   drives top     12 parts respond
ZB     authority -2.281 .. 2.256   drives bottom  10 parts respond
HWB    authority none              drives nothing 11 parts respond
```

`HWB` moves eleven parts and nothing at all in a side view, because it is a
half-width curve. `propose HWB` refuses and says so.

**It will not fit across a boundary where the reference has stopped describing
the curve.** Before fitting, it compares the curve with the reference across the
window and trims where the disagreement is a wild multiple of the median — 0.77
mm across this roof, 272 mm at the tail edge, where the drawing's outline has
become the tailgate. Then it snaps the window outward to the author's own knots,
so the fit replaces whole spans and every join is at a knot somebody placed.

**It will not call noise an improvement.** The side drawing's height agrees
with the published spec to 0.06%, about a millimetre on this car. A change
smaller than that is a measurement of the drawing's error, not the model's.

```
ZROOF  frame: drawn    5.43 mm -> 5.24 mm  (-0.19 mm)   Not recommended
ZROOF  frame: axles    6.80 mm -> 5.36 mm  (-1.44 mm)   Recommended
```

That difference is the answer to a question worth asking. In the drawing's own
frame the roofline is already right and refitting gains nothing. Aligned to the
axles it is 6.8 mm out and refitting is worth doing. Which frame the curve
should live in depends on how the model was built, so `--frame` has no default
that hides the choice.

## How it is put together

```
load.mjs      flattens a model into world-space triangles tagged by part
ruler.mjs     envelopes, key dimensions, extremes, the part table
section.mjs   plane slicing, section chaining, shape symmetry
svg.mjs       a section drawn to scale on a millimetre grid
clearance.mjs nearest surfaces, exact axis gaps, the overlap matrix
apertures.mjs closed panel footprints, surviving intrusions at four open fractions
reference.mjs a calibrated drawing, with its landmarks re-checked on load
knots.mjs     fewest knots that reproduce a profile, in the model's own interp
silhouette.mjs the model's outline, and deviation from the reference by region
curves.mjs    reads the curve layer, preserving S.NOSE / T(4.715) anchors
apply.mjs     propose, build a variant, measure, diff, and a content precondition
authority.mjs which stations a curve controls, measured by perturbing it
boundary.mjs  where the reference stops describing the curve, and the seams
shape.mjs     did the fit keep the shape, or only the average
fit.mjs       measured against a spec, with tolerances
selftest.mjs  calibration and the wheelbase gate
cli.mjs       one command surface
```

The model imports `three` bare and lives in another repository with no
`node_modules`. Rather than copy it in — which is the drift that once left a
released door fix unused for a day — `three-hook.mjs` resolves `three` from
here, and the model stays where it is authored.

`docs/LEARNINGS.md` records why each instrument is shaped the way it is,
including the two that were built wrong first.
