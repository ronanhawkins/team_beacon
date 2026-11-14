# Native headset acceptance — 14 November 2026

The supplied screenshots are the functional checklist. The user's later native Unity/USB requirement replaces their original browser/HTTPS/Three.js delivery instructions. The current export is the authority for numbers and shelter ids.

**Current target: 0.13 Jezero.** The wearer explicitly switched from Murray Buttes to Jezero. Historical Gale reference values below remain evidence for earlier builds, not the current Jezero mission. Hardware testing is deferred at the wearer's request.

## Version 0.13 Jezero switch

The native AR/VR app now uses Jezero's Three Forks/delta-front export and the matching USGS/NASA terrain. All **428 main/diversion points** match the measured 1 m detail tile within 0.25 m. A reprojected 7 km landscape supports approximately 3.5 km roaming radius; distant geometry is coarser. The maximum visible scene budget is **865,108 triangles**, including ground, seam geometry and decorative stones, with detail levels reducing ordinary drawing. Original orbital coverage is distinct from the illustrative warm tint/generated fine materials. No specific 45-million-triangle downloadable model was verified or claimed as imported.

**1,321 mission checks**, **8,803 VR checks**, the shelter-input checks, mission/VR renders and **21 Node integration tests** passed. The physics checks walk Jezero's full main route and its last-point diversion through to shelter. Additional checks verify ground around the wider landscape, survey bounds, consistent coordinate/elevation frame, AR restoration and fixed Sun. New shelter-input tests retain the improvement from the interrupted 0.12 work. Preview inspection found gaps between terrain levels; deeper seam geometry and two-sided rendering close them. The launcher defaults to the Jezero relay and refuses a mismatched site. Physical controller input, haptics, headset frame rate and the laptop's one-eye picture remain unverified for this version.

Source/provenance: `Assets/Beacon/Art/JezeroTerrain/README.md`. Generated material provenance and original Gale/Access Mars assets remain preserved. No new private-room recording was made.

The final APK is installed over USB as **0.13.0 / code 13**, independently confirmed by the Quest package manager. Its embedded Jezero attribution notice was checked. The laptop relay serves **Three Forks and the delta front, Jezero crater**, and USB forwarding on port 5174 is verified. The Quest reports **Asleep**; the launcher correctly leaves it unopened. Start `Start Native Quest.cmd` once wearing it. Installation and automated checks do not establish physical B input, frame rate or mirror quality.

Current Jezero reference: 44 main points; base has **92.8% open sky**. A storm at main index **43** selects **s-1468-1765**, initially **4.31 minutes**, through nine diversion points. Arrival has **82.1% open sky** and retains the base link. The exported shelter label is empty, so presentation uses its id rather than inventing a name.

| Item | Implementation / evidence |
| --- | --- |
| Readable, less peripheral HUD | Compass at 16°; 0.10 moves the bottom readings to two columns at ±24°, with brief feedback below the left column. Wearer fit confirmation remains necessary for the new arrangement. |
| AR and VR fallback | Starts in Quest passthrough. Left X switches to planner-aligned Jezero terrain and warm sky, then back to the room. The terrain and walking controller are disabled in AR. |
| 72-sample skyline, N/E/S/W, smooth transitions | Native dynamic mesh from the exact selected waypoint; smooth sample interpolation and stable calibrated north. 0.10 removes the contour in both modes, retains faint AR shading, and removes the VR fill. No blue baseline or ground fill. Y hides the ring in AR. |
| Sun/Earth/base/shelter markers | Supplied azimuths/elevations in a fixed frame; visibility and base-link dimming; Earth delay and base distance; shelter minutes. Base/shelter markers hide at arrival. No local sky calculation. |
| Main readings | Open sky from `openSky`; left column adds oxygen and dose; right column shows shelter, base link and sunlight. Fractions displayed as percentages. |
| Modes and arrival | Nominal calm, warning amber with reason, storm red border/chime/pulsing shelter, arrival “In shelter” with active storm retained. |
| Route and decision | Exact `route`, `waypointIndex`, `rerouteFrom`; decision reason from `rerouteInfo`. No locally chosen shelter or independently running countdown. |
| Science stop and next waypoint | Named science card; one waypoint arrow on the compass, preserving the user's compass-only navigation preference. |
| Offline operation and reconnect | Local relay and cached real data over USB; existing retry loop and explicit reroute origin. Relay reconnect regression tests pass. No headset internet needed. |
| Sources | Small credit from `data/site.json`: HiRISE/USGS, JPL Horizons and 15 Nov 2026 00:00 UT for Jezero. |
| Visual QA | Current Unity previews cover Jezero mission states, shelter feedback and AR/VR scenery. Historical Gale previews and findings are documented below. |
| Laptop/projector | USB mirror previously confirmed by wearer. Physical HDMI projector rehearsal still needs the actual projector. |
| Full recording and frame rate | Completed on 0.5: 31 main points, all 13 S03 diversion points, arrival and reset. USB recording 85.54 s; Unity reported mean 72.0 fps, p95 13.9 ms throughout sampled windows, including storm and recording. These measure app-frame pacing. |
| Navigable 3D scenery in VR | Version 0.13 uses Jezero's real 1 m detail DEM in the planner frame and a wider coarse landscape, up to 865,108 visible triangles with detail levels. Generated materials are cosmetic. Continuous walking acknowledges reached route samples. Previous Access Mars model remains archived with its licence. |

