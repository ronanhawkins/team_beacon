"""Generate apps/hub/dev/fake-terrain/: a fake height grid and draped image for the hub.

Usage: python3 apps/hub/dev/make_fake_terrain.py   (needs Pillow)

The heights come from tools/fake_scene.py, so the fake terrain is the same plain and butte
as shared/fake/waypoints.json and shared/fake/layers/. Nothing here is real Mars data.

Output, in the same form as the real data/out/terrain/ so the hub has one loader:
  terrain.json  { version, heightGrid: { file, width, height, metresPerPixel }, textures: { hub } }
  heights.bin   raw little-endian float32, row-major, row 0 north, values at cell centres (shared/conventions.md)
  image.png     draped image covering the whole crop
"""

import array
import json
import math
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True  # keep tools/ free of __pycache__
sys.path.insert(0, str(HERE.parent.parent.parent / "tools"))
import fake_scene as S  # noqa: E402

OUT = HERE / "fake-terrain"
SIZE = S.CROP_PX
MPP = S.METRES_PER_PIXEL
IMG = 512


def noise(x, y):
    """Cheap smooth noise in 0..1."""
    return 0.5 + 0.25 * math.sin(x * 0.071 + 1.3 * math.sin(y * 0.043)) + 0.25 * math.sin(y * 0.089 + 1.7 * math.sin(x * 0.037))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    heights = array.array("f")
    for row in range(SIZE):
        y = (SIZE - row - 0.5) * MPP
        for col in range(SIZE):
            heights.append(S.terrain_z(((col + 0.5) * MPP, y)))
    if sys.byteorder == "big":
        heights.byteswap()
    (OUT / "heights.bin").write_bytes(heights.tobytes())

    extent = SIZE * MPP
    img = Image.new("RGB", (IMG, IMG))
    px = img.load()
    for row in range(IMG):
        y = (IMG - row - 0.5) / IMG * extent
        for col in range(IMG):
            x = (col + 0.5) / IMG * extent
            n = noise(x, y)
            ripple = 0.5 + 0.5 * math.sin((x * 0.8 + y * 0.35) / 6 + 5 * n)
            r, g, b = 168 + 30 * n + 8 * ripple, 108 + 22 * n + 6 * ripple, 72 + 16 * n
            if S.inside_butte((x, y)):
                r, g, b = 112 + 14 * n, 80 + 10 * n, 64 + 8 * n
            px[col, row] = (int(r), int(g), int(b))
    img.save(OUT / "image.png")

    meta = {
        "version": 1,
        "note": "FAKE terrain generated from tools/fake_scene.py. Not Mars data.",
        "heightGrid": {"file": "heights.bin", "width": SIZE, "height": SIZE, "metresPerPixel": MPP},
        "textures": {"hub": "image.png"},
    }
    (OUT / "terrain.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"wrote {OUT.relative_to(HERE.parent.parent.parent)}")


if __name__ == "__main__":
    main()
