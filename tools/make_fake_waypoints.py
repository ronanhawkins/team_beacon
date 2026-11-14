"""Generate shared/fake/waypoints.json, state.json and state-storm.json.

Usage: python3 tools/make_fake_waypoints.py

Every number comes from the scene in fake_scene.py, so skylines, openSky,
visibility flags and shelter fields agree with each other.
"""

import json
from pathlib import Path

import fake_scene as S

OUT = Path(__file__).resolve().parent.parent / "shared" / "fake"

MAIN_COUNT = 6
LEG_M = 40.0
SCIENCE_STOP = 2
MAIN_LABELS = ["Open plain", "Plain", "Science stop", "Approach", "Butte foot", "Butte shelter"]


def main_positions():
    """Walk in towards the butte, curving slightly, ending at the shelter."""
    shelter_dist = S.BUTTE_RADIUS + S.SHELTER_GAP
    out = []
    for i in range(MAIN_COUNT):
        steps_left = MAIN_COUNT - 1 - i
        az_from_butte = S.SHELTER_BEARING_FROM_BUTTE - 4.0 * steps_left
        out.append(S.offset(S.BUTTE_CENTRE, az_from_butte, shelter_dist + LEG_M * steps_left))
    return out


def headings(positions, last_heading=None):
    out = []
    for i, p in enumerate(positions):
        if i + 1 < len(positions):
            out.append(S.bearing(p, positions[i + 1]))
        elif out:
            out.append(out[-1])  # no next point: keep the previous heading
        else:
            out.append(last_heading)
    return out


def shelter_info(pos):
    d = S.distance(pos, S.SHELTER_POS)
    if d < 1e-6:
        # At the shelter: point at the butte wall it shelters behind.
        return {"az": round(S.bearing(pos, S.BUTTE_CENTRE), 1), "distance": 0.0, "minutes": 0.0}
    return {
        "az": round(S.bearing(pos, S.SHELTER_POS), 1),
        "distance": round(d, 1),
        "minutes": round(d / S.WALK_SPEED_M_PER_MIN, 1),
    }


def make_waypoint(wid, label, pos, heading, minutes, dose, oxygen, is_shelter, is_science):
    sky = S.skyline(pos)
    return {
        "id": wid,
        "label": label,
        "pos": {"x": round(pos[0], 1), "y": round(pos[1], 1), "z": round(S.terrain_z(pos), 1)},
        "headingDeg": round(heading, 1),
        "skyline": sky,
        "openSky": round(S.open_sky(sky), 3),
        "sun": {**S.SUN, "visible": S.clears(sky, S.SUN["az"], S.SUN["el"])},
        "earth": {**S.EARTH, "visible": S.clears(sky, S.EARTH["az"], S.EARTH["el"])},
        "base": {
            "az": round(S.bearing(pos, S.BASE_POS), 1),
            "distance": round(S.distance(pos, S.BASE_POS), 1),
            "visible": S.base_visible(pos),
        },
        "shelter": shelter_info(pos),
        "minutesFromStart": round(minutes, 1),
        "doseFraction": round(dose, 3),
        "oxygenFraction": round(oxygen, 3),
        "isShelter": is_shelter,
        "isScienceStop": is_science,
    }


def walk(positions, start_minutes, start_dose, dwell_at=None):
    """Cumulative minutes and dose along a list of positions."""
    minutes, dose = [start_minutes], [start_dose]
    for i in range(1, len(positions)):
        a, b = positions[i - 1], positions[i]
        dt = S.distance(a, b) / S.WALK_SPEED_M_PER_MIN
        if dwell_at is not None and i - 1 == dwell_at:
            dt += S.SCIENCE_STOP_DWELL_MIN
        sky_mean = (S.open_sky(S.skyline(a)) + S.open_sky(S.skyline(b))) / 2
        minutes.append(minutes[-1] + dt)
        dose.append(dose[-1] + S.DOSE_PER_MIN_OPEN_SKY * sky_mean * dt)
    return minutes, dose


