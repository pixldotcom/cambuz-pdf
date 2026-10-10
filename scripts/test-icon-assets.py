#!/usr/bin/env python3
"""Check that every shipped platform icon is a transparent rescale of the master.

Requires Pillow (pip install pillow). Run after generate-icon-assets.py or in CI.
"""
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parent.parent
master = Image.open(root / "assets/icon-master.png").convert("RGBA")
assert master.getchannel("A").getextrema()[0] == 0, "master has no transparent pixels"


def check(frame, size, label):
    actual = frame.convert("RGBA")
    expected = master.resize((size, size), Image.Resampling.LANCZOS)
    assert actual.size == (size, size), f"{label}: wrong dimensions"
    assert actual.getchannel("A").getextrema()[0] == 0, f"{label}: transparency lost"
    assert actual.tobytes() == expected.tobytes(), f"{label}: stale or altered icon"
    print(f"  OK {label} ({size}px, alpha preserved)")


for name in ("assets/icon.png", "build/icon.png"):
    check(Image.open(root / name), 512, name)

ico = Image.open(root / "build/icon.ico")
assert set(ico.ico.sizes()) == {(s, s) for s in (16, 24, 32, 48, 64, 128, 256)}
for size in (16, 24, 32, 48, 64, 128, 256):
    check(ico.ico.getimage((size, size)), size, f"build/icon.ico/{size}")

icns = Image.open(root / "build/icon.icns")
for size in (32, 64, 128, 256, 512, 1024):
    # ICNS uses point sizes with a 1x or 2x scale factor.
    scale = 2 if size in (32, 64, 1024) else 1
    check(icns.icns.getimage((size // scale, size // scale, scale)), size, f"build/icon.icns/{size}")

print("All shipped icons match the transparent master.")
