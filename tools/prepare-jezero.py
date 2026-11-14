#!/usr/bin/env python3
"""Terrain crops for the Jezero site (data/sites/jezero/site.json): Three Forks and the delta front.

The Jezero mosaics use equirectangular with standard parallel 0, so at 18.45 N their pixels are about
0.9485 m east-west. The engine assumes square pixels in true metres, so every crop is reprojected to

    +proj=eqc +lat_ts=18.4663 +lat_0=0 +lon_0=0 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs

which is also the projection of the Perseverance waypoint file's easting and northing.

Writes (data/raw is not committed):
  data/raw/jezero/near.bin   3000 x 3000 at 1 m, centred on C = last sol 686 waypoint + 150 m north (whole metres)
  data/raw/jezero/far.bin    the whole CTX 20 m DTM at 20 m
  data/raw/jezero/mola.bin   MOLA global -srcwin 32300 8510 1296 1296, warped at 463 m
  data/out/jezero/terrain/   buttes-style app terrain: 4096 and 2048 px images, 750 x 750 heights, terrain.json,
                             and a 600 m detail tile centred on the route (detail.json)
and checks the warped terrain against every sol 400 to 710 waypoint's elev_geoid (stops if the median is over 1 m).

Needs gdalwarp and gdal_translate on the PATH, numpy and Pillow. Downloads the 1 m DTM (1.8 GB) if it is missing:
    curl -fL -C - -o data/raw/jezero/JEZ_dtm_1m.tif <DTM>
    python3 tools/prepare-jezero.py [--force]
"""
import json
import math
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data/raw/jezero'
OUT = ROOT / 'data/out/jezero/terrain'
BASE = 'https://planetarymaps.usgs.gov/mosaic/'
DTM = BASE + 'mars2020_trn/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif'
ORTHO = BASE + 'mars2020_trn/HiRISE/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif'
CTX = BASE + 'mars2020_trn/CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif'
MOLA = BASE + 'Mars_MGS_MOLA_DEM_mosaic_global_463m.tif'
WAYPOINTS = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json'
LAT_TS = 18.4663
PROJ = f'+proj=eqc +lat_ts={LAT_TS} +lat_0=0 +lon_0=0 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs'
NODATA = -32767.0
SIZE = 3000           # near crop, metres
DETAIL = 600          # detail tile, metres
MOLA_PX = 463.093541550371
FORCE = '--force' in sys.argv
# Remote reads only: with these set globally GDAL cannot find a local ENVI file's .hdr.
REMOTE = ['--config', 'GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR', '--config', 'CPL_VSIL_CURL_ALLOWED_EXTENSIONS', '.tif',
          '--config', 'GDAL_HTTP_MAX_RETRY', '5', '--config', 'GDAL_HTTP_RETRY_DELAY', '5']


def run(*cmd):
    print('  $', ' '.join(str(c) for c in cmd), flush=True)
    subprocess.run([str(c) for c in cmd], check=True, stdout=subprocess.DEVNULL)


def read_envi(path):
    """(array, west, north, pixel) of a single-band Float32 ENVI file written by GDAL."""
    hdr = path.with_suffix('.hdr').read_text()
    get = lambda k: re.search(rf'^{k}\s*=\s*(.+)$', hdr, re.M).group(1).strip()
    w, h = int(get('samples')), int(get('lines'))
    info = [s.strip() for s in get('map info').strip('{}').split(',')]
    west, north, px = float(info[3]), float(info[4]), float(info[5])
    return np.fromfile(path, dtype='<f4').reshape(h, w), west, north, px


def check_projection(path, pixel):
    hdr = path.with_suffix('.hdr').read_text()
    wkt = re.search(r'coordinate system string = \{(.*)\}', hdr).group(1)
    sp = re.search(r'"?standard_parallel_1"?\s*,\s*([-\d.]+)', wkt, re.I)
    _, _, _, px = read_envi(path)
    if not sp or abs(float(sp.group(1)) - LAT_TS) > 1e-6 or abs(px - pixel) > 1e-6:
        raise SystemExit(f'{path.name}: expected standard parallel {LAT_TS} and {pixel} m pixels, got {sp and sp.group(1)} and {px}')
    return wkt


def bilinear(a, west, north, px, e, n):
    """Engine convention: values at cell centres."""
    c, r = (e - west) / px - 0.5, (north - n) / px - 0.5
    c0, r0 = int(math.floor(c)), int(math.floor(r))
    if c0 < 0 or r0 < 0 or c0 + 1 >= a.shape[1] or r0 + 1 >= a.shape[0]:
        return None
    q = a[r0:r0 + 2, c0:c0 + 2].astype(float)
    if (q == NODATA).any():
        return None
    fc, fr = c - c0, r - r0
    return q[0, 0] * (1 - fc) * (1 - fr) + q[0, 1] * fc * (1 - fr) + q[1, 0] * (1 - fc) * fr + q[1, 1] * fc * fr


