# engine

**Owner:** Ronan

Rust crate that reads real Mars terrain, computes a skyline (terrain elevation angle per compass direction) for points on it, and derives open-sky fraction (radiation exposure), sunlight, and line of sight to base and Earth. Writes results to `data/out/`.

Files that will probably live here:

- `src/main.rs`: command-line entry point
- `src/terrain.rs`: loading and sampling the DEM
- `src/skyline.rs`: horizon elevation per azimuth
- `src/layers.rs`: open-sky fraction, sunlight, line of sight
- `src/export.rs`: writing files into `data/out/`
