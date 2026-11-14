# Beacon AR — native Quest app

Unity 6.3 LTS, OpenXR, Meta XR Core SDK. The Android app renders passthrough and a peripheral HUD on Quest 3; no browser is used for the headset view.

## Mission integration

The laptop relay remains the authority. The app loads `/session.json` and that session's exact waypoint document, then connects to `/ws` with role `headset-unity`. `rerouteFrom` identifies emergency routes. There is no independent fake mission inside the app. Missing or invalid data pauses guidance; stale telemetry is labelled offline.

`adb reverse tcp:5174 tcp:5174` carries the connection over USB. The app's endpoint is `http://127.0.0.1:5174`; the laptop hub remains `http://127.0.0.1:5174/hub/`.

## HUD

- Two side columns at ±24 degrees leave the centre clear. Open sky, oxygen and dose sit on the left; shelter time, base link and sunlight sit on the right. The old bottom reading strip is removed. Brief controller/request feedback sits below the left column.
- In AR, the six stat readings have no dark backing boxes; the text retains its outline. VR retains the translucent stat panels. The B-hold progress bar remains visible in either mode.
- The compass is lowered from 27 to 16 degrees above forward gaze. One arrow marks the supplied direction of travel. The watch remains the detailed navigator; there is no route line or mini-map.
- VR also shows one beacon at the next waypoint's measured terrain position: a tapered light column, a small ground ring and an outlined distance label. It stays anchored as the wearer moves, follows the active relay route, turns amber for a shelter diversion and warm orange during a storm. Arrival hides it until the next waypoint is acknowledged; it disappears at the final destination and while offline. AR keeps the compass cue without placing Mars geometry into the room.
- Open-sky percentage is prominent on the left. A named science-stop card appears above the right column. The HUD plane remains 1.2 m forward.
- The ring uses the current waypoint's 72 skyline samples, with faint warm shading above the horizon in AR and N/E/S/W labels. The floating contour line is removed in both AR and VR, and the VR scenery has no artificial blocked-sky fill. There is no flat horizontal baseline or fill over the ground. Sample heights blend as the route advances. North is calibrated once and remains fixed across route changes and head turns; explicit left-stick recentering can recalibrate it.
- Sun and Earth markers use supplied azimuth, elevation and visibility. Earth includes the relay's delay. Base includes its supplied distance and dims on loss of contact. Shelter includes the supplied walking minutes and pulses during emergencies. Base and shelter destination markers disappear at arrival; the side stat still says “In shelter”. These markers describe the mission view, not furniture.
- Warning mode shows an amber border and reason. Storm mode shows a red border, “Solar storm, take cover”, chime and pulsing shelter marker. Arrival says “In shelter” and keeps the shelter skyline and active storm warning.
- The bottom-centre source credit and shelter-choice explanation are removed from AR and VR. Source credits and scenario metadata remain in the bundled notice and repository. Current shelter minutes and request feedback remain in the side stat and come from the relay; the headset does not run its own timer or planner.
- Disconnection labels readings as last-known data, hides navigation and retains any last-known emergency with a red border. Reconnection or arrival does not repeat the alert chime; a new emergency does.
- Holding physical right B shows progress inside the right-side shelter card, followed by the request/result in that same card. A short tap explains the one-second hold. Brief controller pulses acknowledge the press and completion. Already-sheltered and already-rerouted states give confirmation without another request. Offline, failed and unanswered requests are explicit. Temporary text disappears automatically and restores the current shelter reading.

In AR, the presenter uses the hub's Next/Storm/Reset controls; room movement and sticks do not advance the route. In VR, continuous walking follows the real exported coordinates: coming within 2.5 m of the next waypoint sends a guarded arrival event to the relay. The compass arrow and metres use the wearer's actual position. Holding B requests the existing engine diversion from the nearest exported main point. Route changes do not teleport the wearer. Arrival requires physically reaching the shelter; walking away restores guidance. Sky, dose and remaining minutes still update at the supplied waypoint samples, rather than being recomputed in the headset. Returning to AR restores the physical tracking frame. A surveyed lecture-hall route and persistent spatial anchors are a separate next step.

| Controller | Action |
| --- | --- |
| Right A | Toggle Mars atmosphere / clear passthrough |
| Right B, hold one second | Ask the relay for a shelter route |
| Left stick direction | Continuous walking in VR; no action in AR |
| Right stick left/right | Smooth turning in VR; no action in AR |
| Hold left grip while moving (or right index trigger) | Sprint in VR, up to 4.5 m/s; release to return to 1.4 m/s walking |
| Left X | Toggle AR passthrough / Jezero 3D scenery |
| Left Y | Show/hide the ring in AR; explicitly return to the current mission point in VR |
| Left stick click | Smoothly recenter the mission's forward direction to the current gaze |