def oxygen(minutes):
    return 1 - S.OXYGEN_PER_MIN * minutes


def build():
    pos = main_positions()
    head = headings(pos)
    mins, dose = walk(pos, 0.0, 0.0, dwell_at=SCIENCE_STOP)
    main = [
        make_waypoint(f"m{i:02d}", MAIN_LABELS[i], pos[i], head[i], mins[i], dose[i],
                      oxygen(mins[i]), i == MAIN_COUNT - 1, i == SCIENCE_STOP)
        for i in range(MAIN_COUNT)
    ]

    reroutes = {}
    for n in range(MAIN_COUNT):
        count = 3 if n <= 3 else (2 if n == 4 else 1)
        if count == 1:
            rpos = [S.SHELTER_POS]
        else:
            a, b = pos[n], S.SHELTER_POS
            rpos = [(a[0] + (b[0] - a[0]) * k / (count - 1), a[1] + (b[1] - a[1]) * k / (count - 1))
                    for k in range(count)]
        rhead = headings(rpos, last_heading=head[n])
        rmins, rdose = walk(rpos, mins[n], dose[n])
        reroutes[str(n)] = [
            make_waypoint(f"r{n:02d}-{k:02d}", "Butte shelter" if k == count - 1 else "",
                          rpos[k], rhead[k], rmins[k], rdose[k], oxygen(rmins[k]),
                          k == count - 1, False)
            for k in range(count)
        ]

    return {"version": 1, "skylineSamples": S.SKYLINE_SAMPLES, "main": main, "reroutes": reroutes}


def state_from(wp, route, index, mode, storm, reroute_from=None):
    return {
        "version": 1,
        "route": route,
        "waypointIndex": index,
        "rerouteFrom": reroute_from,
        "mode": mode,
        "storm": storm,
        "panic": False,
        "rerouteRequested": False,
        "headingDeg": wp["headingDeg"],
        "shelterBearingDeg": wp["shelter"]["az"],
        "minutesToShelter": wp["shelter"]["minutes"],
        "openSky": wp["openSky"],
        "doseFraction": wp["doseFraction"],
        "oxygenFraction": wp["oxygenFraction"],
        "sunlit": wp["sun"]["visible"],
        "baseLink": wp["base"]["visible"],
        "earthLink": wp["earth"]["visible"],
        "earthDelayMinutes": S.EARTH_DELAY_MINUTES,
    }


def sanity(doc):
    """Fail loudly if the scene drifts away from the brief."""
    m = doc["main"]
    assert all(1.0 <= v <= 3.0 for v in m[0]["skyline"]), "wp0 skyline must be 1-3 deg"
    assert m[0]["sun"]["visible"] and m[0]["earth"]["visible"] and m[0]["base"]["visible"]
    w5 = m[5]
    assert 34.0 <= max(w5["skyline"]) <= 36.0, max(w5["skyline"])
    raised = sum(1 for v in w5["skyline"] if v > 5.0) * S.AZ_STEP
    assert 100 <= raised <= 130, raised
    assert w5["sun"]["visible"] and not w5["earth"]["visible"] and not w5["base"]["visible"]
    # Keep Sun and Earth at least 1 deg off the skyline so rounding can't flip a flag.
    for wp in m + [w for r in doc["reroutes"].values() for w in r]:
        for body in ("sun", "earth"):
            b = wp[body]
            assert abs(b["el"] - wp["skyline"][S.nearest_index(b["az"])]) >= 1.0, (wp["id"], body)


def write(path, obj):
    path.write_text(json.dumps(obj, indent=2) + "\n")
    print(f"wrote {path.relative_to(OUT.parent.parent)}")


if __name__ == "__main__":
    doc = build()
    sanity(doc)
    OUT.mkdir(parents=True, exist_ok=True)
    write(OUT / "waypoints.json", doc)
    write(OUT / "state.json", state_from(doc["main"][0], "main", 0, "nominal", False))
    write(OUT / "state-storm.json", state_from(doc["reroutes"]["3"][0], "reroute", 0, "storm", True, reroute_from=3))
