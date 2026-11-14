import { writeFileSync } from 'node:fs';
import { sampleSkyline } from '../shared/model.js';

const specs = [
  { id: 'plain', name: 'Open plain', kind: 'stop', minutesToShelter: 8.4, contact: 'clear', floor: 3, peak: 12, az: 82 },
  { id: 'approach', name: 'Butte approach', kind: 'stop', minutesToShelter: 4.2, contact: 'clear', floor: 5, peak: 28, az: 68 },
  { id: 'shelter', name: 'Butte shelter', kind: 'shelter', minutesToShelter: 0, contact: 'blocked', floor: 7, peak: 49, az: 46 },
  { id: 'science', name: 'Science stop', kind: 'stop', minutesToShelter: 3.1, contact: 'clear', floor: 4, peak: 20, az: 110 },
];
const route = {
  schemaVersion: 1,
  source: { kind: 'synthetic', description: 'Hand-shaped demo skylines. Not measured Murray Buttes terrain; not the 19% / 10% validation.' },
  coordinateConvention: 'Azimuth clockwise from north; elevation above the geometric horizon; samples start at north and wrap without a duplicate endpoint.',
  waypoints: specs.map((p, index) => ({
    id: p.id, name: p.name, kind: p.kind, minutesToShelter: p.minutesToShelter, contact: p.contact,
    skylineDeg: Array.from({ length: 72 }, (_, i) => {
      const az = i * 5;
      const delta = ((az - p.az + 540) % 360) - 180;
      return Number((p.floor + p.peak * Math.exp(-((delta / 39) ** 4)) + 2.4 * Math.sin(az * Math.PI / 90) ** 2 + 3 * Math.exp(-(((az - 240) / 50) ** 2))).toFixed(2));
    }),
    markers: {
      sun: { azimuthDeg: 126, elevationDeg: 32 },
      earth: { azimuthDeg: 42, elevationDeg: 18 },
      base: { azimuthDeg: 306 - index * 8, elevationDeg: 1 },
      shelter: { azimuthDeg: 58 - index * 6, elevationDeg: 4 },
    },
  })),
};
const state = { schemaVersion: 1, waypointId: 'plain', storm: false, oxygenPct: 86, doseMicroSv: 124, minutesToShelter: 8.4, contact: 'clear', sequence: 0, updatedAt: '2026-11-14T09:00:00.000Z' };
for (const point of route.waypoints) point.contact = point.markers.earth.elevationDeg >= sampleSkyline(point.skylineDeg, point.markers.earth.azimuthDeg) ? 'clear' : 'blocked';
for (const [name, data] of [['fake-waypoints', route], ['fake-state', state]]) {
  writeFileSync(new URL(`../shared/${name}.json`, import.meta.url), JSON.stringify(data, null, 2) + '\n');
}
