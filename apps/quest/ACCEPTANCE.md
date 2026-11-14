# Native headset acceptance — 14 November 2026

The supplied screenshots are the functional checklist. The user's later native Unity/USB requirement replaces their original browser/HTTPS/Three.js delivery instructions. The current export is the authority for numbers and shelter ids.

| Item | Implementation / evidence |
| --- | --- |
| Readable, less peripheral HUD | Compass lowered 27° → 16°; core readings enlarged and moved to a lower strip; open sky/science at ±24° rather than corner dashboards. Wearer fit confirmation remains necessary. |
| AR and VR fallback | Starts in Quest passthrough. Left X switches to the bundled NASA Murray Buttes panorama and warm sky, then back to the room. |
| 72-sample skyline, N/E/S/W, smooth transitions | Native dynamic mesh from the exact selected waypoint; smooth sample interpolation and stable calibrated north. Warm faint contour, no blue baseline, no ground fill. Y hides the ring in AR. |
| Sun/Earth/base/shelter markers | Supplied azimuths/elevations in a fixed frame; visibility and base-link dimming; Earth delay and base distance; shelter minutes. Base/shelter markers hide at arrival. No local sky calculation. |
| Main readings | Open sky from `openSky`; lower line includes shelter time, base link, sunlight, oxygen and dose. Fractions displayed as percentages. |
| Modes and arrival | Nominal calm, warning amber with reason, storm red border/chime/pulsing shelter, arrival “In shelter” with active storm retained. |
| Route and decision | Exact `route`, `waypointIndex`, `rerouteFrom`; decision reason from `rerouteInfo`. No locally chosen shelter or independently running countdown. |
| Science stop and next waypoint | Named science card; one waypoint arrow on the compass, preserving the user's compass-only navigation preference. |
| Offline operation and reconnect | Local relay and cached real data over USB; existing retry loop and explicit reroute origin. Relay reconnect regression tests pass. No headset internet needed. |
| Sources | Small credit from `data/site.json`: HiRISE/USGS, JPL Horizons and 14 Nov 2026 19:40 UT. |
| Visual QA | Unity previews for base, Quela, northwest skyline, warning, storm, arrival and VR fallback. Preview caught missing CanvasRenderer on custom UI; fixed and covered by a regression check. |
| Laptop/projector | USB mirror previously confirmed by wearer. Physical HDMI projector rehearsal still needs the actual projector. |
| Full recording and frame rate | Completed on 0.5: 31 main points, all 13 S03 diversion points, arrival and reset. USB recording 85.54 s; Unity reported mean 72.0 fps, p95 13.9 ms throughout sampled windows, including storm and recording. These measure app-frame pacing. |
| NASA panorama in VR | PIA20840 (sol 1451) bundled and credited; historical reference scenery, not route-matched geometry. Real DEM remains available in `data/out/terrain/`. |

## Version 0.7 verification

Installed over USB and independently confirmed as version 0.7.0 / code 7. **816 native checks**, **16 relay/client tests**, and eleven mission previews passed. The scene checks confirm that a 90° head turn and route step do not rotate the Sun or north, the skyline does not mask the ground or draw a flat baseline, and the atmosphere has no dust geometry. Arrival-marker suppression and offline next/back requests are covered. AR and the final NASA panorama were visually inspected in editor renders. The original NASA pixels remain unchanged; a conservative coverage lookup feathers the mosaic edges. The Quest was asleep after installation, so physical controller input, wearer appearance and a new frame-rate run remain unverified for 0.7. USB mirroring is restored.

## Current export checks

| State | Current expected output |
| --- | --- |
| m00, Base | 92.4% open sky, nominal; already under cover at base |
| m19, Quela drill site | 81.5%, northwest butte, Sun marker dim and Sun disc hidden, named science card |
| m25–m28 | Amber “Base link lost” |
| m30 then storm | Reroute 30 → S03, initially 4.52 min; base 9.73 min and excluded by limit; base link retained at chosen shelter |
| End of reroute 30 | “In shelter”, 0 remaining minutes, 74.6% open sky, base link retained |

The screenshots' approximate base 95% and shelter S04 are older values. They are not hard-coded into the headset. “Initial” in the decision line distinguishes the original choice time from the changing remaining minutes in the main strip.

Earlier 0.6 checks: **812 native checks** and ten successful Unity mission previews. The new offline-emergency and recenter screens were visually checked, alongside the storm view. Regression checks cover offline alert retention, startup, shelter arrival, panic versus solar-storm effects and offline request failure. The preceding upstream integration passed 16 Node tests, 9 fixture checks and the web build.

The **0.6.0 APK (version code 6) is installed on Quest 3 over USB**. It adds a one-second B hold indicator, request/result feedback and smooth left-stick-click recentering. Stale readings are labelled and any last-known emergency retains its red border. The Quest was asleep after this installation, so new physical button interactions remain awaiting wearer confirmation. The laptop USB mirror was reopened. No repeat full-run or frame-rate claim is made for this update.

The **0.5.0 APK completed the full live USB rehearsal**. The relay's in-memory export was confirmed at 92.4% base open sky and S03. Native device logs confirm each stage and measured 72.0 fps / p95 13.9 ms. The MP4 was checked for a complete container and duration; it has not been reviewed frame by frame. Final wearer readability and controller-toggle confirmation remain useful; physical HDMI projection still needs the actual projector.

Local evidence: `.local/Beacon-Quest-demo-2026-11-14-153004.mp4` (85.54 s, 1920×1248, no microphone audio), `.local/quest05-full-run-timeline.json`, `.local/quest05-full-run-device.log`. These include private demo/passthrough content and are excluded from Git.

For the full presenter rehearsal, keep Beacon open and run `node tools/demo-quest-run.mjs` from the repository root. It validates every displayed waypoint, Quela, the link-loss warning, the S03 diversion and arrival, then resets. It writes `.local/quest-demo-timeline.json`. `--quick` reduces the holds for a shorter integration check. Recording is supported by `tools/mirror-quest.ps1 -Record <new-file.mp4> -Seconds 90`; capture includes passthrough but no microphone audio. Keep recordings local unless the wearer chooses to share them.
