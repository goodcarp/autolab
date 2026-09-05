# Apertures

`node src/cli.mjs apertures [--band 50] [--edge 65]` asks whether any fixed
geometry (outside a panel's moving assembly) sits *at the skin* and *well inside*
the opening the closed panel defines. Two numbers make the gate: `--band`, how
far behind the closed skin still counts as "at the skin" (50 mm), and `--edge`,
how far inside the panel's footprint a survivor must be before it is judged
rather than reported as an edge contact (65 mm: door frames overlap their
pillars and sills by up to that in any real car). The footprint is the union of
the closed panel's projected skin triangles, rasterised at 2 mm and closed over
20 mm seams; the inset is an exact Euclidean distance to the nearest point
outside it. Lids under 0.1 m² (the charge-port door) cover a recess by design,
so what they cover is measured and listed as INFO, never FAIL.
It prints JSON and exits 1 on any FAIL (including unresolved shader boundaries),
0 only when every gated opening passes. Current results and the three named
survivors on the model: `docs/aperture-results.md`. A missing animation, missing skin,
non-finite geometry or unsupported clipping refuses certification with exit 1.

```bash
MODEL_PATH=/Users/spaceman/Desktop/r2-tour/src/vehicle.js node src/cli.mjs apertures
node --test
MODEL_PATH=/Users/spaceman/Desktop/r2-tour/src/vehicle.js npm run selftest
APERTURE_BASE_MODEL=/Users/spaceman/Desktop/r2-tour/src/vehicle.js node --test
MODEL_PATH="$PWD/fixtures/aperture-bars.mjs" node src/cli.mjs apertures
```

No install, camera, renderer, source rewrite or alternate model copy is involved.
`fixtures/aperture-bars.mjs` imports that same vehicle module and adds
`fixtureFrontDoorBar` across the front-left doorway and `fixtureLiftgateBand`
across the cargo opening. `APERTURE_BASE_MODEL` selects a different base for the
wrapper. The integration test is opt-in so the ordinary unit suite does not
require somebody else's Desktop checkout.

## The measured volume

The instrument closes the vehicle with `openT=0`, `explodeT=0`, `panelsT=1`, and
calls `update(0, state)` with time, speed and steer zero and run/drive false.
It measures group motion at `openT=1` to discover the panels. Known panel names
that exist but do not move cause an error. Descendants of each moving group are
its assembly, including meshes registered under another part name. Other moving
panels are still tested; there is no blanket exclusion for moving geometry.

The R2 adapter selects the panel's primary skin and glazing by the registry's
existing sub IDs, not by hand-drawn cut coordinates:

| Panel | Selected sub IDs | Projection / inward direction |
| --- | --- | --- |
| doorFL, doorFR | 0, 1 | x/y plane, toward z=0 |
| doorRL, doorRR | 0, 1, 7 | x/y plane, toward z=0 |
| hood | 0 | x/z plane, downward in y |
| tailgate | 0, 1 | z/y plane, forward in x |
| chargePort | 0 | x/y plane, toward z=0 |

Handles, door cards, mirrors, hood badges, lettering and lamps do not enlarge
the footprint. They remain part of their moving assembly and are excluded from
that opening's obstruction test. Unknown moving groups use all their meshes
and a side projection; they need an adapter review before measuring a different
vehicle architecture. Coordinates follow the engine's x-forward, y-up, z-right
contract, in metres.

Each selected closed triangle supplies a projected patch and its own sloping
skin plane. Extruding that patch **100 mm inward along the projection axis**
produces a triangular prism. The aperture is the union of those prisms, expanded
by a **2 mm box in all three model axes**. This is an exact Minkowski expansion
of each prism, constructed with convex hulls. Its corner distance can be
2√3 mm in 3D. It expands rather than erodes the boundary; there is no forgiveness
band which could hide a remnant. A spatial index rejects only disjoint bounds.
Every candidate triangle is clipped against the prism's planes, so even a large
triangle with all vertices outside the opening is tested.

The union preserves rakes, concavity, glazing and gaps between meshes; it is not
the convex hull or bounding rectangle of a whole door. The closed panel itself
is the shell-surface proxy. We do not project onto the remaining, already-cut
body, which could make a missing opening define its own acceptance boundary.
No CUT constants are used to choose the tested footprint.

The 100 mm reach is a declared inspection slab, chosen to include shallow rails,
creases and the historical 52 mm deck band while excluding most of the cabin.
It is not a claim about the real vehicle's jamb depth. The same reach is used
for every panel. Legitimate sills, a tub rim or fixed trim inside it FAIL too:
this instrument measures occupation, not design intent. No part/category allow
list hides those results.

The R2 liftgate is a cap plus a closed-ring rear-glass loft, not a single-valued
outer sheet. This implementation conservatively retains **all** selected skin
facets, including overlapping projections and inner/return facets of closed
meshes. Their prisms are unioned independently. It does not compute an outermost
surface envelope or fill unsupported gaps. Consequently some FAILs can be due
to a return facet, panel overlap or expanded edge rather than a bar across the
usable opening. Review the reported position before interpreting a FAIL as a
model defect. A PASS only covers this explicitly defined volume.

## Shader cuts are part of the geometry contract

R2 body, greenhouse and surround meshes retain triangles across the openings.
The material discards fragments using `inAperture(vObjPos)`. The instrument calls
that material's `onBeforeCompile` with the relevant shader include markers,
reads the emitted scalar GLSL and evaluates its actual rounded constants. Thus
CUT is still the single source for what is removed. A `userData.cut` flag alone
never exempts a mesh, and an uncut crease in the same part remains measurable.

The reader supports scalar declarations, scoped blocks, `if` regions returning
true, the final false return, arithmetic, comparisons, booleans, ternaries,
`abs`, `min`, `max`, and `clamp`. It checks the object-position varying and maps
intersection polygons back through each mesh's world transform. Unknown syntax,
other custom discard logic, shader materials, material clipping planes, alpha
tests, multiple materials, instancing, skinning and morph targets refuse
certification. This is not a general GLSL interpreter or a GPU test.

Interval arithmetic proves that a whole intersection polygon is discarded.
Otherwise surviving vertices and centroids provide witnesses, or the polygon is
bisected until a survivor is found or its extent is at most **0.1 mm**. An
unresolved region (or exhaustion of the 20,000 subdivision-call budget per
intersection) is a FAIL with `shader boundary unresolved`, a position, and a
null intrusion depth. It cannot silently become a PASS. Numerical clipping uses
a 1e-10 m plane epsilon and drops intersections of doubled area ≤1e-14 m²;
zero projected area facets and pure point/edge contact have no surface area to
measure. Arithmetic is CPU double precision, not GPU float rounding.

The current model's HOOD_EDGE stations include 1.14 followed by 1.08. Its emitted
ramp contains `clamp(p.x - 1.1400, 0.0, -0.0600)`. Reversed clamp bounds have
undefined results in the [GLSL specification](https://registry.khronos.org/OpenGL/specs/gl/GLSLangSpec.4.60.pdf).
The reader propagates an unknown interval and reports `shaderLimitations`;
affected unresolved intersections fail without asserting an intrusion depth.
The model is not edited to resolve this ambiguity.

## Reading the report

Every aperture includes its selected skin count, projection, expanded bounds,
assembly part names, and an independent result for `openT` 0, 0.25, 0.5 and 1.
Each pose lists every offending part, a witness in **world x/y/z metres**, and
`intrusionDepth_mm`: the maximum measured inward distance **normal to a closed
skin facet**, restricted to the inspected volume. A sloping facet's normal depth
differs from the axial 100 mm reach. A surface just outside the skin but inside
the expansion can report 0 mm and still FAIL.

For uncut surfaces the maximum comes from clipped polygon vertices. For shader
surfaces it is a witnessed lower bound (`depthIsLowerBound: true`); the cut can
hide a deeper vertex, and the search stops once a survivor has been established.
An unresolved shader witness has no certified depth. A certified intersection
is preferred over an unresolved one in the per-part maximum. The report lists
shader limitations even when that part also has a certified witness elsewhere.

## Coverage and limits

The charge-port door is deliberately reported too. The current shell has no
charge-port opening in its cut description, so solid body behind that moving
door is a finding, not an automatic exclusion. Its inlet also occupies the
inspection slab. The instrument does not decide whether the intended design
requires a modeled hole, a pocket or a separate exception.

It cannot see a ring light clipping through the skin **outside any opening**,
geometry deeper than its slab, a missing panel, fixed quarter-window openings,
inter-pose collisions, or incorrect panel proportions shared by the measured
model. It measures mesh surfaces, not solid containment: a solid which fully
encloses the slab without a surface crossing it is outside this test. It assumes
registered triangle meshes and rigid hierarchy motion; visibility, texture masks,
vertex displacement and unrelated animation/state are not reconstructed.
The update loop is driven at the four stated fractions, not continuously.
The previous open/explode/panel values are restored after measurement; unrelated
live animation state is not preserved, so use a freshly loaded model as the CLI
does. No other engine instrument's existing shader treatment is changed.

## Recorded verification

See [aperture-results](aperture-results.md) for this model's complete part list
and the negative fixture's measured depths. The adjacent JSON reports retain
all four poses and x/y/z witnesses. These are observations, not a passing
baseline to subtract from later runs.
