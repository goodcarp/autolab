# Building a 3D model in code from photographs

Findings from reconstructing a Rivian R2 as procedural three.js geometry, written as inputs for a
reusable Skill. Everything here is a conclusion drawn from something that actually went wrong or
actually worked in this build, not a plan for how it might go.

---

## 1. The finding that dominates all the others

**Vision review does not converge. Measurement does.**

Across this build, every defect that survived more than one round survived because it was being
judged by looking at a picture. Every one of them fell out in a single pass the moment it was
turned into a number.

| Defect | Rounds of visual review | How it actually resolved |
| --- | --- | --- |
| Windscreen base 111 mm too far forward | 4 | One silhouette measurement against the official drawing |
| A-pillar "too thick" | 3 | Realised the thick edge was the FAR pillar's shadow through the glass — a fact about the image, not the model |
| Windscreen "hangs over the cowl" | 2 | Profiled the greenhouse silhouette column by column: 21 mm tall at the tip, split into two rims |
| Side windows "have a seam" | 3 | Counted background-coloured pixels inside the silhouette: a 12.8 mm hole, exact height printed |
| Roof 15 mm low | — (nearly a false alarm) | The measurement was wrong, not the model: see §5 |
| Bar across both door openings | 1 | Isolating the body shell: four captures, no reasoning |
| Rear lamp band "inside out" | 1 | Arithmetic on five offsets against one occluder plane |

The productive loop is:

```
render → extract silhouette → calibrate to known dimensions → diff in millimetres → edit → repeat
```

The unproductive loop is `render → look → describe → edit`. A Skill should make the first loop the
default and treat screenshots as a final acceptance check, not as the working instrument.

**Concretely, for the Skill:** the first tool call after any geometry edit should be a numeric
check, not a screenshot. Screenshots are for "does this read as a car", never for "is this edge in
the right place".

---

## 2. Reference-source hierarchy

Sources are not interchangeable. Ranked by how much a measurement from them can be trusted:

1. **Manufacturer orthographic dimension drawings.** Vector-rendered, no perspective, and they carry
   their own dimension callouts with extension lines — so the drawing calibrates itself. This is the
   only source worth fitting curves to directly.
2. **Published specification tables.** Exact but sparse: length, width, height, wheelbase, track,
   overhangs, clearance, tyre size. Use as anchors, never as shape.
3. **Factory / body-in-white photographs.** Best structural evidence available — they show how panels
   actually meet, with no paint or reflection to hide a joint. Perspective-heavy, so read topology
   from them, not dimensions.
4. **Press and configurator photography.** Good for surface character, actively misleading for
   measurement: bright glass, studio reflections and long lenses all move edges.
5. **Renders and fan art.** Do not use. They inherit someone else's errors.

**Trap found the hard way:** the official drawings were *self-consistent in wheelbase and height to
0.7% but drawn about 5% short overall*, and the front drawing's width calibration was internally
inconsistent (front tyres scaled to 2072 mm against a 1895 mm spec, and the front track drawn wider
than the rear, which is false for this vehicle). So even tier 1 needs an internal consistency check
before it is trusted: **measure at least two known dimensions from every reference and confirm they
agree before fitting anything to it.** Where they disagree, anchor on the ones that agree and warp
the rest — this build anchored y on ground+roof, x on the two axles, and stretched only the
overhangs to reach the published length. Shape preserved, known dimensions met.

---

## 3. Calibration: pick landmarks that cannot move

This is where the single worst measurement error in the build came from, and it is worth stating as
a rule because it is so easy to get wrong.

Calibrating a rendered silhouette by its **overall length** is wrong. Bumpers, cladding and trim
project past the body datum — about 35 mm here — which inflates px/m by 0.75% and silently shortens
**every** height by 13 mm. That is more than enough to invent a roof defect that does not exist. I
spent a round chasing exactly that phantom.

Calibrate on landmarks that are definitionally exact:

- **The two axle centres** are the published wheelbase apart. Render a wheels-only silhouette
  (`?only=wheelFL,wheelFR,wheelRL,wheelRR`) so they separate cleanly from the body.
- **The tyre contact patch** is the ground plane, y = 0.
- Never the overall bounding box in either axis.

