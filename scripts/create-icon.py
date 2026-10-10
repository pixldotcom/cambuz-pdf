#!/usr/bin/env python3
"""Cambuz PDF Reader — application icon generator.

Draws the Cambuz mark programmatically (no image assets needed) and writes the
per-platform packaging formats plus the runtime window icon:

  assets/icon.png   512x512 PNG, staged into the app for BrowserWindow
  build/icon.png    512x512 PNG, electron-builder Linux icon
  build/icon.ico    multi-size ICO, electron-builder Windows icon
  build/icon.icns   multi-size ICNS, electron-builder macOS icon

The mark: a deep-indigo rounded tile, a white document sheet with a folded
corner and text lines, and a coral bookmark ribbon (a reader's mark). All
shapes are drawn at 2x and downscaled for clean edges.

Usage: python3 scripts/create-icon.py
Requires: Pillow (pip install pillow)
"""

import os
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("Pillow is required: pip install pillow")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SS = 2  # supersample factor
MASTER = 1024

# Palette: deep indigo tile, white sheet, slate text lines, coral bookmark.
TILE_TOP = (63, 63, 132)
TILE_BOTTOM = (32, 32, 70)
SHEET = (245, 245, 250)
FOLD = (196, 197, 218)
LINE = (143, 143, 178)
BOOKMARK = (255, 107, 94)
BOOKMARK_DARK = (214, 72, 63)


def rounded_rect(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def draw_icon(size):
    """Return the icon as an RGBA image of (size, size)."""
    s = size * SS  # draw big, then downscale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Tile: rounded square with a vertical gradient.
    margin = int(s * 0.03)
    radius = int(s * 0.225)
    tile = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    td = ImageDraw.Draw(tile)
    for y in range(margin, s - margin):
        t = (y - margin) / max(1, (s - 2 * margin) - 1)
        td.line(
            [(margin, y), (s - margin, y)],
            fill=tuple(int(TILE_TOP[i] + (TILE_BOTTOM[i] - TILE_TOP[i]) * t) for i in range(3)) + (255,),
        )
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([margin, margin, s - margin, s - margin], radius=radius, fill=255)
    img.paste(tile, (0, 0), mask)

    # Soft top highlight on the tile.
    hi = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(hi).rounded_rectangle(
        [margin, margin, s - margin, int(s * 0.5)], radius=radius, fill=(255, 255, 255, 26)
    )
    img = Image.alpha_composite(img, hi)
    d = ImageDraw.Draw(img)

    # Document sheet with a folded top-right corner.
    x0, y0 = int(s * 0.30), int(s * 0.16)
    x1, y1 = int(s * 0.70), int(s * 0.84)
    fold = int(s * 0.10)
    d.polygon(
        [(x0, y0), (x1 - fold, y0), (x1, y0 + fold), (x1, y1), (x0, y1)],
        fill=SHEET + (255,),
    )
    d.polygon(
        [(x1 - fold, y0), (x1, y0 + fold), (x1 - fold, y0 + fold)],
        fill=FOLD + (255,),
    )

    # Text lines on the sheet.
    lx0, lx1 = int(s * 0.355), int(s * 0.645)
    for i, yy in enumerate([0.44, 0.52, 0.60, 0.68]):
        y = int(s * yy)
        h = int(s * 0.028)
        end = int(lx0 + (lx1 - lx0) * (0.62 if i == 3 else 1.0))
        d.rounded_rectangle([lx0, y, end, y + h], radius=h // 2, fill=LINE + (255,))

    # Coral bookmark ribbon overlapping the sheet's top-left.
    bx0, bx1 = int(s * 0.375), int(s * 0.475)
    by0, by1 = int(s * 0.16), int(s * 0.365)
    notch = int(s * 0.035)
    d.polygon(
        [(bx0, by0), (bx1, by0), (bx1, by1), ((bx0 + bx1) // 2, by1 - notch), (bx0, by1)],
        fill=BOOKMARK + (255,),
    )
    # Thin darker edge at the ribbon's top where it meets the sheet edge.
    d.rectangle([bx0, by0, bx1, by0 + int(s * 0.008)], fill=BOOKMARK_DARK + (255,))

    return img.resize((size, size), Image.LANCZOS)


def main():
    master = draw_icon(MASTER)

    assets_dir = os.path.join(REPO_ROOT, "assets")
    build_dir = os.path.join(REPO_ROOT, "build")
    os.makedirs(assets_dir, exist_ok=True)
    os.makedirs(build_dir, exist_ok=True)

    runtime_png = os.path.join(assets_dir, "icon.png")
    master.resize((512, 512), Image.LANCZOS).save(runtime_png)
    print(f"wrote {os.path.relpath(runtime_png, REPO_ROOT)}")

    linux_png = os.path.join(build_dir, "icon.png")
    master.resize((512, 512), Image.LANCZOS).save(linux_png)
    print(f"wrote {os.path.relpath(linux_png, REPO_ROOT)}")

    ico_path = os.path.join(build_dir, "icon.ico")
    master.save(ico_path, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"wrote {os.path.relpath(ico_path, REPO_ROOT)}")

    icns_path = os.path.join(build_dir, "icon.icns")
    master.save(icns_path)
    print(f"wrote {os.path.relpath(icns_path, REPO_ROOT)}")


if __name__ == "__main__":
    main()