Version 0.13 uses Jezero's Three Forks and delta front, with the matching exported Jezero mission. The route area uses measured 1 m terrain and a matching image; a 7 km surrounding landscape supports approximately 3.5 km roaming radius. The outer terrain is coarser. See [Jezero sources, coordinate frame and quality limits](Assets/Beacon/Art/JezeroTerrain/README.md). Generated sand/rock materials, tint and small stones are cosmetic; they do not change mission calculations. Gale assets remain archived. Changing to a mismatched mission disables VR while preserving AR.

## Mars atmosphere

The native AR view starts with a translucent ochre sky, a small Sun and halo, and static red horizon haze. All moving sand and mist particles have been removed. The room remains visible. Press **A on the right controller** to switch between Mars effects and clear passthrough; the HUD and live mission continue in both modes. **B held for one second** still requests shelter.

The live solar-storm flag gradually deepens the static red haze and strengthens a quiet wind loop over four seconds. A panic request alone does not change the weather effect. Disconnected mission data lets the effect return to calm while the HUD retains its last-known emergency. The effect uses one sky-dome draw, with no particles or post-processing. It never adds a route line or centre navigation panel.

The tint, haze and wind are artistic effects. The Sun follows the waypoint's JPL Horizons direction and disappears behind the supplied skyline when `sun.visible` is false; its ring marker remains dimmed. The current source Sun is at azimuth 275.8°, elevation 12°, for the Jezero scenario time 15 Nov 2026 00:00 UT. It stays anchored in the calibrated Mars frame; only its supplied visibility changes at different route points. A route turn no longer swings the Sun or Earth around the wearer. Shader stereo handling follows [Unity's single-pass instancing guidance](https://docs.unity.com/en-us/engine/6000.3/manual/xr/graphics/stereo-rendering/single-pass-instancing).

## Build and install

1. Activate a Unity licence and install editor `6000.3.28f1` with Android Build Support, SDK, NDK and OpenJDK.
2. Open this folder in Unity and let the pinned packages import.
3. Run **Beacon → Prepare native Quest app** to generate the passthrough scene, font resources and OpenXR settings. This recreates `Assets/Beacon/Scenes/BeaconAR.unity`; put manual scene experiments in a separate scene.
4. Run **Beacon → Build Quest APK**. The output is `Builds/BeaconAR.apk`, excluded from Git.
5. Connect Quest USB debugging and run the root `Install Native Quest.cmd`. It starts the laptop relay if needed, installs the app and opens it on Quest.

The native launcher defaults to the Jezero relay. If this laptop is still serving Gale, it restarts its own local relay with Jezero so every connected client receives the same mission. For later sessions, put on the headset and use **Start Native Quest.cmd**. It restores the USB relay connection and opens the installed app without rebuilding or reinstalling. The launcher checks that the Quest is awake, starts the exact activity in the active profile, and confirms both the app process and native relay connection. An asleep headset gets a clear message instead of a false “launched” result.

The same setup/build can run with Unity's documented `-batchmode -projectPath ... -executeMethod BeaconBuild.Prepare` / `BeaconBuild.BuildAndroid`. `BeaconVerify.Run` checks the canonical fixtures, navigation, arrival and invalid-state handling.

On Windows, `powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-quest-native.ps1` runs preparation, mission and VR checks, comparison renders and the Android build in order. It uses an isolated working copy in `.local/quest-build` (which avoids a Windows package-folder lock seen during setup), then returns the APK and generated Unity assets to this folder. Logs go in `.local/`. Close both projects in Unity before running it. `-UseSourceProject` builds this folder directly; `-PrepareOnly` stops after checks and previews. The converted Access Mars assets are committed, so Python/Draco is needed only to regenerate them.

Development builds allow HTTP for the local USB mission connection. Do not treat this development endpoint as a public deployment.

## Laptop/projector view

`Mirror Quest USB.cmd` opens a read-only USB mirror using [the official scrcpy Windows release](https://github.com/Genymobile/scrcpy/blob/master/doc/windows.md). This laptop has version 5.0.1 in `.local/scrcpy/scrcpy-win64-v5.0.1/`; the download is excluded from Git. Connect the laptop to the projector over HDMI. No Meta casting sign-in is involved. The captured view depends on the Quest compositor; check the view with the app running before a presentation. The mirror does not capture microphone audio.

On the 0.9 live check, a mirror started while the Quest was asleep remained black/frozen. Restarting with H.264 software decoding restored the picture, confirmed by the wearer. The helper now uses `--hwdec=disabled`, retains the 1920-pixel / 30 fps cap, and accepts `-Diagnostics` to log received frame rates. Keep the headset awake, start Beacon, then open the mirror. The native app continues rendering at its own headset frame rate.

The 0.10 device-side crop failed the wearer's picture check. Version 0.11 sends an unmodified full H.264 frame from the official scrcpy server and crops/rotates it on the laptop with FFplay. This avoids the Quest's cropped virtual-display path. The default is the left eye with 22-degree correction. `-Eye Right` selects the other eye, `-Eye Both` uses the earlier full stereo scrcpy view, and `-Crop width:height:x:y -Angle degrees` overrides the framing. The filter is tested on synthetic video; a live stream still needs wearer confirmation. Closing the video window ends its own capture and USB forwarding. Logs are in `.local/quest-client-*.log`.

The 0.14 follow-up supplies presentation timestamps for the raw stream, retains its initial keyframe and synchronizes playback to video. This corrects the observed `nan` playback clock and empty frame queue. The FFplay window starts visibly while the capture helper stays hidden. Diagnostic playback advances continuously, and the wearer confirmed one upright, live view. Timing uses FFmpeg's [setpts filter](https://ffmpeg.org/ffmpeg-filters.html#setpts_002c-asetpts).

Install the official scrcpy Windows 5.0.1 release under `.local/scrcpy/`. For local cropping, download [FFmpeg 9.0.2 essentials from Gyan](https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip), a provider listed on [FFmpeg's download page](https://ffmpeg.org/download.html), and extract under `.local/ffmpeg/`. The downloaded archive's SHA256 is `60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`; verify before extracting. Keep binaries out of Git. Optional `-Record <new-file.mp4> -Seconds 90` records the same filtered picture without microphone audio; this new recording path has not yet had a headset rehearsal.

## Verified demo

Version **0.16.0 / code 16** adds the VR waypoint beacon. The navigation checks cover its terrain anchor, stability during walking/turning, main and emergency routes, arrival, disconnection/reconnection and hiding in AR. Near, distant and emergency previews are included in `.local/jezero-native-previews/`. See [acceptance evidence](ACCEPTANCE.md).

Version **0.15.0 / code 15** removes the bottom-centre source-credit and shelter-choice text from both headset modes. The six side stats, compass and emergency alerts keep their current layout. See [acceptance evidence](ACCEPTANCE.md) for verification and installation.

Version **0.14.0 / code 14** removes the six AR stat backgrounds while retaining the text outline, VR panels and shelter hold indicator. The existing HUD visual and shelter-input checks passed; the AR preview was inspected. It also repairs the laptop player's missing timestamps and hidden-window startup. See [acceptance evidence](ACCEPTANCE.md) for installation and current hardware results.

Version **0.13.0 / code 13** switches the active scenery and native launcher to Jezero. **1,321 mission checks**, **8,803 VR checks**, shelter-button regression checks, rendered previews and **21 Node integration tests** pass. The physics check traverses the Jezero main route and its far-point shelter diversion. The maximum visible scene is **865,108 triangles**, with lower detail at distance. The current build includes the interrupted 0.12 shelter-feedback changes. Headset performance, physical B/haptics and the new laptop mirror remain for the later wearer check. See [acceptance evidence](ACCEPTANCE.md).

Version **0.12.0 / code 12** makes shelter-button feedback visible in the shelter card and adds input-path regression checks. At the starting base, “Already safe” is correct: the AR presenter must advance the demo, or the VR wearer must use the stick to walk outside the shelter radius, before requesting a diversion. VR uses actual position, so retaining the base waypoint while walking away no longer suppresses the request. The input tests cover a short tap, one-second hold, no repeated requests while held, stalled frames, base, offline, send failure and walking away from base. Hardware button/haptic confirmation is deferred at the wearer's request.

Version **0.11.0 / code 11** passes **1,321 mission checks**, **8,450 VR checks**, **21 Node integration tests**, **9 fixture checks** and the web build. Native checks include every route point's DEM alignment, a continuous physics walk of the full main route and far-point diversion, sprint, collision, north, AR restoration and arrival/return guidance. Real relay tests walk every exported shelter route for both Gale and Jezero and reject stale arrival/emergency messages. Seven VR and eleven mission preview renders complete. Installation, current-device performance and one-eye picture results are tracked in [acceptance evidence](ACCEPTANCE.md); older performance numbers below do not establish 0.11 performance.

Version **0.10.0 / code 10** is installed. It adds the side-column HUD, removes the floating contour, introduces grip sprint and blends synthetic cosmetic detail into the VR scenery. **815 mission checks**, **1,734 VR checks**, and the mission/VR previews passed. The wearer confirmed the panels and sprint work. The live USB test confirms AR/VR switching and sprint reaching 4.5 m/s; the latest twelve app-frame windows measured 72.0–72.2 fps (p95 13.9 ms). The single-eye laptop stream received about 30 fps, but the wearer reported a bad picture, so the single-eye presentation has not passed. See [acceptance evidence](ACCEPTANCE.md).

Version **0.9.0** was installed on Quest 3 (version code 9). It added the Access Mars ground-level model only in VR, continuous stick walking/turning and a visual alignment under the Quela ring's northwest high side. AR still starts in the real room; walking does not change mission state. **815 mission checks**, **1,630 VR checks**, **16 relay/client tests**, and the mission/VR preview renders passed. Source hashes and unchanged photographs were verified; the completed APK contains the Apache licence and modification/attribution notice. Installation was independently confirmed through the device package manager. The wearer subsequently confirmed AR, VR movement and the restored live laptop picture. Sampled live app windows ran at about 72 fps (p95 13.9 ms); the restarted mirror received about 30 fps. See [acceptance notes and alignment limits](ACCEPTANCE.md).

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
