using System;
using System.IO;
using System.Linq;
using Beacon;
using Newtonsoft.Json.Linq;
using TMPro;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEditor.XR.Management;
using UnityEditor.XR.Management.Metadata;
using UnityEditor.XR.OpenXR.Features;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.XR.Management;
using UnityEngine.XR.OpenXR;
using UnityEngine.XR.OpenXR.Features;

public static class BeaconBuild
{
    public const string SiteKey="jezero";
    public static string WaypointsFile(string repo) => Path.Combine(repo,"data/out/jezero/waypoints.json");
    public static string SiteFile(string repo) => Path.Combine(repo,"data/sites/jezero/site.json");
    const string ScenePath = "Assets/Beacon/Scenes/BeaconAR.unity";
    [MenuItem("Beacon/Prepare native Quest app")]
    public static void Prepare()
    {
        Directory.CreateDirectory("Assets/Beacon/Scenes"); Directory.CreateDirectory("Assets/XR");
        PlayerSettings.companyName = "Team Beacon"; PlayerSettings.productName = "Beacon AR";
        PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, "com.teambeacon.ar");
        PlayerSettings.bundleVersion = "0.17.0"; PlayerSettings.Android.bundleVersionCode = 17;
        PlayerSettings.SetScriptingBackend(NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
        PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
        PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel32;
        PlayerSettings.Android.targetSdkVersion = (AndroidSdkVersions)34;
        PlayerSettings.Android.forceInternetPermission = true;
        PlayerSettings.insecureHttpOption = InsecureHttpOption.DevelopmentOnly;
        PlayerSettings.colorSpace = ColorSpace.Linear;
        PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.Android, false);
        PlayerSettings.SetGraphicsAPIs(BuildTarget.Android, new[] { GraphicsDeviceType.Vulkan });
        PlayerSettings.runInBackground = true;
        QualitySettings.antiAliasing = 4; QualitySettings.vSyncCount = 0;
        QualitySettings.anisotropicFiltering=AnisotropicFiltering.ForceEnable;
        // Enable the new input backend required by OpenXR.
        var settingsObject = new SerializedObject(AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/ProjectSettings.asset")[0]);
        settingsObject.FindProperty("activeInputHandler").intValue = 1; settingsObject.ApplyModifiedPropertiesWithoutUndo();

        if (!EditorBuildSettings.TryGetConfigObject(XRGeneralSettings.k_SettingsKey, out XRGeneralSettingsPerBuildTarget settings))
        {
            settings = ScriptableObject.CreateInstance<XRGeneralSettingsPerBuildTarget>();
            AssetDatabase.CreateAsset(settings, "Assets/XR/XRGeneralSettings.asset");
            EditorBuildSettings.AddConfigObject(XRGeneralSettings.k_SettingsKey, settings, true);
        }
        foreach (var target in new[] { BuildTargetGroup.Android, BuildTargetGroup.Standalone })
        {
            if (!settings.HasManagerSettingsForBuildTarget(target)) settings.CreateDefaultManagerSettingsForBuildTarget(target);
            var general = settings.SettingsForBuildTarget(target); general.InitManagerOnStart = true;
            if (!XRPackageMetadataStore.AssignLoader(general.Manager, "UnityEngine.XR.OpenXR.OpenXRLoader", target)) throw new Exception("Could not enable OpenXR");
            var featureSet = OpenXRFeatureSetManager.GetFeatureSetWithId(target, "com.meta.openxr.featureset.metaxr");
            if (featureSet != null) { featureSet.isEnabled = true; OpenXRFeatureSetManager.SetFeaturesFromEnabledFeatureSets(target); }
            var xr = OpenXRSettings.GetSettingsForBuildTargetGroup(target);
            if (xr == null) throw new Exception("OpenXR settings are missing");
            xr.renderMode = OpenXRSettings.RenderMode.SinglePassInstanced;
            foreach (var feature in xr.GetFeatures<OpenXRFeature>())
            {
                if (new[] { "MetaXRFeature", "OculusTouchControllerProfile", "MetaQuestTouchPlusControllerProfile" }.Contains(feature.GetType().Name)) feature.enabled = true;
                if (target == BuildTargetGroup.Android && feature.GetType().Name == "MetaQuestFeature") feature.enabled = true;
            }
            EditorUtility.SetDirty(xr); EditorUtility.SetDirty(general); EditorUtility.SetDirty(general.Manager);
        }
        EditorUtility.SetDirty(settings);
        var config = OVRProjectConfig.CachedProjectConfig;
        config.insightPassthroughSupport = OVRProjectConfig.FeatureSupport.Required;
        // Meta's default network policy blocks even localhost. Allow only the
        // loopback endpoint carried by adb reverse, keeping other HTTP blocked.
        config.securityXmlPath = "Assets/Beacon/Config/usb_network_security.xml";
        config.targetDeviceTypes = new System.Collections.Generic.List<OVRProjectConfig.DeviceType> { OVRProjectConfig.DeviceType.Quest3 };
        OVRProjectConfig.CommitProjectConfig(config);

        var font = AssetDatabase.LoadAssetAtPath<TMP_FontAsset>("Assets/TextMesh Pro/Resources/Fonts & Materials/LiberationSans SDF.asset");
        if (font == null)
        {
            var package = UnityEditor.PackageManager.PackageInfo.FindForAssembly(typeof(TMP_Text).Assembly);
            AssetDatabase.ImportPackage(Path.Combine(package.resolvedPath, "Package Resources/TMP Essential Resources.unitypackage"), false);
            AssetDatabase.Refresh();
            font = AssetDatabase.LoadAssetAtPath<TMP_FontAsset>("Assets/TextMesh Pro/Resources/Fonts & Materials/LiberationSans SDF.asset");
            if (font == null) throw new Exception("TMP font resources are not ready; rerun Prepare after import");
        }
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Packages/com.meta.xr.sdk.core/Prefabs/OVRCameraRig.prefab");
        if (prefab == null) throw new Exception("Meta camera rig prefab is missing");
        var rigObject = (GameObject)PrefabUtility.InstantiatePrefab(prefab);
        var playerRoot=new GameObject("VR movement root",typeof(CharacterController));
        playerRoot.GetComponent<CharacterController>().enabled=false;
        rigObject.transform.SetParent(playerRoot.transform,false);
        var rig = rigObject.GetComponent<OVRCameraRig>();
        var manager = rigObject.GetComponent<OVRManager>() ?? rigObject.AddComponent<OVRManager>();
        manager.isInsightPassthroughEnabled = true; manager.trackingOriginType = OVRManager.TrackingOrigin.Stage;
        foreach (var camera in rig.GetComponentsInChildren<Camera>(true)) { camera.clearFlags = CameraClearFlags.SolidColor; camera.backgroundColor = Color.clear; camera.nearClipPlane = .05f; camera.farClipPlane = 5000; }
        var passthrough = new GameObject("Room passthrough").AddComponent<OVRPassthroughLayer>();
        passthrough.textureOpacity = 1; passthrough.edgeRenderingEnabled = false;
        RenderSettings.skybox = null;
        var app = new GameObject("Beacon mission"); var relay = app.AddComponent<BeaconRelay>();
        app.AddComponent<BeaconPerformance>();
        var hud = app.AddComponent<BeaconHud>(); hud.rig = rig; hud.relay = relay; hud.font = font;
        var missionView=app.AddComponent<BeaconMissionView>(); missionView.rig=rig; missionView.relay=relay; missionView.font=font;
        missionView.passthrough=passthrough;
        missionView.skylineShader=AssetDatabase.LoadAssetAtPath<Shader>("Assets/Beacon/Shaders/Skyline.shader");
        if(missionView.skylineShader==null) throw new Exception("Skyline shader is missing");
        hud.missionView=missionView;
        var terrain=new GameObject("Planner-aligned Mars terrain").AddComponent<MissionTerrain>();
        const string terrainPath="Assets/Beacon/Art/JezeroTerrain/";
        terrain.heights=AssetDatabase.LoadAssetAtPath<TextAsset>(terrainPath+"height.bytes");
        terrain.backgroundHeights=AssetDatabase.LoadAssetAtPath<TextAsset>(terrainPath+"background.bytes");
        terrain.shadowData=AssetDatabase.LoadAssetAtPath<TextAsset>(terrainPath+"shadow.bytes");
        terrain.metadata=AssetDatabase.LoadAssetAtPath<TextAsset>(terrainPath+"terrain.json");
        terrain.surfaceShader=AssetDatabase.LoadAssetAtPath<Shader>("Assets/Beacon/Shaders/MissionTerrain.shader");
        Texture2D Texture(string path,int size,bool repeat)
        {
            var importer=AssetImporter.GetAtPath(path) as TextureImporter;
            if(importer==null) throw new Exception("Missing terrain texture: "+path);
            importer.textureType=TextureImporterType.Default;importer.sRGBTexture=true;
            importer.maxTextureSize=size;importer.mipmapEnabled=true;importer.isReadable=false;
            importer.wrapMode=repeat ? TextureWrapMode.Repeat:TextureWrapMode.Clamp;importer.anisoLevel=8;
            importer.SetPlatformTextureSettings(new TextureImporterPlatformSettings {name="Android",overridden=true,maxTextureSize=size,format=TextureImporterFormat.ASTC_6x6});
            importer.SaveAndReimport();return AssetDatabase.LoadAssetAtPath<Texture2D>(path);
        }
        terrain.orbital=Texture(terrainPath+"orbital.jpg",4096,false);
        terrain.backgroundPhoto=Texture(terrainPath+"background.jpg",4096,false);
        terrain.cosmeticDetail=Texture("Assets/Beacon/Art/MarsCosmeticDetail.png",2048,true);
        terrain.rockDetail=Texture("Assets/Beacon/Art/MarsLayeredRock.png",2048,true);
        if(terrain.heights==null || terrain.metadata==null || terrain.backgroundHeights==null) throw new Exception("Run tools/prepare-jezero-native.py first");
        terrain.gameObject.SetActive(false);
        var scenery=app.AddComponent<BeaconVrScenery>();scenery.rig=rig;scenery.missionView=missionView;
        scenery.terrain=terrain;scenery.playerRoot=playerRoot.transform;missionView.vrScenery=scenery;
        var atmosphere = app.AddComponent<MarsAtmosphere>(); atmosphere.rig = rig; atmosphere.relay = relay;
        atmosphere.externalVrScenery=true;
        atmosphere.missionView=missionView; missionView.atmosphere=atmosphere;
        atmosphere.skyShader = AssetDatabase.LoadAssetAtPath<Shader>("Assets/Beacon/Shaders/MarsAtmosphere.shader");
        const string photoPath="Assets/Beacon/Art/MurrayButtes-PIA20840.jpg";
        var photoImporter=AssetImporter.GetAtPath(photoPath) as TextureImporter;
        if(photoImporter==null) throw new Exception("NASA panorama is missing");
        photoImporter.textureType=TextureImporterType.Default; photoImporter.sRGBTexture=true;
        photoImporter.maxTextureSize=4096; photoImporter.mipmapEnabled=true; photoImporter.isReadable=true;
        photoImporter.wrapModeU=TextureWrapMode.Repeat; photoImporter.wrapModeV=TextureWrapMode.Clamp;
        photoImporter.SetPlatformTextureSettings(new TextureImporterPlatformSettings {name="Android",overridden=true,maxTextureSize=4096,format=TextureImporterFormat.ASTC_6x6});
        photoImporter.SaveAndReimport();
        atmosphere.panorama=AssetDatabase.LoadAssetAtPath<Texture2D>(photoPath);
        atmosphere.panoramaBounds=MakePanoramaBounds(atmosphere.panorama);
        photoImporter.isReadable=false; photoImporter.SaveAndReimport();
        if (atmosphere.skyShader == null || atmosphere.panorama==null) throw new Exception("Mars atmosphere assets are missing");
        EditorSceneManager.SaveScene(scene, ScenePath);
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        AssetDatabase.SaveAssets();
        Debug.Log("BEACON_PREPARED: Native passthrough scene and OpenXR settings ready");
    }
    static Texture2D MakePanoramaBounds(Texture2D photo)
    {
        const string path="Assets/Beacon/Art/PanoramaBounds.asset";
        const int columns=256;
        var bounds=AssetDatabase.LoadAssetAtPath<Texture2D>(path);
        if(bounds==null) { bounds=new Texture2D(columns,1,TextureFormat.RGBA32,false,true); AssetDatabase.CreateAsset(bounds,path); }
        bounds.name="NASA mosaic captured bounds"; bounds.wrapMode=TextureWrapMode.Repeat; bounds.filterMode=FilterMode.Bilinear;
        var pixels=photo.GetPixels32(); var values=new Color[columns];
        bool Missing(int x,int y) { var c=pixels[y*photo.width+x]; return c.r+c.g+c.b<20; }
        for(int i=0;i<columns;i++)
        {
            int lower=0,upper=photo.height-1;
            for(int neighbour=-2;neighbour<=2;neighbour++)
            {
                int x=((int)((i+.5f)*photo.width/columns)+neighbour+photo.width)%photo.width;
                int lo=0,hi=photo.height-1;
                while(lo<photo.height-1 && Missing(x,lo)) lo++;
                while(hi>lo && Missing(x,hi)) hi--;
                lower=Mathf.Max(lower,lo); upper=Mathf.Min(upper,hi);
            }
            values[i]=new Color((lower+3f)/photo.height,(upper-3f)/photo.height,0,1);
        }
        // Be conservative near abrupt stitching edges. Bilinear interpolation
        // between a tall and short captured column must not reveal a black sliver.
        var guarded=new Color[columns];
        for(int i=0;i<columns;i++)
        {
            float low=0,high=1;
            for(int j=-3;j<=3;j++) { var v=values[(i+j+columns)%columns]; low=Mathf.Max(low,v.r); high=Mathf.Min(high,v.g); }
            guarded[i]=new Color(low,high,0,1);
        }
        bounds.SetPixels(guarded); bounds.Apply(false,false); EditorUtility.SetDirty(bounds); return bounds;
    }
    [MenuItem("Beacon/Build Quest APK")]
    public static void BuildAndroid()
    {
        if (!File.Exists(ScenePath)) Prepare();
        PlayerSettings.productName="Beacon AR";
        PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android,"com.teambeacon.ar");
        PlayerSettings.bundleVersion="0.17.0"; PlayerSettings.Android.bundleVersionCode=17;
        Directory.CreateDirectory("Builds");
        var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions {
            scenes = new[] { ScenePath }, target = BuildTarget.Android,
            locationPathName = "Builds/BeaconAR.apk", options = BuildOptions.Development,
        });
        if (report.summary.result != BuildResult.Succeeded) throw new Exception("Quest build failed: " + report.summary.result);
        Debug.Log("BEACON_APK_READY: " + Path.GetFullPath("Builds/BeaconAR.apk"));
    }
}
