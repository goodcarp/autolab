#!/usr/bin/env python3
"""Build the authored 2.5D safety pack from the reviewed master renders.

This is intentionally a small, deterministic asset-build step. It does not create
new imagery; it only normalizes the reviewed masters, restores transparency on the
blueprint derivative, and derives masks/crops used by the runtime.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).resolve().parent / "source"
OUTPUT = ROOT / "public" / "images"
CANVAS = (1600, 900)


def fit(image: Image.Image, size: tuple[int, int] = CANVAS) -> Image.Image:
    """Resize an already-reviewed 16:9 master to the production canvas."""

    if image.size == size:
        return image.copy()
    return image.resize(size, Image.Resampling.LANCZOS)


def save_webp(image: Image.Image, name: str, *, quality: int = 90) -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    image.save(
        OUTPUT / name,
        format="WEBP",
        quality=quality,
        method=6,
        exact=True,
    )


def neutralize_hubs(
    image: Image.Image,
    hubs: tuple[tuple[int, int, int], ...],
    *,
    fill: str,
    ring: str,
    highlight: str,
) -> Image.Image:
    """Replace generator-made hub glyphs with deliberately plain circles.

    The source renders contain tiny, invented pseudo-lettering at the wheel
    centers despite the no-mark prompt.  Those pixels are not a real brand,
    but leaving them would make the rights story needlessly ambiguous.
    """

    cleaned = image.copy()
    draw = ImageDraw.Draw(cleaned)
    for x, y, radius in hubs:
        draw.ellipse(
            (x - radius, y - radius, x + radius, y + radius),
            fill=fill,
            outline=ring,
            width=2,
        )
        inner = max(2, radius - 5)
        draw.ellipse(
            (x - inner, y - inner, x + inner, y + inner),
            fill=fill,
            outline=highlight,
            width=1,
        )
    return cleaned


def build() -> None:
    side = fit(Image.open(SOURCE / "vehicle-side-master.png").convert("RGBA"))
    showroom = fit(Image.open(SOURCE / "showroom-master.png").convert("RGB"))
    blueprint_rgb = fit(
        Image.open(SOURCE / "vehicle-side-blueprint-master.png").convert("RGB")
    )

    # Remove a handful of isolated generator pixels outside the reviewed vehicle
    # band while retaining the source's antialiased cutout.
    alpha = side.getchannel("A")
    alpha_guard = Image.new("L", CANVAS, 0)
    ImageDraw.Draw(alpha_guard).rectangle((0, 120, 1599, 780), fill=255)
    alpha = ImageChops.multiply(alpha, alpha_guard)

    # The blueprint generator returned a baked light-gray checkerboard rather
    # than alpha. Its actual vehicle is dark/cyan and closely registered to the
    # side render. Build a conservative foreground matte, close tiny linework
    # holes, then intersect it with the reviewed side silhouette. This prevents
    # both checker leakage and a blueprint halo during the scan transition.
    red, green, blue = blueprint_rgb.split()
    minimum_channel = ImageChops.darker(ImageChops.darker(red, green), blue)
    blueprint_foreground = minimum_channel.point(lambda p: 255 if p < 226 else 0)
    blueprint_foreground = blueprint_foreground.filter(ImageFilter.MaxFilter(5))
    blueprint_foreground = blueprint_foreground.filter(ImageFilter.MinFilter(5))
    blueprint_foreground = blueprint_foreground.filter(
        ImageFilter.GaussianBlur(radius=0.8)
    )
    blueprint_alpha = ImageChops.multiply(alpha, blueprint_foreground)
    blueprint = blueprint_rgb.convert("RGBA")
    blueprint.putalpha(blueprint_alpha)

    # Coordinates are audited against the normalized 1600x900 production
    # canvas.  Only the inner hub discs are covered; spokes and wheel anchors
    # remain intact for callouts and the representative wheel treatment.
    side = neutralize_hubs(
        side,
        ((298, 608, 13), (1266, 607, 13)),
        fill="#202326",
        ring="#73787a",
        highlight="#3c4144",
    )
    blueprint = neutralize_hubs(
        blueprint,
        ((303, 608, 14), (1265, 610, 14)),
        fill="#092b46",
        ring="#b9e9f0",
        highlight="#4f93a6",
    )
    showroom = neutralize_hubs(
        showroom,
        ((690, 624, 12), (1350, 576, 9)),
        fill="#202326",
        ring="#74797b",
        highlight="#3c4144",
    )
    # Hub cleanup changes RGB only. Restore the two reviewed alpha mattes after
    # drawing so the cleanup cannot create opaque pixels or a transition halo.
    side.putalpha(alpha)
    blueprint.putalpha(blueprint_alpha)

    save_webp(showroom, "showroom-fallback.webp", quality=91)
    save_webp(side, "vehicle-side.webp", quality=91)
    save_webp(blueprint, "vehicle-side-blueprint.webp", quality=93)

    # Runtime scan mask: a soft-edged luminance silhouette, not a visual layer.
    scan_alpha = alpha.filter(ImageFilter.GaussianBlur(radius=1.2))
    scan_mask = Image.new("RGB", CANVAS, "black")
    scan_mask.paste(Image.new("RGB", CANVAS, "white"), mask=scan_alpha)
    save_webp(scan_mask, "vehicle-scan-mask.webp", quality=95)

    # Approximate recolorable body-paint mask for the authored 2.5D renderer.
    # Pixels are selected in HSV, then constrained by the vehicle alpha.
    hsv = side.convert("RGB").convert("HSV")
    hue, saturation, value = hsv.split()
    green_hue = hue.point(lambda p: 255 if 58 <= p <= 122 else 0)
    colored = saturation.point(lambda p: 255 if p >= 42 else 0)
    visible = value.point(lambda p: 255 if p >= 18 else 0)
    paint_mask = ImageChops.multiply(green_hue, colored)
    paint_mask = ImageChops.multiply(paint_mask, visible)
    paint_mask = ImageChops.multiply(paint_mask, alpha)
    paint_mask = paint_mask.filter(ImageFilter.GaussianBlur(radius=0.7))
    save_webp(paint_mask.convert("RGB"), "vehicle-paint-mask.webp", quality=95)

    # The inset is deliberately representative: it is a truthful crop of the
    # authored source wheel, not a claim that exact production wheel geometry exists.
    wheel_crop = blueprint.crop((145, 420, 495, 770))
    wheel_crop = wheel_crop.resize((512, 512), Image.Resampling.LANCZOS)
    wheel_alpha = Image.new("L", wheel_crop.size, 0)
    ImageDraw.Draw(wheel_alpha).ellipse((28, 28, 484, 484), fill=255)
    wheel_alpha = ImageChops.multiply(wheel_crop.getchannel("A"), wheel_alpha)
    wheel_crop.putalpha(wheel_alpha)
    save_webp(wheel_crop, "representative-wheel-inset.webp", quality=93)


if __name__ == "__main__":
    build()
