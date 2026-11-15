# engine

**Owner:** Ronan

Rust crate that reads real Mars terrain, computes a skyline (terrain elevation angle per compass direction) for points on it, and derives open-sky fraction (radiation exposure), sunlight, and line of sight to base and Earth. Writes results to `data/out/`.

Files that will probably live here:

- `src/main.rs`: command-line entry point
- `src/terrain.rs`: loading and sampling the DEM
- `src/skyline.rs`: horizon elevation per azimuth
- `src/layers.rs`: open-sky fraction, sunlight, line of sight
- `src/export.rs`: writing files into `data/out/`

## Sites

No site set: Gale, from `data/site.json` and `data/raw/` into `data/out/`. `SITE=<name>` or `--site <name>` (on any
command) uses `data/sites/<name>/site.json`, `data/raw/<name>/` and `data/out/<name>/` instead; see `data/README.md`
for the files and the site-file sections the engine reads.

## Custom plans

`engine plan --stops "x,y;x,y,label;...;x,y" --out <dir>` plans a route through other points, in local metres, into
`<dir>` instead of `data/out/`. The first point is the start and the last the end; the points between are science
stops, named by the optional label or "Stop N" (labels cannot contain `;` or `,`). The relay runs this when the hub's
Plan screen asks for a route (`relay/README.md`, Planning).
