#!/usr/bin/env python3
"""Compare our side-elevation silhouette with a reference side photo.

  python3 tools/measure_side.py <reference_side_photo.png> <our_sil_capture.png>

The reference must be a clean side view on a light background (nose left or right; detected from the axles).
Our capture comes from cap.sh with 'view=side&snap=1&adv=2&sil=1&bare=1' (black silhouette on paper).
Scale is taken from the tyre contact patches (wheelbase 2.936 m); the reference body outline is
perspective-corrected by the roof height (1.699 m) because the body sits behind the tyre plane.
Prints the top-of-silhouette height at longitudinal stations (x from the wheelbase centre, nose +) and the delta.
"""
import sys
import numpy as np
from PIL import Image

WB, H_SPEC = 2.936, 1.699

def silhouette(path, thr, dark_thr=None):
    g = np.asarray(Image.open(path).convert('RGB')).astype(int).mean(axis=2)
    mask = g < thr; dark = g < (dark_thr or thr); H, W = mask.shape
    cols = np.where(mask.sum(axis=0) > 8)[0]; x0, x1 = cols.min(), cols.max()
    ytop = np.array([np.where(mask[:, x])[0].min() if mask[:, x].any() else -1 for x in range(W)])
    ybot = np.array([np.where(dark[:, x])[0].max() if dark[:, x].any() else -1 for x in range(W)])
    mid = (x0 + x1) // 2
    def lowest(lo, hi):
        seg = ybot[lo:hi]; yb = seg.max(); cs = np.where(seg >= yb - 2)[0] + lo; return float(np.mean(cs)), int(yb)
    (xa, ya), (xb, yb) = lowest(x0, mid), lowest(mid, x1 + 1)
    # nose is on the side with the longer overhang beyond the axle
    nose_right = (x1 - max(xa, xb)) < (min(xa, xb) - x0)
    xf, xr = (max(xa, xb), min(xa, xb)) if nose_right else (min(xa, xb), max(xa, xb))
    yf = ya if xf == xa else yb; yr = yb if xr == xb else ya
    scale = WB / abs(xf - xr)
    ground = lambda x: yf + (yr - yf) * (x - xf) / (xr - xf)
    sgn = 1 if nose_right else -1
    prof = np.array([((x - xf) * sgn * scale + WB / 2, (ground(x) - ytop[x]) * scale) for x in range(x0, x1 + 1) if ytop[x] >= 0])
    return prof

ref = silhouette(sys.argv[1], 165, 70)
k = H_SPEC / ref[:, 1].max(); ref[:, 0] *= k; ref[:, 1] *= k
ours = silhouette(sys.argv[2], 60)
at = lambda P, X: float(P[np.argmin(np.abs(P[:, 0] - X)), 1])
print(f'perspective factor {k:.4f}   ref nose {ref[:,0].max():.3f} tail {ref[:,0].min():.3f}   ours nose {ours[:,0].max():.3f} tail {ours[:,0].min():.3f}')
print('   x     ref    ours   delta')
worst = 0
for X in np.arange(2.3, -2.4, -0.1):
    r, o = at(ref, X), at(ours, X); worst = max(worst, abs(o - r)); print(f'{X:6.2f}  {r:.3f}  {o:.3f}  {o-r:+.3f}')
print('worst |delta| m:', round(worst, 3))
