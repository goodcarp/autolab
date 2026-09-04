# Reference profiles

`ortho_side.json` and `ortho_front.json` are the output of
`r2-blueprint/tools/measure_ortho.py`, run against Rivian's official
orthographic dimension drawings.

They are snapshotted here because that script writes to `/tmp`, which does not
survive a reboot — and a calibrated reference that evaporates is the same
problem as an instrument that evaporates (Measure, Don't Look, finding 14).

Regenerate with:

```bash
python3 ~/Desktop/r2-blueprint/tools/measure_ortho.py side  <side_drawing.png>
python3 ~/Desktop/r2-blueprint/tools/measure_ortho.py front <front_drawing.png>
cp /tmp/ortho_*.json ~/Desktop/"AutoLab 3D Creation Engine"/reference/
```

## What the calibration says about the source

The side drawing is **self-consistent in wheelbase and height** and **drawn
about 5% short overall**: `drawn_length` 4.516 m against a published 4.722 m,
while `drawn_height` is 1.700 m against a published 1.699 m. The extractor
anchors y on the ground and roof, anchors x on the two axles, and warps the two
overhang regions linearly so the nose and tail land on the published length.
Shape is preserved; the known dimensions are met.

This is finding 02 in the raw: even a tier-one reference has to be checked
against two known dimensions before anything is fitted to it. `reference.mjs`
re-runs that check on load and refuses a source whose landmarks disagree.
