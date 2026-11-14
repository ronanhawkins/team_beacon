// Headset helpers for Ronan's v1 contracts. shared/*.md and shared/fake/ are authoritative.
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const radians = degrees => degrees * Math.PI / 180;

export function direction(azimuthDeg, elevationDeg, radius = 1) {
  const a = radians(azimuthDeg), e = radians(elevationDeg);
  return [radius * Math.cos(e) * Math.sin(a), radius * Math.sin(e), -radius * Math.cos(e) * Math.cos(a)];
}
export const sitePosition = ({ x, y, z }) => [x, z, -y];

// Solid angle of the upper hemisphere, not a dose model or projected sky-view factor.
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

// Only the rendering boundary converts the shared format to scene marker coordinates.
export function scenePoint(point) {
  return {
    id: point.id, name: point.label || (point.isShelter ? 'Shelter' : 'Shelter approach'),
    skylineDeg: point.skyline, openSky: point.openSky,
    markers: {
      sun: { azimuthDeg: point.sun.az, elevationDeg: point.sun.el, visible: point.sun.visible },
      earth: { azimuthDeg: point.earth.az, elevationDeg: point.earth.el, visible: point.earth.visible },
      // These two markers have bearings only. Level placement is a UI convention.
      base: { azimuthDeg: point.base.az, elevationDeg: 0, visible: point.base.visible, bearingOnly: true },
      shelter: { azimuthDeg: point.shelter.az, elevationDeg: 0, bearingOnly: true },
    },
  };
}
export function blendWaypoints(a, b, t) {
  t = clamp(t, 0, 1);
  const n = Math.max(a.skylineDeg.length, b.skylineDeg.length);
  return { ...b,
    skylineDeg: Array.from({ length: n }, (_, i) => sampleSkyline(a.skylineDeg, i * 360 / n) * (1 - t) + sampleSkyline(b.skylineDeg, i * 360 / n) * t),
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
const fraction = (value, name) => finiteIn(value, 0, 1, name);
const bearing = (value, name) => finiteIn(value, 0, 360, name);
function bool(value, name) { if (typeof value !== 'boolean') throw new Error(`Invalid ${name}`); }

export function validateRoute(route) {
  if (route?.version !== 1 || route.skylineSamples !== 72 || !Array.isArray(route.main) || !route.main.length || !route.reroutes || typeof route.reroutes !== 'object' || Array.isArray(route.reroutes)) throw new Error('Expected the shared v1 waypoint file with 72 skyline samples, main and reroutes');
  const ids = new Set();
  const paths = [['main', route.main], ...Object.entries(route.reroutes)];
  for (const [key, points] of paths) {
    if (key !== 'main' && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= route.main.length)) throw new Error('Invalid reroute origin');
    if (!Array.isArray(points) || !points.length) throw new Error(`Empty route ${key}`);
    for (const point of points) {
      if (typeof point.id !== 'string' || !point.id || ids.has(point.id)) throw new Error('Waypoint IDs must be unique strings');
      ids.add(point.id);
      if (typeof point.label !== 'string') throw new Error('Waypoint label missing');
      for (const axis of ['x', 'y', 'z']) finiteIn(point.pos?.[axis], -1e9, 1e9, `position ${axis}`);
      if (!Array.isArray(point.skyline) || point.skyline.length !== route.skylineSamples) throw new Error('Expected 72 skyline elevations');
      point.skyline.forEach(e => finiteIn(e, -90, 90, 'skyline elevation'));
      for (const key of ['openSky', 'doseFraction', 'oxygenFraction']) fraction(point[key], key);
      bearing(point.headingDeg, 'heading');
      finiteIn(point.minutesFromStart, 0, 1e6, 'elapsed minutes');
      for (const key of ['isShelter', 'isScienceStop']) bool(point[key], key);
      for (const key of ['sun', 'earth']) {
        bearing(point[key]?.az, `${key} azimuth`);
        finiteIn(point[key].el, -90, 90, `${key} elevation`);
        bool(point[key].visible, `${key} visibility`);
      }
      for (const key of ['base', 'shelter']) {
        bearing(point[key]?.az, `${key} bearing`);
        finiteIn(point[key].distance, 0, 1e9, `${key} distance`);
      }
      bool(point.base.visible, 'base visibility');
      finiteIn(point.shelter.minutes, 0, 1e6, 'shelter minutes');
    }
  }
  return route;
}
export function validateState(state, route) {
  if (state?.version !== 1 || !['main', 'reroute'].includes(state.route)) throw new Error('Unknown state version or route');
  if (!Number.isSafeInteger(state.waypointIndex) || state.waypointIndex < 0) throw new Error('Invalid waypoint index');
  if (!['nominal', 'warning', 'storm'].includes(state.mode)) throw new Error('Invalid mission mode');
  for (const key of ['storm', 'panic', 'rerouteRequested', 'sunlit', 'baseLink', 'earthLink']) bool(state[key], key);
  for (const key of ['openSky', 'oxygenFraction', 'doseFraction']) fraction(state[key], key);
  for (const key of ['headingDeg', 'shelterBearingDeg']) bearing(state[key], key);
  for (const key of ['minutesToShelter', 'earthDelayMinutes']) finiteIn(state[key], 0, 1e6, key);
  if (state.rerouteFromIndex !== undefined && (!Number.isSafeInteger(state.rerouteFromIndex) || !route.reroutes[String(state.rerouteFromIndex)])) throw new Error('Invalid rerouteFromIndex');
  const paths = state.route === 'main' ? [route.main] : Object.values(route.reroutes);
  if (!paths.some(points => state.waypointIndex < points.length)) throw new Error('Waypoint index outside route');
  return state;
}
function matchesSnapshot(point, state) {
  const expected = { headingDeg: point.headingDeg, shelterBearingDeg: point.shelter.az,
    minutesToShelter: point.shelter.minutes, openSky: point.openSky,
    doseFraction: point.doseFraction, oxygenFraction: point.oxygenFraction,
    sunlit: point.sun.visible, baseLink: point.base.visible, earthLink: point.earth.visible };
  return Object.entries(expected).every(([key, value]) => typeof value === 'boolean' ? state[key] === value : Math.abs(state[key] - value) < 1e-6);
}

// v1 omits the reroute's origin. Prefer an optional additive field, then continuous
// connection history, then an unambiguous exact match to derived waypoint values.
// Reconnects never reuse old history or guess a skyline.
export function resolveSelection(state, route, previous = null) {
  if (state.route === 'main') return { route: 'main', points: route.main, point: route.main[state.waypointIndex], index: state.waypointIndex, origin: state.waypointIndex };
  let origin = state.rerouteFromIndex ?? previous?.origin;
  if (origin === undefined || origin === null) {
    const candidates = Object.entries(route.reroutes).filter(([, points]) => points[state.waypointIndex] && matchesSnapshot(points[state.waypointIndex], state));
    if (candidates.length !== 1) throw new Error('Reroute origin is ambiguous. The relay needs to include rerouteFromIndex in its state.');
    origin = Number(candidates[0][0]);
  }
  const points = route.reroutes[String(origin)], point = points?.[state.waypointIndex];
  if (!point) throw new Error('Reroute waypoint is missing');
  return { route: 'reroute', points, point, index: state.waypointIndex, origin };
}
function atPoint(state, point) {
  return { ...state, headingDeg: point.headingDeg, shelterBearingDeg: point.shelter.az,
    minutesToShelter: point.shelter.minutes, openSky: point.openSky,
    doseFraction: point.doseFraction, oxygenFraction: point.oxygenFraction,
    sunlit: point.sun.visible, baseLink: point.base.visible, earthLink: point.earth.visible };
}

// LOCAL REHEARSAL ONLY: follows the team's fake paths; no planner or dose model.
export function reduceDemoState(state, event, route, initialState) {
  if (event.type === 'reset') return { ...initialState };
  let next = { ...state };
  const selected = resolveSelection(state, route);
  if (event.type === 'next' || event.type === 'back' || event.type === 'goto') {
    const index = event.type === 'goto' ? event.index : selected.index + (event.type === 'next' ? 1 : -1);
    if (!Number.isSafeInteger(index)) throw new Error('goto requires an integer index');
    next.waypointIndex = clamp(index, 0, selected.points.length - 1);
  } else if (['storm', 'panic', 'requestReroute'].includes(event.type)) {
    if (event.type === 'storm') { bool(event.on, 'storm on'); next.storm = event.on; }
    if (event.type === 'panic') next.panic = true;
    if (event.type === 'requestReroute') next.rerouteRequested = true;
    if ((event.type !== 'storm' || event.on) && state.route === 'main') {
      if (!route.reroutes[String(state.waypointIndex)]) throw new Error('No precomputed shelter route from this stop');
      next.route = 'reroute'; next.rerouteFromIndex = state.waypointIndex; next.rerouteFrom = state.waypointIndex; next.waypointIndex = 0;
    }
  } else return state;
  next = atPoint(next, resolveSelection(next, route, selected).point);
  // The time threshold is not agreed yet; this simulator warns on base loss only.
  next.mode = next.storm || next.panic ? 'storm' : !next.baseLink ? 'warning' : 'nominal';
  return next;
}
