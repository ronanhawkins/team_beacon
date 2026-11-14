using System;
using System.IO;
using Beacon;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;

public static class BeaconVerify
{
    static int checks;
    static void Check(bool valid, string name) { if (!valid) throw new Exception("Beacon check failed: " + name); checks++; }
    static void Reject(Action action, string name) { try { action(); } catch (InvalidOperationException) { checks++; return; } throw new Exception("Invalid data was accepted: " + name); }
    public static void Run()
    {
        checks = 0;
        var folder = Path.GetFullPath("../../shared/fake");
        var route = JsonConvert.DeserializeObject<RouteDocument>(File.ReadAllText(Path.Combine(folder, "waypoints.json")));
        Contracts.Validate(route);
        var json = JObject.Parse(File.ReadAllText(Path.Combine(folder, "state.json")));
        var state = Contracts.StateFrom(json);
        var first = Contracts.Select(state, route);
        Check(first.Point.id == "m00" && first.Next.id == "m01", "canonical main route");
        Check(Math.Abs(Navigation.Bearing(first.Point.pos, first.Next.pos) - state.headingDeg) < .2, "route bearing agrees with Ronan's data");
        Check(Navigation.Distance(first.Point.pos, first.Next.pos) > 40, "distance uses metres");
        var storm = Contracts.StateFrom(JObject.Parse(File.ReadAllText(Path.Combine(folder, "state-storm.json"))));
        var diverted = Contracts.Select(storm, route);
        Check(diverted.Point.id == "r03-00" && diverted.Reroute, "fresh emergency connection identifies its route");
        storm.waypointIndex = diverted.Points.Count - 1;
        Check(Contracts.Select(storm, route).Next == null, "arrival has no invented next direction");
        storm.rerouteFrom = null; Reject(() => Contracts.Select(storm, route), "ambiguous reroute");
        Check(Navigation.Relative(5, 355) == 10 && Navigation.Relative(355, 5) == -10, "north crossing takes the short turn");
        Check(Navigation.Bearing(new SitePosition(), new SitePosition { x = 1 }) == 90, "east is ninety degrees");
        Check(Navigation.Turn(90) == "Turn right" && Navigation.Turn(-90) == "Turn left", "turn direction");
        json.Remove("oxygenFraction"); Reject(() => Contracts.StateFrom(json), "missing oxygen is not zero oxygen");
        state.oxygenFraction = 100; Reject(() => Contracts.Select(state, route), "fractions are not percentages");
        state.oxygenFraction = 1; state.waypointIndex = 999; Reject(() => Contracts.Select(state, route), "out-of-range route index");
        // Exercise every exported route, including single-point shelters and
        // coincident path points. These are valid planner outputs, not fixtures.
        var exported = JsonConvert.DeserializeObject<RouteDocument>(File.ReadAllText(Path.GetFullPath("../../data/out/waypoints.json")));
        Contracts.Validate(exported);
        foreach (var path in exported.reroutes)
        {
            Check(int.TryParse(path.Key, out var origin) && origin >= 0 && origin < exported.main.Count, "exported reroute origin");
            for (int i = 0; i < path.Value.Count; i++)
            {
                var p = path.Value[i];
                var live = new MissionState { version = 1, route = "reroute", rerouteFrom = origin, waypointIndex = i, mode = "storm", storm = true,
                    oxygenFraction = p.oxygenFraction, doseFraction = p.doseFraction, openSky = p.openSky,
                    headingDeg = p.headingDeg, shelterBearingDeg = p.shelter.az, minutesToShelter = p.shelter.minutes };
                var selected = Contracts.Select(live, exported);
                Check(selected.Point == p && selected.Remaining >= 0, "exported shelter route selection");
                Check(!string.IsNullOrEmpty(Navigation.After(selected)), "exported navigation instruction");
                var cue = Navigation.Upcoming(selected);
                Check(cue.Metres >= 0 && cue.Metres <= selected.Remaining + .001 && !string.IsNullOrEmpty(cue.Title), "exported upcoming turn");
            }
            Check(path.Value[path.Value.Count - 1].isShelter, "exported reroute ends at shelter");
        }
        Check(exported.reroutes.Count == exported.main.Count, "every exported waypoint has a shelter route");
        var bend = new System.Collections.Generic.List<Waypoint> {
            new Waypoint { pos = new SitePosition() },
            new Waypoint { pos = new SitePosition { y = 5 } },
            new Waypoint { pos = new SitePosition { y = 10 } },
            new Waypoint { pos = new SitePosition { x = 10, y = 10 } }
        };
        var turn = Navigation.Upcoming(new MissionSelection(bend, 0, false));
        Check(turn.Title == "Turn right" && turn.Metres == 10, "navigation skips straight samples and measures distance to the turn");
        Check(UnityEditor.AssetDatabase.LoadAssetAtPath<UnityEngine.Object>("Assets/Beacon/Scenes/BeaconAR.unity") != null, "native scene exists");
        Debug.Log($"BEACON_CHECKS_PASSED: {checks}");
    }
}