After switching to axle calibration the same model went from an apparent *mean 19.4 mm / worst
454 mm* to a true **mean 3.4 mm / worst 5 mm** against the official drawing. Nothing about the
geometry changed. The measurement had been lying.

**Corollary for the Skill:** every measurement harness needs a self-test. `measure(front wheel →
rear wheel)` must return the published wheelbase. If it does not, the calibration is broken and
every other number it produces is fiction.

---

## 4. Turn the renderer into a measuring instrument

The renderer already knows everything; it just has to be asked in a form that returns numbers. Four
capabilities paid for themselves many times over and belong in the Skill's scaffolding from the
first commit, not bolted on at the end:

**a. Silhouette mode** (`?sil=1`) — render every surface as flat black on the paper. Gives a clean
binary mask with no shading, no hatching and no ink lines to threshold around. Everything else in
this list is built on it.

**b. Part isolation** (`?only=a,b` / `?hide=a,b`) — show or hide named components. This is the
bisection tool. When the windscreen "overhang" appeared, four isolation captures found the surface
that owned it; before that I had spent far longer reasoning about which of eight candidate surfaces
it *might* be, and had convinced myself of two wrong answers. **Bisect, do not deduce.**

  A detail that cost a round: the isolation flag has to survive the per-frame update loop. My first
  version set `group.visible = false` at startup and the animation loop overwrote it on frame one, so
  the two "different" captures were identical and I nearly concluded the surface was somewhere else.
  Isolation must be a set the update loop consults, not a one-shot write.

**c. Deterministic capture** (`?snap=1&adv=<seconds>&run=0&nodrift=1`) — jump the camera with no
tween, advance the clock synchronously by a fixed amount, freeze idle animation. Two reasons this is
not optional:
  - Without it, captures are not comparable frame to frame.
  - **The idle animation moves the model.** This build bobs the body ±6 mm and the wheels ±8 mm. That
    is the same order as the errors being chased. A measurement capture that leaves the animation
    running is measuring noise.

**d. A hole detector.** The single highest-value check in the whole build, and about fifteen lines:

```python
silhouette = fill_holes(render_with_sil_1 < threshold)
interior   = binary_erosion(silhouette, 7x7)
holes      = (pixels matching the paper colour) & interior
# label, then report each blob's size and its world-space y range
```

Any background-coloured pixel strictly inside the vehicle's own silhouette is a place you can see
straight through the car. This turned "the windows have a slight seam" — which had survived three
rounds of me looking at it — into `12.8 mm gap, world y 1.1812 to 1.1919, on every door`, which is
directly actionable. It then tracked the repair quantitatively: 1855 px → 1172 → 356, with the
remainder identified as a legitimate 1-px panel-gap highlight.

Run it after every geometry change. It catches the entire class of defect that separate surfaces
produce when they are supposed to meet.

---

## 5. Reduce the round trips

The question "how can we limit back-and-forth screenshots?" has four answers, in order of payoff.

**Print numbers, not pictures.** A column-by-column profile of a silhouette is a handful of lines of
text that says exactly where a surface starts, stops and splits:

```
  x       segments (m)                 h(mm)
+0.939  1.188-1.168                    21.3     <- lone rim: this is the overhang
+0.914  1.258-1.258 | 1.194-1.173      87.4     <- glass and rim are 70 mm apart
+0.862  1.292-1.258 | 1.209-1.179     115.1
```

That diagnosis is complete. No screenshot was needed to reach it, and no screenshot could have
produced it.

**Batch the captures.** Never one render, one look, one edit. Capture the whole set — six views plus
every motion state — in one command, then read them together. Wall-clock time is dominated by
process startup, not by rendering.

**Crop before looking.** A 3360×2100 sheet reviewed whole shows nothing. Crop to the region in
question and upscale with NEAREST so pixel boundaries stay visible; several defects here were only
legible at 3× nearest-neighbour zoom, and one (the bright lip) was invisible at 1×.

**Make the model queryable.** The single biggest structural win: expose the scene graph as callable
tools (§8) so the answer to "how big is the battery pack" is a JSON call, not a render plus a look
plus a guess. Bounding boxes, centres, part lists and part-to-part distances are all exact and all
free.

---

## 6. Can the grid lines help?

Yes, in one specific way, and it is worth being precise about which.

