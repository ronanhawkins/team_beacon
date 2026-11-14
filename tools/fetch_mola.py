#!/usr/bin/env python3
"""Fetch the MOLA terrain crop used for the distant horizon.

Writes data/raw/mola.bin and mola.hdr (not committed): a 600 km square of the
global MOLA mosaic (Mars Global Surveyor, 463 m per pixel) centred on the site,
in the same projection as the Gale mosaic. Needs gdal_translate on the PATH.
The window and command are recorded in data/site.json under "molaCrop".

    python3 tools/fetch_mola.py [--force] [--site <name>]

With --site <name> (or SITE=<name>) it reads data/sites/<name>/site.json and writes data/raw/<name>/mola.bin.
"""
import json
import os
import shlex
import subprocess
import sys

from sitepaths import site_paths

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = site_paths()


def main():
    with open(P.site_json) as f:
        crop = json.load(f)["molaCrop"]
    os.makedirs(P.raw, exist_ok=True)
    out = os.path.relpath(os.path.join(P.raw, "mola.bin"), ROOT)
    if os.path.exists(out) and "--force" not in sys.argv:
        print("%s already exists; pass --force to fetch again" % out)
        return 0
    w = crop["srcwin"]
    cmd = ["gdal_translate", "-srcwin", str(w["xoff"]), str(w["yoff"]), str(w["xsize"]), str(w["ysize"]),
           "-of", "ENVI", "-ot", "Float32", "/vsicurl/" + crop["url"], out]
    print(" ".join(shlex.quote(c) for c in cmd))
    return subprocess.call(cmd, cwd=ROOT)


if __name__ == "__main__":
    sys.exit(main())
