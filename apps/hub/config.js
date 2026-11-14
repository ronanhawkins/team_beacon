// Everything a teammate may need to change in the hub is in this file.

// The relay serves apps/hub at /hub/, shared/ at /shared/ and data/out/ at /data/ (relay/README.md).
// If the repo root is served by a plain static server instead, the page is at /apps/hub/ and data/out/ is at /data/out/.
const DATA = location.pathname.startsWith('/apps/hub') ? '/data/out/' : '/data/';

export const CONFIG = {
  // Engine exports. The hub uses each real file when it exists and the fake one otherwise,
  // the same rule the relay uses for waypoints. Add ?fake=1 to the address to force everything fake.
  REAL: { waypoints: DATA + 'waypoints.json', layers: DATA + 'layers/', terrain: DATA + 'terrain/' },
  FAKE: { waypoints: '/shared/fake/waypoints.json', layers: '/shared/fake/layers/', terrain: './dev/fake-terrain/' },

  // Relay socket. null = shared/client.js's default, wss://<this page's host>/ws.
  RELAY_URL: null,
  ROLE: 'hub',

  // Not in any contract yet, so set here.
  SITE_NAME: 'Murray Buttes, Gale crater',
  HOME_RADIUS_M: 320,           // how much ground the opening view shows around the terrain's parking spot when the route is fake
  ASTRONAUT: { name: 'Astronaut 1', suit: 'EV1' },   // only used when crew-data.js lists no crew
  START_LOCAL_TIME: '',          // Mars local time at waypoint 0 as 'HH:MM'. Empty hides the clock.
  BASE: null,                    // { x, y } in the local frame. null = work it out from the waypoints' base az and distance.
  MAX_SLOPE_DEG: 20,             // steepest ground a suited astronaut may be sent across when placing stops

  // Arrival photo and science task per science stop, keyed by waypoint id. Photo paths are relative to this page.
  //   m02: { task: 'Sample the sandstone and mudstone contact.', photo: './photos/m02.jpg', credit: 'NASA/JPL-Caltech' }
  STOP_NOTES: {},

  EXAGGERATION: 1.6,             // vertical exaggeration of the 3D terrain (1 = true scale)
  IMAGE_GAIN: 1.35,              // brightens the draped image so routes and labels read on a projector (1 = as supplied)

  // Map layers in toggle order (keys 1 to 6). `id` is the layer name in meta.json.
  // `domain` is in the layer's own units (meta.json min..max) and is the range the colours span;
  // `stops` are three r,g,b,a colours (0..1) for the low, middle and high end of that range.
  LAYERS: [
    { id: 'exposure', label: 'Radiation exposure', domain: [0.60, 0.97],
      stops: [[0.16, 0.30, 0.95, 0.92], [0.10, 0.78, 0.74, 0.62], [0.10, 0.78, 0.74, 0.0]],
      lo: 'Sheltered', hi: 'Open sky', source: 'Open-sky fraction from orbiter elevation' },
    { id: 'sunlight', label: 'Sunlight', domain: [0, 1],
      stops: [[0.01, 0.02, 0.06, 0.72], [0.01, 0.02, 0.06, 0.35], [0, 0, 0, 0]],
      lo: 'In shadow', hi: 'Sunlit', source: 'Sun position on orbiter elevation' },
    { id: 'baseLink', label: 'Base link', domain: [0, 1],
      stops: [[0.98, 0.55, 0.10, 0.62], [0.98, 0.55, 0.10, 0.30], [0, 0, 0, 0]],
      lo: 'No link', hi: 'Base in view', source: 'Line of sight to base' },
    { id: 'earthLink', label: 'Earth link', domain: [0, 1],
      stops: [[0.62, 0.36, 0.96, 0.62], [0.62, 0.36, 0.96, 0.30], [0, 0, 0, 0]],
      lo: 'No link', hi: 'Earth in view', source: 'Line of sight to Earth' },
    { id: 'slope', label: 'Slope', domain: [6, 32],
      stops: [[1, 1, 1, 0], [1.0, 0.93, 0.62, 0.55], [0.55, 0.20, 0.05, 0.85]],
      lo: 'Flat', hi: 'Too steep', source: 'Orbiter elevation model' },
    { id: 'minutesToShelter', label: 'Minutes to shelter', domain: [0, 30],
      stops: [[0.10, 0.78, 0.50, 0.0], [0.98, 0.86, 0.35, 0.45], [0.42, 0.16, 0.52, 0.80]],
      lo: 'At shelter', hi: 'Far', source: 'Walking time to the nearest shelter' },
  ],
  LAYERS_ON: ['exposure'],

  // Site file (Ronan's data/site.json). The relay and a plain static server both serve it here.
  // The hub takes Curiosity's real positions near the buttes from it, for the route history.
  SITE: '/data/site.json',

  // Storm and panic alarm: the beeps repeat for this many seconds, or until the emergency ends or it is silenced.
  ALARM: { seconds: 20, everyMs: 1100 },

  // Heart rate and wristband battery. `simulate` shows made-up values, labelled as simulated, until the relay state carries real ones.
  VITALS: { simulate: true, hrHigh: 150, batteryLow: 0.2, historySeconds: 90 },

  // Readiness check for the planned walk. All four are assumptions for the demo, not medical limits.
  //   weeklyDose: dose allowed in seven days, in walk budgets (a doseFraction of 1 is one budget)
  //   weeklyWalkMin: walking minutes allowed in seven days
  //   minRestHours: rest wanted since the last walk
  //   marginalAt: fraction of a limit at which the verdict becomes "marginal"
  CREW_LIMITS: { weeklyDose: 3.0, weeklyWalkMin: 90, minRestHours: 12, marginalAt: 0.8 },

  PLAN_TIMEOUT_MS: 6000,         // how long to wait for a route after "Send to planner"
};
