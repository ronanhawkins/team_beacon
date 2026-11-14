#!/usr/bin/env python3
"""Curiosity RAD: the 20 May 2024 solar storm, measured at Gale.

Downloads the RAD RDR label (.LBL) and data (.TXT, about 90 MB each) for
sol 4186 (quiet baseline) and sols 4190 and 4191 (the storm) from the PDS
Planetary Plasma Interactions node into data/raw/rad/ (not committed), then
writes the summary to data/cache/rad_storm.json (committed).

Each observation in a file has OBSnnn_TOT_DOSE_B and OBSnnn_TOT_DOSE_E
elements in microGray / Hour; the label gives their byte offsets in the .TXT.
Each observation's start time (START_OBS_UTC) and length (OBS_DURATION,
seconds) are in its [OBSERVATION: nn] header in the .TXT.

    python3 tools/fetch_rad.py           download what is missing, then summarise
    python3 tools/fetch_rad.py --offline summarise from data/raw/rad only

Standard library only.
"""
import datetime
import json
import os
import re
import statistics
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw", "rad")
CACHE = os.path.join(ROOT, "data", "cache", "rad_storm.json")
BASE_URL = "https://pds-ppi.igpp.ucla.edu/data/MSL-M-RAD-3-RDR-V1.0/DATA/SOL_04134_04257/"
# The server resets connections from clients without a browser-like User-Agent.
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; beacon-fetch/1.0)"}

BASELINE_SOL = 4186
STORM_SOLS = [4190, 4191]
ONSET_FACTOR = 1.5
# The engine caps the storm length at this many minutes (data/site.json storm.stormMinutesCap).
CAP_MINUTES = 240
# Detector used for the engine's numbers: E is the plastic scintillator, closer to tissue than B (silicon).
PRIMARY = "E"
NASA_REPORTED_UGY = 8100
NASA_SOURCE = "https://www.jpl.nasa.gov/news/nasa-watches-mars-light-up-during-epic-solar-storm/"


def get(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=600) as r:
        return r.read()


def listing():
    html = get(BASE_URL).decode("utf-8", "replace")
    return sorted(set(re.findall(r"RAD_RDR_\d{4}_\d{3}_\d{2}_\d{2}_(\d{4})_V00\.(?:LBL|TXT)", html))), html


def files_for(sol, html):
    names = sorted(set(re.findall(r"RAD_RDR_\d{4}_\d{3}_\d{2}_\d{2}_%04d_V00\.(?:LBL|TXT)" % sol, html)))
    if len(names) != 2:
        raise RuntimeError("sol %d: expected one .LBL and one .TXT in the listing, found %s" % (sol, names))
    return names


def download(sol, html):
    os.makedirs(RAW, exist_ok=True)
    for name in files_for(sol, html):
        path = os.path.join(RAW, name)
        if os.path.exists(path):
            continue
        print("downloading", name)
        data = get(BASE_URL + name)
        with open(path + ".part", "wb") as f:
            f.write(data)
        os.replace(path + ".part", path)


def local_files(sol):
    names = sorted(n for n in os.listdir(RAW) if re.match(r"RAD_RDR_.*_%04d_V00\.(LBL|TXT)$" % sol, n))
    lbl = [n for n in names if n.endswith(".LBL")]
    txt = [n for n in names if n.endswith(".TXT")]
    if len(lbl) != 1 or len(txt) != 1:
        raise RuntimeError("sol %d: need one .LBL and one .TXT in %s, found %s" % (sol, RAW, names))
    return os.path.join(RAW, lbl[0]), os.path.join(RAW, txt[0])


def parse_label(lbl_path):
    """{obs number: {"B": (byte offset, length), "E": ...}} from the label (offsets 1-based)."""
    text = open(lbl_path, encoding="ascii", errors="replace").read()
    out = {}
    pointer = re.compile(r"\^OBS(\d{3})_TOT_DOSE_([BE])_ELEMENT\s*=\s*\(\s*\"[^\"]+\"\s*,\s*(\d+)\s*<BYTES>\s*\)")
    for m in pointer.finditer(text):
        obs, det, offset = int(m.group(1)), m.group(2), int(m.group(3))
        body = text[m.end():text.index("END_OBJECT", m.end())]
        start = int(re.search(r"START_BYTE\s*=\s*(\d+)", body).group(1))
        length = int(re.search(r"BYTES\s*=\s*(\d+)", body).group(1))
        unit = re.search(r'UNIT\s*=\s*"([^"]+)"', body).group(1)
        if unit != "microGray / Hour":
            raise RuntimeError("%s: OBS%03d dose %s unit is %r" % (lbl_path, obs, det, unit))
        out.setdefault(obs, {})[det] = (offset + start - 1, length)
    return out


