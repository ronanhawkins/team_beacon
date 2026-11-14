using System;
using System.IO;
using Beacon;
using Newtonsoft.Json;
using TMPro;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class BeaconVrPreview
{
    public static void Render()
    {
        EditorSceneManager.OpenScene("Assets/Beacon/Scenes/BeaconAR.unity",OpenSceneMode.Single);
        var rig=BeaconVrVerify.PrepareRig();var relay=UnityEngine.Object.FindFirstObjectByType<BeaconRelay>();
        var view=UnityEngine.Object.FindFirstObjectByType<BeaconMissionView>();var atmosphere=UnityEngine.Object.FindFirstObjectByType<MarsAtmosphere>();
        var hud=UnityEngine.Object.FindFirstObjectByType<BeaconHud>();
        string repo=Path.GetFullPath("../.."),folder=Path.Combine(repo,".local","murray-vr-previews");Directory.CreateDirectory(folder);
        var document=JsonConvert.DeserializeObject<RouteDocument>(File.ReadAllText(Path.Combine(repo,"data/out/waypoints.json")));
        var p=document.main[19];var state=new MissionState {version=1,route="main",waypointIndex=19,mode="nominal",headingDeg=p.headingDeg,
            openSky=p.openSky,oxygenFraction=p.oxygenFraction,doseFraction=p.doseFraction,baseLink=p.@base.visible,sunlit=p.sun.visible,
            earthLink=p.earth.visible,minutesToShelter=p.shelter.minutes,shelterBearingDeg=p.shelter.az,earthDelayMinutes=11};
        relay.Preview(state,document,JsonConvert.DeserializeObject<MissionSite>(File.ReadAllText(Path.Combine(repo,"data/site.json"))));
        view.CreateVisuals();view.Calibrate();atmosphere.CreateVisuals(rig.centerEyeAnchor);hud.CreateVisuals();view.SetImmersive(true);
        var camera=new GameObject("Murray scene preview camera").AddComponent<Camera>();camera.clearFlags=CameraClearFlags.SolidColor;
        camera.backgroundColor=new Color(.35f,.35f,.35f);camera.nearClipPlane=.05f;camera.farClipPlane=5000;
        camera.fieldOfView=90;camera.stereoTargetEye=StereoTargetEyeMask.None;
        var target=new RenderTexture(1600,1000,24,RenderTextureFormat.ARGB32);target.Create();camera.targetTexture=target;
        void Capture(string name,float azimuth,bool showHud=true,bool ar=false,bool cosmetic=true)
        {
            view.SetImmersive(!ar);rig.centerEyeAnchor.rotation=Quaternion.Euler(-5,view.NorthYaw+azimuth,0);
            view.vrScenery.terrain.SetCosmeticEnabled(cosmetic);
            view.Tick(10);atmosphere.UpdateSun();hud.Refresh();hud.Tick();
            foreach(var canvas in rig.centerEyeAnchor.GetComponentsInChildren<Canvas>(true)) canvas.enabled=showHud;
            view.transform.Find("Waypoint skyline ring").gameObject.SetActive(showHud);
            camera.transform.SetPositionAndRotation(rig.centerEyeAnchor.position,rig.centerEyeAnchor.rotation);
            Canvas.ForceUpdateCanvases();foreach(var text in UnityEngine.Object.FindObjectsByType<TMP_Text>(FindObjectsInactive.Include,FindObjectsSortMode.None)) text.ForceMeshUpdate(true,true);
            camera.Render();RenderTexture.active=target;var image=new Texture2D(1600,1000,TextureFormat.RGB24,false);
            image.ReadPixels(new Rect(0,0,1600,1000),0,0);image.Apply();File.WriteAllBytes(Path.Combine(folder,name+".png"),image.EncodeToPNG());UnityEngine.Object.DestroyImmediate(image);
        }
        Capture("m12-reference",330,false);Capture("m12-ring-alignment",330);Capture("east-reference",90,false);Capture("south-reference",180,false);
        Capture("east-original",90,false,cosmetic:false);Capture("east-cosmetic",90,false);
        Capture("quela-ar-ring",330,true,true);
        RenderTexture.active=null;camera.targetTexture=null;target.Release();UnityEngine.Object.DestroyImmediate(target);
        if(ShaderUtil.ShaderHasError(view.vrScenery.terrain.surfaceShader)) throw new Exception("Access Mars shader failed");
        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);Debug.Log("BEACON_VR_PREVIEWS_READY");
    }
}
