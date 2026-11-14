# Beacon AR — native Quest app

Unity 6.3 LTS, OpenXR, Meta XR Core SDK. The Android app renders passthrough and a peripheral HUD on Quest 3; no browser is used for the headset view.

## Mission integration

The laptop relay remains the authority. The app loads `/session.json` and that session's exact waypoint document, then connects to `/ws` with role `headset-unity`. `rerouteFrom` identifies emergency routes. There is no independent fake mission inside the app. Missing or invalid data pauses guidance; stale telemetry is labelled offline.

`adb reverse tcp:5174 tcp:5174` carries the connection over USB. The app's endpoint is `http://127.0.0.1:5174`; the laptop hub remains `http://127.0.0.1:5174/hub/`.

## HUD

- A readable lower strip shows minutes to shelter, base link, sunlight, oxygen and dose. It sits 18 degrees below forward gaze, with larger text than 0.3/0.4 and no far-corner readouts.
- The compass is lowered from 27 to 16 degrees above forward gaze. One arrow marks the supplied direction of travel. The watch remains the detailed navigator; there is no route line or mini-map.
- Open-sky percentage is prominent 24 degrees to the left. A named science-stop card appears at the same distance to the right. The HUD plane remains 1.2 m forward.
- The ring uses the current waypoint's 72 skyline samples, with faint warm shading above the horizon, a soft sandstone contour and N/E/S/W labels. There is no flat horizontal baseline or fill over the ground. Sample heights blend as the route advances. North is calibrated once and remains fixed across route changes and head turns; explicit left-stick recentering can recalibrate it.
- Sun and Earth markers use supplied azimuth, elevation and visibility. Earth includes the relay's delay. Base includes its supplied distance and dims on loss of contact. Shelter includes the supplied walking minutes and pulses during emergencies. Base and shelter destination markers disappear at arrival; the lower status still says “In shelter”. These markers describe the mission view, not furniture.
- Warning mode shows an amber border and reason. Storm mode shows a red border, “Solar storm, take cover”, chime and pulsing shelter marker. Arrival says “In shelter” and keeps the shelter skyline and active storm warning.
- The lower explanation comes directly from `rerouteInfo`, including the initial chosen-route time and why base was excluded. Current remaining minutes always come from the relay; the headset does not run its own timer or planner.
- Data credit uses the site file's JPL Horizons time. Missing decision or metadata fields are not fabricated.
- Disconnection labels readings as last-known data, hides navigation and retains any last-known emergency with a red border. Reconnection or arrival does not repeat the alert chime; a new emergency does.
- Holding B shows a temporary progress bar, then the request/result. Already-sheltered and already-rerouted states give confirmation without another request. Feedback disappears automatically to keep the centre clear.

Physical room movement and thumbsticks do not advance the Mars route. The presenter uses the hub's Next/Storm/Reset controls; all mission clients share that state. B remains the headset's emergency shelter request. In VR, the sticks move through the Murray Buttes reference scenery independently of the mission. Returning to AR restores the physical tracking frame. A surveyed lecture-hall route and persistent spatial anchors are a separate next step.

| Controller | Action |
| --- | --- |
| Right A | Toggle Mars atmosphere / clear passthrough |
| Right B, hold one second | Ask the relay for a shelter route |
| Left stick direction | Continuous walking in VR; no action in AR |
| Right stick left/right | Smooth turning in VR; no action in AR |
| Right index trigger while moving | Faster walking in VR |
| Left X | Toggle AR passthrough / Murray Buttes 3D scenery |
| Left Y | Show or hide the skyline ring in AR |
| Left stick click | Smoothly recenter the mission's forward direction to the current gaze |

