import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTerrainGeometry } from '../shared/terrain.js';

test('downloaded terrain stays georeferenced, faces up and maps north to the top of the JPEG', () => {
  const metadata = JSON.parse(readFileSync(new URL('../data/out/terrain/terrain.json', import.meta.url)));
  const site = JSON.parse(readFileSync(new URL('../data/site.json', import.meta.url)));
  assert.equal(metadata.parking.x, site.nearCrop.parkingSpotLocal.x);
  assert.equal(metadata.parking.y, site.nearCrop.parkingSpotLocal.y);
  assert.equal(metadata.parking.z, site.parkingSpot.elevation);
  const bytes = readFileSync(new URL('../data/out/terrain/height_750.bin', import.meta.url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const geometry = createTerrainGeometry(buffer, metadata);
  try {
    const p = geometry.getAttribute('position'), uv = geometry.getAttribute('uv'), normal = geometry.getAttribute('normal');
    assert.equal(p.count, 750 * 750); assert.equal(geometry.index.count / 3, 749 * 749 * 2);
    assert.equal(p.getX(0), 2); assert.equal(p.getZ(0), -2998);
    assert.equal(p.getX(p.count - 1), 2998); assert.equal(p.getZ(p.count - 1), -2);
    assert.ok(Math.abs(p.getY(0) - (bytes.readFloatLE(0) - metadata.parking.z)) < .001);
    assert.ok(uv.getY(0) < .001 && uv.getY(p.count - 1) > .999);
    assert.ok(normal.getY(0) > 0);
    assert.ok(metadata.heightGrid.minimum < -4379.5 && metadata.heightGrid.maximum > -4379.5);
    assert.throws(() => createTerrainGeometry(buffer.slice(4), metadata), /byte count/);
  } finally { geometry.dispose(); }
});
