# Murray Buttes terrain handoff for Ronn

Prepared from the exact crop and source URLs supplied by the team. These are real terrain/image assets. The active mission now uses Ronan's exported waypoints in the same crop frame.

| File | Use |
| --- | --- |
| `height_750.bin` | 750 × 750 Float32 values, little-endian, no embedded header; 2,250,000 bytes |
| `height_750.hdr` | ENVI binary-layout descriptor; georeferencing is in `terrain.json` |
| `buttes_4096.jpg` | Hub colour texture, whole 3 km square, JPEG quality 90 |
| `buttes_2048.jpg` | Smaller colour texture for later headset use, same entire square |
| `terrain.json` | Exact bounds, CRS, source URLs, units, height reference and pixel coordinates |
| `detail_height_601.bin` | Native VR: 601-square real 1 m Float32 height samples, 600 m vertex span |
| `detail_2404.jpg` | Matching native detail image footprint, 601 m square sampled at 0.25 m/pixel |
| `detail_sun_301.bin` | Static visual Sun visibility, 301-square Float32 at 2 m spacing; not mission telemetry |
| `detail_native.json` | Detail origin, source URLs, frame, scenario Sun and main route corridor |

## Load in Three.js

```js
import { loadTerrain } from '../../shared/terrain.js';
const terrain = await loadTerrain('/data/out/terrain/');
scene.add(terrain.mesh);
// Later: terrain.dispose();
```

This optional helper is not imported by AR. It produces the 750-square mesh with correct normals, triangle winding and texture orientation. It uses the southwestern crop corner as its horizontal origin, x east and -z north in Three.js. World y is terrain height minus `terrain.json`'s parking elevation (-4379.46 m, from the updated `data/site.json`).

For a shared route point `{x,y,z}`, use Three.js `[x, z - metadata.parking.z, -y]`. The updated sol 1455 parking spot is `[1500.415, 0, -1500.383]` in this rendering frame. If you instead centre the entire scene at the parking spot, subtract its x from east and add its y to north's negative-z coordinate for **all** assets, including routes and layers.

## Pixel alignment detail

GDAL average resampling gives pixel-centre height samples: first sample is x=2 m, y=2998 m, and the last is x=2998 m, y=2 m. Spacing is exactly 4 m. Texture UV is `(column+0.5)/750, (row+0.5)/750` with `texture.flipY=false`. The image covers the complete 3000 m square. The mesh spans the sample centres (2996 m), not a fictitious extra row. This matches the team's updated cell-centre convention in `shared/conventions.md`; respect each layer's resolution.

## Reproduce

`python -m pip install -r tools/requirements-terrain.txt`, then `python tools/prepare-buttes.py`.

The script uses GDAL via Rasterio because no standalone `gdal_translate` executable is installed on this laptop. It checks that the DEM source window matches the supplied projected bounds. The image and DEM have different datum names but identical numerical projection parameters and Mars radius; those parameters are verified before the image is cropped. The raw height binary is written explicitly because the bundled ENVI writer rejected the planetary CRS. All georeferencing is preserved in `terrain.json`.

Original 1 m crop: `data/raw/near.tif`, ignored by Git. `python tools/prepare-mission-vr.py` creates the native detail tile around all exported Gale routes and its matching colour image, then copies them into Unity. Its southwest vertex is (1200.5, 1140.5); all 268 main/diversion points fit. The 600 m vertex span and 601 m image footprint reflect pixel centres versus edges. See `apps/quest/Assets/Beacon/Art/MissionTerrain/README.md` for detail levels, generated appearance and limits. Do not stretch the full-square image over the smaller tile.

Sources: [USGS DEM](https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif), [USGS/PDS colour mosaic](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_HiRISE-LRGB_78quads_sharp_cog.tif). Credit: NASA/JPL/University of Arizona/USGS. Scenario metadata follows `data/site.json`; these visual assets do not establish the paper's 19%/10% validation.
