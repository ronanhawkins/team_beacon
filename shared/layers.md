# Layers

The engine exports map layers to `data/out/layers/` for the hub. Each layer is one image, plus one metadata file that says how to read them.

Units and the position frame are in `conventions.md`.

## Images

- One 8-bit greyscale PNG per layer.
- Every image has the same width and height, covering the whole terrain crop.
- Row 0 is the north edge. Column 0 is the west edge.
- Pixel (col, row) covers x from col * metresPerPixel to (col + 1) * metresPerPixel. Its centre is at x = (col + 0.5) * metresPerPixel, y = (height - row - 0.5) * metresPerPixel.
- Pixel value 0 maps to the layer's `min` and 255 to its `max`, linearly.

## Layers

| Name | Meaning | Range |
|---|---|---|
| `exposure` | Open-sky fraction | 0 to 1 |
| `sunlight` | In direct sunlight at the chosen time | 0 or 1 |
| `baseLink` | Line of sight to base | 0 or 1 |
| `earthLink` | Line of sight to Earth | 0 or 1 |
| `slope` | Terrain slope | degrees, 0 to `max` |
| `minutesToShelter` | Walking time to the nearest shelter | minutes, 0 to `max` |

## Metadata file

`data/out/layers/meta.json`

```json
{
  "version": 1,
  "width": 750,
  "height": 750,
  "metresPerPixel": 4,
  "layers": {
    "exposure":         { "file": "exposure.png",         "min": 0, "max": 1 },
    "sunlight":         { "file": "sunlight.png",         "min": 0, "max": 1 },
    "baseLink":         { "file": "baseLink.png",         "min": 0, "max": 1 },
    "earthLink":        { "file": "earthLink.png",        "min": 0, "max": 1 },
    "slope":            { "file": "slope.png",            "min": 0, "max": 45 },
    "minutesToShelter": { "file": "minutesToShelter.png", "min": 0, "max": 30 }
  }
}
```

The numbers in the example are illustrative. The engine writes the real ones.

### Images covering part of the crop (addition)

`meta.json` may also carry `originX` and `originY`: the local metres of the south-west corner of the images. When they are absent they are 0, and the images start at the crop's south-west corner as above. With them, pixel (col, row) covers x from originX + col * metresPerPixel to originX + (col + 1) * metresPerPixel, and its centre is at x = originX + (col + 0.5) * metresPerPixel, y = originY + (height - row - 0.5) * metresPerPixel.

```json
{ "version": 1, "width": 375, "height": 375, "metresPerPixel": 4, "originX": 748, "originY": 748, "layers": { "...": "..." } }
```

`meta.json` lists only the layers the engine has written. A layer that is missing from it has not been produced yet.

### Layers valid over part of the image (addition)

A layer entry may carry `validBounds`: `{ "xMin", "xMax", "yMin", "yMax" }` in local metres. Only pixels whose centres fall inside it hold real values; the rest are set to the layer's `max`. `minutesToShelter` uses this, because the planner covers only its own bounds. When absent, the whole image is valid.

```json
"minutesToShelter": { "file": "minutesToShelter.png", "min": 0, "max": 30,
                      "validBounds": { "xMin": 1250, "xMax": 1650, "yMin": 1200, "yMax": 1750 } }
```

## Terrain for the hub and VR

The reduced terrain mesh and its draped image go in `data/out/terrain/`. They cover the same crop and use the same local frame, so layers and routes line up with the mesh without any offset.
