# Offline arrival photographs

These are real NASA images, not generated scenery. The two rover images show the named area's surroundings; they are not a reconstruction of the exact simulated eye position. Cards appear for 12 seconds at named stops, base and the route endpoint. Dense path samples do not create popups. VR requires physical arrival within 2.5 m; AR follows the presenter's selected stop. Emergencies hide the card. Reset permits the arrival cards again.

- `PIA25681.jpg`: Three Forks sample-depot selfie, WATSON, 22 January 2023. NASA/JPL-Caltech/MSSS. Unmodified 640-pixel NASA library thumbnail already supplied in `data/out/jezero/media/`. [JPL source](https://www.jpl.nasa.gov/images/pia25681-perseverances-three-forks-sample-depot-selfie/).
- `PIA24921.jpg`: Jezero delta Mastcam-Z panorama, June 2022. NASA/JPL-Caltech/ASU/MSSS. Enhanced colour. [JPL source](https://www.jpl.nasa.gov/images/pia24921-detailed-panorama-of-mars-jezero-crater-delta/). [1280-pixel NASA derivative](https://images-assets.nasa.gov/image/PIA24921/PIA24921~medium.jpg). The card uses the recorded UV crop to focus on the cliff and avoid uncaptured black stitching gaps. The source JPEG is unmodified.
- `HiRISE.jpg`: unmodified copy of `data/out/jezero/terrain/detail_2400.jpg`, NASA/JPL-Caltech/University of Arizona/USGS. Bounds come from `data/out/jezero/terrain/detail.json`: west 1136, south 1228, extent 600 m, north at image top. Named arrivals without a rover photo display an 80 m satellite crop centred on the waypoint, with an amber location marker. Edge crops clamp inside the survey while retaining the marker's correct position. No photograph is shown outside this coverage.

The catalogue checks both site and waypoint position before assigning a rover photograph. All files are packaged into the APK; viewing them needs no internet. Images retain their original aspect ratio. Unity uses ASTC texture compression on Android.

The base habitat is separate illustrative geometry, with its origin at the exported base coordinate. It does not represent an existing structure on Mars or change the planner's shelter data.