The blueprint sheet's own grid is drawn *in device pixels in screen space*, so it is a scale bar for
the image, not for the world — useless for measurement. **It is, however, an excellent regression
tripwire**: it is a known, exact pattern, so any moiré or aliasing in a downscaled screenshot shows
up in the grid first. Twice in this session a small-viewport screenshot looked catastrophically
broken (dark field, dense speckle) and the grid's behaviour was what identified it as a downscaling
artefact rather than a rendering failure — confirmed by capturing the same frame at full resolution.

What *is* genuinely useful is a **world-space** grid: a ground plane ruled at exactly 1 m via
ray/plane intersection through the inverse view-projection. That gives a scale reference that lives
in the scene, is correct under both perspective and orthographic projection, and lets a reviewer sanity-check
a dimension by eye without any tooling. This build already draws one analytically in the composite
shader; a Skill should include it from the start and, for measurement captures, offer a
**calibration overlay**: the world grid plus a 1 m rule pinned to the ground plane at the vehicle
centreline. Any capture carrying it is self-calibrating even if the harness metadata is lost.

The other half of the answer is that the *reference* drawings' rules are what matter, and those are
gold: manufacturer drawings carry dimension extension lines marking the exact measured points. Read
the calibration off those, never off the drawing's bounding box (§3).

---

## 7. Architectural findings — what makes geometry stay correct

Three findings here, and they are what separates a model that converges from one that keeps
regressing. They are about construction, not about tooling.

### 7a. One surface plus shader cuts beats several surfaces made to meet

Separate ribbons that have to be aligned will mis-register. Always. They mis-registered here at the
A-pillar, at the door surrounds and at the rear lamps, repeatedly, in different ways.

The fix that ended it: build **one** surface and remove what should not be there, with the aperture
defined **once** and emitted into both the beauty material and the G-buffer material from the same
description. The A, B, C and D pillars are then not four parts that must be made to meet — they are
what is left of a single skin after the windows are cut out. They cannot mis-register because there
is nothing to register.

Same finding in a different form at the rear: one band swept along the body's own skin, around the
corner and across the tail, instead of a flat panel plus two corner pieces.

**Rule: if two surfaces must meet exactly, they should be one surface.**

### 7b. A cut is not the same thing as its surface — mind the offset

The subtlest bug class in the whole build, and it appeared three separate times.

Panels are offset along the section normal to sit proud of or inset into the skin (+4 mm for a
window surround, −2 mm for glass). The aperture test, however, runs on the fragment's **world**
position. Near a fillet the normal has a large vertical component, so a surface offset 4 mm outward
has its cut edge land 4 mm *higher* than the surface it is supposed to align with. Three separate
4 mm slivers of daylight came from exactly this.

**Rule: every panel filling an aperture must overlap it on all four edges by more than the largest
normal offset in play.** Flush is not good enough; flush is a sliver.

### 7c. A constant is not a datum

`beltY = 1.200` was used as *the* belt line. But the section's own floor is `ZT(x) − 12 mm`, and
`ZT` rises to 1.225 behind the doors. So at the rear quarter the aperture cut 13 mm below the glass
it was supposed to frame, and no amount of adjusting the glass could close it.

The same mistake, in the same file, made the deck cut eat the foot of the windscreen: a flat ceiling
of 1.26 m is under the roofline over the cabin but *above* the whole greenhouse section forward of
x ≈ 0.92, so it removed the glass instead of the floor beneath it.

**Rule: a boundary that interacts with a swept surface must be a function of the same curve that
swept it, not a number that happens to be right in the middle.** Where the boundary lives in a
shader, sample the curve at build time and emit it as a piecewise-linear ramp — the same technique
already used for the hood's shut line, and it is cheap:

```js
deckCeil: linspace(0.58, 1.02, 0.02).map(x => [x, topYatZ(upperSec, x, DECK_Z) - 0.002]),
```

Note *which* curve: the first attempt tracked the centreline roof and still opened a slot, because
the cut's outboard edge is at |z| = 0.84 where the section is lower. Track the curve **at the
boundary's own location**.

### 7d. An outward offset needs a direction, not a sign

The rear lamp is one band swept along the body's own skin — the §7a construction, and the right one.
It offsets itself off the skin by a scalar `off`: along the flanks as `p.z + normal.z * off`, and
across the tail as `x_cap + off`.

