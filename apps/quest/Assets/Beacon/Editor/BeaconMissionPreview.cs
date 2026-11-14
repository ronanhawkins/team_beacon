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
        var doc=JsonConvert.DeserializeObject<RouteDocument>(File.ReadAllText(Path.Combine(repo,"data/out/waypoints.json")));
        string siteJson=File.ReadAllText(Path.Combine(repo,"data/site.json"));
        var site=JsonConvert.DeserializeObject<MissionSite>(siteJson); double delay=(double)JObject.Parse(siteJson)["earthDelayMinutes"];
        var camera=new GameObject("Acceptance preview camera").AddComponent<Camera>();
        camera.clearFlags=CameraClearFlags.SolidColor; camera.backgroundColor=new Color(.25f,.27f,.29f,1);
        camera.nearClipPlane=.05f; camera.farClipPlane=100; camera.fieldOfView=90; camera.stereoTargetEye=StereoTargetEyeMask.None;
        var target=new RenderTexture(1600,1000,24,RenderTextureFormat.ARGB32); target.Create(); camera.targetTexture=target;
        void Capture(string name,int index,bool storm=false,bool vr=false,bool lookAtButte=false)
        {
            var p=storm ? doc.reroutes["30"][index] : doc.main[index];
            var state=new MissionState {version=1,route=storm ? "reroute":"main",rerouteFrom=storm ? 30:(int?)null,waypointIndex=index,
                storm=storm,mode=storm ? "storm":p.@base.visible ? "nominal":"warning",headingDeg=p.headingDeg,
                shelterBearingDeg=p.shelter.az,minutesToShelter=p.shelter.minutes,openSky=p.openSky,doseFraction=p.doseFraction,
                oxygenFraction=p.oxygenFraction,sunlit=p.sun.visible,baseLink=p.@base.visible,earthLink=p.earth.visible,earthDelayMinutes=delay};
            rig.centerEyeAnchor.rotation=Quaternion.identity;
            relay.Preview(state,doc,site); view.Calibrate(); view.SetImmersive(vr); view.Tick(10);
            if(lookAtButte) rig.centerEyeAnchor.rotation=Quaternion.Euler(0,view.NorthYaw+315,0);
            view.Tick(10); atmosphere.UpdateSun(); atmosphere.SetStormStrength(storm ? 1:0); hud.Refresh(); hud.Tick();
            camera.transform.SetPositionAndRotation(rig.centerEyeAnchor.position,rig.centerEyeAnchor.rotation);
            Canvas.ForceUpdateCanvases();
            foreach(var text in UnityEngine.Object.FindObjectsByType<TMP_Text>(FindObjectsInactive.Include,FindObjectsSortMode.None)) text.ForceMeshUpdate(true,true);
            camera.Render(); RenderTexture.active=target;
            var image=new Texture2D(1600,1000,TextureFormat.RGB24,false); image.ReadPixels(new Rect(0,0,1600,1000),0,0); image.Apply();
            File.WriteAllBytes(Path.Combine(folder,name+".png"),image.EncodeToPNG()); UnityEngine.Object.DestroyImmediate(image);
        }
        Capture("m00-base",0); Capture("m19-science",19); Capture("m19-northwest",19,lookAtButte:true);
        Capture("m25-warning",25); Capture("m30-storm",0,storm:true);
        Capture("shelter-arrival",doc.reroutes["30"].Count-1,storm:true); Capture("vr-fallback",19,vr:true);
        RenderTexture.active=null; camera.targetTexture=null; target.Release(); UnityEngine.Object.DestroyImmediate(target);
        if(ShaderUtil.ShaderHasError(view.skylineShader)) throw new Exception("Skyline shader failed");
        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
        Debug.Log("BEACON_MISSION_PREVIEWS_READY");
    }
}