def parse_headers(txt_bytes):
    """{obs number: (start datetime UTC, duration seconds)} from the [OBSERVATION: nn] headers."""
    out = {}
    head = re.compile(rb"\[OBSERVATION: (\d+)\]\s*(.*?)\n\s*\n", re.S)
    for m in head.finditer(txt_bytes):
        fields = dict(re.findall(rb"(\w+)=\"?([^\"\n]*)\"?", m.group(2)))
        start = datetime.datetime.strptime(fields[b"START_OBS_UTC"].decode(), "%Y-%j %H:%M:%S")
        out[int(m.group(1))] = (start, int(fields[b"OBS_DURATION"]))
    return out


def read_sol(sol):
    lbl, txt = local_files(sol)
    data = open(txt, "rb").read()
    pointers = parse_label(lbl)
    headers = parse_headers(data)
    rows = []
    for obs in sorted(pointers):
        if obs not in headers:
            raise RuntimeError("sol %d: OBS%03d has dose elements but no header" % (sol, obs))
        start, duration = headers[obs]
        dose = {}
        for det, (offset, length) in pointers[obs].items():
            raw = data[offset - 1:offset - 1 + length].decode("ascii").strip()
            dose[det] = float(raw)
        rows.append({"sol": sol, "obs": obs, "start": start, "durationS": duration, "B": dose.get("B"), "E": dose.get("E")})
    return rows


def valid(r, det):
    return r[det] is not None and r[det] > 0 and r["durationS"] > 0


def mid(r):
    return r["start"] + datetime.timedelta(seconds=r["durationS"] / 2)