VR uses the ground-level Murray Buttes model and photographs from [Access Mars](https://github.com/googlecreativelab/access-mars), with 158,096 visible terrain triangles, a warm sky and the calculated skyline overlay. X returns to AR. The model is reference scenery, visually oriented toward the Quela ring's high side; it is not georegistered to the live route. The ring and mission readings continue to use Ronan's data while stick movement only moves the viewpoint. See [model source, Apache 2.0 licence and conversion notes](Assets/Beacon/Art/AccessMars/README.md). The older PIA20840 panorama remains in the source archive but is disabled when this 3D scene is present.

## Mars atmosphere

The native AR view starts with a translucent ochre sky, a small Sun and halo, and static red horizon haze. All moving sand and mist particles have been removed. The room remains visible. Press **A on the right controller** to switch between Mars effects and clear passthrough; the HUD and live mission continue in both modes. **B held for one second** still requests shelter.

The live solar-storm flag gradually deepens the static red haze and strengthens a quiet wind loop over four seconds. A panic request alone does not change the weather effect. Disconnected mission data lets the effect return to calm while the HUD retains its last-known emergency. The effect uses one sky-dome draw, with no particles or post-processing. It never adds a route line or centre navigation panel.

The tint, haze and wind are artistic effects. The Sun follows the waypoint's JPL Horizons direction and disappears behind the supplied skyline when `sun.visible` is false; its ring marker remains dimmed. The current source Sun is at azimuth 280.4°, elevation 12°, for the scenario time 14 Nov 2026 19:40 UT. It stays anchored in the calibrated Mars frame; only its supplied visibility changes at different route points. A route turn no longer swings the Sun or Earth around the wearer. The real DEM remains in `data/out/terrain/` for a later navigable terrain scene. Shader stereo handling follows [Unity's single-pass instancing guidance](https://docs.unity.com/en-us/engine/6000.3/manual/xr/graphics/stereo-rendering/single-pass-instancing).

## Build and install

1. Activate a Unity licence and install editor `6000.3.28f1` with Android Build Support, SDK, NDK and OpenJDK.
2. Open this folder in Unity and let the pinned packages import.
3. Run **Beacon → Prepare native Quest app** to generate the passthrough scene, font resources and OpenXR settings. This recreates `Assets/Beacon/Scenes/BeaconAR.unity`; put manual scene experiments in a separate scene.
4. Run **Beacon → Build Quest APK**. The output is `Builds/BeaconAR.apk`, excluded from Git.
5. Connect Quest USB debugging and run the root `Install Native Quest.cmd`. It starts the laptop relay if needed, installs the app and opens it on Quest.

The same setup/build can run with Unity's documented `-batchmode -projectPath ... -executeMethod BeaconBuild.Prepare` / `BeaconBuild.BuildAndroid`. `BeaconVerify.Run` checks the canonical fixtures, navigation, arrival and invalid-state handling.

On Windows, `powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-quest-native.ps1` runs preparation, mission and VR checks, comparison renders and the Android build in order. It uses an isolated working copy in `.local/quest-build` (which avoids a Windows package-folder lock seen during setup), then returns the APK and generated Unity assets to this folder. Logs go in `.local/`. Close both projects in Unity before running it. `-UseSourceProject` builds this folder directly; `-PrepareOnly` stops after checks and previews. The converted Access Mars assets are committed, so Python/Draco is needed only to regenerate them.

Development builds allow HTTP for the local USB mission connection. Do not treat this development endpoint as a public deployment.

## Laptop/projector view

`Mirror Quest USB.cmd` opens a read-only USB mirror using [the official scrcpy Windows release](https://github.com/Genymobile/scrcpy/blob/master/doc/windows.md). This laptop has version 5.0.1 in `.local/scrcpy/scrcpy-win64-v5.0.1/`; the download is excluded from Git. Connect the laptop to the projector over HDMI. No Meta casting sign-in is involved. The captured view depends on the Quest compositor; check the view with the app running before a presentation. The mirror does not capture microphone audio.

## Verified demo

Version **0.9.0** is installed on Quest 3 (version code 9). It adds the Access Mars ground-level model only in VR, continuous stick walking/turning and a visual alignment under the Quela ring's northwest high side. AR still starts in the real room; walking does not change mission state. **815 mission checks**, **1,630 VR checks**, **16 relay/client tests**, and the mission/VR preview renders passed. Source hashes and unchanged photographs were verified; the completed APK contains the Apache licence and modification/attribution notice. Installation was independently confirmed through the device package manager. Wearer movement and new frame-rate checks are pending. See [acceptance notes and alignment limits](ACCEPTANCE.md).

Version **0.8.0** was installed on Quest 3 (version code 8). It removed native thumbstick waypoint stepping and the corresponding relay-sender method, retaining the B emergency request and presenter controls. All **815 native checks** passed and the Android build succeeded.

Version **0.7.0** was installed on Quest 3 (version code 7). It fixed the Sun/Earth frame across route changes, removed moving particles and ground fill, replaced the blue baseline with a faint warm contour, hid arrived destination markers, added the now-superseded relay-backed right-stick route steps, and bundled the NASA panorama for VR. It passed **816 native checks**, **16 relay/client tests**, and eleven rendered mission previews. Scene regression checks exercise a 90° head turn plus route change, unchanged Sun/north, no ground mask, no flat baseline and one atmosphere draw with no dust geometry. The panorama was visually checked after feathering uncaptured mosaic boundaries without cutting out dark rocks. The Quest was asleep after that installation; wearer confirmation was pending. USB mirroring was restored.

Version **0.6.0** adds hold-to-request feedback, left-stick recentering, explicit stale readings and persistent last-known emergency alerts on USB loss. It passed **812 native checks**, built successfully, rendered ten mission previews, and was installed over USB (version code 6). The new offline and recenter screens were visually checked. The headset was asleep after this update, so the new controller actions await wearer confirmation. The USB mirror was reopened. The full live recording and measured frame rate below are from 0.5 immediately before this usability update.

The 0.5.0 update merges main through `32564e3` and follows its current exports. The screenshot checklist's older values changed: base is 92.4% open sky, and the far-point choice is S03 (4.52 minutes), rather than S04. Quela is 81.5% with the Sun hidden; m25–m28 lose base contact; shelter arrival is 74.6% with base contact retained. See [acceptance checklist](ACCEPTANCE.md) for evidence and outstanding hardware checks. `Beacon → Render mission acceptance previews` renders all these states against neutral grey, not a camera image.

Version 0.5.0 passed 805 native checks, seven visual previews, 16 relay/client tests and nine fixture checks, and was installed over USB. A full on-device rehearsal on 14 November then passed all 31 main waypoints, all 13 points on the S03 diversion, arrival and reset. During the run and USB recording, Unity reported mean 72.0 fps and p95 frame time 13.9 ms. These are app-frame measurements, not independent compositor/GPU measurements. The complete 85.54-second local recording is `.local/Beacon-Quest-demo-2026-11-14-153004.mp4`; the full state timeline and device log are `.local/quest05-full-run-timeline.json` and `.local/quest05-full-run-device.log`. The recording stays off Git.

The 0.4.0 atmosphere build passed all 611 Unity checks and compiled both shaders for Android/Vulkan on 14 November 2026. Calm and storm materials were rendered and visually checked in Unity against a neutral background; these are material previews, not headset captures. The APK was then installed and launched on Quest 3 over USB. Device logs confirmed atmosphere startup, live mission data, a six-second storm test, the next shelter-route point and reset to calm, with no matching runtime exceptions. The USB mirror was reopened. Wearer confirmation of the final effect strength and A-button toggle is still needed. `Beacon → Render atmosphere preview` recreates the previews under `.local/`.

The 0.3.0 development APK replaces the dashboard with the small corner readouts and compass-only waypoint described above. It passed all 611 Unity checks, built successfully, and was installed over USB on 14 November 2026. Final corner visibility and text readability need to be assessed by the wearer; the Quest was asleep immediately after installation.

The 0.2.0 development APK was built and installed on Quest 3 over USB on 14 November 2026. The wearer confirmed room passthrough with the HUD, and the laptop USB mirror. On-device logs confirmed main waypoint 9, storm reroute 9, the next shelter-route waypoint, and reset to main waypoint 0. The Unity checks passed for canonical fixtures and all 31 exported shelter routes; the relay's 16 Node tests and 9 fixture checks also passed.

Keep the headset on during the live demonstration: taking it off can pause Unity and temporarily disconnect mission data. It reconnects when the app resumes. Use the laptop hub or `/debug` presenter controls for Next, Storm and Reset. Reset before handing the headset to the next wearer. The current scene shows the Mars route as a HUD demonstration; it does not guide walking around room obstacles.

## Credits

Beacon was made with Unity®. Unity is a trademark or registered trademark of Unity Technologies. Copyright © 2005–2026 Unity Technologies. All rights reserved.

Meta XR SDK packages retain their original SDK licence. TextMesh Pro font resources retain their bundled notices.
