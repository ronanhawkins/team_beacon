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
        void Capture(string name,int index,bool storm=false,bool vr=false,bool lookAtButte=false,bool offline=false,bool recenter=false,bool calibrate=true,float gaze=0)
        {
            var p=storm ? doc.reroutes[(doc.main.Count-1).ToString()][index] : doc.main[index];
            var state=new MissionState {version=1,route=storm ? "reroute":"main",rerouteFrom=storm ? doc.main.Count-1:(int?)null,waypointIndex=index,
                storm=storm,mode=storm ? "storm":p.@base.visible ? "nominal":"warning",headingDeg=p.headingDeg,
                shelterBearingDeg=p.shelter.az,minutesToShelter=p.shelter.minutes,openSky=p.openSky,doseFraction=p.doseFraction,
                oxygenFraction=p.oxygenFraction,sunlit=p.sun.visible,baseLink=p.@base.visible,earthLink=p.earth.visible,earthDelayMinutes=delay};
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
        // Exercise the same hold handler used by physical right B. A short tap,
        // base, offline relay and walking away from base must all explain the
        // outcome in the shelter card instead of silently doing nothing.
        void Input(bool pressed,float seconds=.1f) => hud.ProcessShelterButton(pressed,seconds).GetAwaiter().GetResult();
        void Hold() {Input(false);for(int i=0;i<11;i++) Input(true);hud.Tick();}
        void Require(bool ok,string why) {if(!ok) throw new Exception("Shelter input: "+why);}
        void CaptureFeedback(string name)
        {
            hud.Tick();Canvas.ForceUpdateCanvases();camera.transform.SetPositionAndRotation(rig.centerEyeAnchor.position,rig.centerEyeAnchor.rotation);
            camera.Render();RenderTexture.active=target;var picture=new Texture2D(target.width,target.height,TextureFormat.RGB24,false);
            picture.ReadPixels(new Rect(0,0,target.width,target.height),0,0);picture.Apply();File.WriteAllBytes(Path.Combine(folder,name+".png"),picture.EncodeToPNG());UnityEngine.Object.DestroyImmediate(picture);
            var card=hudRoot.Find("Side reading SHELTER");
            foreach(var text in card.GetComponentsInChildren<TMP_Text>())
            {text.ForceMeshUpdate();Require(text.GetPreferredValues(text.text,float.PositiveInfinity,float.PositiveInfinity).x<=text.rectTransform.rect.width+1,"shelter feedback fits without ellipsis: "+text.text);}
        }
        Capture("shelter-input-base",0);
        Input(true,2);Require(hud.ShelterHoldProgress<.11f,"a stalled frame must not confirm a hold");Input(false);
        Require(hud.ShelterNotice=="HOLD B · 1 SEC","a short tap explains the hold");CaptureFeedback("shelter-tap-hint");
        Input(true,.1f);CaptureFeedback("shelter-hold-progress");Input(false);
        Hold();Require(hud.ShelterNotice=="ALREADY SAFE","base explains why no diversion is needed");CaptureFeedback("shelter-already-covered");
        relay.PreviewOffline();Input(true);Require(hud.ShelterNotice=="ALREADY SAFE","held B does not repeat when state changes");
        Hold();Require(hud.ShelterNotice=="LAPTOP OFFLINE","offline request is explained");CaptureFeedback("shelter-request-offline");Input(false);
        Capture("shelter-input-away",19);Hold();Require(hud.ShelterNotice=="REQUEST FAILED","a disconnected socket never claims success");CaptureFeedback("shelter-request-failed");Input(false);
        Capture("shelter-input-active",0,storm:true);Hold();Require(hud.ShelterNotice=="ROUTE ACTIVE","existing diversion is explicitly acknowledged");CaptureFeedback("shelter-route-active");Input(false);
        Capture("shelter-input-vr",0,vr:true);
        for(int i=0;i<120;i++) view.vrScenery.Step(Vector2.up,Vector2.zero,0,.05f);
        Require(!view.vrScenery.InShelter,"walk physically away from base");
        Hold();Require(hud.ShelterNotice=="REQUEST FAILED","walking away from the base sample reaches the request sender");Input(false);
        view.SetImmersive(false);
        Debug.Log("BEACON_SHELTER_INPUT_PASSED: short tap, one-second hold, no repeat, long-frame guard, base, offline, send failure, VR walk away, readable feedback");
        RenderTexture.active=null; camera.targetTexture=null; target.Release(); UnityEngine.Object.DestroyImmediate(target);
        if(ShaderUtil.ShaderHasError(view.skylineShader)) throw new Exception("Skyline shader failed");
        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
        Debug.Log("BEACON_MISSION_PREVIEWS_READY");
    }
}
