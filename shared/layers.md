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

## Terrain for the hub and VR

The reduced terrain mesh and its draped image go in `data/out/terrain/`. They cover the same crop and use the same local frame, so layers and routes line up with the mesh without any offset.
