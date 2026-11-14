# Native headset acceptance — 14 November 2026

The supplied screenshots are the functional checklist. The user's later native Unity/USB requirement replaces their original browser/HTTPS/Three.js delivery instructions. The current export is the authority for numbers and shelter ids.

| Item | Implementation / evidence |
| --- | --- |
| Readable, less peripheral HUD | Compass lowered 27° → 16°; core readings enlarged and moved to a lower strip; open sky/science at ±24° rather than corner dashboards. Wearer fit confirmation remains necessary. |
| AR and VR fallback | Starts in Quest passthrough. Left X switches to the Access Mars Murray Buttes 3D scenery and warm sky, then back to the room. The terrain and walking controller are disabled in AR. |
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
| Ground-level 3D scenery in VR | Access Mars's real glTF/Draco model and 64 photo tiles, converted offline to 158,096 visible triangles. Apache 2.0 licence/attribution bundled. Continuous sticks move only the viewpoint; no mission events. Older panorama remains in source; real DEM remains available in `data/out/terrain/`. |

## Version 0.9 verification

The user replaced the separate Jezero work with Murray Buttes. No Jezero app was installed; unfinished local assets are retained outside the active project. Beacon starts in AR and exposes the original-area scenery through X.

**815 mission checks**, **1,630 VR checks**, and **16 relay/client tests** passed. The two relay-network tests initially encountered the restricted environment's local-network denial; all 16 passed with local networking allowed. VR checks cover geometry/winding, the photographed ground collider, gradual left-stick movement, continuous right-stick turning, no route changes, stable north/Sun, dead zone, diagonal speed and restoration of the physical AR frame. Five VR/AR comparison renders and the eleven mission regression previews completed. The scene regressions retain the fixed Sun, clear floor, absent blue baseline and absence of particles.

The starting view was inspected by eye with NASA's M12/Quela reference photo and the supplied Quela skyline. The butte is placed under the northwest high side, with a roughly 4° peak-height difference. This is deliberately reference scenery, not georegistration; the mission ring does not follow free exploration. The roughly 128 m central reconstruction has uneven photographic coverage and a coarser distant background. Movement is bounded inside the reconstructed surface. The 600 m fallback was not needed for the directional alignment. Full source, transformations and pinned hashes are documented in `Assets/Beacon/Art/AccessMars/README.md`.

The **0.9.0 APK / version code 9** built successfully and was installed over USB, independently confirmed by the device package manager. The Apache licence and attribution/modification notice were verified inside the finished APK. The headset was asleep immediately after installation; the old launcher accepted a launch request without actually starting Unity. Once awake, a direct activity launch started Beacon and connected its native relay client. The launcher now checks wakefulness, uses an explicit activity launch and verifies both the app process and relay handshake. `Start Native Quest.cmd` repeats this setup without reinstalling.

The wearer then confirmed **AR and VR movement work**, including the X mode switch. Device logs show continuous movement at approximately 1.4 m/s over the actual terrain. The retained 25 frame windows measured **71.3–72.0 fps / p95 13.9 ms**. These are Unity frame timings, not independent GPU/compositor measurements. The logs also recorded the existing r09 shelter route becoming active. The original mirror was black/frozen; restarting it with software H.264 decoding restored the **live laptop picture**, explicitly confirmed by the wearer, while its diagnostic counter reported about **30 fps**. The software decode setting is retained in the mirror helper. These fixes do not rebuild or reinstall the functioning 0.9 app.

Local diagnostic evidence: `.local/quest09-live-check.log`, `.local/quest09-mirror-restart.log`, and `.local/quest09-mirror-restart-error.log`. Logs stay excluded from Git. Physical projector/HDMI validation still requires the projector.

## Earlier version verification

Superseded movement: version **0.8.0 / code 8** removes thumbstick waypoint stepping, per the wearer's correction. The update passed **815 native checks**, built and was installed over USB. The emergency B request remains.

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
