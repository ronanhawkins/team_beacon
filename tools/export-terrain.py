"""Export a reduced, textured GLB from a TEAM-AGREED projected DTM and orthoimage.

Visualisation only: preserve the full-resolution source for Ronan's skyline engine.
Requires --bounds xmin ymin xmax ymax in the DTM's projected metre CRS.
"""
import argparse
import io
import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import reproject, Resampling


def export_terrain(dtm_path, image_path, bounds, output, grid=129, texture_size=2048):
    bounds = np.asarray(bounds, dtype=float)
    if bounds.shape != (4,) or not np.isfinite(bounds).all() or bounds[0] >= bounds[2] or bounds[1] >= bounds[3]:
        raise ValueError('Bounds must be finite xmin ymin xmax ymax, in projected metres.')
    if not 3 <= grid <= 257 or not 16 <= texture_size <= 4096:
        raise ValueError('Use a grid of 3–257 and a texture size of 16–4096.')
    xmin, ymin, xmax, ymax = bounds
    mesh_transform = from_bounds(*bounds, grid, grid)
    texture_transform = from_bounds(*bounds, texture_size, texture_size)
    with rasterio.open(dtm_path) as dtm, rasterio.open(image_path) as ortho:
        if not dtm.crs or not dtm.crs.is_projected or abs(dtm.crs.linear_units_factor[1] - 1) > 1e-9:
            raise ValueError('DTM must have a projected coordinate system in metres.')
        if dtm.crs != ortho.crs:
            raise ValueError('Use a matching orthoimage in the same planetary CRS as the DTM; reproject deliberately first.')
        if xmin < dtm.bounds.left or ymin < dtm.bounds.bottom or xmax > dtm.bounds.right or ymax > dtm.bounds.top:
            raise ValueError('Crop lies outside the DTM coverage.')
        elevations = np.full((grid, grid), np.nan, dtype=np.float32)
        reproject(rasterio.band(dtm, 1), elevations, src_nodata=dtm.nodata,
                  dst_transform=mesh_transform, dst_crs=dtm.crs, dst_nodata=np.nan,
                  resampling=Resampling.bilinear)
        elevations = elevations * dtm.scales[0] + dtm.offsets[0]
        valid = np.isfinite(elevations)
        if not valid.any():
            raise ValueError('Crop has no valid height samples.')
        # A single RED ortho stays grayscale; do not imply it is natural-colour imagery.
        bands = [1, 2, 3] if ortho.count >= 3 else [1, 1, 1]
        rgb = np.zeros((texture_size, texture_size, 3), dtype=np.uint8)
        image_valid = np.ones((texture_size, texture_size), dtype=bool)
        for channel, band in enumerate(bands):
            values = np.full((texture_size, texture_size), np.nan, dtype=np.float32)
            reproject(rasterio.band(ortho, band), values, src_nodata=ortho.nodata,
                      dst_transform=texture_transform, dst_crs=dtm.crs, dst_nodata=np.nan,
                      resampling=Resampling.bilinear)
            finite = np.isfinite(values)
            if not finite.any():
                raise ValueError('Orthoimage does not cover this crop.')
            image_valid &= finite
            if ortho.dtypes[band - 1] == 'uint8':
                scaled = values
            else:
                lo, hi = np.percentile(values[finite], [1, 99])
                scaled = (values - lo) * 255 / max(float(hi - lo), 1)
            rgb[..., channel] = np.nan_to_num(np.clip(scaled, 0, 255), nan=0).astype(np.uint8)
        crs_wkt = dtm.crs.to_wkt()
    rgba = np.dstack([rgb, image_valid.astype(np.uint8) * 255])
    png = io.BytesIO()
    Image.fromarray(rgba).save(png, format='PNG')
    centre = [(xmin + xmax) / 2, (ymin + ymax) / 2]
    height_origin = float(np.median(elevations[valid]))
    # Vertices lie at resampled pixel centres; UVs use the same crop footprint.
    u = (np.arange(grid) + .5) / grid
    v = (np.arange(grid) + .5) / grid
    uu, vv = np.meshgrid(u, v)
    x = xmin + uu * (xmax - xmin) - centre[0]
    z = centre[1] - (ymax - vv * (ymax - ymin))
    y = np.where(valid, elevations - height_origin, 0)
    positions = np.stack([x, y, z], axis=-1).reshape(-1, 3).astype('<f4')
    dz, dx = np.gradient(y, (ymax-ymin)/grid, (xmax-xmin)/grid)
    normals = np.stack([-dx, np.ones_like(y), -dz], axis=-1)
    normals /= np.linalg.norm(normals, axis=-1, keepdims=True)
    normals = normals.reshape(-1, 3).astype('<f4')
    uv = np.stack([uu, vv], axis=-1).reshape(-1, 2).astype('<f4')
    faces = []
    for row in range(grid - 1):
        for col in range(grid - 1):
            a = row * grid + col
            for tri in [(a, a+grid, a+1), (a+1, a+grid, a+grid+1)]:
                if all(valid.flat[index] for index in tri):
                    faces.extend(tri)
    if not faces:
        raise ValueError('Crop has no complete terrain triangles.')
    indices = np.asarray(faces, dtype='<u4')
    views, chunks, offset = [], [], 0
    for raw in [positions.tobytes(), normals.tobytes(), uv.tobytes(), indices.tobytes(), png.getvalue()]:
        views.append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(raw)})
        padded = raw + b'\0' * (-len(raw) % 4)
        chunks.append(padded)
        offset += len(padded)
    metadata = {'sourceDtm': str(dtm_path), 'sourceOrthoimage': str(image_path), 'crsWkt': crs_wkt,
                'cropBoundsProjectedMetres': bounds.tolist(), 'originProjectedMetres': centre,
                'heightOriginMetres': height_origin, 'axes': '+X east, +Y up, -Z north; units metres',
                'triangles': len(faces)//3, 'validHeightFraction': float(valid.mean()),
                'validTextureFraction': float(image_valid.mean()), 'use': 'Reduced visual mesh; not a skyline-analysis source'}
    document = {'asset': {'version': '2.0', 'generator': 'Beacon terrain exporter'},
                'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': 'Murray Buttes terrain'}],
                'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2}, 'indices': 3, 'material': 0}]}],
                'materials': [{'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0, 'roughnessFactor': 1}, 'alphaMode': 'MASK'}],
                'textures': [{'source': 0, 'sampler': 0}], 'samplers': [{'wrapS': 33071, 'wrapT': 33071}],
                'images': [{'bufferView': 4, 'mimeType': 'image/png'}],
                'buffers': [{'byteLength': offset}], 'bufferViews': views,
                'accessors': [
                    {'bufferView': 0, 'componentType': 5126, 'count': len(positions), 'type': 'VEC3', 'min': positions.min(axis=0).tolist(), 'max': positions.max(axis=0).tolist()},
                    {'bufferView': 1, 'componentType': 5126, 'count': len(normals), 'type': 'VEC3'},
                    {'bufferView': 2, 'componentType': 5126, 'count': len(uv), 'type': 'VEC2'},
                    {'bufferView': 3, 'componentType': 5125, 'count': len(indices), 'type': 'SCALAR'}],
                'extras': metadata}
    data = json.dumps(document, separators=(',', ':')).encode()
    data += b' ' * (-len(data) % 4)
    binary = b''.join(chunks)
    glb = struct.pack('<III', 0x46546C67, 2, 28+len(data)+len(binary))
    glb += struct.pack('<II', len(data), 0x4E4F534A) + data
    glb += struct.pack('<II', len(binary), 0x004E4942) + binary
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(glb)
    output.with_suffix('.metadata.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    output.with_suffix('.png').write_bytes(png.getvalue())
    return metadata


if __name__ == '__main__':
    from sitepaths import site_paths
    site = site_paths()  # --site <name> or SITE=<name>: the default output goes to data/out/<name>/
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dtm', required=True)
    parser.add_argument('--image', required=True)
    parser.add_argument('--bounds', nargs=4, type=float, required=True)
    parser.add_argument('--output', default=f'data/out/{site.name}/terrain.glb' if site.name else 'data/out/terrain.glb')
    parser.add_argument('--grid', type=int, default=129)
    parser.add_argument('--texture-size', type=int, default=2048)
    args = parser.parse_args()
    result = export_terrain(args.dtm, args.image, args.bounds, args.output, args.grid, args.texture_size)
    print(json.dumps(result, indent=2))
