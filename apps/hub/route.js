// Route model: reads the waypoint file (shared/waypoints.md) and the relay state (shared/state.md)
// into the shapes the hub draws from. Field names from the contracts appear only in this file.
const RAD = Math.PI / 180;

function waypoint(w) {
  return {
    id: w.id, label: w.label || '', x: w.pos.x, y: w.pos.y, z: w.pos.z, headingDeg: w.headingDeg,
    skyline: w.skyline || [], openSky: w.openSky, sun: w.sun || null, earth: w.earth || null,
    base: w.base ? { az: w.base.az, distM: w.base.distance, visible: w.base.visible } : null,
    shelter: w.shelter ? { az: w.shelter.az, distM: w.shelter.distance, min: w.shelter.minutes } : null,
    t: w.minutesFromStart ?? 0, dose: w.doseFraction, oxygen: w.oxygenFraction,
    isShelter: !!w.isShelter, isScienceStop: !!w.isScienceStop,
  };
}

export function readWaypoints(doc, cfg) {
  const waypoints = (doc.main || []).map(waypoint), reroutes = {};
  for (const [k, list] of Object.entries(doc.reroutes || {})) reroutes[k] = list.map(waypoint);
  const all = [...waypoints, ...Object.values(reroutes).flat()];

  // Science stops and shelters are flags on waypoints, not separate lists.
  let n = 0;
  const stops = waypoints.map((w, i) => (w.isScienceStop ? { id: w.id, name: w.label || `Stop ${n + 1}`, num: ++n, x: w.x, y: w.y, wp: i, etaMin: w.t } : null)).filter(Boolean);
  const shelters = [];
  for (const w of all) if (w.isShelter && !shelters.some((s) => Math.hypot(s.x - w.x, s.y - w.y) < 2)) shelters.push({ x: w.x, y: w.y, label: w.label });

  // Base position is not in the file; every waypoint gives its direction and distance, so average those.
  let base = cfg.BASE;
  const fixes = waypoints.filter((w) => w.base && w.base.az != null && w.base.distM != null);
  if (!base && fixes.length) {
    base = { x: 0, y: 0 };
    for (const w of fixes) { base.x += (w.x + Math.sin(w.base.az * RAD) * w.base.distM) / fixes.length; base.y += (w.y + Math.cos(w.base.az * RAD) * w.base.distM) / fixes.length; }
  }

  let distanceM = 0, maxSlopeDeg = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1], b = waypoints[i], d = Math.hypot(b.x - a.x, b.y - a.y);
    distanceM += d; if (d > 0.5 && a.z != null && b.z != null) maxSlopeDeg = Math.max(maxSlopeDeg, Math.atan(Math.abs(b.z - a.z) / d) / RAD);
  }
  const first = waypoints[0] || {}, last = waypoints[waypoints.length - 1] || {};
  return {
    version: doc.version, waypoints, reroutes, stops, shelters, base,
    totals: {
      timeMin: last.t ?? null, distanceM,
      oxygenUsed: first.oxygen != null && last.oxygen != null ? first.oxygen - last.oxygen : null,
      dose: last.dose ?? null,
      worstShelterMin: waypoints.length ? Math.max(...waypoints.map((w) => (w.shelter && w.shelter.min) || 0)) : null,
      maxSlopeDeg,
    },
  };
}

// The state says route "reroute" and an index into it, but not which main waypoint the reroute left from.
// The hub remembers that from the last "main" state; after a reconnect it finds the reroute whose
// waypoint matches the live values in the state.
function rerouteFrom(raw, route, prev) {
  const score = (k) => {
    const w = (route.reroutes[k] || [])[raw.waypointIndex]; if (!w) return Infinity;
    return Math.abs((w.openSky ?? 0) - (raw.openSky ?? 0)) * 20 + Math.abs(((w.shelter && w.shelter.min) ?? 0) - (raw.minutesToShelter ?? 0))
      + Math.abs((w.dose ?? 0) - (raw.doseFraction ?? 0)) * 100 + Math.abs((w.oxygen ?? 0) - (raw.oxygenFraction ?? 0)) * 100;
  };
  const guess = prev ? String(prev.reroute ? prev.reroute.from : prev.wp) : null;
  if (guess != null && score(guess) < 0.05) return +guess;
  let best = guess, bs = Infinity;
  for (const k of Object.keys(route.reroutes)) { const sc = score(k); if (sc < bs) { bs = sc; best = k; } }
  return best != null ? +best : 0;
}

export function readState(raw, route, prev) {
  const onReroute = raw.route === 'reroute';
  let wp = Math.max(0, Math.min(route.waypoints.length - 1, raw.waypointIndex | 0)), reroute = null;
  if (onReroute) {
    const from = rerouteFrom(raw, route, prev), list = route.reroutes[String(from)] || [], end = list[list.length - 1];
    wp = Math.max(0, Math.min(route.waypoints.length - 1, from));
    reroute = { from, wp: Math.max(0, Math.min(list.length - 1, raw.waypointIndex | 0)), waypoints: list, target: 'shelter', x: end ? end.x : null, y: end ? end.y : null };
  }
  return {
    version: raw.version, wp, reroute, mode: raw.mode || 'nominal',
    storm: !!raw.storm, panic: !!raw.panic, rerouteRequested: !!raw.rerouteRequested,
    headingDeg: raw.headingDeg, shelterBearingDeg: raw.shelterBearingDeg, shelterMin: raw.minutesToShelter,
    openSky: raw.openSky, dose: raw.doseFraction, oxygen: raw.oxygenFraction,
    sunlit: raw.sunlit, baseLink: raw.baseLink, earthLink: raw.earthLink, earthDelayMin: raw.earthDelayMinutes,
    // Proposed additions, not in shared/state.md yet (see README). Missing until the relay carries them.
    heartRate: raw.heartRateBpm ?? null, wristBattery: raw.wristBatteryFraction ?? null,
  };
}

export const emptyState = () => readState({ route: 'main', waypointIndex: 0 }, { waypoints: [{}], reroutes: {} }, null);

// Curiosity's real positions near the buttes, from the site file (data/site.json: routeNearButtes, in the
// terrain mosaic's projection). Local metres are measured from the south-west corner of the near crop.
export function readSite(site) {
  const crop = site && site.nearCrop, track = site && site.routeNearButtes;
  if (!crop || !Array.isArray(track) || track.length < 2) return null;
  const pts = track.map((p) => ({ x: p.easting - crop.left, y: p.northing - crop.bottom, sol: p.sol }));
  return { label: `Curiosity rover, sols ${pts[0].sol} to ${pts[pts.length - 1].sol}`, pts, source: 'NASA MSL waypoints (data/site.json)' };
}
