#!/usr/bin/env python3
"""Cambuz PDF Reader — platform icon asset generator.

Derives every packaged icon format from the official master icon
(`assets/icon-master.png`), which is the authoritative visual identity of the
application. The master must never be redrawn, recoloured or substituted: this
script only rescales it to the formats the packaging setup requires:

  assets/icon.png   512x512 PNG   runtime window/taskbar icon + README logo
  build/icon.png    512x512 PNG   electron-builder Linux icon (hicolor set)
  build/icon.ico    16-256 ICO    Windows installer, exe, shortcut, taskbar
  build/icon.icns   32-1024 ICNS  macOS bundle icon (Dock, Finder, title bar)

Known limitation of the source asset: the master is a 1254x1254 RGB PNG with
no alpha channel — the artwork is a full-bleed tile with its own dark
background, so there is nothing to key out. The conversions are therefore
straight opaque rescales; no transparency is invented and nothing is cropped.

The script fails with a clear error when the master is missing or unusable, so
packaging can never silently fall back to a generic icon. Regenerate the assets
with:

    python3 scripts/generate-icon-assets.py

Requires: Pillow (pip install pillow)
"""

import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: pip install pillow")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER = os.path.join(REPO_ROOT, "assets", "icon-master.png")

RUNTIME_PNG = os.path.join(REPO_ROOT, "assets", "icon.png")
LINUX_PNG = os.path.join(REPO_ROOT, "build", "icon.png")
WIN_ICO = os.path.join(REPO_ROOT, "build", "icon.ico")
MAC_ICNS = os.path.join(REPO_ROOT, "build", "icon.icns")

PNG_SIZE = 512
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
# Pillow's ICNS writer packs ic07 (128), ic08/ic13 (256), ic09/ic14 (512),
# ic10 (1024), ic11 (32 = 16@2x) and ic12 (64 = 32@2x). Supply every size as a
# pre-rescaled image so each entry is a clean LANCZOS rescale of the master.
ICNS_SIZES = [32, 64, 128, 256, 512, 1024]
MIN_MASTER = 1024


def die(message):
    sys.exit(f"generate-icon-assets: {message}")


def load_master():
    if not os.path.exists(MASTER):
        die(
            "required icon master is missing: assets/icon-master.png\n"
            "  The official icon is the source of truth for the application identity;\n"
            "  restore it before packaging (no fallback icon is allowed)."
        )
    try:
        master = Image.open(MASTER)
        master.load()
    except Exception as error:  # noqa: BLE001 - report any decode failure clearly
        die(f"assets/icon-master.png is not a readable image: {error}")
    if master.format != "PNG":
        die(f"assets/icon-master.png must be a PNG (found {master.format})")
    width, height = master.size
    if width != height:
        die(f"assets/icon-master.png must be square (found {width}x{height})")
    if width < MIN_MASTER:
        die(
            f"assets/icon-master.png is {width}x{height}; at least {MIN_MASTER}x{MIN_MASTER}\n"
            f"  is needed for a sharp macOS 1024px (ic10) entry without upscaling."
        )
    return master.convert("RGBA")


def main():
    master = load_master()

    for directory in (os.path.dirname(RUNTIME_PNG), os.path.dirname(LINUX_PNG)):
        os.makedirs(directory, exist_ok=True)

    # 512px PNG: window/taskbar icon at runtime and the Linux electron-builder icon.
    png = master.resize((PNG_SIZE, PNG_SIZE), Image.LANCZOS)
    png.save(RUNTIME_PNG)
    print(f"wrote {os.path.relpath(RUNTIME_PNG, REPO_ROOT)} ({PNG_SIZE}x{PNG_SIZE})")
    png.save(LINUX_PNG)
    print(f"wrote {os.path.relpath(LINUX_PNG, REPO_ROOT)} ({PNG_SIZE}x{PNG_SIZE})")

    # Windows: one multi-resolution .ico (PNG-compressed entries).
    master.save(WIN_ICO, sizes=ICO_SIZES)
    print(
        f"wrote {os.path.relpath(WIN_ICO, REPO_ROOT)} "
        f"({', '.join(f'{w}x{h}' for w, h in ICO_SIZES)})"
    )

    # macOS: one multi-resolution .icns (PNG-encoded entries). Every entry size
    # is passed pre-rescaled so the writer never resamples on its own.
    frames = [master.resize((size, size), Image.LANCZOS) for size in ICNS_SIZES]
    frames[-1].save(MAC_ICNS, append_images=frames)
    print(
        f"wrote {os.path.relpath(MAC_ICNS, REPO_ROOT)} "
        f"({', '.join(str(s) + 'px' for s in ICNS_SIZES)})"
    )

    # Sanity: outputs must exist and be non-trivial.
    for path in (RUNTIME_PNG, LINUX_PNG, WIN_ICO, MAC_ICNS):
        if not os.path.exists(path) or os.path.getsize(path) == 0:
            die(f"failed to write {os.path.relpath(path, REPO_ROOT)}")


if __name__ == "__main__":
    main()
