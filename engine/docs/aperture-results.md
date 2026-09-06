# Aperture results (calibrated gate)

`node src/cli.mjs apertures` on the committed model (`r2-blueprint` `tour`/main, `src/vehicle.js` at 1703ded),
band 50 mm behind the closed skin, edge margin 65 mm, lids under 0.1 m² measured but not judged.

| Aperture | Status | Footprint m² | Edge contacts (≤ 65 mm inside the outline) | Survivors (> 65 mm inside, ≤ 50 mm deep) |
| --- | --- | --- | --- | --- |
| hood | FAIL | 2.068 | headlamps, lightBar, pillars | body: 76 mm inside, 5.9 mm deep at x 2.230 y 1.072 z 0.703 |
| doorFL | PASS | 0.986 | body, cladding, doorRL, greenhouse, pillars | — |
| doorFR | PASS | 0.986 | body, cladding, doorRR, greenhouse, pillars | — |
| doorRL | FAIL | 0.943 | body, cladding, doorFL | greenhouse: 158 mm inside, 4 mm deep at x -0.402 y 1.412 z -0.843; pillars: 158 mm inside, 0 mm deep at x -0.402 y 1.385 z -0.857 |
| doorRR | FAIL | 0.943 | body, cladding, doorFR | greenhouse: 158 mm inside, 4.1 mm deep at x -0.401 y 1.224 z 0.907; pillars: 158 mm inside, 0 mm deep at x -0.400 y 1.354 z 0.868 |
| tailgate | FAIL | 1.632 | body, fasciaRear, greenhouse, pillars, roofGlass | cargoFloor: 156 mm inside, 15 mm deep at x -2.395 y 0.710 z -0.550 |
| chargePort | INFO | 0.025 | — | body: 72 mm inside, 13 mm deep at x -2.087 y 0.816 z -0.925; inlet: 74 mm inside, 43 mm deep at x -2.088 y 0.814 z -0.915 |

## What the survivors are

Three findings for the model's author, in order of size. The gate reports them as FAIL because the
instrument has no way to know which are design and which are the sixth defect of the class that
produced the five in `NEXT-SESSION.md`; it names the part and the place, and the person decides.

1. **Rear doors, both sides: `pillars` and `greenhouse` 158 mm inside the door outline at the skin** (x ≈ −0.40, y 1.22–1.41 m).
   The rear doors' window frames reach forward over the B-pillar above the belt line by about 158 mm. Real rear doors
   start at the pillar's rear face; a frame that wraps 158 mm over the pillar is either a quarter-glass design choice or the
   same overhang class as the C-pillar defect fixed in v0.14.3. Capture: `?view=q34f&open=1&az=…` from the front-left, eye level.
2. **Hood: `body` 76 mm inside the hood outline, 6 mm below the skin** (x 2.230, z ±0.703). The fender top runs 76 mm under the
   hood's side edge. Hoods overlap fenders by a shut line, not 76 mm.
3. **Tailgate: `cargoFloor` 156 mm inside the tailgate outline, 15 mm behind the skin** (y 0.71). The load floor's rear lip sits
   inside the gate's outline above the bumper. This is how every SUV is built (the gate wraps down over the sill), so this one is
   most likely design; it is listed because the instrument cannot tell.

Everything else that touches an opening does so within 65 mm of its edge: flanges, sills, cladding returns, the adjacent door's
frame, pillars under the front doors, the lamps under the hood edge.

## Negative fixtures (`fixtures/aperture-bars.mjs`)

| Aperture | Fixture | Inside the outline (mm) | Behind the skin (mm) |
| --- | --- | --- | --- |
| doorFL | fixtureFlankLight | 454 | 36 |
| doorFL | fixtureFrontDoorBar | 398 | 31 |
| doorRL | fixtureFrontDoorBar | 175.9 | 31.2 |
| doorRL | fixturePillarOverhang | 300 | 37.6 |
| tailgate | fixtureLiftgateBand | 410 | 38.2 |

All four fixture classes (bar across a doorway, band across the cargo opening, pillar overhanging a door, lamp through a door skin)
FAIL at every open fraction; the front-door bar is also caught from the rear door's side. Exit code 1.

## Reading it

A survivor is fixed (non-moving) geometry at the skin (within `--band` mm behind the closed panel's surface) and more than
`--edge` mm inside the panel's projected footprint. The footprint is the union of the closed panel's skin triangles, rasterised at
2 mm and closed over 20 mm gaps, so patch seams and the notch behind a raked pillar are handled; the inset is an exact Euclidean
distance to the nearest point outside that footprint. Shader-cut regions (`inAperture` discards) are read by interval arithmetic
as in the first version; an unresolved region still FAILs rather than passing.

The superseded first version (100 mm prism, no edge margin) failed every opening on the real model because floors, sills and
flanges legitimately live inside such a prism; it is kept in git history only.


## Looked at, 2026-09-05 (Fable)

The three survivors were framed from their own coordinates in the Owner's Guide
with the doors, hood and liftgate open (`frame_point`, then `list_visible_parts`):

- rear door frames over the B-pillar (158 mm): the frame's upper rail runs over
  the pillar's face behind it; nothing crosses the opening. Reads as the door
  frame overlapping the pillar, which real doors do, only wider here.
- fender top under the hood's side edge (76 mm): the fender top surface runs
  under the raised hood edge; with the hood shut the seam is clean.
- load floor lip inside the liftgate outline (156 mm): the liftgate drops below
  the load floor, as SUV gates do; the floor's rear lip is inside its outline
  by construction.

None is a visible defect from those views. They stay listed, because the gate
cannot know that, and the author has the say. If they are accepted, the honest
change is an explicit accepted-survivor list in the report, not a wider margin.
