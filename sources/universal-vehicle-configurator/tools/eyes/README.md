# Eyes

Instruments for questions that cannot be answered by looking at the app or by
reading its source.

The reasoning is in `docs/measure-dont-look.html` in the r2-blueprint
repository. Three of its findings shape this directory:

- **01 — Vision review does not converge. Measurement does.** The first thing
  run after a change should be a numeric check, not a screenshot. Screenshots
  answer "does this read as a car", never "is this edge in the right place".
- **12 — A measurement is only as good as the argument that the quantity
  moves.** Every instrument here has a positive control, and asserts the
  preconditions of its own measurement.
- **14 — An instrument that does not survive the session is not phase 0.**
  These are committed, one command each, because the second question is always
  already on its way.

## Running them

Serve the production build first — these measure what ships, not the dev server:

```bash
pnpm build && pnpm preview --host 127.0.0.1 --port 4176
```

Point them somewhere else with `EYES_URL`.

| Command | Answers |
| --- | --- |
| `pnpm eyes:selftest` | Are the instruments themselves calibrated? Run this first, and after touching `lib.mjs`. |
| `pnpm eyes:degrade [outDir]` | Does the page degrade honestly, and is it usable without a mouse? Touch orbit on both render paths, reduced motion, no WebGL, four viewports, both surfaces. |
| `pnpm eyes:isolate <outDir> [preset]` | Which part is that artefact? Tints each material role and captures one frame. |

## Why the self-test matters

`pnpm eyes:selftest` is not a unit test. It drives each instrument in both
directions against the real app: once where the thing it measures is known not
to change, and once where it is known to change by a route that does not go
through the instrument.

A frame differencer that reports "changed" for everything passes the positive
control and fails the negative one. A differencer wired to the wrong quantity
passes the negative control and fails the positive one. Both directions have to
come out right before a null result from it counts as evidence.

This exists because a harness once reported a clean, reproducible,
two-platform failure that was not real: it was reading the authored still's pan
variable, which is deliberately frozen while the live renderer owns the drag.
The number was correct and about the wrong thing.

## Adding one

An instrument belongs here when it answers a question about the built artefact
that reading cannot settle. It should:

- read the artefact — pixels, geometry, the returned object — not a proxy for it;
- carry a positive control in `selftest.mjs`;
- assert its own preconditions, and fail loudly rather than measure something
  else (see `clearPoint`, which refuses to drag from a point covered by a
  control);
- report through `report()` so every instrument prints the same way, and use
  `report().guard()` so one failure cannot cost the answers already earned.
