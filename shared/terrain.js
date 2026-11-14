// Optional hub/VR helper. Never imported by the AR ring, which only needs waypoints.
import * as THREE from 'three';

export function createTerrainGeometry(buffer, metadata) {
  const { width, height, metresPerPixel } = metadata.heightGrid;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 2 || height < 2 || width * height > 1e6 || !Number.isFinite(metresPerPixel) || metresPerPixel <= 0 || buffer.byteLength !== width * height * 4) throw new Error('Unexpected height-grid dimensions or byte count');
  const originZ = metadata.parking.z;
  if (!Number.isFinite(originZ)) throw new Error('Missing terrain elevation reference');
  const values = new DataView(buffer), positions = new Float32Array(width * height * 3), uv = new Float32Array(width * height * 2);
  const north = metadata.boundsProjectedMetres[3] - metadata.boundsProjectedMetres[1];
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const i = row * width + col, elevation = values.getFloat32(i * 4, true);
    if (!Number.isFinite(elevation)) throw new Error('Height grid contains missing data');
    positions.set([(col + .5) * metresPerPixel, elevation - originZ, -(north - (row + .5) * metresPerPixel)], i * 3);
    uv.set([(col + .5) / width, (row + .5) / height], i * 2);
  }
  const indices = new Uint32Array((width - 1) * (height - 1) * 6);
  let offset = 0;
  for (let row = 0; row < height - 1; row++) for (let col = 0; col < width - 1; col++) {
    const a = row * width + col;
    indices.set([a, a + width, a + 1, a + 1, a + width, a + width + 1], offset); offset += 6;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData = { elevationOriginMetres: originZ, axes: '+X east, +Y up, -Z north; southwest origin' };
  return geometry;
}

export async function loadTerrain(baseUrl = '/data/out/terrain/', { texture = 'hub' } = {}) {
  const base = new URL(baseUrl, location.href);
  const response = await fetch(new URL('terrain.json', base));
  if (!response.ok) throw new Error(`Cannot load terrain metadata: HTTP ${response.status}`);
  const metadata = await response.json();
  const heights = await fetch(new URL(metadata.heightGrid.file, base));
  if (!heights.ok) throw new Error(`Cannot load height grid: HTTP ${heights.status}`);
  const geometry = createTerrainGeometry(await heights.arrayBuffer(), metadata);
  let map;
  try { map = await new THREE.TextureLoader().loadAsync(new URL(metadata.textures[texture], base).href); }
  catch (error) { geometry.dispose(); throw error; }
  // North is at the top of the JPEG and at v=0 in this mesh.
  map.flipY = false; map.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map }));
  mesh.name = 'Murray Buttes · agreed 3 km crop';
  return { mesh, metadata, dispose() { geometry.dispose(); mesh.material.dispose(); map.dispose(); } };
}
