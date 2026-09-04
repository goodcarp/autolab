#!/usr/bin/env python3
"""Pixel-level checks for the authored 2.5D safety pack.

Run with the bundled workspace Python after ``build-fallbacks.py``.  This is
separate from the dependency-free Node hash verifier because it uses Pillow to
decode WebP alpha and inspect the deliberately neutral wheel hubs.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageChops


ROOT = Path(__file__).resolve().parents[2]
IMAGES = ROOT / "public" / "images"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL {message}")
    print(f"PASS {message}")


def near(actual: tuple[int, int, int], expected: tuple[int, int, int], tolerance: int = 18) -> bool:
    return all(abs(a - e) <= tolerance for a, e in zip(actual, expected, strict=True))


side = Image.open(IMAGES / "vehicle-side.webp").convert("RGBA")
blueprint = Image.open(IMAGES / "vehicle-side-blueprint.webp").convert("RGBA")
wheel = Image.open(IMAGES / "representative-wheel-inset.webp").convert("RGBA")
showroom = Image.open(IMAGES / "showroom-fallback.webp").convert("RGB")

require(side.size == (1600, 900), "side layer is 1600x900")
require(blueprint.size == side.size, "blueprint and side layers share a canvas")
require(showroom.size == side.size, "showroom fallback is 1600x900")
require(wheel.size == (512, 512), "representative wheel inset is 512x512")

side_alpha = side.getchannel("A")
blueprint_alpha = blueprint.getchannel("A")
require(side_alpha.getextrema() == (0, 255), "side layer contains real transparency")
require(
    ImageChops.subtract(blueprint_alpha, side_alpha).getbbox() is None,
    "blueprint matte stays inside the reviewed side silhouette",
)
side_coverage = sum(side_alpha.get_flattened_data())
blueprint_coverage = sum(blueprint_alpha.get_flattened_data())
require(
    blueprint_coverage / side_coverage >= 0.96,
    f"blueprint retains at least 96% silhouette coverage ({blueprint_coverage / side_coverage:.1%})",
)

corners_1600 = ((0, 0), (1599, 0), (0, 899), (1599, 899))
require(
    all(side_alpha.getpixel(point) == 0 for point in corners_1600),
    "side canvas corners are fully transparent",
)
require(
    all(blueprint_alpha.getpixel(point) == 0 for point in corners_1600),
    "baked blueprint checkerboard is absent from shipped corners",
)
require(
    all(wheel.getchannel("A").getpixel(point) == 0 for point in ((0, 0), (511, 0), (0, 511), (511, 511))),
    "wheel inset corners are fully transparent",
)

# Exact center pixels sit inside the plain discs painted by build-fallbacks.py.
hub_checks = (
    (side.convert("RGB"), (298, 608), (32, 35, 38), "side front hub is neutral"),
    (side.convert("RGB"), (1266, 607), (32, 35, 38), "side rear hub is neutral"),
    (blueprint.convert("RGB"), (303, 608), (9, 43, 70), "blueprint front hub is neutral"),
    (blueprint.convert("RGB"), (1265, 610), (9, 43, 70), "blueprint rear hub is neutral"),
    (showroom, (690, 624), (32, 35, 38), "showroom front hub is neutral"),
    (showroom, (1350, 576), (32, 35, 38), "showroom rear hub is neutral"),
)
for image, point, expected, label in hub_checks:
    actual = image.getpixel(point)
    require(near(actual, expected), f"{label} ({actual})")

print("Pixel audit complete: alpha continuity and all six shipped wheel hubs are approved.")
