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
    public static void Run()
    {
        checks=0;EditorSceneManager.OpenScene("Assets/Beacon/Scenes/BeaconAR.unity",OpenSceneMode.Single);
        var rig=PrepareRig();var scenery=UnityEngine.Object.FindFirstObjectByType<BeaconVrScenery>();scenery.Create();
        var view=scenery.missionView;var relay=view.relay;var terrain=scenery.terrain;
        Check(!terrain.gameObject.activeSelf && !scenery.Active,"AR must start with all VR scenery hidden");
        Check(!scenery.playerRoot.GetComponent<CharacterController>().enabled,"AR must not enable virtual movement");
        Check(terrain.VisibleTriangles==158096 && terrain.CollisionTriangles==127952,"source triangle counts / budget");
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
        var document=JsonConvert.DeserializeObject<RouteDocument>(File.ReadAllText(Path.Combine(repo,"data/out/waypoints.json")));
        var p=document.main[19];var state=new MissionState {version=1,route="main",waypointIndex=19,mode="nominal",headingDeg=p.headingDeg,
            openSky=p.openSky,oxygenFraction=p.oxygenFraction,doseFraction=p.doseFraction,baseLink=p.@base.visible,sunlit=p.sun.visible,
            earthLink=p.earth.visible,minutesToShelter=p.shelter.minutes,shelterBearingDeg=p.shelter.az,earthDelayMinutes=11};
        relay.Preview(state,document,JsonConvert.DeserializeObject<MissionSite>(File.ReadAllText(Path.Combine(repo,"data/site.json"))));
        view.CreateVisuals();view.Calibrate();float north=view.NorthYaw;var sun=view.SkyDirection(p.sun);
        string beforeState=JsonConvert.SerializeObject(relay.State);
        view.SetImmersive(true);Physics.SyncTransforms();
        Check(scenery.Active && terrain.gameObject.activeSelf && view.passthrough.hidden,"VR shows scenery and hides room");
        Check(terrain.GroundAt(rig.centerEyeAnchor.position,out var hit),"starting view has photographed ground below it");
        Check(Mathf.Abs(hit.point.y)<.1f,"original scene scale and spawn height are correct");
        for(int i=0;i<50;i++) {scenery.Step(Vector2.zero,Vector2.zero,0,.02f);Physics.SyncTransforms();}
        var start=scenery.playerRoot.position;
        for(int i=0;i<100;i++)
        {
            var prior=scenery.playerRoot.position;scenery.Step(Vector2.up,Vector2.zero,0,.02f);Physics.SyncTransforms();
            Check(Vector3.Distance(prior,scenery.playerRoot.position)<.3f,"stick movement has no teleport jumps");
        }
        Check(Vector3.Distance(start,scenery.playerRoot.position)>1,"left stick produces continuous movement");
        float yaw=rig.centerEyeAnchor.eulerAngles.y;scenery.Step(Vector2.zero,Vector2.right,0,.02f);
        Check(Mathf.Abs(Mathf.DeltaAngle(yaw,rig.centerEyeAnchor.eulerAngles.y)-.8f)<.01f,"right stick turns smoothly");
        Check(JsonConvert.SerializeObject(relay.State)==beforeState,"walking and turning leave the mission route unchanged");
        Check(view.NorthYaw==north && Vector3.Angle(view.SkyDirection(p.sun),sun)<.01f,"walking and turning preserve the measured Sun frame");
        Check(BeaconVrScenery.Stick(new Vector2(.1f,0))==Vector2.zero,"stick dead zone");
        Check(Mathf.Abs(BeaconVrScenery.Stick(Vector2.one).magnitude-1)<.001f,"diagonal speed normalization");
        view.SetImmersive(false);var arPosition=scenery.playerRoot.position;
        scenery.Step(Vector2.up,Vector2.right,1,.05f);
        Check(!terrain.gameObject.activeSelf && !view.passthrough.hidden,"AR restores passthrough and hides VR terrain");
        Check(arPosition==Vector3.zero && scenery.playerRoot.position==arPosition && scenery.playerRoot.rotation==Quaternion.identity,"AR restores the physical tracking frame and ignores sticks");
        Check(!ShaderUtil.ShaderHasError(terrain.surfaceShader),"photo shader compiles");
        Check(File.Exists("Assets/StreamingAssets/ThirdParty/AccessMars-LICENSE.txt"),"redistributed licence is included in APK assets");
        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);Debug.Log($"BEACON_VR_CHECKS_PASSED: {checks}");
    }
}
