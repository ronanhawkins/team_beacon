using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Beacon
{
    [Serializable] public sealed class SitePosition { public double x, y, z; }
    [Serializable] public sealed class Shelter { public string id, label; public double az, distance, minutes; } // label: optional name (shared/waypoints.md)
    [Serializable] public sealed class SkyBody { public double az, el; public bool visible; }
    [Serializable] public sealed class BaseBeacon { public double az, distance; public bool visible; }
    [Serializable] public sealed class DecisionOption { public string id, kind, label; public double? minutes, minutesLate; public bool? baseLink, late; }
    [Serializable] public sealed class BaseDecision { public double? minutes; public bool? excludedByLimit; }
    [Serializable] public sealed class RerouteDecision { public DecisionOption chosen; public BaseDecision @base; }
    [Serializable] public sealed class SkyMetadata { public string timeUT, source; }
    [Serializable] public sealed class MissionSite { public string site; public SkyMetadata sky; public SitePosition @base; }
    [Serializable] public sealed class Waypoint
    {
        public string id, label;
        public SitePosition pos;
        public double headingDeg, openSky, doseFraction, oxygenFraction;
        public double[] skyline;
        public SkyBody sun, earth;
        public BaseBeacon @base;
        public Shelter shelter;
        public bool isShelter, isScienceStop;
        public string Name => string.IsNullOrEmpty(label) ? (isShelter ? "Shelter" : "Waypoint") : label;
    }
    [Serializable] public sealed class RouteDocument
    {
        public int version, skylineSamples;
        public List<Waypoint> main;
        public Dictionary<string, List<Waypoint>> reroutes;
        public Dictionary<string, RerouteDecision> rerouteInfo;
    }
    [Serializable] public sealed class MissionState
    {
        public int version, waypointIndex;
        public int? rerouteFrom;
        public string route, mode;
        public bool storm, panic, rerouteRequested, sunlit, baseLink, earthLink;
        public double headingDeg, shelterBearingDeg, minutesToShelter, openSky, doseFraction, oxygenFraction, earthDelayMinutes;
        [JsonIgnore] public bool Emergency => storm || panic || mode == "storm";
    }
    [Serializable] public sealed class MissionSession { public int version; public string waypoints; public bool synthetic; }
    public sealed class MissionSelection
    {
        public readonly List<Waypoint> Points;
        public readonly Waypoint Point;
        public readonly int Index;
        public readonly bool Reroute;
        public MissionSelection(List<Waypoint> points, int index, bool reroute) { Points = points; Index = index; Point = points[index]; Reroute = reroute; }
        public Waypoint Next
        {
            get { for (var i = Index + 1; i < Points.Count; i++) if (Navigation.Distance(Point.pos, Points[i].pos) > .1) return Points[i]; return null; }
        }
        public double Remaining
        {
            get { double sum = 0; for (var i = Index; i < Points.Count - 1; i++) sum += Navigation.Distance(Points[i].pos, Points[i + 1].pos); return sum; }
        }
    }
    public static class Navigation
    {
        public sealed class Cue { public double Metres; public string Title, Detail; }
        public static double Wrap(double d) => (d % 360 + 360) % 360;
        public static double Relative(double target, double heading) => Wrap(target - heading + 180) - 180;
        public static double Distance(SitePosition a, SitePosition b) => Math.Sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
        public static double Bearing(SitePosition a, SitePosition b) => Wrap(Math.Atan2(b.x - a.x, b.y - a.y) * 180 / Math.PI);
        public static string DistanceText(double m) => m >= 1000 ? $"{m / 1000:0.0} km" : $"{m:0} m";
        public static string Turn(double d) => Math.Abs(d) < 20 ? "Continue ahead" : Math.Abs(d) >= 150 ? "Turn back" : $"{(Math.Abs(d) < 50 ? "Bear" : "Turn")} {(d > 0 ? "right" : "left")}";
        public static Cue Upcoming(MissionSelection s)
        {
            double metres = 0;
            // Planner samples are not all turns. Look ahead to a meaningful bend,
            // science stop or destination and measure along the supplied path.
            for (int i = s.Index + 1; i < s.Points.Count; i++)
            {
                var p = s.Points[i]; var previous = s.Points[i - 1];
                metres += Distance(previous.pos, p.pos);
                int before = i - 1, next = i + 1;
                while (before >= s.Index && Distance(s.Points[before].pos, p.pos) <= .1) before--;
                while (next < s.Points.Count && Distance(p.pos, s.Points[next].pos) <= .1) next++;
                if (p.isScienceStop || next == s.Points.Count)
                    return new Cue { Metres = metres, Title = p.Name, Detail = p.isShelter ? "Arrive at shelter" : p.isScienceStop ? "Science stop ahead" : "Destination ahead" };
                if (before < s.Index) continue;
                double bend = Relative(Bearing(p.pos, s.Points[next].pos), Bearing(s.Points[before].pos, p.pos));
                if (Math.Abs(bend) >= 30)
                    return new Cue { Metres = metres, Title = Turn(bend), Detail = "Follow the dashed route" };
            }
            return new Cue { Metres = 0, Title = s.Point.isShelter ? "Shelter reached" : "Route complete", Detail = "Hold position" };
        }
        public static string After(MissionSelection s)
        {
            var next = s.Next;
            if (next == null) return s.Point.isShelter ? "Shelter reached" : "Route complete";
            int i = s.Points.IndexOf(next);
            while (++i < s.Points.Count)
                if (Distance(next.pos, s.Points[i].pos) > .1) return "Then: " + Turn(Relative(Bearing(next.pos, s.Points[i].pos), Bearing(s.Point.pos, next.pos))).ToLowerInvariant();
            return next.isShelter ? "Arrive at shelter" : "Arrive at destination";
        }
    }
    public static class Contracts
    {
        static void Require(bool valid, string message) { if (!valid) throw new InvalidOperationException(message); }
        static bool Finite(double v) => !double.IsNaN(v) && !double.IsInfinity(v);
        static bool Fraction(double v) => Finite(v) && v >= 0 && v <= 1;
        public static MissionState StateFrom(JToken token)
        {
            Require(token is JObject, "Mission state is missing");
            foreach (var name in new[] { "storm", "panic", "rerouteRequested", "sunlit", "baseLink", "earthLink" }) Require(token[name]?.Type == JTokenType.Boolean, "Missing or invalid " + name);
            foreach (var name in new[] { "version", "waypointIndex" }) Require(token[name]?.Type == JTokenType.Integer, "Missing or invalid " + name);
            foreach (var name in new[] { "headingDeg", "shelterBearingDeg", "minutesToShelter", "openSky", "doseFraction", "oxygenFraction", "earthDelayMinutes" }) Require(token[name]?.Type == JTokenType.Float || token[name]?.Type == JTokenType.Integer, "Missing or invalid " + name);
            return token.ToObject<MissionState>();
        }
        public static void Validate(RouteDocument doc)
        {
            Require(doc != null && doc.version == 1 && doc.main?.Count > 0 && doc.reroutes != null && doc.skylineSamples == 72, "Unsupported or incomplete waypoint file");
            var paths = new List<List<Waypoint>> { doc.main }; paths.AddRange(doc.reroutes.Values);
            foreach (var path in paths)
            {
                Require(path?.Count > 0, "Empty route");
                foreach (var p in path)
                {
                    Require(p?.pos != null && p.shelter != null && !string.IsNullOrEmpty(p.id), "Incomplete waypoint");
                    Require(Finite(p.pos.x) && Finite(p.pos.y) && Finite(p.pos.z), "Invalid waypoint coordinates");
                    Require(p.skyline?.Length == 72 && Array.TrueForAll(p.skyline, Finite), "Invalid skyline");
                    Require(p.sun != null && p.earth != null && p.@base != null, "Missing sky or base marker");
                    Require(Finite(p.sun.az) && Finite(p.sun.el) && Math.Abs(p.sun.el) <= 90 && Finite(p.earth.az) && Finite(p.earth.el) && Math.Abs(p.earth.el) <= 90, "Invalid sky directions");
                    Require(Finite(p.@base.az) && Finite(p.@base.distance) && p.@base.distance >= 0, "Invalid base marker");
                }
            }
        }
        public static MissionSelection Select(MissionState s, RouteDocument route)
        {
            Require(s != null && s.version == 1 && (s.route == "main" || s.route == "reroute"), "Unsupported mission state");
            Require(s.mode == "nominal" || s.mode == "warning" || s.mode == "storm", "Invalid mission mode");
            Require(Fraction(s.oxygenFraction) && Fraction(s.doseFraction) && Fraction(s.openSky), "Invalid mission fractions");
            Require(Finite(s.minutesToShelter) && s.minutesToShelter >= 0 && Finite(s.headingDeg) && Finite(s.shelterBearingDeg), "Invalid mission navigation");
            List<Waypoint> points = route.main;
            if (s.route == "reroute")
            {
                Require(s.rerouteFrom.HasValue, "Shelter route origin is missing");
                Require(route.reroutes.TryGetValue(s.rerouteFrom.Value.ToString(), out points), "Shelter route is missing");
            }
            Require(s.waypointIndex >= 0 && s.waypointIndex < points.Count, "Waypoint index is outside the selected route");
            return new MissionSelection(points, s.waypointIndex, s.route == "reroute");
        }
    }
}