Along the flanks that is correct. Across the tail it is exactly backwards, because the vehicle's x
axis points forward, so "outward" at the tail is **−x**. Every band therefore sat `off` millimetres
*inside* the tail skin, behind the liftgate panel, and the three bands stacked in reverse — the brow,
meant to be proudest, ended up deepest. The user's description was "inside out", which is precisely
what it was.

**Rule: an offset is a vector, not a number.** The moment a swept surface turns a corner, a scalar
that meant "outward" on one face means "inward" on the next. Either offset along the real 3-D
normal, or name the axis explicitly at each face.

### 7e. A fix verified in one state can be a defect in another

The four-millimetre slivers of §7b were closed by leaving a 22 mm band of body uncut across the belt.
That closed every hole, passed the hole detector, and was invisible in every capture taken — because
every capture had the doors **shut**.

With the doors open it is a solid rail across both door openings, running the length of the cabin. A
car cannot have one. It shipped, and the user found it in about a minute.

**Rule: a part that moves has to be checked in every state it moves through.** The acceptance sweep
now captures doors-open and liftgate-open as well as closed, and the hole detector is not evidence
about a state it never rendered.

The repair also shows the shape of the right fix: instead of the *body* keeping material to back the
door, the *door's* own upper panel now spans the whole door rather than just the glazed opening —
which is what a real door does, since the window frame belongs to the door. Everything outside the
body's aperture is covered by the surround anyway, so the wider panel is invisible except where it
should be. The aperture is then cut continuously, and there is nothing left to bar the doorway.

### 7f. One defect masks another

With the lamp bands buried behind the liftgate, a second fault in them could not be seen: the brow's
height is set as `tailY + 0.068`, and the roll pulls the section's top down to 1.178 at the tail, so
the brow was asking for a height 5 mm above the bodywork. The height lookup silently clamped to the
top corner and returned a crossing 60 mm narrower at each end than the strip below it — a third
instance of §7c, in the same file, found only because the first fix made it visible.

It was not found by looking, and not by measuring the render — the render could not show it. It came
from an adversarial reviewer told to attack the *proposed fix* rather than the defect, which
recomputed the section arithmetic and predicted the symptom before it existed.

**Rule: after fixing an occlusion, re-examine what it was hiding.** And when a fix changes what is
visible, the adversarial pass is worth more than another screenshot.

---

## 8. Make the model agent-legible

The model should be queryable by the agent building it, not only renderable. This build ships a
WebMCP surface (`src/webmcp.js`) exposing 13 tools; the ones that matter for reconstruction work:

| Tool | Why it removes a round trip |
| --- | --- |
| `list_parts {detail:true}` | Full component listing with bounding boxes in metres — the component/coordinate/tag listing that otherwise has to be inferred from screenshots |
| `get_part` | One component's box, centre, size, explode vector and engineering description |
| `measure {from, to}` | Exact centre-to-centre distance; also the harness self-test of §3 |
| `frame_part` | Points the camera at a component and fits it — replaces guessing an azimuth and re-shooting |
| `set_camera` / `orbit_camera` | Absolute and relative poses including an orthographic toggle, so a measurement view is reproducible by value |
| `get_specification` | The published figures every curve is fitted to |

Two design notes learned by getting them wrong:

- **Return structured JSON, never prose.** "The battery is about 2.8 metres long" has to be parsed
  and can be misparsed. `{"size":{"x":2.84,"y":0.155,"z":1.56}}` cannot.
- **Errors should carry the recovery.** `no part "flux capacitor". Call list_parts for the 42
  available ids.` costs one round trip. `undefined` costs three.

A third, found while testing: `frame_part` on an internal component puts the camera inside the body
shell, which renders as noise. The tool now returns a `hint` telling the caller to dissolve the
shell first. **Any tool that can put the caller in an unrenderable state should say so in its own
result.**

---

## 9. The kernel idea

The recurring shape of this work is that a handful of primitives, defined once, generate the entire
vehicle; everything else is data. Extracted from this build, the kernel is:

**Curve layer.** Named 1-D profiles over the long axis — roof height, belt height, floor height, half
width at three heights, corner radii, crown. Monotone-cubic through hand-placed knots, because knots
are what a measurement produces and monotone interpolation will not overshoot between them. *All
fitting happens here.* This is the only layer that touches reference imagery.

