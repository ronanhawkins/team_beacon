"""Generate shared/fake/layers/: meta.json plus one 8-bit greyscale PNG per layer.

Usage: python3 tools/make_fake_layers.py   (needs Pillow)

The scene is the same flat plain and butte as the fake waypoints (fake_scene.py),
so the route lines up with the layers. Image layout follows shared/layers.md:
row 0 is north, column 0 is west, pixel (col, row) covers
x = col * metresPerPixel, y = (height - 1 - row) * metresPerPixel.
"""

import json
import math
from pathlib import Path

from PIL import Image

import fake_scene as S

OUT = Path(__file__).resolve().parent.parent / "shared" / "fake" / "layers"
SIZE = S.CROP_PX
MPP = S.METRES_PER_PIXEL

LAYERS = {
    "exposure":         {"file": "exposure.png",         "min": 0, "max": 1},
    "sunlight":         {"file": "sunlight.png",         "min": 0, "max": 1},
    "baseLink":         {"file": "baseLink.png",         "min": 0, "max": 1},
    "earthLink":        {"file": "earthLink.png",        "min": 0, "max": 1},
    "slope":            {"file": "slope.png",            "min": 0, "max": 45},
    "minutesToShelter": {"file": "minutesToShelter.png", "min": 0, "max": 40},
}

BASE_SIN = [math.sin(math.radians(max(0.0, S.base_horizon(i * S.AZ_STEP))))
            for i in range(S.SKYLINE_SAMPLES)]
SUN_I = S.nearest_index(S.SUN["az"])
EARTH_I = S.nearest_index(S.EARTH["az"])


def sample(pos):
    """Values of every layer at one position."""
    on_top = S.inside_butte(pos)
    total = 0.0
    sky_at = {}
    for i in range(S.SKYLINE_SAMPLES):
        b = 0.0 if on_top else S.butte_elevation(pos, i * S.AZ_STEP)
        base = S.base_horizon(i * S.AZ_STEP)
        if b > base:
            total += math.sin(math.radians(b))
            if i in (SUN_I, EARTH_I):
                sky_at[i] = b
        else:
            total += BASE_SIN[i]
            if i in (SUN_I, EARTH_I):
                sky_at[i] = base

    d = S.distance(pos, S.BUTTE_CENTRE)
    wall = 40.0 * math.exp(-((d - S.BUTTE_RADIUS) / 6.0) ** 2)
    ground = 2.0 + 1.5 * (math.sin(pos[0] / 37.0) * math.cos(pos[1] / 53.0)) ** 2
    return {
        "exposure": 1 - total / S.SKYLINE_SAMPLES,
        "sunlight": 1.0 if S.SUN["el"] > sky_at[SUN_I] else 0.0,
        "baseLink": 1.0 if S.base_visible(pos) else 0.0,
        "earthLink": 1.0 if S.EARTH["el"] > sky_at[EARTH_I] else 0.0,
        "slope": max(wall, ground),
        "minutesToShelter": S.distance(pos, S.SHELTER_POS) / S.WALK_SPEED_M_PER_MIN,
    }


def to_byte(v, lo, hi):
    return max(0, min(255, round((v - lo) / (hi - lo) * 255)))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    pixels = {name: bytearray(SIZE * SIZE) for name in LAYERS}
    for row in range(SIZE):
        y = (SIZE - 1 - row) * MPP
        for col in range(SIZE):
            values = sample((col * MPP, y))
            for name, spec in LAYERS.items():
                pixels[name][row * SIZE + col] = to_byte(values[name], spec["min"], spec["max"])

    for name, spec in LAYERS.items():
        Image.frombytes("L", (SIZE, SIZE), bytes(pixels[name])).save(OUT / spec["file"], optimize=True)
        print(f"wrote shared/fake/layers/{spec['file']}")

    meta = {"version": 1, "width": SIZE, "height": SIZE, "metresPerPixel": MPP, "layers": LAYERS}
    (OUT / "meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print("wrote shared/fake/layers/meta.json")


if __name__ == "__main__":
    main()
