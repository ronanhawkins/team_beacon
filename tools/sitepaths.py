"""Which site a tool works on, and where that site's files are. Same rule as the engine (engine/src/main.rs).

No site (the default, Gale): data/site.json, data/raw/, data/out/, caches in data/cache/.
SITE=<name> in the environment, or --site <name> on the command line (which wins):
    data/sites/<name>/site.json, data/raw/<name>/, data/out/<name>/,
    site-specific caches in data/cache/<name>/; site-independent caches (RAD storm, DONKI) stay in data/cache/.

    from sitepaths import site_paths
    P = site_paths()          # also removes "--site <name>" from sys.argv so the tool's own parsing is unchanged
    P.site_json, P.raw, P.out, P.cache_shared, P.cache_site, P.name

Standard library only.
"""
import os
import re
import sys
from collections import namedtuple

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SitePaths = namedtuple("SitePaths", "name site_json raw out cache_shared cache_site")


def site_paths(argv=None):
    argv = sys.argv if argv is None else argv
    name = os.environ.get("SITE") or None
    if "--site" in argv:
        i = argv.index("--site")
        if i + 1 >= len(argv):
            sys.exit("--site needs a name")
        name = argv[i + 1]
        del argv[i:i + 2]
    data = os.path.join(ROOT, "data")
    cache = os.path.join(data, "cache")
    if not name:
        return SitePaths(None, os.path.join(data, "site.json"), os.path.join(data, "raw"), os.path.join(data, "out"), cache, cache)
    if not re.fullmatch(r"[A-Za-z0-9_-]+", name):
        sys.exit("site name %r must be letters, digits, - or _" % name)
    site_json = os.path.join(data, "sites", name, "site.json")
    if not os.path.exists(site_json):
        sys.exit("no site file at %s for site %r" % (os.path.relpath(site_json, ROOT), name))
    return SitePaths(name, site_json, os.path.join(data, "raw", name), os.path.join(data, "out", name), cache, os.path.join(cache, name))
