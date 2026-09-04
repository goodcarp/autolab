#!/usr/bin/env python3
"""Compare our rendered side silhouette against the calibrated official drawing, in millimetres.

  python3 tools/fit_check.py <our_sil.png> <our_wheels_sil.png> [/tmp/ortho_side.json]

Both sides are put in the model's own frame the same way: y from the tyre contact patch, x from
the two axle centres (wheelbase 2.936 m). That makes the comparison independent of framing, zoom
and canvas size, so a capture at any resolution can be checked against the same reference.

Prints the worst and mean deviation of the TOP profile and a station table. This is the loop that
repeatedly beat looking at pictures: a 111 mm error in the windscreen base survived several rounds
of visual review and fell out of the first measurement.
"""
import sys, json
import numpy as np
from PIL import Image
from scipy import ndimage

WB, LENGTH = 2.936, 4.722

def car_mask(path):
    a = np.asarray(Image.open(path).convert('L')).astype(float)
    m = a < 60
    lab, k = ndimage.label(m)
    if k == 0: raise SystemExit(f'{path}: nothing rendered')
    sz = ndimage.sum(m, lab, range(1, k + 1))
    H = m.shape[0]
    keep = np.zeros_like(m)
    for i in np.argsort(sz)[::-1]:
        if sz[i] < 4000: break
        ys, xs = np.where(lab == i + 1)
        if ys.min() < H * 0.12: continue          # sheet furniture (corner marker), not the car
        keep |= (lab == i + 1)
    return keep

def calibrate(wheel_mask):
    """Front-axle x and ground y in pixels, from a WHEELS-ONLY silhouette.

    Do not calibrate on the overall silhouette length. The bumpers and cladding project ~35 mm past
    the body datum, which inflates px/m by 0.75% and quietly shortens every height by 13 mm - enough
    to invent a roof error that is not in the model. The wheels carry two exact landmarks instead:
    the axle centres are the published wheelbase apart, and the contact patch is the ground plane.
    Capture it with  ?only=wheelFL,wheelFR,wheelRL,wheelRR  and the same view/adv as the body shot."""
    cols = np.where(wheel_mask.any(axis=0))[0]
    gaps = np.where(np.diff(cols) > 50)[0]
    if not len(gaps): raise SystemExit('wheel silhouette: could not separate the two axles')
    a, b = cols[:gaps[0] + 1], cols[gaps[0] + 1:]
    cx = sorted([a.mean(), b.mean()])
    return cx[1], (cx[1] - cx[0]) / WB, np.where(wheel_mask.any(axis=1))[0].max()

def our_top(path, wheel_path):
    m = car_mask(path)
    axf, ppm, ground = calibrate(car_mask(wheel_path))
    prof = {}
    for px in np.where(m.any(axis=0))[0]:
        X = WB / 2 + (px - axf) / ppm
        prof[round(X, 4)] = (ground - np.where(m[:, px])[0].min()) / ppm
    return prof, ppm

if __name__ == '__main__':
    ours, ppm = our_top(sys.argv[1], sys.argv[2])
    ref = json.load(open(sys.argv[3] if len(sys.argv) > 3 else '/tmp/ortho_side.json'))
    rx = np.array([p[0] for p in ref['top']]); ry = np.array([p[1] for p in ref['top']])
    ox = np.array(sorted(ours)); oy = np.array([ours[x] for x in ox])
    # trim 80 mm off each end: at the nose and tail tips a single column carries both the top and
    # the bottom of the silhouette, so the 'top profile' there is meaningless in either source
    lo, hi = max(rx.min(), ox.min()) + 0.08, min(rx.max(), ox.max()) - 0.08
    xs = np.arange(lo, hi, 0.02)
    d = (np.interp(xs, ox, oy) - np.interp(xs, rx, ry)) * 1000
    print(f'{len(xs)} stations from x {lo:+.2f} to {hi:+.2f}   scale {ppm:.1f} px/m')
    print(f'top profile:  mean |dev| {np.abs(d).mean():5.1f} mm   worst {np.abs(d).max():5.1f} mm '
          f'at x {xs[np.argmax(np.abs(d))]:+.2f}   bias {d.mean():+5.1f} mm')
    # bias is a DATUM question (how tall the drawing thinks the car is), not a shape question:
    # report the shape fit separately so a ride-height argument cannot hide a bad curve
    s = d - d.mean()
    print(f'shape only:   mean |dev| {np.abs(s).mean():5.1f} mm   worst {np.abs(s).max():5.1f} mm '
          f'at x {xs[np.argmax(np.abs(s))]:+.2f}')
    print('\n   x      ours    ref     dev    shape')
    for i in range(0, len(xs), max(1, len(xs) // 26)):
        print(f'{xs[i]:+6.2f}  {np.interp(xs[i],ox,oy):6.3f}  {np.interp(xs[i],rx,ry):6.3f}  {d[i]:+7.1f}  {s[i]:+7.1f} mm')
