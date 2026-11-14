# Native headset acceptance — 14 November 2026

The supplied screenshots are the functional checklist. The user's later native Unity/USB requirement replaces their original browser/HTTPS/Three.js delivery instructions. The current export is the authority for numbers and shelter ids.

| Item | Implementation / evidence |
| --- | --- |
| Readable, less peripheral HUD | Compass lowered 27° → 16°; core readings enlarged and moved to a lower strip; open sky/science at ±24° rather than corner dashboards. Wearer fit confirmation remains necessary. |
| AR and VR fallback | Starts in Quest passthrough. Left X switches to opaque Mars sky plus the solid waypoint skyline and back. |
| 72-sample skyline, N/E/S/W, smooth transitions | Native dynamic mesh from the exact selected waypoint; smooth sample and heading interpolation. Y hides the ring in AR. |
| Sun/Earth/base/shelter markers | Supplied azimuths and elevations; visibility and base-link dimming; Earth delay and base distance; shelter minutes. No local sky calculation. |
| Main readings | Open sky from `openSky`; lower line includes shelter time, base link, sunlight, oxygen and dose. Fractions displayed as percentages. |
| Modes and arrival | Nominal calm, warning amber with reason, storm red border/chime/pulsing shelter, arrival “In shelter” with active storm retained. |
| Route and decision | Exact `route`, `waypointIndex`, `rerouteFrom`; decision reason from `rerouteInfo`. No locally chosen shelter or independently running countdown. |
| Science stop and next waypoint | Named science card; one waypoint arrow on the compass, preserving the user's compass-only navigation preference. |
| Offline operation and reconnect | Local relay and cached real data over USB; existing retry loop and explicit reroute origin. Relay reconnect regression tests pass. No headset internet needed. |
| Sources | Small credit from `data/site.json`: HiRISE/USGS, JPL Horizons and 14 Nov 2026 19:40 UT. |
| Visual QA | Unity previews for base, Quela, northwest skyline, warning, storm, arrival and VR fallback. Preview caught missing CanvasRenderer on custom UI; fixed and covered by a regression check. |
| Laptop/projector | USB mirror previously confirmed by wearer. Physical HDMI projector rehearsal still needs the actual projector. |
| Full recording and frame rate | Pending final 0.5 headset run. Development build reports measured mean FPS and 95th percentile frame time to its log. |
| Optional terrain or panorama in VR | Not included in the fallback; real downloaded terrain remains available in `data/out/terrain/`. |

## Current export checks

| State | Current expected output |
| --- | --- |
| m00, Base | 92.4% open sky, nominal; already under cover at base |
| m19, Quela drill site | 81.5%, northwest butte, Sun marker dim and Sun disc hidden, named science card |
| m25–m28 | Amber “Base link lost” |
| m30 then storm | Reroute 30 → S03, initially 4.52 min; base 9.73 min and excluded by limit; base link retained at chosen shelter |
| End of reroute 30 | “In shelter”, 0 remaining minutes, 74.6% open sky, base link retained |

The screenshots' approximate base 95% and shelter S04 are older values. They are not hard-coded into the headset. “Initial” in the decision line distinguishes the original choice time from the changing remaining minutes in the main strip.

Current checks: **805 native checks**, 16 Node tests, 9 fixture checks and a successful web build after the upstream merge. All seven updated Unity mission previews rendered successfully; arrow, compass ticks, cardinal labels and red border were visually confirmed after the renderer fix.

The **0.5.0 APK (version code 5) is installed on Quest 3 over USB**. The relay was restarted and its in-memory export confirmed at 92.4% base open sky and S03. The Quest was asleep after installation, so wearer readability, controller toggles, native frame-rate measurements and the full recording remain pending. The laptop mirror was reopened.

For the full presenter rehearsal, keep Beacon open and run `node tools/demo-quest-run.mjs` from the repository root. It validates every displayed waypoint, Quela, the link-loss warning, the S03 diversion and arrival, then resets. It writes `.local/quest-demo-timeline.json`. `--quick` reduces the holds for a shorter integration check. Recording is supported by `tools/mirror-quest.ps1 -Record <new-file.mp4> -Seconds 90`; capture includes passthrough but no microphone audio. Keep recordings local unless the wearer chooses to share them.