def summarise(rows, baseline, det):
    """Onset, peak, time and dose above baseline for one detector, over storm rows sorted by time."""
    rows = [r for r in rows if valid(r, det)]
    threshold = ONSET_FACTOR * baseline
    peak = max(rows, key=lambda r: r[det])
    above = [i for i, r in enumerate(rows) if r[det] > threshold]
    if not above:
        return {"peak": peak[det], "peakTime": iso(mid(peak)), "onset": None}
    first, last = above[0], above[-1]
    # Elapsed time from the start of the first reading above the threshold to the end of the last,
    # gaps between observations included (the storm continues through them).
    end_last = rows[last]["start"] + datetime.timedelta(seconds=rows[last]["durationS"])
    elapsed_min = (end_last - rows[first]["start"]).total_seconds() / 60
    observed_min = sum(rows[i]["durationS"] for i in range(first, last + 1)) / 60
    # Dose over the period: trapezoids between observation midpoints, so gaps are filled by
    # straight lines, plus each end observation's outer half at its own rate.
    def integral(f):
        total = f(rows[first]) * rows[first]["durationS"] / 2 + f(rows[last]) * rows[last]["durationS"] / 2
        for a, b in zip(rows[first:last], rows[first + 1:last + 1]):
            hours = (mid(b) - mid(a)).total_seconds() / 3600
            total += (f(a) + f(b)) / 2 * hours * 3600
        return total / 3600  # rate in uGy/h times seconds -> uGy
    in_period = integral(lambda r: r[det])
    above_baseline_period = integral(lambda r: r[det] - baseline)
    # Total excess over the whole storm files, not just the period above 1.5 x baseline.
    whole = 0.0
    for a, b in zip(rows, rows[1:]):
        whole += ((a[det] - baseline) + (b[det] - baseline)) / 2 * (mid(b) - mid(a)).total_seconds() / 3600
    hours = elapsed_min / 60
    # Mean multiplier over the first CAP_MINUTES after onset, weighted by observation length.
    cap_end = rows[first]["start"] + datetime.timedelta(minutes=CAP_MINUTES)
    early = [r for r in rows[first:] if r["start"] < cap_end]
    early_mean = sum(r[det] * r["durationS"] for r in early) / sum(r["durationS"] for r in early) / baseline
    return {
        "peak": peak[det],
        "peakTime": iso(mid(peak)),
        "peakMultiplier": round(peak[det] / baseline, 2),
        "onset": iso(rows[first]["start"]),
        "onsetRate": rows[first][det],
        "minutesOnsetToPeak": round((mid(peak) - rows[first]["start"]).total_seconds() / 60, 1),
        "minutesAbove": round(elapsed_min, 1),
        "minutesObservedAbove": round(observed_min, 1),
        "lastAbove": iso(end_last),
        "meanMultiplierAbove": round(in_period / (baseline * hours), 3),
        "meanMultiplierFirst%dMinutes" % CAP_MINUTES: round(early_mean, 3),
        "doseInPeriodMicroGray": round(in_period, 1),
        "doseAboveBaselineInPeriodMicroGray": round(above_baseline_period, 1),
        "doseAboveBaselineWholeFilesMicroGray": round(whole, 1),
    }


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def main():
    offline = "--offline" in sys.argv
    sols = [BASELINE_SOL] + STORM_SOLS
    if not offline:
        _, html = listing()
        for sol in sols:
            download(sol, html)
    quiet = read_sol(BASELINE_SOL)
    storm = sorted(read_sol(STORM_SOLS[0]) + read_sol(STORM_SOLS[1]), key=lambda r: r["start"])
    baseline = {d: statistics.median(r[d] for r in quiet if valid(r, d)) for d in "BE"}
    per_det = {d: summarise(storm, baseline[d], d) for d in "BE"}
    p = per_det[PRIMARY]
    out = {
        "version": 1,
        "event": "Solar energetic particle event of 20 May 2024, Curiosity sol 4190",
        "source": BASE_URL,
        "instrument": "Mars Science Laboratory Radiation Assessment Detector (RAD), RDR v1.0",
        "files": sorted(os.path.basename(f) for s in sols for f in local_files(s)),
        "units": {"dose": "microGray / Hour", "times": "UTC"},
        "detectors": {"B": "silicon detector B", "E": "plastic scintillator E (closer to tissue)"},
        "primaryDetector": PRIMARY,
        "onsetFactor": ONSET_FACTOR,
        "baselineSol": BASELINE_SOL,
        "baseline": {d: round(baseline[d], 3) for d in "BE"},
        "baselineNote": "Median of every reading on sol %d" % BASELINE_SOL,
        "storm": per_det,
        # Summary fields for the primary detector, as the engine reads them.
        "baselineRate": round(baseline[PRIMARY], 3),
        "peakRate": p["peak"],
        "peakMultiplier": p.get("peakMultiplier"),
        "onset": p["onset"],
        "minutesOnsetToPeak": p.get("minutesOnsetToPeak"),
        "minutesAbove": p.get("minutesAbove"),
        "meanMultiplierAbove": p.get("meanMultiplierAbove"),
        "doseAboveBaselineMicroGray": p.get("doseAboveBaselineInPeriodMicroGray"),
        "nasaReported": {"microGray": NASA_REPORTED_UGY, "source": NASA_SOURCE},
        "series": [
            {"time": iso(r["start"]), "durationS": r["durationS"], "doseB": r["B"], "doseE": r["E"], "sol": r["sol"]}
            for r in sorted(quiet + storm, key=lambda r: r["start"])
        ],
    }
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")

    print("baseline (median, sol %d): B %.2f, E %.2f uGy/h" % (BASELINE_SOL, baseline["B"], baseline["E"]))
    for d in "BE":
        s = per_det[d]
        print("detector %s: peak %.1f uGy/h (x%s) at %s; onset %s; onset to peak %s min; above %.1fx baseline %s min"
              % (d, s["peak"], s.get("peakMultiplier"), s["peakTime"], s["onset"], s.get("minutesOnsetToPeak"), ONSET_FACTOR, s.get("minutesAbove")))
        print("  mean multiplier over the first %d min after onset: %s" % (CAP_MINUTES, s.get("meanMultiplierFirst%dMinutes" % CAP_MINUTES)))
        print("  dose in that period %s uGy, of which above baseline %s uGy; above baseline over both storm sols %s uGy; mean multiplier %s"
              % (s.get("doseInPeriodMicroGray"), s.get("doseAboveBaselineInPeriodMicroGray"), s.get("doseAboveBaselineWholeFilesMicroGray"), s.get("meanMultiplierAbove")))
    print("NASA reported: %d uGy" % NASA_REPORTED_UGY)
    print("wrote", CACHE)
    return 0


if __name__ == "__main__":
    sys.exit(main())
