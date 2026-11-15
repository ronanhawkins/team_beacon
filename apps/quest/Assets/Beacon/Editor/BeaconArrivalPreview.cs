using System;
using System.IO;
using Beacon;
using Newtonsoft.Json;
using TMPro;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

// Focused checks for the base and arrival photographs only.
public static class BeaconArrivalPreview
{
    public static void Render() => Run(false);
    public static void RenderLayout() => Run(true);
    static void Run(bool layoutOnly)
    {
        foreach(string path in new[]{"PIA25681.jpg","PIA24921.jpg","HiRISE.jpg"})
        {
            var importer=(TextureImporter)AssetImporter.GetAtPath("Assets/Resources/WaypointPhotos/"+path);
            importer.textureType=TextureImporterType.Default;importer.textureShape=TextureImporterShape.Texture2D;importer.npotScale=TextureImporterNPOTScale.None;importer.sRGBTexture=true;importer.isReadable=false;
            importer.mipmapEnabled=true;importer.wrapMode=TextureWrapMode.Clamp;importer.maxTextureSize=path=="HiRISE.jpg" ? 4096:2048;
            importer.SetPlatformTextureSettings(new TextureImporterPlatformSettings {name="Android",overridden=true,maxTextureSize=importer.maxTextureSize,format=TextureImporterFormat.ASTC_6x6});
            importer.SaveAndReimport();
        }
        EditorSceneManager.OpenScene("Assets/Beacon/Scenes/BeaconAR.unity",OpenSceneMode.Single);
        var rig=UnityEngine.Object.FindFirstObjectByType<OVRCameraRig>();rig.enabled=false;
        if(rig.centerEyeAnchor==null) typeof(OVRCameraRig).GetMethod("EnsureGameObjectIntegrity",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic).Invoke(rig,null);
        foreach(var cam in rig.GetComponentsInChildren<Camera>(true)) cam.enabled=false;
        rig.centerEyeAnchor.position=new Vector3(0,1.65f,0);rig.centerEyeAnchor.rotation=Quaternion.identity;
        var relay=UnityEngine.Object.FindFirstObjectByType<BeaconRelay>();var view=UnityEngine.Object.FindFirstObjectByType<BeaconMissionView>();
        var hud=UnityEngine.Object.FindFirstObjectByType<BeaconHud>();var atmosphere=UnityEngine.Object.FindFirstObjectByType<MarsAtmosphere>();
        string repo=Path.GetFullPath("../.."),folder=Path.Combine(repo,".local","arrival21-previews");Directory.CreateDirectory(folder);
        var doc=JsonConvert.DeserializeObject<RouteDocument>(File.ReadAllText(BeaconBuild.WaypointsFile(repo)));
        var site=JsonConvert.DeserializeObject<MissionSite>(File.ReadAllText(BeaconBuild.SiteFile(repo)));
        void Select(int index)
        {
            var p=doc.main[index];relay.Preview(new MissionState {version=1,route="main",waypointIndex=index,mode="nominal",headingDeg=p.headingDeg,
                openSky=p.openSky,oxygenFraction=p.oxygenFraction,doseFraction=p.doseFraction,baseLink=p.@base.visible,sunlit=p.sun.visible,
                earthLink=p.earth.visible,minutesToShelter=p.shelter.minutes,shelterBearingDeg=p.shelter.az,earthDelayMinutes=11},doc,site);
        }
        int checks=0;
        void Require(bool valid,string why) {if(!valid) throw new Exception("Base / arrival: "+why);checks++;}
        Select(0);view.CreateVisuals();view.Calibrate();atmosphere.CreateVisuals(rig.centerEyeAnchor);hud.CreateVisuals();view.SetImmersive(true);
        var scenery=view.vrScenery;var habitat=scenery.Base;
        if(!layoutOnly)
        {
        Require(habitat?.Root!=null,"base absent");
        Require(Vector3.Distance(habitat.Root.position,scenery.terrain.WorldPoint(site.@base))<.001f,"base not at exported coordinate");
        Require(habitat.Triangles<2000,"base triangle budget");
        foreach(var box in habitat.Root.GetComponents<BoxCollider>())
        {
            float dx=Mathf.Max(0,Mathf.Abs(box.center.x)-box.size.x*.5f),dz=Mathf.Max(0,Mathf.Abs(box.center.z)-box.size.z*.5f);
            Require(Mathf.Sqrt(dx*dx+dz*dz)>3,"base blocks arrival / reset apron");
        }
        var before=habitat.Root.localPosition;
        scenery.terrain.transform.RotateAround(rig.centerEyeAnchor.position,Vector3.up,35);
        Require(Vector3.Distance(before,habitat.Root.localPosition)<.001f && Vector3.Distance(habitat.Root.position,scenery.terrain.WorldPoint(site.@base))<.001f,"base loses calibrated frame");
        scenery.ReturnToRoute();
        view.SetImmersive(false);Require(!habitat.Root.gameObject.activeInHierarchy,"base visible in passthrough");view.SetImmersive(true);
        Require(ShaderUtil.ShaderHasError(Resources.Load<Shader>("BeaconBase"))==false,"base shader failed");
        }
        var card=hud.ArrivalPhoto;
        Require(Resources.Load<TextAsset>("WaypointPhotos/catalog")!=null,"photo catalogue resource missing");
        Require(Resources.Load<Texture2D>("WaypointPhotos/PIA25681")!=null,"depot texture resource missing");
        Require(Resources.Load<Texture2D>("WaypointPhotos/PIA24921")!=null,"delta texture resource missing");
        void Photo(SitePosition position,float now,bool walking=true,bool connected=true) => card.Tick(relay.State,relay.Selection,site,position,walking,connected,now);
        card.Reset();Select(2);var depot=doc.main[3].pos;
        Photo(new SitePosition {x=depot.x+4,y=depot.y},0);Require(!card.Visible,"photo before arrival");
        Photo(depot,1);Require(card.Visible && card.WaypointId=="m03" && card.PhotoResource=="PIA25681","depot photo before relay acknowledgement: visible="+card.Visible+", id="+card.WaypointId+", resource="+card.PhotoResource+", selection="+relay.Selection.Index+", site="+site.site);
        Select(3);Photo(depot,2);Require(card.Visible,"card disappears on arrival acknowledgement");
        Photo(depot,5.99f);Require(card.Visible,"photo hides before five seconds");
        Photo(depot,6);Require(!card.Visible,"photo does not hide at five seconds");
        Photo(depot,14);Require(!card.Visible,"photo repeats while still in zone");
        Require(Mathf.Abs(card.Root.localPosition.x)<.001f && Mathf.Abs(Mathf.Atan2(card.Root.localPosition.y,card.Root.localPosition.z)*Mathf.Rad2Deg+24)<.01f,"photo is not bottom centre");
        if(!layoutOnly)
        {
        Select(36);var delta=doc.main[37].pos;Photo(new SitePosition{x=delta.x+20,y=delta.y},16);Require(!card.Visible,"remote science stop visible");
        Photo(delta,17);Require(card.Visible && card.PhotoResource=="PIA24921","delta panorama not selected");
        Require(card.Image.uvRect.width<1 && card.Image.rectTransform.sizeDelta.x>card.Image.rectTransform.sizeDelta.y,"panorama crop/aspect");
        Photo(delta,18,connected:false);Require(!card.Visible,"photo persists offline");
        relay.State.storm=true;relay.State.mode="storm";Photo(delta,19);Require(!card.Visible,"photo obscures emergency");relay.State.storm=false;relay.State.mode="nominal";
        card.Reset();Select(37);Photo(delta,20,walking:false);Require(card.Visible,"presenter AR arrival missing");
        Select(43);Photo(doc.main[43].pos,21);Require(card.Visible && card.PhotoResource=="HiRISE","far point satellite fallback missing");
        card.Reset();Select(0);Photo(site.@base,22);Require(card.Visible && card.PhotoResource=="HiRISE","base reset arrival missing");
        string actualSite=site.site;site.site="Gale";Photo(site.@base,23);Require(!card.Visible,"photo applied to wrong site");site.site=actualSite;
        card.Reset();Select(19);Photo(doc.main[19].pos,24,walking:false);Require(!card.Visible,"dense route sample creates popup");
        }
        var camera=new GameObject("Base and arrival preview").AddComponent<Camera>();camera.clearFlags=CameraClearFlags.SolidColor;camera.backgroundColor=new Color(.35f,.35f,.35f);
        camera.nearClipPlane=.05f;camera.farClipPlane=5000;camera.fieldOfView=75;camera.stereoTargetEye=StereoTargetEyeMask.None;
        var target=new RenderTexture(1600,1000,24);target.Create();camera.targetTexture=target;
        void Capture(string name,bool showHud)
        {
            view.Tick(10);atmosphere.SendMessage("LateUpdate");atmosphere.UpdateSun();hud.Refresh();hud.Tick();
            foreach(var canvas in rig.centerEyeAnchor.GetComponentsInChildren<Canvas>(true)) canvas.enabled=showHud;
            view.transform.Find("Waypoint skyline ring").gameObject.SetActive(showHud);
            camera.transform.SetPositionAndRotation(rig.centerEyeAnchor.position,rig.centerEyeAnchor.rotation);
            Canvas.ForceUpdateCanvases();foreach(var text in UnityEngine.Object.FindObjectsByType<TMP_Text>(FindObjectsInactive.Include,FindObjectsSortMode.None)) text.ForceMeshUpdate(true,true);
            camera.Render();RenderTexture.active=target;var image=new Texture2D(1600,1000,TextureFormat.RGB24,false);
            image.ReadPixels(new Rect(0,0,1600,1000),0,0);image.Apply();File.WriteAllBytes(Path.Combine(folder,name+".png"),image.EncodeToPNG());UnityEngine.Object.DestroyImmediate(image);
        }
        if(!layoutOnly)
        {
        Select(0);scenery.ReturnToRoute();
        rig.centerEyeAnchor.position=habitat.Root.TransformPoint(new Vector3(0,2.8f,-16));
        rig.centerEyeAnchor.rotation=Quaternion.LookRotation(habitat.Root.TransformPoint(new Vector3(0,1.7f,3))-rig.centerEyeAnchor.position);
        Capture("base-habitat",false);
        }
        rig.centerEyeAnchor.localPosition=new Vector3(0,1.65f,0);
        foreach(int index in layoutOnly ? new[]{3}:new[]{3,37,43})
        {
            Select(index);scenery.ReturnToRoute();card.Reset();rig.centerEyeAnchor.rotation=Quaternion.Euler(0,view.NorthYaw+330,0);
            Capture("arrival-m"+index.ToString("00"),true);
        }
        view.SetImmersive(false);Select(3);card.Reset();Capture("arrival-ar",true);
        RenderTexture.active=null;camera.targetTexture=null;target.Release();UnityEngine.Object.DestroyImmediate(target);
        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
        Debug.Log($"BEACON_ARRIVAL_CHECKS_PASSED: {checks} focused checks; {(layoutOnly ? 2:5)} previews");
    }
}
