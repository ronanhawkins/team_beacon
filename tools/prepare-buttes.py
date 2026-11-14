"""Download Ronan's agreed crop using the GDAL bundled with Rasterio.

Equivalent to the supplied gdal_translate windows; no whole-mosaic download.
Usage: .venv/Scripts/python tools/prepare-buttes.py
The optional central 1 km VR grid is intentionally deferred until AR is tested.
"""
import json
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.windows import Window, bounds as window_bounds, from_bounds as window_from_bounds

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data/raw'
OUT = ROOT / 'data/out/terrain'
DEM = 'https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif'
ORTHO = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_HiRISE-LRGB_78quads_sharp_cog.tif'
BOUNDS = [8140057.492786, -279807.075189, 8143057.492786, -276807.075189]
WINDOW = Window(12064, 32026, 3000, 3000)


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    near = RAW / 'near.tif'
    print(f'Using GDAL {rasterio.__gdal_version__} through Rasterio {rasterio.__version__}', flush=True)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif', GDAL_HTTP_TIMEOUT='120', GDAL_HTTP_MAX_RETRY='3'):
        if not near.exists():
            print('Reading the exact 3000 x 3000 DEM crop…', flush=True)
            with rasterio.open('/vsicurl/' + DEM) as source:
                actual = window_bounds(WINDOW, source.transform)
                if not np.allclose(actual, BOUNDS, atol=0.001, rtol=0):
                    raise ValueError(f'DEM window differs from agreed image bounds: {actual}')
                heights = source.read(1, window=WINDOW, masked=True)
                if heights.shape != (3000, 3000) or np.ma.getmaskarray(heights).any() or not np.isfinite(heights).all():
                    raise ValueError('The crop contains missing terrain heights')
                profile = source.profile.copy()
                profile.update(driver='GTiff', width=3000, height=3000, count=1, transform=source.window_transform(WINDOW), compress='deflate')
                with rasterio.open(near.with_suffix('.partial.tif'), 'w', **profile) as target:
                    target.write(heights.filled(), 1)
                    target.scales = (source.scales[0],)
                    target.offsets = (source.offsets[0],)
            near.with_suffix('.partial.tif').replace(near)
        with rasterio.open(near) as source:
            if source.shape != (3000, 3000) or not np.allclose(source.bounds, BOUNDS, atol=0.001, rtol=0):
                raise ValueError('Existing near.tif does not match the agreed crop')
            crs = source.crs
            reduced = source.read(1, out_shape=(750, 750), resampling=Resampling.average, masked=True)
            reduced = np.asarray(reduced, dtype='<f4') * source.scales[0] + source.offsets[0]
            if not np.isfinite(reduced).all():
                raise ValueError('Invalid reduced height grid')
            print('Writing the little-endian height grid…', flush=True)
            # Raw bytes avoid ENVI's limited planetary projection support. Georeferencing
            # is preserved explicitly in terrain.json; the .hdr describes the binary layout.
            (OUT / 'height_750.bin').write_bytes(reduced.astype('<f4').tobytes(order='C'))
            (OUT / 'height_750.hdr').write_text('ENVI\nsamples = 750\nlines = 750\nbands = 1\nheader offset = 0\nfile type = ENVI Standard\ndata type = 4\ninterleave = bsq\nbyte order = 0\n', encoding='ascii')
        for size in (4096, 2048):
            output = OUT / f'buttes_{size}.jpg'
            if output.exists():
                with Image.open(output) as existing:
                    if existing.size != (size, size):
                        raise ValueError(f'Unexpected size for {output.name}')
                continue
            print(f'Reading colour imagery at {size} x {size}…', flush=True)
            with rasterio.open('/vsicurl/' + ORTHO) as source:
                # These official products name their Mars datums differently. Require
                # identical numeric projection parameters, radius and units before cropping.
                if source.crs.to_dict() != crs.to_dict() or source.count < 3 or any(t != 'uint8' for t in source.dtypes[:3]):
                    raise ValueError('Expected matching planetary CRS and three 8-bit colour bands')
                rgb = source.read([1, 2, 3], window=window_from_bounds(*BOUNDS, source.transform),
                                  out_shape=(3, size, size), resampling=Resampling.average, masked=True)
                if np.ma.getmaskarray(rgb).any():
                    raise ValueError('Colour image does not fully cover the agreed crop')
                Image.fromarray(np.moveaxis(np.asarray(rgb), 0, -1)).save(output.with_suffix('.partial.jpg'), quality=90)
                output.with_suffix('.partial.jpg').replace(output)
    metadata = {
        'version': 1, 'source': {'dem': DEM, 'colour': ORTHO, 'credit': 'NASA/JPL/University of Arizona/USGS'},
        'demSourceWindow': [12064, 32026, 3000, 3000], 'boundsProjectedMetres': BOUNDS, 'crsWkt': crs.to_wkt(),
        'originProjectedMetres': BOUNDS[:2], 'localFrame': 'x east, y north, z absolute terrain elevation; metres; origin southwest',
        'parking': {'x': 1500, 'y': 1500, 'z': -4379.5, 'source': 'Team-provided crop centre and height; not an independently verified rover location'},
        'heightGrid': {'file': 'height_750.bin', 'width': 750, 'height': 750, 'metresPerPixel': 4,
                       'dtype': 'little-endian Float32', 'headerBytes': 0, 'row0': 'north',
                       'samplePosition': 'x = (column + 0.5) * 4; y = 3000 - (row + 0.5) * 4; z = height',
                       'minimum': float(reduced.min()), 'maximum': float(reduced.max())},
        'textures': {'hub': 'buttes_4096.jpg', 'headset': 'buttes_2048.jpg', 'row0': 'north', 'coverage': 'entire 3000 m square'},
        'rendering': {'threeJsPosition': '[x, z - (-4379.5), -y]', 'textureUV': '[(column+0.5)/750, (row+0.5)/750]',
                      'note': 'Height values are pixel-centre samples, 2 m inside the crop boundary. The shared layer convention uses grid nodes; honour each asset transform.'},
        'optionalVrGrid': 'Deferred until AR works end to end',
    }
    (OUT / 'terrain.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'files': {p.name: p.stat().st_size for p in OUT.iterdir() if p.is_file()},
                      'heightRange': [float(reduced.min()), float(reduced.max())]}, indent=2), flush=True)


if __name__ == '__main__':
    main()
