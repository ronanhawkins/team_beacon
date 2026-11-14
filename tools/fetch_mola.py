#!/usr/bin/env python3
"""Fetch the MOLA terrain crop used for the distant horizon.

Writes data/raw/mola.bin and mola.hdr (not committed): a 600 km square of the
global MOLA mosaic (Mars Global Surveyor, 463 m per pixel) centred on the site,
in the same projection as the Gale mosaic. Needs gdal_translate on the PATH.
The window and command are recorded in data/site.json under "molaCrop".

    python3 tools/fetch_mola.py [--force]
"""
import json
import os
import shlex
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    with open(os.path.join(ROOT, "data", "site.json")) as f:
        crop = json.load(f)["molaCrop"]
    out = os.path.join(ROOT, "data", "raw", "mola.bin")
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
