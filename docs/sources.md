# Data sources

Every dataset Beacon uses, what it is used for, and which files it feeds. Downloads are made by scripts in `tools/`. Large raw files go in `data/raw/`, which is not committed. Small cached extracts go in `data/cache/`, which is committed, so the engine and the demo run offline.

For the colour texture and terrain hand-off to the hub and headset, see also `docs/DATA-SOURCES.md`.

| Dataset | Mission and instrument | Used for | Feeds |
|---|---|---|---|
| Gale crater DEM mosaic, 1 m | Mars Reconnaissance Orbiter, HiRISE stereo (USGS Astrogeology mosaic) | Terrain heights: skylines, slope, line of sight, shelters, walking times | `data/raw/near.bin`, `data/raw/far.bin` (not committed); all of `data/out/` |
| Gale HiRISE colour mosaic | Mars Reconnaissance Orbiter, HiRISE | Colour texture for the terrain | `data/out/terrain/` |
| MOLA global DEM, 463 m | Mars Global Surveyor, Mars Orbiter Laser Altimeter | The distant horizon beyond the Gale mosaic, out to 300 km | `data/raw/mola.bin` (not committed); skylines, layers and shelters in `data/out/` |
| Curiosity waypoints | Mars Science Laboratory (Curiosity), rover localisation | The parking spot and the route stops near the buttes | `data/site.json` (`parkingSpot`, `routeNearButtes`, `routeStops`) |
| Sun and Earth directions | JPL Horizons ephemeris service | Sun and Earth azimuth and elevation at the site for the demo time | `data/site.json` (`sky`); the sunlight and Earth-link layers, waypoints |
| Natural radiation shielding paper | Mars Science Laboratory, Radiation Assessment Detector (RAD) | Calibration of dose against blocked sky, and the 0.19 / 0.10 targets | `data/site.json` (`paperTarget`, `planner.doseShieldingFactor`); `engine check` |
| RAD reduced data, sols 4186, 4190, 4191 | Mars Science Laboratory, Radiation Assessment Detector (RAD) | The solar storm of 20 May 2024: quiet dose rate, storm length and strength | `data/cache/rad_storm.json`; storm settings, microgray fields in `waypoints.json` and `briefing.json` |
| DONKI WSA-Enlil simulations | NASA Community Coordinated Modeling Center (space weather models, from coronagraph observations) | Forecast arrivals of coronal mass ejections at Mars | `data/cache/donki_mars.json`; `briefing.json` `spaceWeather` |
| MSL weather feed | Mars Science Laboratory, Rover Environmental Monitoring Station (REMS), via Centro de Astrobiologia | Recent conditions at Gale: temperature, pressure, UV, sunrise and sunset | `data/cache/rems.json`; `briefing.json` `conditions` |
| NASA Image and Video Library | Mars Science Laboratory, Mastcam (and MAHLI self-portrait) | Photos for the science stops | `data/cache/stop_images.json`, `data/out/media/`; `data/out/stops.json` |

## Details

### Gale crater DEM mosaic

- URL: https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif
- Equirectangular, sphere radius 3396190 m, centre longitude 0. The 3 km near crop and the 20 m far grid are made with `gdal_translate`; the exact commands are in `data/site.json` (`nearCrop`, `farCrop`).

### Gale HiRISE colour mosaic

- URL: https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_HiRISE-LRGB_78quads_sharp_cog.tif
- Cropped to the same 3 km square by `tools/prepare-buttes.py`.

### MOLA global DEM

- URL: https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif
- A 600 km square around the site, fetched by `tools/fetch_mola.py`. The window, command and a comparison of its heights with the Gale mosaic are in `data/site.json` (`molaCrop`).

### Curiosity waypoints

- URL: https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json
- Positions are already in the mosaic's projection.

### JPL Horizons

- URL: https://ssd.jpl.nasa.gov/horizons/
- Airless apparent azimuth and elevation of the Sun and Earth from the site (137.353006 E, -4.695202) at the demo time in `data/site.json` (`sky`).

### Natural radiation shielding paper

- Ehresmann, B., et al. (2021). Natural radiation shielding on Mars measured with the MSL/RAD instrument. Journal of Geophysical Research: Planets.
- Curiosity parked beside Murray Butte, where the terrain blocked about 19 percent of the sky against about 10 percent on open ground, and the dose fell by about 4 to 5 percent.

### Curiosity RAD reduced data

- URL: https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/DATA/SOL_04134_04257/ (NASA Planetary Data System, Planetary Plasma Interactions node)
- Fetched and summarised by `tools/fetch_rad.py`. The summary uses detector E (plastic, closer to tissue); both B and E are kept.
- NASA's public figure for the event: https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm/

### DONKI

- URL: https://api.nasa.gov/DONKI/WSAEnlilSimulations (NASA Open APIs; the demo key allows 30 requests an hour)
- Fetched by `tools/fetch_donki.py` for 10 to 25 May 2024 and for the 10 days up to the demo time.

### MSL weather feed

- URL: https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json
- Provided by Centro de Astrobiologia (CAB) for outreach use only; REMS science data is in the Planetary Data System. Fetched by `tools/fetch_rems.py`; the feed's disclaimer is kept in the cache and the briefing.

### NASA Image and Video Library

- URL: https://images-api.nasa.gov/search
- Fetched by `tools/fetch_stop_images.py` with the queries "Curiosity Quela drill" and "Curiosity Murray Buttes". Images are credited NASA/JPL-Caltech/MSSS, as given per image.
