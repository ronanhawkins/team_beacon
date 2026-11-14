// Hub: walking time to the base (apps/hub/walkfield.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWalkGrid } from '../apps/hub/pathfind.js';
import { walkField } from '../apps/hub/walkfield.js';

const grid = (wall) => {
  const cols = 100, rows = 100, cell = 4, h = new Float32Array(cols * rows);
  if (wall) for (let r = 10; r < 90; r++) for (let c = 50; c < 52; c++) h[r * cols + c] = 40;
  return makeWalkGrid({ cols, rows, cell, heights: h });
};

test('flat ground: minutes = distance / walkSpeed', () => {
  const F = walkField(grid(false), { x: 80, y: 200 }, { walkSpeed: 0.8 });
  assert.ok(Math.abs(F.at(180, 200) - 100 / 0.8 / 60) < 0.05);
  assert.equal(F.at(80, 200), 0);
});

test('a cliff is walked around, not through', () => {
  const F = walkField(grid(true), { x: 80, y: 200 }, { walkSpeed: 0.8, maxSlopeDeg: 25 });
  assert.ok(F.at(240, 200) > 160 / 0.8 / 60 * 1.5);
});

test('outside the terrain gives null', () => {
  const F = walkField(grid(false), { x: 80, y: 200 });
  assert.equal(F.at(-10, 200), null);
});
