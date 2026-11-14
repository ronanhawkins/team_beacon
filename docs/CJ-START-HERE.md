# CJ: first headset session

The priority is to get the existing app visible in Quest passthrough over USB. Unity, Android Studio and an APK build are not required for the team's planned WebXR page.

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
7. Trigger storm: verify the red border and pulsing shelter marker. Use **Demo shelter jump**: the fake shelter shows 0.0 minutes and blocked Earth contact.
8. Reset and exit/re-enter AR, then try VR. Confirm exiting restores the desktop preview.
9. Disconnect the relay/server: the display should warn of stale values, then recover when reconnected.
10. Record readability, comfort and frame-rate issues before adding large real-terrain assets.

## What to coordinate next

Ronan: confirm `shared/CONTRACT.md`; provide exact DTM and orthoimage products, source CRS, crop bounds, parking point, date and Sun/Earth directions; supply the relay URL and real waypoints.

Ronn: agree the terrain origin and axes in the GLB's `.metadata.json`. Use the same bounds. The mesh is a visual asset, not an engine input.

Joel: use the same relay snapshot and units so phone and headset agree.

The missing agreed data is the reason real terrain is pending. Do not independently choose a different crop and call it matched.
