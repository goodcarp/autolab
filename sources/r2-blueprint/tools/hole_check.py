#!/usr/bin/env python3
"""Find places you can see straight through the vehicle.

  ./cap.sh out side 'view=side&snap=1&adv=2&bare=1&run=0&nodrift=1'
  ./cap.sh out sil  'view=side&snap=1&adv=2&bare=1&run=0&nodrift=1&sil=1'
  python3 tools/hole_check.py out [y_min y_max]

Any pixel matching the paper colour that lies strictly inside the vehicle's own filled silhouette is
a hole: two surfaces that were meant to meet do not. This is the single highest-yield check in the
project. "The side windows have a slight seam" survived three rounds of looking at pictures; this
turned it into "12.8 mm, world y 1.1812..1.1919, on every door" in one run, and then tracked the
repair quantitatively (1855 px -> 1172 -> 356, the remainder being a legitimate 1 px panel gap).

The default y window skips the wheel spokes underneath and the sheet furniture above, both of which
are see-through on purpose. Pass explicit bounds to widen it.
"""
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage

PAPER = np.array([244, 246, 250])
WB = 2.936

def car_mask(a):
    m = a < 60
    lab, k = ndimage.label(m)
    if k == 0: raise SystemExit('nothing rendered')
    sz = ndimage.sum(m, lab, range(1, k + 1))
    keep = np.zeros_like(m)
    for i in np.argsort(sz)[::-1]:
        if sz[i] < 4000: break
        ys, _ = np.where(lab == i + 1)
        if ys.min() < m.shape[0] * 0.12: continue    # sheet furniture, not the car
        keep |= (lab == i + 1)
    return keep

def calibrate(mask):
    """px/metre and the ground row, from the wheels in the silhouette's lower half."""
    H = mask.shape[0]
    low = mask[int(H * 0.55):, :]
    cols = np.where(low.any(axis=0))[0]
    ground = np.where(low.any(axis=1))[0].max() + int(H * 0.55)
    gaps = np.where(np.diff(cols) > 50)[0]
    if len(gaps):                                     # wheels separable: exact scale
        a, b = cols[:gaps[0] + 1], cols[gaps[0] + 1:]
        return abs(b.mean() - a.mean()) / WB, ground
    full = np.where(mask.any(axis=0))[0]              # fall back to overall length (approximate)
    return (full.max() - full.min()) / 4.722, ground

if __name__ == '__main__':
    d = sys.argv[1]
    y0, y1 = (float(sys.argv[2]), float(sys.argv[3])) if len(sys.argv) > 3 else (0.55, 1.70)
    sil = car_mask(np.asarray(Image.open(os.path.join(d, 'sil.png')).convert('L')).astype(float))
    ppm, ground = calibrate(sil)
    inner = ndimage.binary_erosion(ndimage.binary_fill_holes(sil), np.ones((7, 7)))
    img = np.asarray(Image.open(os.path.join(d, 'side.png')).convert('RGB')).astype(int)
    paper = np.abs(img - PAPER).sum(axis=2) < 14
    lab, k = ndimage.label(paper & inner)
    Y = lambda py: (ground - py) / ppm
    bad = []
    for i in range(1, k + 1):
        ys, xs = np.where(lab == i)
        lo, hi = Y(ys.max()), Y(ys.min())
        if hi < y0 or lo > y1: continue
        bad.append((len(ys), xs.min(), xs.max(), lo, hi))
    bad.sort(reverse=True)
    print(f'scale {ppm:.1f} px/m   window y {y0}..{y1}')
    print(f'see-through blobs inside the silhouette: {len(bad)}, {sum(b[0] for b in bad)} px')
    for n, xa, xb, lo, hi in bad[:12]:
        print(f'  {n:6d} px   x {xa}-{xb}   world y {lo:.3f}..{hi:.3f}   ({(hi - lo) * 1000:.1f} mm tall)')
    if not bad: print('  none — every surface that should meet, meets.')