def main():
    RAW.mkdir(parents=True, exist_ok=True); OUT.mkdir(parents=True, exist_ok=True)
    wp_file = RAW / 'M20_waypoints.json'
    if not wp_file.exists():
        urllib.request.urlretrieve(WAYPOINTS, wp_file)
    props = [f['properties'] for f in json.loads(wp_file.read_text())['features']]
    last = lambda sol: [p for p in props if p['sol'] == sol][-1]   # the last waypoint of that sol
    dtm = RAW / 'JEZ_dtm_1m.tif'
    if not dtm.exists():
        raise SystemExit(f'missing {dtm.relative_to(ROOT)}; download it first (see the docstring)')

    base = last(686)
    cx, cy = round(base['easting']), round(base['northing'] + 150)
    west, south = cx - SIZE // 2, cy - SIZE // 2
    east, north = west + SIZE, south + SIZE
    print(f'Centre C {cx}, {cy} (sol 686 + 150 m north); near crop {west}..{east} E, {south}..{north} N')

    # 1. One aligned 1 m warp covering the near crop and every sol 400..710 waypoint, then near.bin is cut from it
    #    without resampling, so the check sees exactly the samples near.bin holds where they overlap.
    check = [p for p in props if 400 <= p['sol'] <= 710]
    rw = math.floor(min([west] + [p['easting'] for p in check])) - 50
    rs = math.floor(min([south] + [p['northing'] for p in check])) - 50
    re_ = math.ceil(max([east] + [p['easting'] for p in check])) + 50
    rn = math.ceil(max([north] + [p['northing'] for p in check])) + 50
    region = RAW / 'region_1m.bin'
    if FORCE or not region.exists():
        run('gdalwarp', '-overwrite', '-t_srs', PROJ, '-te', rw, rs, re_, rn, '-tr', 1, 1, '-r', 'bilinear',
            '-dstnodata', NODATA, '-of', 'ENVI', '-ot', 'Float32', dtm, region)
    check_projection(region, 1.0)
    a, aw, an, apx = read_envi(region)
    diffs, missing = [], []
    for p in check:
        z = bilinear(a, aw, an, apx, p['easting'], p['northing'])
        (missing if z is None else diffs).append(p['sol'] if z is None else z - p['elev_geoid'])
    d = np.abs(np.array(diffs))
    inside = sum(1 for p in check if west <= p['easting'] <= east and south <= p['northing'] <= north)
    print(f'Alignment: {len(diffs)} of {len(check)} sol 400..710 waypoints ({inside} inside near.bin), '
          f'terrain - elev_geoid median {np.median(d):.3f} m, largest {d.max():.3f} m'
          f' (signed median {np.median(diffs):+.3f} m){", no terrain at sols " + str(missing) if missing else ""}')
    if np.median(d) > 1.0:
        raise SystemExit('STOP: median difference over 1 m; the projection or the crop is wrong')

    near = RAW / 'near.bin'
    if FORCE or not near.exists():
        run('gdal_translate', '-projwin', west, north, east, south, '-of', 'ENVI', region, near)
    h, nw, nn, npx = read_envi(near)
    if h.shape != (SIZE, SIZE) or (nw, nn, npx) != (west, north, 1.0):
        raise SystemExit(f'near.bin is {h.shape} at {nw}, {nn}, {npx} m')
    wkt = check_projection(near, 1.0)
    nod = int((h == NODATA).sum())
    print(f'near.bin: {SIZE} x {SIZE} at 1 m, no-data cells {nod} ({nod / h.size:.2%}), heights {h[h != NODATA].min():.1f}..{h[h != NODATA].max():.1f} m')

    # 2. Far field: the whole CTX DTM at 20 m, and the MOLA window at 463 m.
    far = RAW / 'far.bin'
    if FORCE or not far.exists():
        ctx = RAW / 'ctx_20m_src.tif'   # a local copy first: gdalwarp cannot write ENVI with the remote-read settings
        if not ctx.exists():
            run('gdal_translate', *REMOTE, '/vsicurl/' + CTX, ctx)
        run('gdalwarp', '-overwrite', '-t_srs', PROJ, '-tr', 20, 20, '-r', 'bilinear', '-dstnodata', NODATA,
            '-of', 'ENVI', '-ot', 'Float32', ctx, far)
    check_projection(far, 20.0)
    mola_cut, mola = RAW / 'mola_src.tif', RAW / 'mola.bin'
    if FORCE or not mola.exists():
        run('gdal_translate', *REMOTE, '-srcwin', 32300, 8510, 1296, 1296, '/vsicurl/' + MOLA, mola_cut)
        run('gdalwarp', '-overwrite', '-t_srs', PROJ, '-tr', MOLA_PX, MOLA_PX, '-r', 'bilinear', '-dstnodata', NODATA,
            '-of', 'ENVI', '-ot', 'Float32', mola_cut, mola)
    check_projection(mola, MOLA_PX)
    for f in (far, mola):
        g, gw, gn, gpx = read_envi(f)
        ok = g != NODATA
        print(f'{f.name}: {g.shape[1]} x {g.shape[0]} at {gpx:g} m, covers {gw:.0f}..{gw + g.shape[1] * gpx:.0f} E, '
              f'{gn - g.shape[0] * gpx:.0f}..{gn:.0f} N, heights {g[ok].min():.0f}..{g[ok].max():.0f} m, no-data {1 - ok.mean():.1%}')

    # 3. Image: one remote warp at 25 cm over the near crop, then everything else from the local copy.
    ortho = RAW / 'ortho_25cm.tif'
    if FORCE or not ortho.exists():
        # The remote file is uncompressed, in one-row strips, without overviews: a remote warp fetches row by row and
        # stalls. So cut the source window (plus 20 m) with large sequential reads, then warp the local copy.
        src = RAW / 'ortho_src.tif'
        if not src.exists():
            k, ox, oy, opx = math.cos(math.radians(LAT_TS)), 4577366.0, 1106618.0, 0.25   # source origin and pixel (gdalinfo)
            x0, x1 = ((west - 20) / k - ox) / opx, ((east + 20) / k - ox) / opx
            y0, y1 = (oy - (north + 20)) / opx, (oy - (south - 20)) / opx
            run('gdal_translate', *REMOTE, '--config', 'CPL_VSIL_CURL_CHUNK_SIZE', 10485760, '--config', 'CPL_VSIL_CURL_CACHE_SIZE', 268435456,
                '-srcwin', math.floor(x0), math.floor(y0), math.ceil(x1 - x0), math.ceil(y1 - y0),
                '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE', '/vsicurl/' + ORTHO, src)
        run('gdalwarp', '-overwrite', '-t_srs', PROJ, '-te', west, south, east, north, '-tr', 0.25, 0.25, '-r', 'bilinear',
            '-srcnodata', 0, '-dstnodata', 0, '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE', '-wm', 1024, src, ortho)

    def image(src, size, out, extent=None):
        tmp = RAW / f'_img_{size}.bin'
        args = ['gdalwarp', '-overwrite', '-ts', size, size, '-r', 'average', '-srcnodata', 0, '-dstnodata', 0, '-of', 'ENVI', '-ot', 'Byte']
        if extent:
            args += ['-te', *extent]
        run(*args, src, tmp)
        px = np.fromfile(tmp, dtype='u1').reshape(size, size)
        for f in (tmp, tmp.with_suffix('.hdr'), Path(str(tmp) + '.aux.xml')):
            f.unlink(missing_ok=True)
        if (px == 0).mean() > 0.001:
            raise SystemExit(f'{out.name}: {(px == 0).mean():.2%} of the image has no data')
        Image.fromarray(px).convert('RGB').save(out, quality=90)   # greyscale source, saved as RGB like Gale's
        print(f'{out.relative_to(ROOT)}: {size} x {size}')

    for size in (4096, 2048):
        image(ortho, size, OUT / f'jezero_{size}.jpg')

    # 4. App height grid: 750 x 750 by averaging near.bin into 4 m cells, as for Gale.
    grid = RAW / '_h750.bin'
    run('gdalwarp', '-overwrite', '-tr', 4, 4, '-r', 'average', '-srcnodata', NODATA, '-dstnodata', NODATA, '-of', 'ENVI', near, grid)
    reduced, *_ = read_envi(grid)
    if reduced.shape != (750, 750) or (reduced == NODATA).any() or not np.isfinite(reduced).all():
        raise SystemExit('Invalid 750 x 750 height grid (no-data in the crop)')
    (OUT / 'height_750.bin').write_bytes(reduced.astype('<f4').tobytes(order='C'))
    (OUT / 'height_750.hdr').write_text('ENVI\nsamples = 750\nlines = 750\nbands = 1\nheader offset = 0\nfile type = ENVI Standard\ndata type = 4\ninterleave = bsq\nbyte order = 0\n', encoding='ascii')
    for f in (grid, grid.with_suffix('.hdr'), Path(str(grid) + '.aux.xml')):
        f.unlink(missing_ok=True)

    # 5. Detail tile, 600 m centred on the route's bounding box (the route stops in the site file).
    site = json.loads((ROOT / 'data/sites/jezero/site.json').read_text())
    xs = [s['x'] for s in site['routeStops']]; ys = [s['y'] for s in site['routeStops']]
    dx0, dy0 = round((min(xs) + max(xs)) / 2) - DETAIL // 2, round((min(ys) + max(ys)) / 2) - DETAIL // 2
    dext = [west + dx0, south + dy0, west + dx0 + DETAIL, south + dy0 + DETAIL]
    dh = RAW / '_detail.bin'
    run('gdal_translate', '-projwin', dext[0], dext[3], dext[2], dext[1], '-of', 'ENVI', near, dh)
    det, *_ = read_envi(dh)
    if det.shape != (DETAIL, DETAIL) or (det == NODATA).any():
        raise SystemExit('Invalid detail height tile')
    (OUT / 'detail_height_600.bin').write_bytes(det.astype('<f4').tobytes(order='C'))
    for f in (dh, dh.with_suffix('.hdr'), Path(str(dh) + '.aux.xml')):
        f.unlink(missing_ok=True)
    image(ortho, DETAIL * 4, OUT / 'detail_2400.jpg', dext)
    (OUT / 'detail.json').write_text(json.dumps({
        'version': 1,
        'description': 'Detail tile centred on the route, at full resolution. Same frame as terrain.json: local metres from the near crop\'s south-west corner',
        'originLocal': {'x': dx0, 'y': dy0}, 'sizeMetres': DETAIL,
        'heightGrid': {'file': 'detail_height_600.bin', 'width': DETAIL, 'height': DETAIL, 'metresPerPixel': 1,
                       'dtype': 'little-endian Float32', 'headerBytes': 0, 'row0': 'north',
                       'samplePosition': f'x = {dx0} + column + 0.5; y = {dy0 + DETAIL} - (row + 0.5); z = height',
                       'minimum': float(det.min()), 'maximum': float(det.max())},
        'texture': {'file': 'detail_2400.jpg', 'width': DETAIL * 4, 'height': DETAIL * 4, 'metresPerPixel': 0.25, 'row0': 'north'},
    }, indent=2) + '\n')

    # 6. terrain.json with exactly Gale's keys. "parking" is the crop centre C, as Gale's parking spot is its crop's centre.
    cz = float(bilinear(h, nw, nn, npx, cx, cy))
    parking = {'x': float(cx - west), 'y': float(cy - south), 'z': round(cz, 2),
               'source': 'Crop centre C: the last Perseverance sol 686 waypoint (Three Forks depot) + 150 m north, NASA M20 waypoint record'}
    meta = {
        'version': 1, 'source': {'dem': DTM, 'colour': ORTHO, 'credit': 'NASA/JPL-Caltech/University of Arizona/USGS'},
        'demSourceWindow': [west, south, SIZE, SIZE], 'boundsProjectedMetres': [west, south, east, north], 'crsWkt': wkt,
        'originProjectedMetres': [west, south], 'localFrame': 'x east, y north, z absolute terrain elevation; metres; origin southwest',
        'parking': parking,
        'heightGrid': {'file': 'height_750.bin', 'width': 750, 'height': 750, 'metresPerPixel': 4,
                       'dtype': 'little-endian Float32', 'headerBytes': 0, 'row0': 'north',
                       'samplePosition': 'x = (column + 0.5) * 4; y = 3000 - (row + 0.5) * 4; z = height',
                       'minimum': float(reduced.min()), 'maximum': float(reduced.max())},
        'textures': {'hub': 'jezero_4096.jpg', 'headset': 'jezero_2048.jpg', 'row0': 'north', 'coverage': 'entire 3000 m square'},
        'rendering': {'threeJsPosition': f"[x, z - ({parking['z']}), -y]", 'textureUV': '[(column+0.5)/750, (row+0.5)/750]',
                      'note': 'Height values are pixel-centre samples, 2 m inside the crop boundary, matching shared/conventions.md. Honour each asset resolution. The source mosaics were warped from standard parallel 0 to 18.4663 so pixels are square metres; demSourceWindow gives the crop in that projection (west, south, width, height)'},
        'optionalVrGrid': 'Deferred until AR works end to end',
    }
    (OUT / 'terrain.json').write_text(json.dumps(meta, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({p.name: p.stat().st_size for p in sorted(OUT.iterdir())}, indent=1))


if __name__ == '__main__':
    main()
