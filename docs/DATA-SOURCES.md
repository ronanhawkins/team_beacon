# Data sources and provenance

Real terrain assets for the team's agreed crop are now in `data/out/terrain/` and committed for the hub. The AR ring still uses the synthetic waypoint fixture and requires no raster downloads. Only raw downloads are ignored by Git.

## Agreed terrain crop

- DEM: `https://planetarymaps.usgs.gov/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif`; source window `[12064, 32026, 3000, 3000]`, at 1 m/pixel.
- Colour: `https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_HiRISE-LRGB_78quads_sharp_cog.tif`.
- Bounds (xmin, ymin, xmax, ymax): `[8140057.492786, -279807.075189, 8143057.492786, -276807.075189]` in the Mars equirectangular metre CRS.
- Derived files: 750-square averaged Float32 height grid, 4096- and 2048-square JPEG colour textures, all covering the same 3 km square. Metadata and instructions are in `data/out/terrain/`.
- The team specifies the crop centre as parking position, with height -4379.5 m. This is not independently verified as Curiosity's measurement location.
- Reproduction: `python tools/prepare-buttes.py`. Rasterio uses GDAL for raster reads/resampling; original 1 m data remains `data/raw/near.tif`.

## Candidate panorama

[NASA: Rover's Panorama Taken Amid “Murray Buttes”](https://science.nasa.gov/resource/rovers-panorama-taken-amid-murray-buttes-on-mars/)

- Credit: NASA/JPL-Caltech/MSSS.
- Mastcam images acquired 4 September 2016, sol 1451; rover at the position reached on the sol 1448 drive.
- NASA identifies north at both ends and south in the middle.
- The listed original is 15000 × 4272, not a complete 2:1 spherical panorama. Do not map it directly to a full sphere without verifying the projection, vertical field of view and horizon placement.
- Candidate only: Ronan's exact parking spot is not yet agreed. It cannot currently prove that the computed skyline matches the observing location.
- Not downloaded or used as the prototype background. The gradient/silhouette is generated from fake waypoints.

## Terrain and orthorectified imagery

[NASA PDS HiRISE DTM dataset](https://pds.nasa.gov/ds-view/pds/viewDataset.jsp?dsid=MRO-M-HIRISE-5-DTM-V1.0) contains terrain models and corresponding orthoimages. Start from the [HiRISE DTM catalogue](https://www.uahirise.org/dtm/) and [official DTM usage guide](https://hirise.lpl.arizona.edu/dtm/howto.php).

An observation showing Murray Buttes is not sufficient: choose a DTM whose footprint covers the agreed parking point and crop, plus a corresponding **orthoimage**. A browse image, hillshade, unrectified image or unrelated Gale Crater DTM is not a substitute. The team must agree planetary CRS and elevation units. HiRISE's `.IMG` terrain is a PDS raster, not a disk image.

The agreed mosaic crop above is the current handoff; do not substitute a separate DTM footprint. The generic `tools/export-terrain.py` remains available for future projected DTM/ortho pairs. Its GLB metadata explicitly records its own centred render origin; do not assume it uses the raw-grid southwest origin.

## Scientific checks still pending

The task brief cites 19% blocked sky beside a butte and 10% on an open plain. These are **team-provided targets**, not independently verified measurements in this starter. Before presenting them as proof, identify the original publication, observation/parking locations, angular definition and sampling method. Do not tune synthetic skylines to those values and label the result validated.
