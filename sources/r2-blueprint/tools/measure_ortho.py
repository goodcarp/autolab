#!/usr/bin/env python3
"""Extract calibrated profiles from Rivian's official orthographic dimension drawings.

  python3 tools/measure_ortho.py side  <side_drawing.png>   [our_sil.png]
  python3 tools/measure_ortho.py front <front_drawing.png>  [our_sil.png]

Why these drawings: they are vector illustrations rendered orthographically, so unlike a
photograph there is no perspective to correct — a pixel is a pixel at every depth.

Calibration. The side drawing carries dimension callouts C (length) and D (wheelbase) with
extension lines marking the exact measured points, plus a ground line. Measured against the
published figures the drawing is self-consistent in WHEELBASE and HEIGHT (2935 / 1700 agree to
0.7%) but its overall length is drawn about 5% short (4482 vs 4722). So we anchor y on the
ground and roof, anchor x on the two axles, and then warp the two overhang regions linearly so
the nose and tail land on the published length. Shape is preserved; the known dimensions are met.

Output: JSON with the top profile, the bottom profile (underbody, chin and departure lines,
which the earlier photo fit never used) and the key stations, all in the model's own frame:
x forward with the nose at +2.361, y up from the ground.
"""
import sys, json
import numpy as np
from PIL import Image
from scipy import ndimage

SPEC = dict(length=4.722, wheelbase=2.935, height=1.700, clearance=0.245, width=1.904, width_mirrors=2.152)

def load(path):
    im = Image.open(path).convert('RGBA')
    im = Image.alpha_composite(Image.new('RGBA', im.size, (255,) * 4), im).convert('RGB')
    return np.asarray(im).astype(int).mean(axis=2)

def biggest_component(mask):
    lab, n = ndimage.label(mask, structure=np.ones((3, 3)))
    if n == 0: raise SystemExit('no ink found')
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    return lab == (int(np.argmax(sizes)) + 1)

def vertical_marks(mask, y0, y1, frac=0.75):
    """x positions of the dimension extension lines inside a horizontal band."""
    band = mask[y0:y1]; need = (y1 - y0) * frac
    xs = np.where(band.sum(axis=0) >= need)[0]
    if len(xs) == 0: return []
    out, cur = [], [xs[0]]
    for x in xs[1:]:
        if x - cur[-1] <= 3: cur.append(x)
        else: out.append(sum(cur) / len(cur)); cur = [x]
    out.append(sum(cur) / len(cur))
    return out

def side_profile(path):
    g = load(path); mask = g < 200
    car = biggest_component(mask)
    ys, xs = np.where(car)
    x0, x1, ytop = xs.min(), xs.max(), ys.min()
    axles = vertical_marks(mask, 1545, 1645)          # the D (wheelbase) extension lines
    if len(axles) != 2: raise SystemExit(f'expected 2 wheelbase marks, got {axles}')
    axr, axf = min(axles), max(axles)
    ground = float(np.where(car[:, int(axf)])[0].max())  # the tyre's contact patch
    sy = SPEC['height'] / (ground - ytop)                # metres per pixel, vertical
    sx_wb = SPEC['wheelbase'] / (axf - axr)              # metres per pixel between the axles
    # piecewise x: axles pinned to +-wheelbase/2, overhangs stretched to the published length
    nose_m, tail_m = SPEC['length'] / 2, -SPEC['length'] / 2
    axf_m, axr_m = SPEC['wheelbase'] / 2, -SPEC['wheelbase'] / 2
    def xm(px):
        if px >= axf: return axf_m + (px - axf) * (nose_m - axf_m) / (x1 - axf)
        if px <= axr: return axr_m + (px - axr) * (tail_m - axr_m) / (x0 - axr)
        return axf_m + (px - axf) * sx_wb
    top, bot = [], []
    for px in range(x0, x1 + 1):
        col = np.where(car[:, px])[0]
        if len(col) == 0: continue
        X = xm(px)
        top.append([X, (ground - col.min()) * sy])
        bot.append([X, (ground - col.max()) * sy])
    return dict(scale_y=sy, scale_x_wb=sx_wb, ground_px=ground, axle_px=[axr, axf],
                bbox_px=[int(x0), int(x1), int(ytop)],
                drawn_length=float((x1 - x0) * sx_wb), drawn_height=float((ground - ytop) * sy),
                top=top, bottom=bot)

def front_profile(path):
    g = load(path); mask = g < 200
    car = biggest_component(mask)
    ys, xs = np.where(car)
    x0, x1, ytop, ybot = xs.min(), xs.max(), ys.min(), ys.max()
    # the widest point of the body is the mirrors; height anchors y
    sy = SPEC['height'] / (ybot - ytop)
    sx = SPEC['width_mirrors'] / (x1 - x0)
    cx = (x0 + x1) / 2
    half = []
    for py in range(ytop, ybot + 1):
        row = np.where(car[py])[0]
        if len(row) == 0: continue
        half.append([(ybot - py) * sy, (row.max() - row.min()) / 2 * sx])
    return dict(scale_x=sx, scale_y=sy, bbox_px=[int(x0), int(x1), int(ytop), int(ybot)],
                drawn_width=float((x1 - x0) * sx), half_width_by_height=half)

if __name__ == '__main__':
    kind, path = sys.argv[1], sys.argv[2]
    out = side_profile(path) if kind == 'side' else front_profile(path)
    print(json.dumps(out)[:400] + ' ...')
    with open(f'/tmp/ortho_{kind}.json', 'w') as f: json.dump(out, f)
    print(f'wrote /tmp/ortho_{kind}.json')