**Section layer.** One function `section(x) → closed loop of points` built from the curves, with a
**fixed index map** so that "the top-right corner" is the same index at every station. That fixed
map is what makes every downstream operation composable — you can say "from the top corner to the
bottom corner" and mean it at every station, which is exactly what makes §7a possible.

**Surface layer.** Four operators over sections, and they were sufficient for an entire vehicle:
`loft` (sweep a section along x), `colGrid` (a ribbon between two index bounds), `rowGrid` (a ribbon
between two heights), `wrapBand` (follow the skin around a corner). Plus `capFromLoop` to close an
end.

**Aperture layer.** One declarative description of every hole, emitted as GLSL and compiled into
*every* material that needs it. One source of truth; a door opening cannot disagree with itself.

**Assembly layer.** Named parts with a category, a rest position, an explode vector, an anchor for
callouts and a description. This layer is what §8 exposes to an agent, and it is nearly free once
parts are named.

**Instrument layer.** Silhouette mode, part isolation, deterministic capture, the hole detector, the
fit check. Built at the same time as the geometry, not after it.

The value of the kernel is that the six layers have a strict dependency order, so **a measurement
correction only ever edits the curve layer.** When the windscreen base moved 111 mm, one knot list
changed and the pillars, surrounds, glass, cowl and wipers all followed — because the pillar edge is
*derived* from the roof curve rather than being a separately fitted number. The failures that cost
the most time in this build were all places where that discipline had leaked: a constant standing in
for a curve (§7c), or two surfaces fitted independently (§7a).

---

## 10. Proposed Skill shape

**Phase 0 — Instruments before geometry.** Silhouette mode, part isolation, deterministic capture,
hole detector, fit check, axle-calibrated measurement with its wheelbase self-test. Refuse to start
modelling until `measure(front axle → rear axle)` returns the published wheelbase.

**Phase 1 — Reference triage.** Collect sources, rank them (§2), and run the internal-consistency
check on each: measure two known dimensions and confirm they agree. Record which sources are
trusted for dimensions, which for topology only, and which are excluded.

**Phase 2 — Curves from the drawings.** Extract profiles from the orthographic drawings, calibrated
off their own dimension extension lines. This produces the knot lists. Nothing else is modelled yet.

**Phase 3 — Kernel build.** Sections, then surfaces, then apertures, then parts (§9). Every
component named and categorised as it is created, so §8 comes for free.

**Phase 4 — The measured loop.** After every edit: fit check, then hole detector, then — only then —
a batched capture set for a visual read. Escalate to part isolation the moment a defect cannot be
attributed to a specific named surface with certainty.

**Phase 5 — Acceptance.** Fit within tolerance, zero interior see-through pixels, no console errors,
determinism verified by capturing the same frame twice and comparing bytes, and a responsive check
at real device viewports.

One caveat on that last point, because it wasted a round: **headless Chrome silently clamps
`--window-size` to a 500 px minimum**, so "mobile" captures taken that way are not mobile. Real
device emulation (375×812, 768×1024) is required, asserting `scrollWidth === innerWidth` and zero
overflowing elements.

---

## 11. Things I would do differently

- Build the hole detector and the fit check **first**. Both are ~30 lines and both would have caught
  their defects on the day they were introduced rather than several sessions later.
- Put the wheelbase self-test in the measurement harness from the beginning. A measurement tool with
  no self-test produced a confident, precise, wrong answer (§3) and I believed it.
- Treat "two surfaces need to meet" as a design smell on sight, not after the third mis-registration.
- Never judge a fine-detail question from a downscaled screenshot. Two apparent catastrophes in this
  session were moiré from a small viewport, and one apparent success was actually hiding a 12.8 mm
  hole behind a bright lip.
- Check every moving part in its moved state before calling a fix done. The door bar passed every
  numeric check I had, because every check rendered the doors shut.
- Distrust any measurement that contradicts a spec the model was built from. Both times that
  happened here (roof 15 mm low, windscreen base 111 mm forward) the answer was *not* the obvious
  one: once the measurement was wrong, once the model was — and only re-deriving the calibration
  told me which.