## Version 0.12 shelter-button follow-up

The wearer clarified that holding B seemed to do nothing and deferred hardware testing. The old pre-0.11 VR guard used the selected waypoint's `isShelter` even after the wearer walked away from base; 0.11 replaced it with physical proximity. Feedback had remained in a brief low-left panel, which could hide the reason for a refused request. Version 0.12 moves hold progress and all shelter-request outcomes into the existing right-side shelter card. A tap explains the one-second hold; base says **Already safe**; an existing diversion says **Route active**. Offline, send failure and missing replies have distinct messages. Brief right-controller pulses acknowledge press/confirmation, and logs identify both button recognition and outcome. Focus loss clears an unfinished hold.

Input-path checks exercise short taps, the one-second hold, no repeats while held, a long-frame guard, the base, offline state, a failed socket, an existing diversion and continuous VR walking away from a still-selected base waypoint. The latter must reach the sender instead of claiming the wearer remains sheltered. The visual review caught truncated long messages; shortened copy and preferred-width checks now guard against ellipsis. The earlier mission and VR suites are rerun with this change. Physical B input, haptics, current headset performance and the one-eye mirror are deferred at the wearer's request; automated input does not establish those hardware results.

## Version 0.11 verification

Merged `origin/main` through `d28ae32`, including stable shelter ids/labels, current dose outputs and multi-site relay support. The far-point diversion now names **Butte M12 shelter**, rather than relying on the old S03/S04 ids.

The active VR scene now uses the original 1 m DEM in the planner's coordinates: a 600 m vertex-span detail tile, matching HiRISE image and coarse 3 km distant terrain. All 268 exported Gale route points lie inside the detail tile. The maximum visible budget is **834,976 triangles**, with automatic detail reduction. Generated sand/layered-rock materials, decorative stones and a scenario-Sun shadow bake improve appearance without replacing measured heights or planner calculations. Seven VR comparison previews and eleven mission previews rendered; the updated terrain and lighting were visually inspected. This remains a heightfield with illustrative detail, not a complete ground-level photogrammetric reconstruction.

VR arrival sends a guarded relay step only when the wearer reaches the next sample. B selects the existing diversion from the nearest main sample. The compass uses physical VR position and shows metres; shelter arrival requires physical proximity and guidance returns if the wearer walks away. Ordinary movement and route changes do not teleport. Y explicitly returns to the selected mission point. AR remains presenter-driven, with sticks disabled.

**1,321 mission checks**, **8,450 VR checks**, **21 Node integration tests**, **9 fixture checks** and the web build passed. Native checks cover DEM alignment for every exported point, an end-to-end continuous physics walk of the main route and far-point diversion, walking/sprint/collision, arrival, leaving shelter, north and AR restoration. Relay integration tests traverse every exported diversion for both Gale and Jezero and reject duplicate/stale events, invalid origins and main-route steps delayed across a storm. Rust engine tests were not run; the engine itself was not modified. The web build retains its existing large-bundle advisory.

The mirror now crops and rotates the full unmodified Quest capture on the laptop, avoiding device-side crop/rotation. A synthetic 1920 by 1240 input successfully produced a one-second 1356 by 1510 filtered file. PowerShell parsing passed. This validates the filter, not the live headset picture. The new optional filtered-recording path also needs a hardware rehearsal.

The final APK built successfully, includes the terrain provenance notice, and is installed over USB as **0.11.0 / code 11**, independently confirmed by the device package manager. The local relay was restarted with the merged data and guarded-event handling. The Quest reports **Asleep**, so the launcher correctly did not claim to open the app. Frame pacing, wearer navigation/readability and live single-eye presentation remain pending. Previous versions' hardware results below are historical and do not establish 0.11 performance. No new passthrough recording was made.

## Version 0.10 verification

Installed **0.10.0 / code 10** over USB and independently confirmed it with the device package manager. The update removes the bright skyline contour in both modes, keeps only faint blocked-sky shading in AR, moves the five lower readings into side columns alongside Open Sky, and moves transient control feedback below the left column. Holding the left grip (or right index trigger) while moving sprints at up to 4.5 m/s; walking remains 1.4 m/s. AR ignores locomotion.

