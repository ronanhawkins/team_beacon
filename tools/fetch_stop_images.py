#!/usr/bin/env python3
"""Curiosity images for the science stops, from the NASA Image and Video Library.

Searches https://images-api.nasa.gov/search?q=<query>&media_type=image and keeps
up to 3 relevant results per query, in the library's order. The queries are the site file's
"stopImageQueries"; at Gale:

  - "Curiosity Quela drill"   -> the quela stop
  - "Curiosity Murray Buttes" -> the sol1448 stop (Butte outcrop)

Relevant means: the title or description names the place (the query's "mustName",
here "Quela" or "Murray Buttes"), and it is a photograph, not a graphic, map or chart. An image
already kept for an earlier query is not repeated. Fewer than 3 are kept when
fewer are relevant.

Writes data/cache/stop_images.json (committed) and downloads each thumbnail to
data/out/media/<nasa_id>.jpg.

    python3 tools/fetch_stop_images.py [--force] [--site <name>]

With --site <name> (or SITE=<name>) it reads data/sites/<name>/site.json and writes
data/cache/<name>/stop_images.json and data/out/<name>/media/.

Standard library only.
"""
import datetime
import json
import os
import re
import sys
import urllib.parse
import urllib.request

from sitepaths import site_paths

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = site_paths()
CACHE = os.path.join(P.cache_site, "stop_images.json")
MEDIA = os.path.join(P.out, "media")
SEARCH = "https://images-api.nasa.gov/search"
HEADERS = {"User-Agent": "beacon-fetch/1.0"}
KEEP = 3
with open(P.site_json) as _f:
    QUERIES = json.load(_f).get("stopImageQueries", [])
# Descriptions that start like this are graphics, not photographs.
NOT_A_PHOTO = re.compile(r"\b(graphic|map|maps|chart|charts|graphed|diagram)\b", re.I)


def get(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def clean(text):
    return " ".join((text or "").split())


def is_photo(description):
    # Look only at the opening sentence, where the library says what the image is.
    first = clean(description).replace("Original Caption Released with Image:", "").strip()
    first = first.split(". ")[0]
    return not NOT_A_PHOTO.search(first)


def main():
    if os.path.exists(CACHE) and "--force" not in sys.argv:
        print("%s already exists; pass --force to search again" % CACHE)
        return 0
    os.makedirs(MEDIA, exist_ok=True)
    used = set()
    out = {
        "version": 1,
        "source": SEARCH,
        "provider": "NASA Image and Video Library",
        "fetchedUT": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%MZ"),
        "rule": "Up to %d per query, in the library's order: names the place, is a photograph (not a graphic, map or chart), not already kept for an earlier query" % KEEP,
        "stops": {},
    }
    for q in QUERIES:
        url = SEARCH + "?" + urllib.parse.urlencode({"q": q["query"], "media_type": "image"})
        items = json.loads(get(url).decode("utf-8"))["collection"]["items"]
        kept, skipped = [], []
        for it in items:
            m = it["data"][0]
            nasa_id, title, desc = m["nasa_id"], clean(m.get("title")), clean(m.get("description"))
            why = None
            if q["mustName"].lower() not in (title + " " + desc).lower():
                why = "does not name %s" % q["mustName"]
            elif not is_photo(desc):
                why = "graphic, map or chart"
            elif nasa_id in used:
                why = "already kept for an earlier stop"
            if why:
                skipped.append({"nasa_id": nasa_id, "title": title, "why": why})
                continue
            thumb = next((l["href"] for l in it.get("links", []) if l.get("rel") == "preview"), None)
            if not thumb:
                skipped.append({"nasa_id": nasa_id, "title": title, "why": "no thumbnail"})
                continue
            file_name = "%s.jpg" % nasa_id
            with open(os.path.join(MEDIA, file_name), "wb") as f:
                f.write(get(thumb))
            kept.append({
                "nasa_id": nasa_id,
                "title": title,
                "date": (m.get("date_created") or "")[:10],
                "description": desc,
                "credit": clean(m.get("secondary_creator") or m.get("photographer") or m.get("center")),
                "thumbnailUrl": thumb,
                "file": "media/" + file_name,
                "page": "https://images.nasa.gov/details/%s" % urllib.parse.quote(nasa_id),
            })
            used.add(nasa_id)
            if len(kept) == KEEP:
                break
        out["stops"][q["stop"]] = {"query": q["query"], "results": len(items), "images": kept, "skipped": skipped}
        print("%s (%r): %d results, kept %s" % (q["stop"], q["query"], len(items), [k["nasa_id"] for k in kept]))
        for s in skipped:
            print("  skipped %s: %s" % (s["nasa_id"], s["why"]))
    with open(CACHE, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print("wrote", CACHE, "and thumbnails in", MEDIA)
    return 0


if __name__ == "__main__":
    sys.exit(main())
