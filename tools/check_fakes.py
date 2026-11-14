"""Check waypoint and state files against the contracts in shared/.

Usage: python3 tools/check_fakes.py                     shared/fake/ (waypoints and both state files)
       python3 tools/check_fakes.py data/out/waypoints.json   any waypoint file on its own
(standard library only)

For a real waypoint file openSky may differ from the 72-value formula by up to
0.02, because the engine computes it from 360 directions. State files are only
checked with the fakes.

Field names are read from the tables in shared/state.md and shared/waypoints.md,
so a field added to a contract shows up here as missing until the fakes have it.
Exits non-zero if any check fails.
"""

import json
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHARED = ROOT / "shared"
FAKE = SHARED / "fake"

SAMPLES = 72
OPEN_SKY_TOLERANCE_FAKE = 0.005
OPEN_SKY_TOLERANCE_REAL = 0.02

results = []


def check(name, problems):
    results.append((name, problems))
    status = "PASS" if not problems else "FAIL"
    print(f"[{status}] {name}")
    for p in problems[:10]:
        print(f"         - {p}")
    if len(problems) > 10:
        print(f"         - ... and {len(problems) - 10} more")


def contract_fields(md_path, section):
    """{field: [subfields]} from the table under '## <section>' in a contract file."""
    text = md_path.read_text()
    m = re.search(rf"^## {re.escape(section)}\s*$(.*?)(?=^## |\Z)", text, re.M | re.S)
    if not m:
        raise SystemExit(f"cannot find '## {section}' in {md_path}")
    fields = {}
    for line in m.group(1).splitlines():
        row = re.match(r"\|\s*`([^`]+)`\s*\|\s*([^|]*)\|", line)
        if not row:
            continue
        name, typ = row.group(1), row.group(2)
        sub = re.search(r"\{([^}]*)\}", typ)
        fields[name] = [s.strip() for s in sub.group(1).split(",")] if sub else []
    return fields


def missing_fields(obj, fields, where):
    out = []
    for name, subs in fields.items():
        if name not in obj:
            out.append(f"{where}: missing '{name}'")
            continue
        for s in subs:
            if not isinstance(obj[name], dict) or s not in obj[name]:
                out.append(f"{where}: missing '{name}.{s}'")
    return out


def nearest_index(az):
    return int(az / (360 / SAMPLES) + 0.5) % SAMPLES


def open_sky(sky):
    return 1 - sum(math.sin(math.radians(max(0.0, e))) for e in sky) / len(sky)


