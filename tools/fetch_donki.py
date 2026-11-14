#!/usr/bin/env python3
"""DONKI: Mars-directed space weather forecasts (NASA CCMC WSA-Enlil simulations).

Makes two calls to the DONKI WSAEnlilSimulations endpoint and keeps every
impact on Mars: 2024-05-10 to 2024-05-25 (the May 2024 storm) and the 10 days
up to sky.timeUT in data/site.json. Writes data/cache/donki_mars.json
(committed), so the engine needs no network.

The demo key allows 30 requests an hour, so the script does nothing when the
cache exists unless --force is given. Set NASA_API_KEY to use your own key.

    python3 tools/fetch_donki.py [--force]

Standard library only.
"""
import datetime
import json
import os
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "cache", "donki_mars.json")
ENDPOINT = "https://api.nasa.gov/DONKI/WSAEnlilSimulations"
HEADERS = {"User-Agent": "beacon-fetch/1.0"}


def fetch(start, end, key):
    query = urllib.parse.urlencode({"startDate": start, "endDate": end, "api_key": key})
    req = urllib.request.Request(ENDPOINT + "?" + query, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=120) as r:
        body = r.read().decode("utf-8")
    return json.loads(body) if body.strip() else []


def mars_impacts(sims):
    out = []
    for sim in sims or []:
        for impact in sim.get("impactList") or []:
            if impact.get("location") == "Mars":
                out.append({
                    "arrivalTime": impact.get("arrivalTime"),
                    "isGlancingBlow": impact.get("isGlancingBlow"),
                    "modelCompletionTime": sim.get("modelCompletionTime"),
                    "simulationID": sim.get("simulationID"),
                    "link": sim.get("link"),
                })
    return sorted(out, key=lambda i: i["arrivalTime"] or "")


def main():
    if os.path.exists(CACHE) and "--force" not in sys.argv:
        print("%s already exists; pass --force to call DONKI again" % CACHE)
        return 0
    with open(os.path.join(ROOT, "data", "site.json")) as f:
        time_ut = json.load(f)["sky"]["timeUT"]
    sky_day = datetime.datetime.strptime(time_ut, "%Y-%m-%d %H:%M").date()
    key = os.environ.get("NASA_API_KEY", "DEMO_KEY")
    windows = [
        ("may2024", "2024-05-10", "2024-05-25"),
        ("beforeSkyTime", (sky_day - datetime.timedelta(days=10)).isoformat(), sky_day.isoformat()),
    ]
    out = {
        "version": 1,
        "source": ENDPOINT,
        "provider": "NASA Community Coordinated Modeling Center (CCMC), DONKI",
        "fetchedUT": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%MZ"),
        "skyTimeUT": time_ut,
        "note": "WSA-Enlil simulations of coronal mass ejections; only impacts with location Mars are kept",
        "windows": {},
    }
    for name, start, end in windows:
        sims = fetch(start, end, key)
        impacts = mars_impacts(sims)
        out["windows"][name] = {"startDate": start, "endDate": end, "simulations": len(sims or []), "marsImpacts": impacts}
        print("%s %s..%s: %d simulations, %d Mars impacts" % (name, start, end, len(sims or []), len(impacts)))
        for i in impacts:
            print("  arrival %s  glancing %s  model done %s" % (i["arrivalTime"], i["isGlancingBlow"], i["modelCompletionTime"]))
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print("wrote", CACHE)
    return 0


if __name__ == "__main__":
    sys.exit(main())
