# Data sources and provenance

No NASA terrain is included in the current synthetic headset demo. Raw downloads and generated terrain assets are ignored by Git.

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

After agreement, save original files under `data/raw/`, record product URLs/IDs and crop in `data/site.json`, and retain the full-resolution height data for the engine. `tools/export-terrain.py` produces a compact visual GLB with the image aligned to identical bounds, metre coordinates and provenance metadata.

## Scientific checks still pending

The task brief cites 19% blocked sky beside a butte and 10% on an open plain. These are **team-provided targets**, not independently verified measurements in this starter. Before presenting them as proof, identify the original publication, observation/parking locations, angular definition and sampling method. Do not tune synthetic skylines to those values and label the result validated.
