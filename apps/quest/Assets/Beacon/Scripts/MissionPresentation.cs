using System;
using System.Globalization;

namespace Beacon
{
    // Display formatting only: never select shelter, estimate dose or count down locally.
    public static class MissionPresentation
    {
        // A shelter's optional label ("Butte M12 shelter") when the engine gives one, else its id (s-<x>-<y>, from its position).
        public static string ShelterName(string id, string label = null) => !string.IsNullOrEmpty(label) ? label : string.IsNullOrEmpty(id) ? "Shelter" : id == "base" ? "Base" : "Shelter " + id.ToUpperInvariant();
        public static string Warning(MissionState s) => !s.baseLink ? "BASE LINK LOST" : "SHELTER IS DISTANT";
        public static string Alert(MissionState s, bool connected, bool sheltered)
        {
            if(!connected) return s==null ? "CONNECTING TO MISSION" : s.Emergency ? "LAST ALERT · DATA OFFLINE" : "DATA OFFLINE · CHECK USB";
            if(s?.Emergency==true) return sheltered ? "IN SHELTER · HOLD POSITION" : s.panic ? "EMERGENCY · SEEK SHELTER" : "SOLAR STORM, TAKE COVER";
            return s?.mode=="warning" ? Warning(s) : "";
        }
        public static bool AlertBorder(MissionState s, bool connected) => s?.Emergency==true || (connected && s?.mode=="warning");
        public static bool StormAtmosphere(MissionState s, bool connected) => connected && s?.storm==true;
        public static bool ShowBaseMarker(Waypoint p) => p?.@base!=null && p.@base.distance>1;
        public static bool ShowShelterMarker(Waypoint p) => p?.shelter!=null && !p.isShelter && p.shelter.distance>1;
        public static string Decision(MissionState state, RouteDocument doc)
        {
            if (state?.route != "reroute" || !state.rerouteFrom.HasValue || doc?.rerouteInfo == null ||
                !doc.rerouteInfo.TryGetValue(state.rerouteFrom.Value.ToString(), out var info)) return "";
            var choice = info?.chosen;
            if (choice?.minutes == null || string.IsNullOrEmpty(choice.id) || double.IsNaN(choice.minutes.Value) || double.IsInfinity(choice.minutes.Value)) return "Shelter choice details unavailable";
            string text = $"{ShelterName(choice.id, choice.label)} · initial {choice.minutes:0.0} min";
            if (choice.baseLink.HasValue) text += choice.baseLink.Value ? " · base link kept" : " · no base link";
            if (choice.late == true) text += " · nearest cover, beyond time limit";
            else if (info.@base?.minutes != null && info.@base.excludedByLimit == true) text += $". Base {info.@base.minutes:0.0} min, out of reach";
            return text;
        }
        public static string Credit(MissionSite site)
        {
            string text = "Terrain: HiRISE/USGS · Sky: ";
            if (site?.sky?.source == null || !site.sky.source.Contains("JPL Horizons")) return text + "metadata unavailable";
            text += "JPL Horizons";
            if (DateTime.TryParseExact(site.sky.timeUT, "yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var time))
                text += " · " + time.ToString("dd MMM yyyy HH:mm", CultureInfo.InvariantCulture) + " UT";
            return text;
        }
    }
}
