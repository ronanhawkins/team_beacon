using System;
using System.IO;
using Beacon;
using Newtonsoft.Json;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class BeaconVrVerify
{
    static int checks;
    static void Check(bool pass,string message) {checks++;if(!pass) throw new Exception("VR scenery: "+message);}
    public static OVRCameraRig PrepareRig()
    {
        var rig=UnityEngine.Object.FindFirstObjectByType<OVRCameraRig>();rig.enabled=false;
        if(rig.centerEyeAnchor==null) typeof(OVRCameraRig).GetMethod("EnsureGameObjectIntegrity",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic).Invoke(rig,null);
        foreach(var camera in rig.GetComponentsInChildren<Camera>(true)) camera.enabled=false;
        rig.centerEyeAnchor.localPosition=new Vector3(0,1.65f,0);rig.centerEyeAnchor.localRotation=Quaternion.identity;return rig;
    }
    public static void RunSpeed()
    {
        checks=0;EditorSceneManager.OpenScene("Assets/Beacon/Scenes/BeaconAR.unity",OpenSceneMode.Single);
        var rig=PrepareRig();var scenery=UnityEngine.Object.FindFirstObjectByType<BeaconVrScenery>();
        Check(Mathf.Approximately(scenery.walkSpeed,4.5f) && Mathf.Approximately(scenery.fastSpeed,11.25f),"serialized scene uses requested speeds");
        string repo=Path.GetFullPath("../..");
        var document=JsonConvert.DeserializeObject<RouteDocument>(File.ReadAllText(BeaconBuild.WaypointsFile(repo)));
        var site=JsonConvert.DeserializeObject<MissionSite>(File.ReadAllText(BeaconBuild.SiteFile(repo)));
        var p=document.main[0];var state=new MissionState {version=1,route="main",waypointIndex=0,mode="nominal",headingDeg=p.headingDeg,
            openSky=p.openSky,oxygenFraction=p.oxygenFraction,doseFraction=p.doseFraction,baseLink=p.@base.visible,sunlit=p.sun.visible,
            earthLink=p.earth.visible,minutesToShelter=p.shelter.minutes,shelterBearingDeg=p.shelter.az,earthDelayMinutes=11};
        var view=scenery.missionView;view.relay.Preview(state,document,site);view.CreateVisuals();view.Calibrate();view.SetImmersive(true);
        string initial=JsonConvert.SerializeObject(state);
        float Measure(float grip)
        {
            scenery.ReturnToRoute();Physics.SyncTransforms();
            for(int i=0;i<50;i++) {scenery.Step(Vector2.up,Vector2.zero,grip,.05f);Physics.SyncTransforms();}
            var start=scenery.playerRoot.position;
            for(int i=0;i<20;i++) {scenery.Step(Vector2.up,Vector2.zero,grip,.05f);Physics.SyncTransforms();}
            return Vector3.ProjectOnPlane(scenery.playerRoot.position-start,Vector3.up).magnitude;
        }
        float normal=Measure(0),sprint=Measure(1);
        Check(Mathf.Abs(normal-4.5f)<.3f,"normal movement reaches 4.5 m/s");
        Check(Mathf.Abs(sprint-11.25f)<.5f,"sprint reaches 11.25 m/s");
        Check(sprint/normal>2.35f && sprint/normal<2.65f,"sprint is 2.5 times normal speed");
        for(int i=0;i<40;i++) {scenery.Step(Vector2.up,Vector2.zero,0,.05f);Physics.SyncTransforms();}
        Check(!scenery.Sprinting && Mathf.Abs(scenery.Speed-4.5f)<.3f,"releasing grip returns to new normal speed");
        for(int i=0;i<40;i++) {scenery.Step(Vector2.zero,Vector2.zero,0,.05f);Physics.SyncTransforms();}
        Check(scenery.Speed<.1f,"releasing stick stops movement");
        Check(initial==JsonConvert.SerializeObject(view.relay.State),"speed changes do not mutate mission state");
        Check(scenery.fastSpeed*.05f<WalkNavigation.ArrivalRadius,"maximum frame step remains below arrival radius");
        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
        Debug.Log($"BEACON_SPEED_CHECKS_PASSED: {checks}; normal {normal:F2} m/s; sprint {sprint:F2} m/s");
    }
    public static void Run()
    {
        checks=0;EditorSceneManager.OpenScene("Assets/Beacon/Scenes/BeaconAR.unity",OpenSceneMode.Single);
        var rig=PrepareRig();var scenery=UnityEngine.Object.FindFirstObjectByType<BeaconVrScenery>();scenery.Create();
        var view=scenery.missionView;var relay=view.relay;var terrain=scenery.terrain;
        Check(!terrain.gameObject.activeSelf && !scenery.Active,"AR must start with all VR scenery hidden");
        Check(!scenery.playerRoot.GetComponent<CharacterController>().enabled,"AR must not enable virtual movement");
        Check(terrain.VisibleTriangles>720000 && terrain.VisibleTriangles<=1000000 && terrain.CollisionTriangles>=720000,"1 m source terrain stays within the visible triangle budget");
        foreach(var mesh in terrain.Meshes)
        {
            var vertices=mesh.vertices;var normals=mesh.normals;var uv=mesh.uv;var indices=mesh.triangles;
            Check(vertices.Length==normals.Length && vertices.Length==uv.Length,"complete geometry attributes");
            for(int i=0;i<vertices.Length;i+=73) Check(float.IsFinite(vertices[i].x) && float.IsFinite(vertices[i].y) && float.IsFinite(vertices[i].z),"finite geometry");
            int facing=0,back=0;
            for(int i=0;i<indices.Length;i+=Math.Max(3,(indices.Length/60/3)*3))
            {
                int a=indices[i],b=indices[i+1],c=indices[i+2];
                var cross=Vector3.Cross(vertices[b]-vertices[a],vertices[c]-vertices[a]);
                if(cross.sqrMagnitude<1e-12f) continue;
                if(Vector3.Dot(cross,normals[a]+normals[b]+normals[c])>0) facing++;else back++;
            }
            Check(facing>=back,"coordinate conversion preserves triangle facing");
        }
        string repo=Path.GetFullPath("../..");
        var document=JsonConvert.DeserializeObject<RouteDocument>(File.ReadAllText(BeaconBuild.WaypointsFile(repo)));
        foreach(var route in document.reroutes.Values) foreach(var point in route)
            Check(Math.Abs(terrain.HeightAt((float)point.pos.x,(float)point.pos.y)-point.pos.z)<.25,"VR and planner use the same original heights");
        var p=document.main[19];var state=new MissionState {version=1,route="main",waypointIndex=19,mode="nominal",headingDeg=p.headingDeg,
            openSky=p.openSky,oxygenFraction=p.oxygenFraction,doseFraction=p.doseFraction,baseLink=p.@base.visible,sunlit=p.sun.visible,
            earthLink=p.earth.visible,minutesToShelter=p.shelter.minutes,shelterBearingDeg=p.shelter.az,earthDelayMinutes=11};
        relay.Preview(state,document,JsonConvert.DeserializeObject<MissionSite>(File.ReadAllText(BeaconBuild.SiteFile(repo))));
        view.CreateVisuals();view.Calibrate();float north=view.NorthYaw;var sun=view.SkyDirection(p.sun);
        string beforeState=JsonConvert.SerializeObject(relay.State);
        view.SetImmersive(true);Physics.SyncTransforms();
        Check(scenery.Active && terrain.gameObject.activeSelf && view.passthrough.hidden,"VR shows scenery and hides room");
        Check(terrain.GroundAt(rig.centerEyeAnchor.position,out var hit),"starting view has measured ground below it");
        Check(Mathf.Abs(hit.point.y)<.2f,"original scene scale and spawn height are correct");
        Check(Navigation.Distance(scenery.Position,p.pos)<.05,"VR starts at the actual mission point, not an unrelated photo origin");
        scenery.TickBeacon();
        Check(scenery.Beacon.Visible && scenery.Beacon.TargetIndex==37,"VR beacon selects the next named mission stop");
        var beaconAnchor=terrain.WorldPoint(document.main[37].pos)+Vector3.up*.06f;
        Check(Vector3.Distance(scenery.Beacon.WorldPosition,beaconAnchor)<.01f,"beacon is anchored on the measured target ground");
        Check(Math.Abs(scenery.GuidanceDistance-Navigation.Distance(scenery.Position,document.main[37].pos))<.01,"compass measures the same named waypoint as the beacon");
        Check(scenery.GuidanceDistance>Navigation.Distance(scenery.Position,document.main[20].pos)*5,"waypoint distance is distinct from the nearby path sample");
        Check(Math.Abs(Navigation.Relative(scenery.GuidanceBearing,Navigation.Bearing(scenery.Position,document.main[20].pos)))<.01,"compass arrow follows the next unpassed path point while its distance measures the mission stop");
        var hud=UnityEngine.Object.FindFirstObjectByType<BeaconHud>();hud.CreateVisuals();hud.Tick();
        var compassArrow=(RectTransform)rig.centerEyeAnchor.Find("Readable peripheral HUD/Lowered compass/Single waypoint arrow");
        float expectedArrowX=Mathf.Clamp((float)Navigation.Relative(scenery.GuidanceBearing,view.Heading)/70,-.96f,.96f)*360;
        Check(Mathf.Abs(compassArrow.anchoredPosition.x-expectedArrowX)<.01f,"rendered compass keeps route steering separate from destination distance");
        for(int i=0;i<50;i++) {scenery.Step(Vector2.zero,Vector2.zero,0,.02f);Physics.SyncTransforms();}
        var start=scenery.playerRoot.position;
        for(int i=0;i<100;i++)
        {
            var prior=scenery.playerRoot.position;scenery.Step(Vector2.up,Vector2.zero,0,.02f);Physics.SyncTransforms();
            Check(Vector3.Distance(prior,scenery.playerRoot.position)<.3f,"stick movement has no teleport jumps");
        }
        float walked=Vector3.ProjectOnPlane(scenery.playerRoot.position-start,Vector3.up).magnitude;
        Check(walked>1,"left stick produces continuous movement");
        float yaw=rig.centerEyeAnchor.eulerAngles.y;scenery.Step(Vector2.zero,Vector2.right,0,.02f);
        Check(Mathf.Abs(Mathf.DeltaAngle(yaw,rig.centerEyeAnchor.eulerAngles.y)-.8f)<.01f,"right stick turns smoothly");
        Check(JsonConvert.SerializeObject(relay.State)==beforeState,"walking and turning leave the mission route unchanged");
        Check(view.NorthYaw==north && Vector3.Angle(view.SkyDirection(p.sun),sun)<.01f,"walking and turning preserve the measured Sun frame");
        scenery.TickBeacon();
        Check(Vector3.Distance(scenery.Beacon.WorldPosition,beaconAnchor)<.01f,"beacon stays at the waypoint while the wearer walks and turns");
        relay.PreviewOffline();scenery.TickBeacon();Check(!scenery.Beacon.Visible,"offline data hides the world beacon");
        relay.Preview(state,document,relay.Site);scenery.TickBeacon();Check(scenery.Beacon.Visible,"reconnection restores the world beacon");
        Check(BeaconVrScenery.Stick(new Vector2(.1f,0))==Vector2.zero,"stick dead zone");
        Check(Mathf.Abs(BeaconVrScenery.Stick(Vector2.one).magnitude-1)<.001f,"diagonal speed normalization");
        view.SetImmersive(false);view.SetImmersive(true);Physics.SyncTransforms();
        for(int i=0;i<50;i++) {scenery.Step(Vector2.zero,Vector2.zero,0,.02f);Physics.SyncTransforms();}
        start=scenery.playerRoot.position;
        for(int i=0;i<100;i++)
        {
            var prior=scenery.playerRoot.position;scenery.Step(Vector2.up,Vector2.zero,1,.02f);Physics.SyncTransforms();
            Check(Vector3.Distance(prior,scenery.playerRoot.position)<.3f,"sprint remains gradual and collision bounded");
        }
        Check(scenery.Sprinting && Vector3.ProjectOnPlane(scenery.playerRoot.position-start,Vector3.up).magnitude>walked*1.5f,"grip sprint traverses more ground than walking in the same time");
        for(int i=0;i<100;i++) {scenery.Step(Vector2.zero,Vector2.zero,1,.02f);Physics.SyncTransforms();}
        Check(!scenery.Sprinting && scenery.Speed<.1f,"release movement stops sprint even with grip held");
        Check(JsonConvert.SerializeObject(relay.State)==beforeState,"sprinting never changes the mission route");
        Check(terrain.cosmeticDetail!=null && terrain.rockDetail!=null,"generated sand and layered rock are bundled");
        if(terrain.Data.wideWalking)
        {
            foreach(var far in new[]{new SitePosition{x=-500,y=1500},new SitePosition{x=3500,y=1500},new SitePosition{x=1500,y=-500},new SitePosition{x=1500,y=3500}})
            {
                var point=terrain.WorldPoint(far);
                Check(terrain.InSurvey(point) && terrain.GroundAt(point,out var farHit),"wide Jezero landscape has walkable measured ground");
            }
            Check(!terrain.InSurvey(terrain.WorldPoint(new SitePosition{x=6000,y=1500})),"wide landscape respects its survey boundary");
        }
        var physicalPosition=scenery.Position;view.Recenter();view.Tick(2);scenery.Step(Vector2.zero,Vector2.zero,0,.02f);Physics.SyncTransforms();
        Check(Navigation.Distance(physicalPosition,scenery.Position)<.1,"recentring preserves the planner location");
        // Walk the real main path and the far-point shelter path through physics.
        // Server acknowledgements are replayed here; socket guards have their own integration test.
        void WalkPath(System.Collections.Generic.List<Waypoint> path,bool reroute)
        {
            void Publish(int index)
            {
                var q=path[index];var s=new MissionState {version=1,route=reroute ? "reroute":"main",rerouteFrom=reroute ? document.main.Count-1:(int?)null,waypointIndex=index,
                    mode=reroute ? "storm":"nominal",storm=reroute,headingDeg=q.headingDeg,openSky=q.openSky,oxygenFraction=q.oxygenFraction,doseFraction=q.doseFraction,
                    baseLink=q.@base.visible,sunlit=q.sun.visible,earthLink=q.earth.visible,minutesToShelter=q.shelter.minutes,shelterBearingDeg=q.shelter.az,earthDelayMinutes=11};
                relay.Preview(s,document,relay.Site);
            }
            Publish(0);scenery.ReturnToRoute();Physics.SyncTransforms();scenery.TickBeacon();
            int expectedGoal=reroute ? path.Count-1:3;
            Check(scenery.Beacon.Visible && scenery.Beacon.TargetIndex==expectedGoal,"beacon follows the active mission stop or emergency shelter");
            Check(Vector3.Distance(scenery.Beacon.WorldPosition,terrain.WorldPoint(path[expectedGoal].pos)+Vector3.up*.06f)<.01f,"route change places beacon on its own destination");
            Check(reroute ? scenery.Beacon.Tone.r>scenery.Beacon.Tone.g : scenery.Beacon.Tone.g>scenery.Beacon.Tone.r,"emergency beacon uses a distinct warm colour");
            for(int i=0;i<50;i++) {scenery.Step(Vector2.zero,Vector2.zero,0,.02f);Physics.SyncTransforms();}
            for(int index=1;index<path.Count;index++)
            {
                int frames=0;double distance=Navigation.Distance(scenery.Position,path[index].pos);
                int limit=(int)(distance/scenery.fastSpeed/.05*4)+250;
                while(distance>WalkNavigation.ArrivalRadius && frames++<limit)
                {
                    float bearing=(float)Navigation.Bearing(scenery.Position,path[index].pos);
                    rig.centerEyeAnchor.rotation=Quaternion.Euler(0,view.NorthYaw+bearing,0);
                    scenery.Step(Vector2.up,Vector2.zero,1,.05f);Physics.SyncTransforms();
                    distance=Navigation.Distance(scenery.Position,path[index].pos);
                }
                Check(distance<=WalkNavigation.ArrivalRadius,$"physical {(reroute ? "shelter":"main")} path reaches {path[index].id}; remaining {distance:F2} m");
                Publish(index);
            }
            Check(!reroute || scenery.InShelter,"walking the shelter route produces actual arrival");
            scenery.TickBeacon();Check(!scenery.Beacon.Visible,"destination beacon disappears on actual arrival");
            for(int i=0;i<100;i++) {scenery.Step(Vector2.up,Vector2.zero,1,.05f);Physics.SyncTransforms();}
            scenery.TickBeacon();hud.Tick();
            Check(Navigation.Distance(scenery.Position,path[path.Count-1].pos)>WalkNavigation.ArrivalRadius,"completion test walks away from the reached beacon");
            Check(scenery.TargetIndex==-1 && scenery.WaypointIndex==-1 && !scenery.Beacon.Visible && !compassArrow.gameObject.activeSelf,"walking away never reopens a completed destination arrow or beacon");
            Check(!reroute || !scenery.InShelter,"completed route does not falsely claim current shelter cover");
        }
        WalkPath(document.main,false);WalkPath(document.reroutes[(document.main.Count-1).ToString()],true);
        view.SetImmersive(false);var arPosition=scenery.playerRoot.position;
        scenery.Step(Vector2.up,Vector2.right,1,.05f);
        Check(!terrain.gameObject.activeSelf && !view.passthrough.hidden && !scenery.Sprinting,"AR restores passthrough and hides VR terrain / sprint");
        Check(arPosition==Vector3.zero && scenery.playerRoot.position==arPosition && scenery.playerRoot.rotation==Quaternion.identity,"AR restores the physical tracking frame and ignores sticks");
        Check(!scenery.Beacon.Visible,"AR does not project a false Mars waypoint into the room");
        Check(!ShaderUtil.ShaderHasError(terrain.surfaceShader),"photo shader compiles");
        Check(File.Exists("Assets/StreamingAssets/ThirdParty/AccessMars-LICENSE.txt"),"redistributed licence is included in APK assets");
        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);Debug.Log($"BEACON_VR_CHECKS_PASSED: {checks}");
    }
}
