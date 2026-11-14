using System;
using System.IO;
using Beacon;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using TMPro;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class BeaconMissionPreview
{
    [MenuItem("Beacon/Render mission acceptance previews")]
    public static void Render()
    {
        EditorSceneManager.OpenScene("Assets/Beacon/Scenes/BeaconAR.unity",OpenSceneMode.Single);
        var rig=UnityEngine.Object.FindFirstObjectByType<OVRCameraRig>(); rig.enabled=false;
        if(rig.centerEyeAnchor==null) typeof(OVRCameraRig).GetMethod("EnsureGameObjectIntegrity",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic).Invoke(rig,null);
        foreach(var cameraInRig in rig.GetComponentsInChildren<Camera>(true)) cameraInRig.enabled=false;
        rig.centerEyeAnchor.position=new Vector3(0,1.65f,0); rig.centerEyeAnchor.rotation=Quaternion.identity;
        var relay=UnityEngine.Object.FindFirstObjectByType<BeaconRelay>();
        var view=UnityEngine.Object.FindFirstObjectByType<BeaconMissionView>();
        var hud=UnityEngine.Object.FindFirstObjectByType<BeaconHud>();
        var atmosphere=UnityEngine.Object.FindFirstObjectByType<MarsAtmosphere>();
        view.CreateVisuals(); atmosphere.CreateVisuals(rig.centerEyeAnchor); hud.CreateVisuals();
        string repo=Path.GetFullPath("../.."),folder=Path.Combine(repo,".local","mission-previews"); Directory.CreateDirectory(folder);
        var doc=JsonConvert.DeserializeObject<RouteDocument>(File.ReadAllText(BeaconBuild.WaypointsFile(repo)));
        string siteJson=File.ReadAllText(BeaconBuild.SiteFile(repo));
        var site=JsonConvert.DeserializeObject<MissionSite>(siteJson); double delay=(double)JObject.Parse(siteJson)["earthDelayMinutes"];
        var camera=new GameObject("Acceptance preview camera").AddComponent<Camera>();
        camera.clearFlags=CameraClearFlags.SolidColor; camera.backgroundColor=new Color(.25f,.27f,.29f,1);
        camera.nearClipPlane=.05f; camera.farClipPlane=5000; camera.fieldOfView=90; camera.stereoTargetEye=StereoTargetEyeMask.None;
        var target=new RenderTexture(1600,1000,24,RenderTextureFormat.ARGB32); target.Create(); camera.targetTexture=target;
        MissionState StateAt(int index,bool storm=false,int? origin=null)
        {
            int from=origin ?? doc.main.Count-1;
            var p=storm ? doc.reroutes[from.ToString()][index] : doc.main[index];
            return new MissionState {version=1,route=storm ? "reroute":"main",rerouteFrom=storm ? from:(int?)null,waypointIndex=index,
                storm=storm,mode=storm ? "storm":p.@base.visible ? "nominal":"warning",headingDeg=p.headingDeg,
                shelterBearingDeg=p.shelter.az,minutesToShelter=p.shelter.minutes,openSky=p.openSky,doseFraction=p.doseFraction,
                oxygenFraction=p.oxygenFraction,sunlit=p.sun.visible,baseLink=p.@base.visible,earthLink=p.earth.visible,earthDelayMinutes=delay};
        }
        void Capture(string name,int index,bool storm=false,bool vr=false,bool lookAtButte=false,bool offline=false,bool recenter=false,bool calibrate=true,float gaze=0)
        {
            var state=StateAt(index,storm);
            rig.centerEyeAnchor.rotation=Quaternion.Euler(0,gaze,0);
            relay.Preview(state,doc,site); if(calibrate) view.Calibrate(); view.SetImmersive(vr); view.Tick(10);
            if(lookAtButte) rig.centerEyeAnchor.rotation=Quaternion.Euler(0,view.NorthYaw+315,0);
            if(offline) relay.PreviewOffline();
            if(recenter) view.Recenter();
            view.Tick(10); atmosphere.UpdateSun(); atmosphere.SetStormStrength(storm && !offline ? 1:0); hud.Refresh(); hud.Tick();
            camera.transform.SetPositionAndRotation(rig.centerEyeAnchor.position,rig.centerEyeAnchor.rotation);
            Canvas.ForceUpdateCanvases();
            foreach(var text in UnityEngine.Object.FindObjectsByType<TMP_Text>(FindObjectsInactive.Include,FindObjectsSortMode.None)) text.ForceMeshUpdate(true,true);
            camera.Render(); RenderTexture.active=target;
            var image=new Texture2D(1600,1000,TextureFormat.RGB24,false); image.ReadPixels(new Rect(0,0,1600,1000),0,0); image.Apply();
            File.WriteAllBytes(Path.Combine(folder,name+".png"),image.EncodeToPNG()); UnityEngine.Object.DestroyImmediate(image);
        }
        Capture("m00-base",0);
        var fixedSun=view.SkyDirection(doc.main[0].sun); float fixedNorth=view.NorthYaw;
        Capture("fixed-sun-after-route-step",19,calibrate:false,gaze:90);
        if(Mathf.Abs(Mathf.DeltaAngle(fixedNorth,view.NorthYaw))>.001f || Vector3.Angle(fixedSun,view.SkyDirection(doc.main[0].sun))>.01f)
            throw new Exception("Head turn / route step rotated the calibrated Sun");
        var skyMesh=view.transform.Find("Waypoint skyline ring/72-sample blocked sky").GetComponent<MeshFilter>().sharedMesh;
        for(int i=0;i<72;i++)
            if(skyMesh.vertices[i*6].y<-.001f || skyMesh.colors[i*6+4].a!=0 || skyMesh.colors[i*6+2].a!=0 || skyMesh.colors[i*6+3].a!=0)
                throw new Exception("Skyline masks the ground or draws a baseline / contour");
        var hudRoot=rig.centerEyeAnchor.Find("Readable peripheral HUD");
        if(hudRoot.Find("Quiet mission line")!=null) throw new Exception("Old bottom reading strip remains");
        foreach(string caption in new[]{"SHELTER","BASE","SUNLIGHT","OXYGEN","DOSE USED"})
            if(Mathf.Abs(hudRoot.Find("Side reading "+caption).localPosition.x)<.35f) throw new Exception("Mission reading is not at the side");
        var atmosphereRoot=atmosphere.transform.Find("Mars atmosphere effects");
        if(atmosphereRoot.GetComponentsInChildren<MeshRenderer>(true).Length!=1)
            throw new Exception("Moving dust geometry was not removed");
        Debug.Log("BEACON_VISUAL_REGRESSIONS_PASSED: side readings, no contour, fixed Sun, unchanged north, clear ground, no baseline, no particles");
        Capture("m19-science",19); Capture("m19-northwest",19,lookAtButte:true);
        Capture("m25-warning",25); Capture("m30-storm",0,storm:true);
        Capture("shelter-arrival",doc.reroutes[(doc.main.Count-1).ToString()].Count-1,storm:true); Capture("vr-fallback",19,vr:true);
        Capture("offline-calm",19,offline:true); Capture("offline-emergency",0,storm:true,offline:true);
        Capture("recenter-feedback",19,recenter:true);
        // Exercise the actual A/B handler with delayed, correlated replies.
        // The separate relay tests verify the real server's command handling.
        var sent=new System.Collections.Generic.List<JObject>();
        relay.PreviewTransport=message => {sent.Add(message);return System.Threading.Tasks.Task.FromResult(true);};
        void Release() => hud.ProcessDemoButtons(false,false).GetAwaiter().GetResult();
        System.Threading.Tasks.Task Tap(bool reset) {Release();return hud.ProcessDemoButtons(!reset,reset);}
        string LastId() => (string)sent[sent.Count-1]["requestId"];
        void Reply(MissionState state,string id) {relay.Preview(state,doc,site);relay.PreviewCommandReply(id);hud.Tick();}
        void Require(bool ok,string why) {if(!ok) throw new Exception("Demo input: "+why);}
        void CaptureFeedback(string name)
        {
            hud.Tick();Canvas.ForceUpdateCanvases();camera.transform.SetPositionAndRotation(rig.centerEyeAnchor.position,rig.centerEyeAnchor.rotation);
            camera.Render();RenderTexture.active=target;var picture=new Texture2D(target.width,target.height,TextureFormat.RGB24,false);
            picture.ReadPixels(new Rect(0,0,target.width,target.height),0,0);picture.Apply();File.WriteAllBytes(Path.Combine(folder,name+".png"),picture.EncodeToPNG());UnityEngine.Object.DestroyImmediate(picture);
            var card=hudRoot.Find("Side reading SHELTER");
            foreach(var text in card.GetComponentsInChildren<TMP_Text>())
            {text.ForceMeshUpdate();Require(text.GetPreferredValues(text.text,float.PositiveInfinity,float.PositiveInfinity).x<=text.rectTransform.rect.width+1,"shelter feedback fits without ellipsis: "+text.text);}
        }
        Capture("demo-input-base",0);
        var stormTask=Tap(false);string stormId=LastId();
        Require(sent.Count==1 && (string)sent[0]["type"]=="storm" && (bool)sent[0]["on"],"one B press immediately starts a storm, including at base");
        Require(!stormTask.IsCompleted && relay.SimulationCommandPending,"sending alone never claims success");
        hud.ProcessDemoButtons(true,false).GetAwaiter().GetResult();Require(sent.Count==1,"held B never repeats");
        relay.PreviewCommandReply("wrong-id");Require(!stormTask.IsCompleted,"unrelated replies cannot confirm a command");
        Reply(StateAt(0,true,0),stormId);stormTask.GetAwaiter().GetResult();
        Require(hud.ShelterNotice=="STAY COVERED" && relay.State.storm,"a confirmed storm under cover asks the wearer to stay covered");CaptureFeedback("button-b-storm");

        Capture("demo-input-vr",19,vr:true);
        for(int i=0;i<120;i++) {view.vrScenery.Step(Vector2.up,Vector2.zero,1,.05f);Physics.SyncTransforms();}
        var beforeReset=view.vrScenery.Position;
        stormTask=Tap(false);stormId=LastId();int nearest=WalkNavigation.ClosestMain(doc,beforeReset);
        Require((int)sent[sent.Count-1]["atIndex"]==nearest,"VR storm selects the nearest supplied main route origin");
        Reply(StateAt(0,true,nearest),stormId);stormTask.GetAwaiter().GetResult();
        Require(Navigation.Distance(beforeReset,view.vrScenery.Position)<.01,"storm changes the route without teleporting the wearer");
        Require(hud.ShelterNotice=="TAKE COVER","an exposed wearer gets the storm take-cover warning");CaptureFeedback("button-b-storm-exposed");
        var resetTask=Tap(true);string resetId=LastId();
        Require((string)sent[sent.Count-1]["type"]=="reset" && !resetTask.IsCompleted,"A requests a confirmed reset");
        int pendingCount=sent.Count;
        Require(!relay.AdvanceWaypoint().GetAwaiter().GetResult() && sent.Count==pendingCount,"arrival events pause while reset is pending");
        relay.Preview(StateAt(0),doc,site);
        Require(Navigation.Distance(beforeReset,view.vrScenery.Position)<.01,"uncorrelated base state cannot teleport the wearer");
        relay.PreviewCommandReply(resetId);resetTask.GetAwaiter().GetResult();Physics.SyncTransforms();hud.Tick();
        Require(view.Immersive && Navigation.Distance(view.vrScenery.Position,doc.main[0].pos)<.05,"confirmed A reset returns VR to base without changing mode");
        Require(view.vrScenery.Speed==0 && !view.vrScenery.Sprinting && hud.ShelterNotice=="RESET","reset clears motion and reports success");
        hud.ProcessDemoButtons(false,true).GetAwaiter().GetResult();Require(sent.Count==pendingCount,"held A never repeats");CaptureFeedback("button-a-reset");
        Release();var both=hud.ProcessDemoButtons(true,true);resetId=LastId();
        Require((string)sent[sent.Count-1]["type"]=="reset","A wins simultaneous presses");
        relay.PreviewCommandReply(resetId);both.GetAwaiter().GetResult();Require(!relay.SimulationCommandPending,"already-reset state can acknowledge another reset");

        stormTask=Tap(false);stormId=LastId();
        resetTask=hud.ProcessDemoButtons(true,true);resetId=LastId();
        Reply(StateAt(0,true,0),stormId);Require(!resetTask.IsCompleted,"late B reply cannot confirm or cancel A");
        Reply(StateAt(0),resetId);resetTask.GetAwaiter().GetResult();stormTask.GetAwaiter().GetResult();
        Require(hud.ShelterNotice=="RESET" && !relay.State.storm,"reset supersedes a pending storm without stale feedback");

        relay.PreviewOffline();Tap(false).GetAwaiter().GetResult();Require(hud.ShelterNotice=="LAPTOP OFFLINE","offline B never invents a storm");
        Tap(true).GetAwaiter().GetResult();Require(hud.ShelterNotice=="LAPTOP OFFLINE","offline A never claims reset");CaptureFeedback("buttons-offline");
        relay.Preview(StateAt(0),doc,site);relay.PreviewTransport=message => System.Threading.Tasks.Task.FromResult(false);
        Tap(false).GetAwaiter().GetResult();Require(hud.ShelterNotice=="REQUEST FAILED" && !relay.SimulationCommandPending,"failed send clears command state");CaptureFeedback("buttons-send-failed");
        relay.PreviewTransport=message => {sent.Add(message);return System.Threading.Tasks.Task.FromResult(true);};
        resetTask=Tap(true);
        typeof(BeaconRelay).GetField("commandDeadline",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic).SetValue(relay,-1f);
        relay.SendMessage("Update");resetTask.GetAwaiter().GetResult();Require(hud.ShelterNotice=="REQUEST FAILED" && !relay.SimulationCommandPending,"missing acknowledgement times out without claiming reset");
        relay.PreviewTransport=null;Release();
        relay.Preview(StateAt(0),doc,site);view.vrScenery.ReturnToRoute();
        view.vrScenery.playerRoot.position+=Vector3.right*6;Physics.SyncTransforms();
        relay.Preview(StateAt(0,true,0),doc,site);view.vrScenery.TickBeacon();hud.Tick();
        Require(view.vrScenery.WaypointIndex==0 && view.vrScenery.Beacon.Visible,"a new one-point shelter diversion remains visible before physical arrival");
        view.vrScenery.ReturnToRoute();view.vrScenery.TickBeacon();
        view.vrScenery.playerRoot.position+=Vector3.right*6;Physics.SyncTransforms();view.vrScenery.TickBeacon();hud.Tick();
        Require(view.vrScenery.WaypointIndex==-1 && !view.vrScenery.Beacon.Visible && !view.vrScenery.InShelter,"after visiting that shelter, walking away keeps its beacon completed and reports outside cover");
        view.SetImmersive(false);
        Debug.Log("BEACON_DEMO_INPUT_PASSED: B storm, A reset, no repeat, reset precedence, confirmed VR return, stale reply, offline, send failure, timeout, readable feedback");
        RenderTexture.active=null; camera.targetTexture=null; target.Release(); UnityEngine.Object.DestroyImmediate(target);
        if(ShaderUtil.ShaderHasError(view.skylineShader)) throw new Exception("Skyline shader failed");
        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
        Debug.Log("BEACON_MISSION_PREVIEWS_READY");
    }
}
