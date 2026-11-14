# CJ: first headset session

Use **Start WiFi Demo.cmd** to get the existing app into Quest passthrough without Developer Mode: connect the Quest and laptop to the same Wi-Fi, enter the printed HTTPS `/headset/` address in Quest Browser, accept its local certificate warning, then select **Enter AR**. The synced laptop hub is `http://127.0.0.1:5174/hub/`. Keep the launcher open. This is the same WebXR app; Unity, Android Studio and an APK build are not required.

For laptop-only practice, **Start Laptop Demo.cmd** opens the same relay without HTTPS. Open its hub and `http://127.0.0.1:5174/headset/?helmet=1` in two tabs. Next, Storm, Panic and Reset in the hub drive the helmet preview. Drag or arrow keys look around. This checks the UI and synchronization; actual passthrough and tracking are still hardware checks.

USB remains available later. Stop one launcher before starting the other because both use port 5174.

## Borrowed Quest: account setup

The owner/admin account is the first account used to set up the headset. Additional profiles can use it but cannot pair it independently to the Meta Horizon mobile app. Adding your profile is optional for this development test; it does not unlock the owner's device settings.

Ask your uncle to open his paired Meta Horizon phone app, select the headset, then **Headset Settings → Developer Mode**. If developer registration/verification is required, the paired account owner must complete it. He can do this without sharing his password. Developer Mode is configured from the phone app, not a hidden headset switch. A developer-team invitation is separate from a headset profile invitation.

For an already configured headset, Meta Support identifies **Settings → System → About → Pairing Code** as the code location. Labels may differ by headset software. Finding the code does not remove the admin/secondary-account restriction. Avoid factory-resetting a borrowed headset to change its admin.

Sources: [device setup](https://developers.meta.com/vr/documentation/android-apps/enable-developer-mode/), [admin vs secondary accounts](https://communityforums.atmeta.com/discussions/OtherTroubleshooting/meta-quest-3-initial-setup-and-multiple-family-accounts/1135028/replies/1136153), [secondary-account pairing limitation](https://communityforums.atmeta.com/discussions/PairingConnection/casting-issues-with-quest-3/1351835/replies/1351861), [finding the pairing code](https://communityforums.atmeta.com/discussions/OtherTroubleshooting/where-is-the-5-digit-code-to-pair-my-headset/886694/replies/1257039).

## Laptop work already prepared

- App, local simulator and fake data in this repository.
- JavaScript dependencies installed; `Start Beacon.cmd` starts the app.
- Official Google Android Platform Tools in `.local/platform-tools`; `Connect Quest.cmd` checks and opens the USB connection.
- Automated checks for skyline maths, angle wrapping, state validation and two-client synchronization.
- Reduced terrain exporter and separate Python environment; synthetic crop/mesh checks passed.

## The ten-minute hardware check

1. Enable Developer Mode with the owner; connect a USB data cable; accept USB debugging.
2. Run **Start Beacon.cmd** if the server is not already running, then **Connect Quest.cmd**.
3. In Quest Browser, open `http://localhost:5173/apps/headset/` and choose **Enter AR**.
4. Confirm passthrough is visible around the ring and the HUD is readable with both eyes.
5. Rotate through a full turn: N/E/S/W and the markers should remain in site directions. Trigger realigns north. No walking/teleport locomotion is needed.
6. On the laptop, advance waypoints. The ring should blend over about 0.9 seconds while status values change immediately.
7. At the fourth main waypoint, trigger storm: verify the red border and pulsing shelter marker. The route switches to a three-point shelter path. Advance twice: the shelter shows 0.0 minutes and blocked Earth contact. Refresh during the reroute and verify the same skyline returns.
8. Reset and exit/re-enter AR, then try VR. Confirm exiting restores the desktop preview.
9. Disconnect the relay/server: the display should warn of stale values, then recover when reconnected.
10. Record readability, comfort and frame-rate issues before adding large real-terrain assets.

## What to coordinate next

Ronan: the headset now reads your `shared/fake/` fixtures and v1 contracts directly. Supply the relay endpoint and real `data/out/waypoints.json`; the state now carries `rerouteFrom` (shared/state.md), which the headset uses on reconnects. See `apps/headset/README.md`. The team's exact crop is prepared under `data/out/terrain/`; date and real Sun/Earth directions still come from the engine/site definition.

Ronn: `data/out/terrain/README.md` explains the committed height grid, both textures, coordinate conversion and optional `shared/terrain.js` mesh loader. Keep the 1 m raw crop for the engine; the 4 m grid is a visual asset.

Joel: use the same relay snapshot and units so phone and headset agree.

AR requires no terrain assets. Keep the real terrain and synthetic route distinction visible until the engine exports matched real waypoints.
