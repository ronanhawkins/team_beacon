#!/usr/bin/env node
// Stands in for `engine plan --stops ... --out <dir>` in tests/relay-plan.test.js: copies the fake route,
// marks one science stop with the label it was given, and fails when a label says "fail".
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2), arg = (k) => args[args.indexOf(k) + 1];
const stops = arg('--stops').split(';').map((s) => s.split(','));
if (stops.some((s) => s[2] === 'fail')) { console.error('Error: no walkable path to stop 1'); process.exit(1); }
const doc = JSON.parse(readFileSync(new URL('../../shared/fake/waypoints.json', import.meta.url), 'utf8'));
doc.main[0].pos.x = +stops[0][0]; doc.main[0].pos.y = +stops[0][1];
Object.assign(doc.main[2], { isScienceStop: true, label: stops[1][2] || 'Stop 1' });
writeFileSync(join(arg('--out'), 'waypoints.json'), JSON.stringify(doc));
writeFileSync(join(arg('--out'), 'briefing.json'), JSON.stringify({ version: 1, stub: true }));
