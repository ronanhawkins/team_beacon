#!/usr/bin/env python3
"""Curiosity REMS weather at Gale, from the public MSL weather feed.

Fetches https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json
and writes the latest 30 sols, with the feed's English disclaimer, to
data/cache/rems.json (committed). The feed is provided by Centro de
Astrobiologia (CAB) for outreach use; REMS science data is in the PDS.

    python3 tools/fetch_rems.py [--force]

Standard library only.
"""
import datetime
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "cache", "rems.json")
URL = "https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json"
HEADERS = {"User-Agent": "beacon-fetch/1.0"}
KEEP = 30


def main():
    if os.path.exists(CACHE) and "--force" not in sys.argv:
        print("%s already exists; pass --force to fetch again" % CACHE)
        return 0
    req = urllib.request.Request(URL, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=120) as r:
        feed = json.loads(r.read().decode("utf-8", "replace"))
    soles = sorted(feed["soles"], key=lambda s: int(s["sol"]), reverse=True)[:KEEP]
    disclaimer = " ".join(feed["descriptions"]["disclaimer_en"].split())
    out = {
        "version": 1,
        "source": URL,
        "provider": "Centro de Astrobiologia (CAB), Curiosity Rover Environmental Monitoring Station (REMS)",
        "disclaimer": disclaimer,
        "fetchedUT": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%MZ"),
        "units": {"temperature": "degrees C", "pressure": "Pa", "sunrise and sunset": "local Mars time at the rover, as given by the feed"},
        "note": "Values are strings as the feed gives them; \"--\" means not available",
        "soles": soles,
    }
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    latest = soles[0]
    print("latest sol %s, Earth date %s, %d sols kept" % (latest["sol"], latest["terrestrial_date"], len(soles)))
    print("wrote", CACHE)
    return 0


if __name__ == "__main__":
    sys.exit(main())
