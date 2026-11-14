// Crew model: the walk log, each astronaut's totals for the week and the readiness check for the planned walk.
// No drawing and no contract field names here. The roster is in crew-data.js and the limits in config.js.
const DAY = 864e5, KEY = 'beacon.hub.walks';
const xy = ({ x, y }) => ({ x, y });
export const pathLength = (pts) => { let d = 0; for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return d; };

// Walks the hub recorded on this laptop. They stay in the browser's storage, which can be missing or blocked.
export function loadRecorded() { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
export function saveRecorded(list) { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 20))); } catch { /* history then lasts until the page closes */ } }
export function loadChoice(key) { try { return localStorage.getItem('beacon.hub.' + key); } catch { return null; } }
export function saveChoice(key, v) { try { localStorage.setItem('beacon.hub.' + key, v); } catch { /* not kept */ } }

// One list of every past walk, newest first: walks recorded by the hub, the sample crew log laid over the
// engine's route, and the rover's real track from the site file last.
export function buildWalks(crew, route, recorded, rover, now) {
  const w = route.waypoints, out = [];
  // Microgray when the route carries it, otherwise fractions of the walk budget (see doseUnits).
  const ugy = doseUnits(route) === 'uGy', doseOf = (p) => (ugy ? p.doseUgy : p.dose) ?? 0;
  for (const m of crew) (m.walks || []).forEach((s, k) => {
    let i = s.to === 'end' ? w.length - 1 : w.findIndex((p) => p.id === s.to || p.label === s.to);
    if (i < 1) i = Math.max(1, Math.round((w.length - 1) * (s.fraction ?? 1)));
    const leg = w.slice(0, i + 1), end = w[i], back = s.back !== false, n = back ? 2 : 1;
    const pts = (back ? [...leg, ...leg.slice(0, -1).reverse()] : leg).map(xy);
    out.push({
      id: `${m.id}-${k}`, who: m.id, kind: 'sample', at: now - s.daysAgo * DAY,
      label: `${w[0].label || 'Start'} to ${end.label || 'waypoint ' + i}${back ? ' and back' : ''}`,
      distanceM: pathLength(pts), minutes: ((end.t ?? 0) - (w[0].t ?? 0)) * n, dose: (doseOf(end) - doseOf(w[0])) * n,
      hrAvg: s.hrAvg ?? null, hrPeak: s.hrPeak ?? null, outcome: s.outcome || 'Completed', pts,
      stops: leg.filter((p) => p.isScienceStop).map(xy),
    });
  });
  for (const r of recorded) if (r && Array.isArray(r.pts) && r.pts.length > 1) out.push({ ...r, kind: 'recorded' });
  out.sort((a, b) => b.at - a.at);
  if (rover && rover.pts.length > 1) out.push({ id: 'rover', who: null, kind: 'rover', at: null, label: rover.label, distanceM: pathLength(rover.pts), pts: rover.pts, marks: rover.pts, source: rover.source });
  return out;
}

// 'uGy' when every main waypoint has an absolute dose (engine with Curiosity RAD data), else 'budget'.
export const doseUnits = (route) => (route.waypoints.length && route.waypoints.every((p) => p.doseUgy != null) ? 'uGy' : 'budget');

// Totals over the last seven days for one astronaut.
export function weekStats(walks, id, now) {
  const mine = walks.filter((k) => k.who === id && k.at != null), week = mine.filter((k) => now - k.at <= 7 * DAY);
  const sum = (f) => week.reduce((a, k) => a + (f(k) || 0), 0);
  return { walks: week.length, minutes: sum((k) => k.minutes), distanceM: sum((k) => k.distanceM), dose: sum((k) => k.dose), lastAt: mine.length ? Math.max(...mine.map((k) => k.at)) : null };
}

// Readiness for the planned walk. `plan` is { minutes, dose, stormDose } of the route on the map, in the units of
// `lim.weeklyDose`; `lim` is CONFIG.CREW_LIMITS with weeklyDose (and the week's background dose, `background`)
// in those units. Returns level 'fit', 'marginal' or 'no', with the reasons in words, worst first.
// `doseStorm` (the week if a solar storm hits during the walk) is shown, not judged: a storm's dose alone is
// near the weekly limit, so judging it would mark every walk marginal.
export function readiness(member, st, plan, lim, now, extra = {}) {
  const no = [], warn = [], pc = (f) => Math.round(f * 100) + '%', bg = lim.background || 0;
  const doseNow = (bg + st.dose) / lim.weeklyDose, doseAfter = (bg + st.dose + (plan.dose || 0)) / lim.weeklyDose;
  const doseStorm = plan.stormDose != null ? (bg + st.dose + (plan.dose || 0) + plan.stormDose) / lim.weeklyDose : null;
  const timeAfter = (st.minutes + (plan.minutes || 0)) / lim.weeklyWalkMin;
  const restH = st.lastAt != null ? (now - st.lastAt) / 36e5 : null;
  if (member.condition === 'injured' || member.condition === 'ill') no.push(`${member.condition === 'ill' ? 'Ill' : 'Injured'}: not cleared to walk`);
  if (doseAfter > 1) no.push(`This walk would take the weekly dose to ${pc(doseAfter)} of the limit`);
  else if (doseAfter > lim.marginalAt) warn.push(`Weekly dose would reach ${pc(doseAfter)} of the limit`);
  if (timeAfter > 1) no.push(`This walk would take walk time to ${pc(timeAfter)} of the weekly limit`);
  else if (timeAfter > lim.marginalAt) warn.push(`Walk time would reach ${pc(timeAfter)} of the weekly limit`);
  if (member.condition === 'fatigued') warn.push('Reported fatigue');
  if (restH != null && restH < lim.minRestHours) warn.push(`Only ${restH < 1 ? 'minutes' : Math.round(restH) + ' h'} of rest since the last walk (${lim.minRestHours} h wanted)`);
  if (extra.batteryLow) warn.push('Wristband battery is low');
  const level = no.length ? 'no' : warn.length ? 'marginal' : 'fit';
  return { level, reasons: no.length || warn.length ? [...no, ...warn] : ['Rested and inside the weekly limits'], doseAfter, doseStorm, timeAfter, doseNow, timeNow: st.minutes / lim.weeklyWalkMin, restH };
}
