"""Software check with synthetic rasters. This is NOT a Mars-data validation."""
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import numpy as np
import rasterio
from rasterio.transform import from_bounds

spec = importlib.util.spec_from_file_location('terrain', Path(__file__).parents[1] / 'tools/export-terrain.py')
terrain = importlib.util.module_from_spec(spec)
spec.loader.exec_module(terrain)

temporary_root = (Path(__file__).parents[1] / '.local').resolve()
temporary_root.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='beacon-terrain-', dir=temporary_root) as tmp:
    root = Path(tmp)
    assert root.resolve().is_relative_to(temporary_root)
    transform = from_bounds(0, 0, 64, 64, 64, 64)
    x, row = np.meshgrid(np.arange(64)+.5, np.arange(64)+.5)
    heights = (100 + x*.1 + (64-row)*.2).astype('float32')
    profile = dict(driver='GTiff', width=64, height=64, count=1, crs='EPSG:3857', transform=transform)
    with rasterio.open(root/'height.tif', 'w', dtype='float32', **profile) as target:
        target.write(heights, 1)
    # North edge is light, south edge dark: verifies UV convention and texture orientation.
    with rasterio.open(root/'image.tif', 'w', dtype='uint8', **profile) as target:
        target.write((255-row*3).astype('uint8'), 1)
    output = root/'terrain.glb'
    info = terrain.export_terrain(root/'height.tif', root/'image.tif', [8,8,56,56], output, 17, 64)
    assert info['triangles'] == 512
    assert info['validHeightFraction'] == info['validTextureFraction'] == 1
    raw = output.read_bytes()
    magic, version, length = struct.unpack_from('<III', raw)
    assert magic == 0x46546C67 and version == 2 and length == len(raw)
    json_size, json_type = struct.unpack_from('<II', raw, 12)
    assert json_type == 0x4E4F534A
    doc = json.loads(raw[20:20+json_size])
    binary_size, binary_type = struct.unpack_from('<II', raw, 20+json_size)
    binary = raw[28+json_size:]
    assert binary_type == 0x004E4942 and binary_size == len(binary)
    positions = np.frombuffer(binary, dtype='<f4', count=17*17*3).reshape(-1,3)
    view = doc['bufferViews'][3]
    triangles = np.frombuffer(binary, dtype='<u4', count=512*3, offset=view['byteOffset']).reshape(-1,3)
    a,b,c = (positions[triangles[0][i]] for i in range(3))
    assert np.cross(b-a,c-a)[1] > 0, 'Terrain face should point upward'
    assert positions[0,0] < 0 and positions[0,2] < 0, 'First vertex must be northwest'
    texture = np.asarray(terrain.Image.open(output.with_suffix('.png')))
    assert texture[0,32,0] > texture[-1,32,0], 'Texture north must stay at the top'
    try:
        terrain.export_terrain(root/'height.tif', root/'image.tif', [-1,0,64,64], output)
    except ValueError:
        pass
    else:
        raise AssertionError('Out-of-bounds crop must be rejected')
print('Terrain checks passed: crop alignment, triangle count, winding, north orientation, texture orientation and bounds validation.')