def load(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as e:
        check(f"load {path}", [str(e)])
        return None


def main(argv):
    wp_path = Path(argv[1]) if len(argv) > 1 else FAKE / "waypoints.json"
    is_fake = wp_path.resolve() == (FAKE / "waypoints.json").resolve()
    tolerance = OPEN_SKY_TOLERANCE_FAKE if is_fake else OPEN_SKY_TOLERANCE_REAL
    print(f"Checking {wp_path}" + ("" if is_fake else " (real file: openSky tolerance 0.02, no state files)"))
    wp_doc = load(wp_path)
    states = {n: load(FAKE / n) for n in ("state.json", "state-storm.json")} if is_fake else {}
    if wp_doc is None or None in states.values():
        return 1

    all_wps = [("main", i, w) for i, w in enumerate(wp_doc.get("main", []))]
    for key, route in wp_doc.get("reroutes", {}).items():
        all_wps += [(f"reroutes[{key}]", i, w) for i, w in enumerate(route)]

    def label(route, i, w):
        return f"{route}[{i}] {w.get('id', '?')}"

    # Fields named in the contracts are present.
    top = contract_fields(SHARED / "waypoints.md", "Top level")
    wpf = contract_fields(SHARED / "waypoints.md", "Waypoint")
    stf = contract_fields(SHARED / "state.md", "Fields")
    problems = missing_fields(wp_doc, top, "waypoints.json")
    for r, i, w in all_wps:
        problems += missing_fields(w, wpf, label(r, i, w))
    check(f"waypoints.json has every field in waypoints.md ({len(top)} top-level, {len(wpf)} per waypoint)",
          problems)
    if states:
        problems = []
        for name, st in states.items():
            problems += missing_fields(st, stf, name)
        check(f"state files have every field in state.md ({len(stf)})", problems)

    # 72 values per skyline.
    problems = []
    if wp_doc.get("skylineSamples") != SAMPLES:
        problems.append(f"skylineSamples is {wp_doc.get('skylineSamples')}, expected {SAMPLES}")
    for r, i, w in all_wps:
        n = len(w.get("skyline", []))
        if n != SAMPLES:
            problems.append(f"{label(r, i, w)}: {n} skyline values")
    check(f"every skyline has {SAMPLES} values", problems)

    # Fractions between 0 and 1.
    problems = []
    for r, i, w in all_wps:
        for f in ("openSky", "doseFraction", "oxygenFraction"):
            v = w.get(f)
            if not isinstance(v, (int, float)) or not 0 <= v <= 1:
                problems.append(f"{label(r, i, w)}: {f} = {v}")
    for name, st in states.items():
        for f in ("openSky", "doseFraction", "oxygenFraction"):
            v = st.get(f)
            if not isinstance(v, (int, float)) or not 0 <= v <= 1:
                problems.append(f"{name}: {f} = {v}")
    check("all fractions are between 0 and 1", problems)

    # openSky matches the skyline.
    problems = []
    for r, i, w in all_wps:
        sky = w.get("skyline", [])
        if len(sky) == SAMPLES:
            expected = open_sky(sky)
            if abs(w.get("openSky", -1) - expected) > tolerance:
                problems.append(f"{label(r, i, w)}: openSky {w.get('openSky')}, skyline gives {expected:.3f}")
    check(f"openSky = 1 - mean(sin(skyline)) within {tolerance}", problems)

    # Sun and Earth visibility matches the skyline.
    problems = []
    for r, i, w in all_wps:
        sky = w.get("skyline", [])
        if len(sky) != SAMPLES:
            continue
        for body in ("sun", "earth"):
            b = w.get(body, {})
            if not {"az", "el", "visible"} <= b.keys():
                continue
            expected = b["el"] > sky[nearest_index(b["az"])]
            if b["visible"] != expected:
                problems.append(f"{label(r, i, w)}: {body}.visible {b['visible']}, skyline says {expected}")
    check("sun.visible and earth.visible match the skyline", problems)

    # Every main index has a reroute.
    reroutes = wp_doc.get("reroutes", {})
    problems = [f"no reroute for main index {i}" for i in range(len(wp_doc.get("main", [])))
                if str(i) not in reroutes or not reroutes[str(i)]]
    check("every main index has a reroute", problems)

    if not states:
        return finish()

    # rerouteFrom is null on the main route and names an existing reroute otherwise.
    problems = []
    for name, st in states.items():
        rf = st.get("rerouteFrom")
        if st.get("route") == "main" and rf is not None:
            problems.append(f"{name}: route is main but rerouteFrom is {rf}")
        if st.get("route") == "reroute" and (not isinstance(rf, int) or isinstance(rf, bool) or str(rf) not in reroutes):
            problems.append(f"{name}: route is reroute but rerouteFrom is {rf!r}, not a reroutes key")
    check("rerouteFrom is null on main and a reroutes key on a reroute", problems)

    # Derived state fields match the waypoint they were taken from.
    sources = {
        "state.json": wp_doc["main"][states["state.json"]["waypointIndex"]]
        if states["state.json"].get("route") == "main" else None,
        "state-storm.json": reroutes.get(str(states["state-storm.json"].get("rerouteFrom")), [None])[
            states["state-storm.json"].get("waypointIndex", 0)],
    }
    mapping = {
        "headingDeg": lambda w: w["headingDeg"],
        "shelterBearingDeg": lambda w: w["shelter"]["az"],
        "minutesToShelter": lambda w: w["shelter"]["minutes"],
        "openSky": lambda w: w["openSky"],
        "doseFraction": lambda w: w["doseFraction"],
        "oxygenFraction": lambda w: w["oxygenFraction"],
        "sunlit": lambda w: w["sun"]["visible"],
        "baseLink": lambda w: w["base"]["visible"],
        "earthLink": lambda w: w["earth"]["visible"],
    }
    problems = []
    for name, wp in sources.items():
        if wp is None:
            problems.append(f"{name}: cannot find its source waypoint")
            continue
        for field, get in mapping.items():
            if states[name].get(field) != get(wp):
                problems.append(f"{name}: {field} {states[name].get(field)}, waypoint {wp['id']} has {get(wp)}")
    check("state derived fields match their waypoint (main[0], reroutes[rerouteFrom][0])", problems)
    return finish()


def finish():
    failed = sum(1 for _, p in results if p)
    print()
    print(f"{len(results) - failed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
