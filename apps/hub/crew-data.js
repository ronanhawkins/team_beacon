// Sample crew for the readiness panel. Edit this file to change the people.
//
// What is made up: the people, their condition, who walked when, and the heart rates of past walks.
// What is not made up: each past walk's path, distance, time and dose. The hub works those out from the
// engine's route (data/out/waypoints.json) for the stretch the walk covered, so they change with the route.
//
// A walk goes from the start of the route to `to` (a waypoint label or id, or 'end') and back.
// `fraction` (0 to 1 of the route) is used when the route has no waypoint with that label.
// `daysAgo` may be a fraction: 0.25 is six hours ago. `condition` is 'fit', 'fatigued', 'injured' or 'ill'.
export const CREW = [
  { id: 'ev1', name: 'Tess Okonkwo', suit: 'EV1', role: 'Geologist', condition: 'fit', note: 'No issues reported.',
    walks: [
      { daysAgo: 2.2, to: 'Quela drill site', fraction: 0.6, hrAvg: 98, hrPeak: 124 },
      { daysAgo: 4.3, to: 'end', hrAvg: 104, hrPeak: 137 },
    ] },
  { id: 'ev5', name: 'Amara Osei', suit: 'EV5', role: 'Mission specialist', condition: 'fit', note: 'Fully rested, cleared by the medic this morning.',
    walks: [
      { daysAgo: 5.4, to: 'Quela drill site', fraction: 0.6, hrAvg: 94, hrPeak: 118 },
      { daysAgo: 9.0, to: 'end', hrAvg: 99, hrPeak: 127 },
    ] },
  { id: 'ev2', name: 'Dario Lindqvist', suit: 'EV2', role: 'Engineer', condition: 'fit', note: 'No issues reported.',
    walks: [
      { daysAgo: 0.25, to: 'Butte outcrop', fraction: 0.8, hrAvg: 109, hrPeak: 142 },
      { daysAgo: 1.3, to: 'end', hrAvg: 101, hrPeak: 133 },
      { daysAgo: 3.1, to: 'Quela drill site', fraction: 0.6, hrAvg: 96, hrPeak: 121 },
    ] },
  { id: 'ev3', name: 'Yuna Halloran', suit: 'EV3', role: 'Biologist', condition: 'fatigued', note: 'Reported poor sleep after three walks in four sols.',
    walks: [
      { daysAgo: 1.1, to: 'end', hrAvg: 112, hrPeak: 151 },
      { daysAgo: 2.4, to: 'end', hrAvg: 106, hrPeak: 139 },
      { daysAgo: 4.0, to: 'Butte outcrop', fraction: 0.8, hrAvg: 103, hrPeak: 135 },
    ] },
  { id: 'ev4', name: 'Sam Whitlock', suit: 'EV4', role: 'Medic', condition: 'injured', note: 'Sprained wrist on the last walk. Base duties only until cleared.',
    walks: [
      { daysAgo: 3.0, to: 'Quela drill site', fraction: 0.6, hrAvg: 118, hrPeak: 158, outcome: 'Ended early' },
    ] },
];
