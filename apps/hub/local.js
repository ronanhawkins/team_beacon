// Stand-in for the relay so the hub still runs when the relay is not there (?local=1, or "Run locally").
// It copies the state logic of relay/server.js. Other devices do not follow it.
const WARNING_MINUTES_TO_SHELTER = 12;
const EARTH_DELAY_MINUTES = 14;

export function localRelay({ doc, onState }) {
  let sim = { route: 'main', waypointIndex: 0, storm: false, panic: false, rerouteRequested: false, rerouteFrom: 0 };
  const list = () => (sim.route === 'main' ? doc.main : doc.reroutes[String(sim.rerouteFrom)]);
  const clamp = (i) => Math.max(0, Math.min(list().length - 1, i));
  const reroute = () => {
    const r = sim.route === 'main' && doc.reroutes && doc.reroutes[String(sim.waypointIndex)];
    if (Array.isArray(r) && r.length) { sim.rerouteFrom = sim.waypointIndex; sim.route = 'reroute'; sim.waypointIndex = 0; }
  };
  function state() {
    const wp = list()[sim.waypointIndex], baseLink = wp.base.visible;
    return {
      version: 1, route: sim.route, waypointIndex: sim.waypointIndex,
      mode: sim.storm || sim.panic ? 'storm' : !baseLink || wp.shelter.minutes > WARNING_MINUTES_TO_SHELTER ? 'warning' : 'nominal',
      storm: sim.storm, panic: sim.panic, rerouteRequested: sim.rerouteRequested,
      headingDeg: wp.headingDeg, shelterBearingDeg: wp.shelter.az, minutesToShelter: wp.shelter.minutes,
      openSky: wp.openSky, doseFraction: wp.doseFraction, oxygenFraction: wp.oxygenFraction,
      ...(wp.doseMicroGray != null && { doseMicroGray: wp.doseMicroGray }),
      ...(wp.doseRateMicroGrayPerHour != null && { doseRateMicroGrayPerHour: wp.doseRateMicroGrayPerHour }),
      sunlit: wp.sun.visible, baseLink, earthLink: wp.earth.visible, earthDelayMinutes: EARTH_DELAY_MINUTES,
    };
  }
  function apply(ev) {
    switch (ev && ev.type) {
      case 'next': sim.waypointIndex = clamp(sim.waypointIndex + 1); return true;
      case 'back': sim.waypointIndex = clamp(sim.waypointIndex - 1); return true;
      case 'goto': if (!Number.isInteger(ev.index)) return false; sim.waypointIndex = clamp(ev.index); return true;
      case 'storm':
        if (typeof ev.on !== 'boolean') return false;
        if (ev.on) { sim.storm = true; reroute(); return true; }
        sim.storm = false;
        if (sim.route === 'reroute' && !sim.panic && !sim.rerouteRequested) { sim.route = 'main'; sim.waypointIndex = sim.rerouteFrom; }
        return true;
      case 'panic': sim.panic = true; reroute(); return true;
      case 'requestReroute': sim.rerouteRequested = true; reroute(); return true;
      case 'reset': sim = { route: 'main', waypointIndex: 0, storm: false, panic: false, rerouteRequested: false, rerouteFrom: 0 }; return true;
      default: return false; // unknown events are ignored (shared/events.md)
    }
  }
  setTimeout(() => onState(state()), 0);
  return { kind: 'local', send(ev) { if (apply(ev)) onState(state()); return true; }, close() {} };
}
