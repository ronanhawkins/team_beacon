# tools

**Owner:** Ronan

Small one-off scripts that support the rest of the repo.

Files that will probably live here:

- a script to download the raw terrain data into `data/raw/`
- a script to generate local TLS certificates into `relay/certs/`

## Sites

The site-dependent scripts take `--site <name>` or `SITE=<name>` (see `data/README.md`); `sitepaths.py` resolves the
paths the same way the engine does. With neither, they work on Gale exactly as before.

- `fetch_mola.py`, `fetch_stop_images.py`, `fetch_rems.py`, `export-terrain.py`, `check_fakes.py`: use the site's folders.
- `fetch_donki.py`: reads the site's sky time; its cache is shared by every site.
- `fetch_rad.py`: accepts the option; the RAD storm is site-independent.
- `prepare-buttes.py`: Gale only (its DEM, image and window are fixed); it refuses a site.
- `fake_scene.py`, `make_fake_layers.py`, `make_fake_waypoints.py`: write the shared fakes in `shared/fake/`, which belong to no site.
