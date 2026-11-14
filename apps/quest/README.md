# Beacon AR — native Quest app

Unity 6.3 LTS, OpenXR, Meta XR Core SDK. The Android app renders passthrough and a peripheral HUD on Quest 3; no browser is used for the headset view.

## Mission integration

The laptop relay remains the authority. The app loads `/session.json` and that session's exact waypoint document, then connects to `/ws` with role `headset-unity`. `rerouteFrom` identifies emergency routes. There is no independent fake mission inside the app. Missing or invalid data pauses guidance; stale telemetry is labelled offline.

`adb reverse tcp:5174 tcp:5174` carries the connection over USB. The app's endpoint is `http://127.0.0.1:5174`; the laptop hub remains `http://127.0.0.1:5174/hub/`.

## HUD

- Oxygen remaining and dose-budget-used occupy the upper corners.
- Base contact is a small top status strip.
- A north-up mini map draws only the supplied route, with dashed remaining segments and a head-direction arrow. It does not invent terrain or streets.
- The lower navigation panel looks past straight path samples to the next meaningful bend, science stop or destination. It shows distance along the route, with a head-relative direction arrow, shelter time and open sky.
- Emergencies briefly expand a notice, sound a short chime, then retain a smaller edge warning. Arrival does not clear an active emergency.
- Holding the right controller's B button for one second requests a shelter route.

Entering the app establishes an illustrative room north after tracking starts. Physical room movement does not advance the Mars route. The presenter uses the hub's Next/Storm/Reset controls. A surveyed lecture-hall route and persistent spatial anchors are a separate next step; the current Mars coordinates must not be treated as a room-scale walking path.

## Build and install

1. Activate a Unity licence and install editor `6000.3.28f1` with Android Build Support, SDK, NDK and OpenJDK.
2. Open this folder in Unity and let the pinned packages import.
3. Run **Beacon → Prepare native Quest app** to generate the passthrough scene, font resources and OpenXR settings. This recreates `Assets/Beacon/Scenes/BeaconAR.unity`; put manual scene experiments in a separate scene.
4. Run **Beacon → Build Quest APK**. The output is `Builds/BeaconAR.apk`, excluded from Git.
5. Connect Quest USB debugging and run the root `Install Native Quest.cmd`. It starts the laptop relay if needed, installs the app and opens it on Quest.

The same setup/build can run with Unity's documented `-batchmode -projectPath ... -executeMethod BeaconBuild.Prepare` / `BeaconBuild.BuildAndroid`. `BeaconVerify.Run` checks the canonical fixtures, navigation, arrival and invalid-state handling.

On Windows, `powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-quest-native.ps1` runs preparation, fixture/exported-route checks and the Android build in order. It uses an isolated working copy in `.local/quest-build` (which avoids a Windows package-folder lock seen during setup), then returns the APK and generated Unity assets to this folder. Logs go in `.local/`. Close both projects in Unity before running it. `-UseSourceProject` builds this folder directly.

Development builds allow HTTP for the local USB mission connection. Do not treat this development endpoint as a public deployment.

## Laptop/projector view

`Mirror Quest USB.cmd` opens a read-only USB mirror using [the official scrcpy Windows release](https://github.com/Genymobile/scrcpy/blob/master/doc/windows.md). This laptop has version 5.0.1 in `.local/scrcpy/scrcpy-win64-v5.0.1/`; the download is excluded from Git. Connect the laptop to the projector over HDMI. No Meta casting sign-in is involved. The captured view depends on the Quest compositor; check the view with the app running before a presentation. The mirror does not capture microphone audio.

## Credits

Beacon was made with Unity®. Unity is a trademark or registered trademark of Unity Technologies. Copyright © 2005–2026 Unity Technologies. All rights reserved.

Meta XR SDK packages retain their original SDK licence. TextMesh Pro font resources retain their bundled notices.
