export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const radians = (degrees) => degrees * Math.PI / 180;

export function direction(azimuthDeg, elevationDeg, radius = 1) {
  const a = radians(azimuthDeg), e = radians(elevationDeg);
  return [radius * Math.cos(e) * Math.sin(a), radius * Math.sin(e), -radius * Math.cos(e) * Math.cos(a)];
}

// Solid angle of the blocked upper hemisphere, NOT projected sky-view factor.
export function openSkyPct(skyline) {
  return 100 * (1 - skyline.reduce((sum, e) => sum + Math.sin(radians(clamp(e, 0, 90))), 0) / skyline.length);
}

export function sampleSkyline(skyline, azimuth) {
  const i = (((azimuth % 360) + 360) % 360) / 360 * skyline.length;
  const lo = Math.floor(i), t = i - lo;
  return skyline[lo] * (1 - t) + skyline[(lo + 1) % skyline.length] * t;
}

export function blendAngle(a, b, t) {
  return ((a + (((b - a + 540) % 360) - 180) * clamp(t, 0, 1)) % 360 + 360) % 360;
}

export function blendWaypoints(a, b, t) {
  t = clamp(t, 0, 1);
  const n = Math.max(a.skylineDeg.length, b.skylineDeg.length);
  return {
    ...b,
    skylineDeg: Array.from({ length: n }, (_, i) => {
      const az = i * 360 / n;
      return sampleSkyline(a.skylineDeg, az) * (1 - t) + sampleSkyline(b.skylineDeg, az) * t;
    }),
    markers: Object.fromEntries(['sun', 'earth', 'base', 'shelter'].map(key => [key, {
      ...b.markers[key],
      azimuthDeg: blendAngle(a.markers[key].azimuthDeg, b.markers[key].azimuthDeg, t),
      elevationDeg: a.markers[key].elevationDeg * (1 - t) + b.markers[key].elevationDeg * t,
    }])),
  };
}

function finiteIn(value, min, max, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
}

export function validateRoute(route) {
  if (route?.schemaVersion !== 1 || !Array.isArray(route.waypoints) || !route.waypoints.length) throw new Error('Expected a version 1 waypoint file');
  if (!['synthetic', 'terrain-derived'].includes(route.source?.kind)) throw new Error('Route must declare its data source');
  const ids = new Set();
  for (const point of route.waypoints) {
    if (typeof point.id !== 'string' || !point.id || ids.has(point.id)) throw new Error('Waypoint IDs must be unique strings');
    ids.add(point.id);
    if (typeof point.name !== 'string') throw new Error('Waypoint name missing');
    if (!Array.isArray(point.skylineDeg) || point.skylineDeg.length < 8 || point.skylineDeg.length > 4096) throw new Error('Skyline requires 8–4096 equally spaced samples');
    point.skylineDeg.forEach(e => finiteIn(e, -90, 90, 'skyline elevation'));
    finiteIn(point.minutesToShelter, 0, 10000, 'minutes to shelter');
    if (!['clear', 'blocked'].includes(point.contact)) throw new Error('Invalid contact');
    for (const key of ['sun', 'earth', 'base', 'shelter']) {
      finiteIn(point.markers?.[key]?.azimuthDeg, 0, 360, `${key} azimuth`);
      finiteIn(point.markers[key].elevationDeg, -90, 90, `${key} elevation`);
    }
  }
  return route;
}

export function validateState(state, route) {
  if (state?.schemaVersion !== 1 || !route.waypoints.some(p => p.id === state.waypointId)) throw new Error('Unknown state version or waypoint');
  if (typeof state.storm !== 'boolean') throw new Error('Storm must be boolean');
  finiteIn(state.oxygenPct, 0, 100, 'oxygen');
  finiteIn(state.doseMicroSv, 0, 1e9, 'dose');
  finiteIn(state.minutesToShelter, 0, 10000, 'minutes to shelter');
  if (!['clear', 'blocked'].includes(state.contact)) throw new Error('Invalid contact');
  if (!Number.isSafeInteger(state.sequence) || state.sequence < 0) throw new Error('Invalid sequence');
  if (typeof state.updatedAt !== 'string' || !Number.isFinite(Date.parse(state.updatedAt))) throw new Error('Invalid timestamp');
  return state;
}

// For the LOCAL SIMULATOR ONLY. Ronan's relay and planner remain authoritative in live mode.
export function reduceDemoState(state, command, route, initialState) {
  const index = route.waypoints.findIndex(p => p.id === state.waypointId);
  let next = { ...state };
  if (command.action === 'reset') next = { ...initialState };
  else if (command.action === 'storm') next.storm = !state.storm;
  else if (command.action === 'next' || command.action === 'back') {
    const point = route.waypoints[clamp(index + (command.action === 'next' ? 1 : -1), 0, route.waypoints.length - 1)];
    Object.assign(next, { waypointId: point.id, minutesToShelter: point.minutesToShelter, contact: point.contact });
  } else if (command.action === 'panic') {
    // Scripted demo destination; not a computed reroute.
    const shelter = route.waypoints.find(p => p.kind === 'shelter');
    if (shelter) Object.assign(next, { waypointId: shelter.id, minutesToShelter: shelter.minutesToShelter, contact: shelter.contact });
    next.storm = true;
  } else return state;
  next.sequence = state.sequence + 1;
  next.updatedAt = new Date().toISOString();
  return next;
}
