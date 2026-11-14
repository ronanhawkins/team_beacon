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
        var walkingPath=new System.Collections.Generic.List<Waypoint> {
            new Waypoint {pos=new SitePosition()},
            new Waypoint {pos=new SitePosition {y=10}},
            new Waypoint {pos=new SitePosition {x=10,y=10}},
            new Waypoint {pos=new SitePosition {x=20,y=10},isScienceStop=true,label="Science stop"},
            new Waypoint {pos=new SitePosition {x=30,y=10},isShelter=true}
        };
        var walkingSelection=new MissionSelection(walkingPath,0,false);
        Check(WalkNavigation.WaypointIndex(walkingSelection,new SitePosition())==3,"compass destination is the next mission stop, not a path sample or the final route end");
        Check(WalkNavigation.WaypointIndex(new MissionSelection(walkingPath,0,true),new SitePosition())==4,"diversion compass destination is the chosen shelter");
        Check(!WalkNavigation.ShouldAdvance(walkingSelection,new SitePosition {y=4}),"before the bend, retain the next path point");
        var missedCorner=new SitePosition {x=4,y=8};
        Check(WalkNavigation.ShouldAdvance(walkingSelection,missedCorner) && WalkNavigation.TargetIndex(walkingSelection,missedCorner)==2,"a cut corner directs ahead instead of back to the missed bend");
        Check(walkingSelection.Index==0,"guidance selection does not mutate authoritative mission progress");
        Check(WalkNavigation.ShouldAdvance(walkingSelection,new SitePosition {x=3,y=13}),"passing the bend's plane while closer to the stop advances it");
        Check(!WalkNavigation.ShouldAdvance(walkingSelection,new SitePosition {x=-10,y=13}),"overshooting away from the destination does not falsely advance a bend");
        var beyondTwo=new SitePosition {x=14,y=11};
        Check(WalkNavigation.TargetIndex(walkingSelection,beyondTwo)==3,"guidance skips multiple passed samples immediately while acknowledgements catch up");
        int acknowledged=0;
        while(WalkNavigation.ShouldAdvance(new MissionSelection(walkingPath,acknowledged,false),beyondTwo)) acknowledged++;
        Check(acknowledged==2,"sequential guarded acknowledgements stop before an unvisited mission stop");
        var beforeScience=new MissionSelection(walkingPath,2,false);
        Check(!WalkNavigation.ShouldAdvance(beforeScience,new SitePosition {x=24,y=10}),"passing a science destination never invents its arrival");
        Check(WalkNavigation.ShouldAdvance(beforeScience,walkingPath[3].pos),"physically reaching the named destination acknowledges arrival");
        Check(WalkNavigation.WaypointIndex(new MissionSelection(walkingPath,3,false),walkingPath[3].pos)==4,"after the science stop, compass selects the next destination");
        var hairpin=new System.Collections.Generic.List<Waypoint> {
            new Waypoint {pos=new SitePosition()},new Waypoint {pos=new SitePosition {y=10}},
            new Waypoint {pos=new SitePosition {x=2}},new Waypoint {pos=new SitePosition {x=2,y=-10},isShelter=true}
        };
        Check(!WalkNavigation.ShouldAdvance(new MissionSelection(hairpin,0,false),hairpin[0].pos),"being closer to the goal alone does not skip an unpassed hairpin");
        var duplicates=new System.Collections.Generic.List<Waypoint> {
            new Waypoint {pos=new SitePosition()},new Waypoint {pos=new SitePosition()},new Waypoint {pos=new SitePosition()},
            new Waypoint {pos=new SitePosition {y=10}},new Waypoint {pos=new SitePosition {y=20},isShelter=true}
        };
        Check(WalkNavigation.ShouldAdvance(new MissionSelection(duplicates,0,true),new SitePosition {y=15}),"coincident intermediate samples cannot stall progress after passing them");
        Check(!WalkNavigation.ShouldAdvance(new MissionSelection(duplicates,3,true),new SitePosition {y=25}),"passing the final shelter does not claim shelter arrival");
        var coincidentArrival=new System.Collections.Generic.List<Waypoint> {new Waypoint {pos=new SitePosition()},new Waypoint {pos=new SitePosition(),isShelter=true}};
        Check(WalkNavigation.ShouldAdvance(new MissionSelection(coincidentArrival,0,true),new SitePosition()),"a coincident shelter endpoint can be acknowledged at its actual location");
        Check(!WalkNavigation.ShouldAdvance(new MissionSelection(coincidentArrival,0,true),new SitePosition {x=10}),"a coincident shelter endpoint still requires physical arrival");
        var rotatedPath=new System.Collections.Generic.List<Waypoint>();
        foreach(var q in walkingPath) rotatedPath.Add(new Waypoint {pos=new SitePosition {x=1000-q.pos.y,y=2000+q.pos.x},isScienceStop=q.isScienceStop,isShelter=q.isShelter});
        Check(WalkNavigation.ShouldAdvance(new MissionSelection(rotatedPath,0,false),new SitePosition {x=992,y=2004}),"passed-turn logic works after rotating and translating the route frame");
        Check(UnityEditor.AssetDatabase.LoadAssetAtPath<UnityEngine.Object>("Assets/Beacon/Scenes/BeaconAR.unity") != null, "native scene exists");
        Check(Math.Abs(exported.main[0].openSky-.924)<.001, "current exported base has 92.4 percent open sky, not the old screenshot value");
        var quela=exported.main[19];
        Check(quela.isScienceStop && quela.label=="Quela drill site" && !quela.sun.visible, "Quela science card and hidden Sun");
        Check(Math.Abs(quela.openSky-.815)<.001, "Quela open sky uses exported fraction");
        for(int i=25;i<=28;i++) Check(!exported.main[i].@base.visible, "outcrop base link loss");
        var decisionState=new MissionState { route="reroute",rerouteFrom=30 };
        string why=MissionPresentation.Decision(decisionState,exported);
        Check(why.Contains("Butte M12 shelter") && why.Contains("4.5 min") && why.Contains("9.7 min") && why.Contains("base link kept") && why.Contains("out of reach"), "far point explanation uses the current stable shelter name and engine decision");
        Check(MissionPresentation.ShelterName("s-1475-1497")=="Shelter S-1475-1497" && MissionPresentation.ShelterName("base")=="Base","unnamed shelters and base retain meaningful fallbacks");
        foreach(var path in exported.reroutes)
        {
            for(int i=0;i<path.Value.Count-1;i++)
            {
                var selection=new MissionSelection(path.Value,i,true);var next=selection.Next;if(next==null) continue;
                Check(WalkNavigation.ShouldAdvance(selection,next.pos),"walking reaches every exported next sample");
                Check(WalkNavigation.Remaining(selection,next.pos)<=selection.Remaining+.001,"remaining supplied route does not grow on arrival");
            }
            var final=new MissionSelection(path.Value,path.Value.Count-1,true);
            Check(WalkNavigation.InShelter(final,final.Point.pos) && WalkNavigation.TargetIndex(final,final.Point.pos)==-1,"actual arrival clears navigation");
            var outside=new SitePosition {x=final.Point.pos.x+10,y=final.Point.pos.y};
            Check(!WalkNavigation.InShelter(final,outside) && WalkNavigation.TargetIndex(final,outside,true)==-1 && WalkNavigation.WaypointIndex(final,outside,true)==-1,"leaving a completed shelter updates cover status without resurrecting its arrow or beacon");
            Check(WalkNavigation.TargetIndex(final,outside)==final.Index,"a final shelter not yet physically visited remains a target");
            Check(Math.Abs(WalkNavigation.Remaining(final,outside)-Navigation.Distance(outside,final.Point.pos))<.001,"outside-shelter distance remains truthful after completed guidance disappears");
        }
        for(int i=0;i<exported.main.Count;i++) Check(WalkNavigation.ClosestMain(exported,exported.main[i].pos)==i,"shelter request matches the current physical route location");
        Check(MissionPresentation.Decision(decisionState,route)=="", "optional decision missing does not invent a reason");
        var arrival=exported.reroutes["30"][exported.reroutes["30"].Count-1];
        Check(arrival.isShelter && arrival.shelter.minutes==0 && arrival.@base.visible && Math.Abs(arrival.openSky-.746)<.001, "arrival uses sheltered skyline, zero minutes and retained base link");
        Check((BeaconMissionView.Direction(90,0)-Vector3.right).magnitude<.001f, "ring east is clockwise from north");
        Check((BeaconMissionView.Direction(0,90)-Vector3.up).magnitude<.001f, "sky marker elevation is above horizon");
        Check(MissionPresentation.Warning(new MissionState { baseLink=false })=="BASE LINK LOST", "amber warning explains link loss");
        Check(MissionPresentation.Alert(null,false,false)=="CONNECTING TO MISSION", "startup is distinct from stale mission data");
        var calm=new MissionState {mode="nominal"};
        var panic=new MissionState {mode="storm",panic=true};
        var solar=new MissionState {mode="storm",storm=true};
        Check(MissionPresentation.Alert(calm,false,false)=="DATA OFFLINE · CHECK USB" && !MissionPresentation.AlertBorder(calm,false), "offline calm does not imply emergency");
        Check(MissionPresentation.Alert(solar,false,false)=="LAST ALERT · DATA OFFLINE" && MissionPresentation.AlertBorder(solar,false), "USB loss preserves last known emergency visibly");
        Check(MissionPresentation.Alert(panic,true,false)=="EMERGENCY · SEEK SHELTER", "panic does not invent a solar storm");
        Check(!MissionPresentation.StormAtmosphere(panic,true) && MissionPresentation.StormAtmosphere(solar,true) && !MissionPresentation.StormAtmosphere(solar,false), "weather effect requires live storm flag");
        Check(MissionPresentation.Alert(solar,true,true)=="IN SHELTER · HOLD POSITION" && MissionPresentation.AlertBorder(solar,true), "arrival does not dismiss active emergency");
        var disconnected=new GameObject("Offline shelter request check").AddComponent<BeaconRelay>();
        Check(!disconnected.RequestShelter().GetAwaiter().GetResult(), "offline request reports failure instead of false confirmation");
        UnityEngine.Object.DestroyImmediate(disconnected.gameObject);
        var site=JsonConvert.DeserializeObject<MissionSite>(File.ReadAllText(Path.GetFullPath("../../data/site.json")));
        Check(MissionPresentation.Credit(site).Contains("14 Nov 2026 19:40 UT"), "sky credit uses source time");
        Check(!MissionPresentation.ShowBaseMarker(exported.main[0]), "base marker disappears at base");
        Check(!MissionPresentation.ShowShelterMarker(arrival), "arrived shelter is not a horizon destination");
        Check(MissionPresentation.ShowShelterMarker(exported.main[30]), "shelter remains a destination before arrival");
        foreach(var graphicType in new[] {typeof(CompassGraphic),typeof(ArrowGraphic),typeof(HudBorderGraphic)})
        {
            var graphic=new GameObject("Renderer regression check",graphicType);
            Check(graphic.GetComponent<CanvasRenderer>()!=null,"custom HUD graphic has the renderer required to draw: "+graphicType.Name);
            UnityEngine.Object.DestroyImmediate(graphic);
        }
        Debug.Log($"BEACON_CHECKS_PASSED: {checks}");
    }
}
