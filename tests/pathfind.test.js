import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeWalkGrid, findPath } from '../apps/hub/pathfind.js';

// 60 x 60 cells of 4 m, flat, with a tall wall along column 30 that has one gap at rows 48..52 (y = 32..52 m).
function wallWithGap() {
  const cols = 60, rows = 60, cell = 4, heights = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 28; c <= 32; c++) if (r < 48 || r > 52) heights[r * cols + c] = 80;
  return makeWalkGrid({ cols, rows, cell, heights });
}

test('the draft path goes through the gap in a wall, not straight across it', () => {
  const G = wallWithGap(), a = { x: 40, y: 200 }, b = { x: 200, y: 200 };
  const r = findPath(G, a, b, { maxSlopeDeg: 25 });
  assert.ok(r.ok, r.reason);
  assert.deepEqual(r.pts[0], a); assert.deepEqual(r.pts[r.pts.length - 1], b);
  // where the path crosses the wall (x = 112..132 m) it is inside the gap (y = 32..52 m, rows 48..52 from the north)
  const crossing = r.pts.some((p, i) => i > 0 && Math.min(p.x, r.pts[i - 1].x) < 122 && Math.max(p.x, r.pts[i - 1].x) > 122 && Math.min(p.y, r.pts[i - 1].y) < 60);
  assert.ok(crossing, 'path should cross the wall near the gap: ' + JSON.stringify(r.pts));
  assert.ok(r.distanceM > 160 + 100, 'detour is longer than the straight 160 m');
  assert.ok(r.maxSlopeDeg <= 25);
});

test('an unreachable end falls back to a straight line and says why', () => {
  const cols = 40, rows = 40, cell = 4, heights = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 18; c <= 22; c++) heights[r * cols + c] = 100; // wall with no gap
  const G = makeWalkGrid({ cols, rows, cell, heights }), r = findPath(G, { x: 20, y: 80 }, { x: 140, y: 80 });
  assert.equal(r.ok, false); assert.equal(r.pts.length, 2); assert.ok(r.reason);
});

test('a path on the real Murray Buttes terrain stays on walkable ground and finishes quickly', () => {
  const meta = JSON.parse(readFileSync(new URL('../data/out/terrain/terrain.json', import.meta.url)));
  const bytes = readFileSync(new URL('../data/out/terrain/' + meta.heightGrid.file, import.meta.url));
  const heights = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const { width: cols, height: rows, metresPerPixel: cell } = meta.heightGrid;
  const G = makeWalkGrid({ cols, rows, cell, heights }), t0 = performance.now();
  const r = findPath(G, { x: 1598, y: 1250 }, { x: 1500, y: 1628 }, { maxSlopeDeg: 25 });
  assert.ok(r.ok, r.reason); assert.ok(r.maxSlopeDeg <= 25 + 1e-6); assert.ok(performance.now() - t0 < 1500);
});