**815 mission checks** and **1,734 VR checks** passed, including a timed walk-versus-sprint comparison, gradual collision-bounded movement, release-to-stop, no mission-state change and AR restoration. Seven VR comparison renders and eleven mission previews completed. Visual regressions check that the lower strip and contour are gone while all five readings remain at the sides, with fixed Sun/north, clear floor, no baseline and no particles. Calm, storm, offline emergency, AR and the updated VR view were visually inspected.

The user explicitly requested invented cosmetic detail for poor photography. A generated material warms grey patches and provides subtle near-surface grain; the matched `east-original` / `east-cosmetic` renders were inspected. There are still 158,096 visible terrain triangles; original photo files, terrain shape, collision and the planner's data are unchanged. The new texture, generation prompt and limitations are documented in `Assets/Beacon/Art/MarsCosmeticDetail.md`. The APK's updated attribution notice was verified.

The laptop mirror now defaults to a cropped, rotated left-eye view, retaining software H.264 decoding and the 30 fps cap. It reads reported dimensions, supports right-eye/full-stereo/manual crop alternatives and refuses to start a blank stream while the Quest is asleep.

Once the wearer put the headset on, the launcher confirmed the native process and relay connection. The wearer confirmed that **the panels look good and sprint works**. Live logs show AR/VR switching and six sprint samples, reaching 4.50 m/s on the photographed ground. The latest twelve five-second app-frame windows measured **72.0–72.2 fps**, mean **72.02 fps**, with **p95 13.9 ms**. An earlier mode-switch window measured 70.6 fps. These are Unity app timings, not independent GPU/compositor measurements. The single-eye mirror delivered a **1486×1920** stream at about **30 fps**, with no reported mirror error, but the wearer reported a bad laptop picture. The single-eye presentation has therefore **not passed**; frame delivery alone does not verify framing. Local logs: `.local/quest10-live-check.log`, `.local/quest10-mirror-live.log` and `.local/quest10-mirror-live-error.log` (excluded from Git; no new recording).

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

## Historical Gale export checks

| State | Current expected output |
| --- | --- |
| m00, Base | 92.4% open sky, nominal; already under cover at base |
| m19, Quela drill site | 81.5%, northwest butte, Sun marker dim and Sun disc hidden, named science card |
| m25–m28 | Amber “Base link lost” |
| m30 then storm | Reroute 30 → Butte M12 shelter, initially 4.52 min; base 9.73 min and excluded by limit; base link retained at chosen shelter |
| End of reroute 30 | “In shelter”, 0 remaining minutes, 74.6% open sky, base link retained |

The screenshots' approximate base 95% and shelter S04 are older values. They are not hard-coded into the headset. “Initial” in the decision line distinguishes the original choice time from the changing remaining minutes in the shelter card.

Earlier 0.6 checks: **812 native checks** and ten successful Unity mission previews. The new offline-emergency and recenter screens were visually checked, alongside the storm view. Regression checks cover offline alert retention, startup, shelter arrival, panic versus solar-storm effects and offline request failure. The preceding upstream integration passed 16 Node tests, 9 fixture checks and the web build.

The **0.6.0 APK (version code 6) is installed on Quest 3 over USB**. It adds a one-second B hold indicator, request/result feedback and smooth left-stick-click recentering. Stale readings are labelled and any last-known emergency retains its red border. The Quest was asleep after this installation, so new physical button interactions remain awaiting wearer confirmation. The laptop USB mirror was reopened. No repeat full-run or frame-rate claim is made for this update.

The **0.5.0 APK completed the full live USB rehearsal**. The relay's in-memory export was confirmed at 92.4% base open sky and S03. Native device logs confirm each stage and measured 72.0 fps / p95 13.9 ms. The MP4 was checked for a complete container and duration; it has not been reviewed frame by frame. Final wearer readability and controller-toggle confirmation remain useful; physical HDMI projection still needs the actual projector.

Local evidence: `.local/Beacon-Quest-demo-2026-11-14-153004.mp4` (85.54 s, 1920×1248, no microphone audio), `.local/quest05-full-run-timeline.json`, `.local/quest05-full-run-device.log`. These include private demo/passthrough content and are excluded from Git.

For the full presenter rehearsal, keep Beacon open and run `node tools/demo-quest-run.mjs` from the repository root. It validates every displayed waypoint, Quela, the link-loss warning, the S03 diversion and arrival, then resets. It writes `.local/quest-demo-timeline.json`. `--quick` reduces the holds for a shorter integration check. Recording is supported by `tools/mirror-quest.ps1 -Record <new-file.mp4> -Seconds 90`; capture includes passthrough but no microphone audio. Keep recordings local unless the wearer chooses to share them.
