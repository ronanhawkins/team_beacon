"""Prepare georeferenced Gale terrain for native walking; no invented elevations.

Uses the team's existing 1 m DEM and downloads only a matching 601 m colour
window. Fine generated materials are separate Unity assets, never planner data.
"""
import json
import shutil
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import Window, from_bounds
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/out/terrain'
ART = ROOT / 'apps/quest/Assets/Beacon/Art/MissionTerrain'
SIZE = 601
X, Y = 1200, 1140


def main():
    ART.mkdir(parents=True, exist_ok=True)
    site = json.loads((ROOT / 'data/site.json').read_text())
    source = json.loads((OUT / 'terrain.json').read_text())
    routes = json.loads((ROOT / 'data/out/waypoints.json').read_text())
    all_points = [p for route in [routes['main'], *routes['reroutes'].values()] for p in route]
    if not all(X + 2 < p['pos']['x'] < X + SIZE - 2 and Y + 2 < p['pos']['y'] < Y + SIZE - 2 for p in all_points):
        raise ValueError('Mission route extends outside the chosen detail tile')
    with rasterio.open(ROOT / 'data/raw/near.tif') as dem:
        window = Window(X, 3000-Y-SIZE, SIZE, SIZE)
        heights = dem.read(1, window=window, masked=True)
        if heights.shape != (SIZE, SIZE) or np.ma.getmaskarray(heights).any():
            raise ValueError('Incomplete DEM detail tile')
        heights = np.asarray(heights, dtype='<f4') * dem.scales[0] + dem.offsets[0]
        if not np.isfinite(heights).all():
            raise ValueError('Nonfinite DEM values')
        bounds = rasterio.windows.bounds(window, dem.transform)
        crs = dem.crs
        whole = dem.read(1).astype(np.float32) * dem.scales[0] + dem.offsets[0]
    (OUT / 'detail_height_601.bin').write_bytes(heights.astype('<f4').tobytes())
    # Offline visual shadow bake from the same measured heights and supplied Sun.
    # It affects terrain lighting only, never the relay's sunlight or dose data.
    shadow_size = 301
    xx, yy = np.meshgrid(X + .5 + np.arange(shadow_size)*2,
                         Y + .5 + np.arange(shadow_size-1, -1, -1)*2)
    def sample(px, py):
        col=np.clip(px-.5,0,2998.999);row=np.clip(2999.5-py,0,2998.999)
        c=col.astype(np.int32);r=row.astype(np.int32);fx=col-c;fy=row-r
        return (whole[r,c]*(1-fx)+whole[r,c+1]*fx)*(1-fy)+(whole[r+1,c]*(1-fx)+whole[r+1,c+1]*fx)*fy
    base=sample(xx,yy);az=np.deg2rad(site['sky']['sun']['az']);sun_slope=np.tan(np.deg2rad(site['sky']['sun']['el']))
    horizon=np.full_like(base,-100)
    for distance in np.arange(2,402,2):
        horizon=np.maximum(horizon,(sample(xx+np.sin(az)*distance,yy+np.cos(az)*distance)-base)/distance)
    visibility=np.clip((sun_slope-horizon+.012)/.024,0,1)
    visibility=(visibility*visibility*(3-2*visibility)).astype('<f4')
    (OUT / 'detail_sun_301.bin').write_bytes(visibility.tobytes())
    image_path = OUT / 'detail_2404.jpg'
    if not image_path.exists():
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN='EMPTY_DIR', CPL_VSIL_CURL_ALLOWED_EXTENSIONS='.tif', GDAL_HTTP_TIMEOUT='90', GDAL_HTTP_MAX_RETRY='2'):
            with rasterio.open('/vsicurl/' + source['source']['colour']) as image:
                if image.crs.to_dict() != crs.to_dict():
                    raise ValueError('Colour projection does not match DEM')
                rgb = image.read([1, 2, 3], window=from_bounds(*bounds, image.transform),
                                 out_shape=(3, 2404, 2404), resampling=Resampling.average, masked=True)
                if np.ma.getmaskarray(rgb).any():
                    raise ValueError('Missing colour coverage')
                Image.fromarray(np.moveaxis(np.asarray(rgb), 0, -1)).save(image_path, quality=94)
    meta = {
        'version': 1, 'site': 'gale', 'width': SIZE, 'height': SIZE,
        'originX': X + .5, 'originY': Y + .5, 'spacing': 1,
        'heightOrigin': site['parkingSpot']['elevation'],
        'backgroundWidth': 750, 'backgroundSpacing': 4, 'backgroundOrigin': 2,
        'shadowWidth': shadow_size, 'shadowSpacing': 2, 'shadowSun': site['sky']['sun'],
        'boundsProjectedMetres': list(bounds), 'sources': source['source'],
        'frame': '+X east, +Y up, +Z north in Unity before calibrated-north rotation; absolute mission coordinates retained',
        'heightLayout': 'little-endian Float32, north row first; vertex centres, no header',
        'texture': 'detail_2404.jpg; covers 601 m square at 0.25 m/pixel',
        'detailTriangles': 600 * 600 * 2,
        'mainRoute': [p['pos'] for p in routes['main']],
    }
    (OUT / 'detail_native.json').write_text(json.dumps(meta, indent=2) + '\n')
    for src, dst in [('detail_height_601.bin', 'height.bytes'), ('height_750.bin', 'background.bytes'), ('detail_sun_301.bin','shadow.bytes'),
                     ('detail_2404.jpg', 'orbital.jpg'), ('buttes_2048.jpg', 'background.jpg'),
                     ('detail_native.json', 'terrain.json')]:
        shutil.copyfile(OUT / src, ART / dst)
    print(json.dumps({'detailMetres': 600, 'heightRange': [float(heights.min()), float(heights.max())],
                      'routePointsCovered': len(all_points), 'nativeAssets': str(ART)}, indent=2))


if __name__ == '__main__':
    main()
