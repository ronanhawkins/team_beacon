using System;
using System.IO;
using System.Linq;
using Beacon;
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
    const string ScenePath = "Assets/Beacon/Scenes/BeaconAR.unity";
    [MenuItem("Beacon/Prepare native Quest app")]
    public static void Prepare()
    {
        Directory.CreateDirectory("Assets/Beacon/Scenes"); Directory.CreateDirectory("Assets/XR");
        PlayerSettings.companyName = "Team Beacon"; PlayerSettings.productName = "Beacon AR";
        PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, "com.teambeacon.ar");
        PlayerSettings.bundleVersion = "0.3.0"; PlayerSettings.Android.bundleVersionCode = 3;
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
        var rig = rigObject.GetComponent<OVRCameraRig>();
        var manager = rigObject.GetComponent<OVRManager>() ?? rigObject.AddComponent<OVRManager>();
        manager.isInsightPassthroughEnabled = true; manager.trackingOriginType = OVRManager.TrackingOrigin.Stage;
        foreach (var camera in rig.GetComponentsInChildren<Camera>(true)) { camera.clearFlags = CameraClearFlags.SolidColor; camera.backgroundColor = Color.clear; camera.nearClipPlane = .05f; camera.farClipPlane = 100; }
        var passthrough = new GameObject("Room passthrough").AddComponent<OVRPassthroughLayer>();
        passthrough.textureOpacity = 1; passthrough.edgeRenderingEnabled = false;
        RenderSettings.skybox = null;
        var app = new GameObject("Beacon mission"); var relay = app.AddComponent<BeaconRelay>();
        var hud = app.AddComponent<BeaconHud>(); hud.rig = rig; hud.relay = relay; hud.font = font;
        EditorSceneManager.SaveScene(scene, ScenePath);
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        AssetDatabase.SaveAssets();
        Debug.Log("BEACON_PREPARED: Native passthrough scene and OpenXR settings ready");
    }
    [MenuItem("Beacon/Build Quest APK")]
    public static void BuildAndroid()
    {
        if (!File.Exists(ScenePath)) Prepare();
        Directory.CreateDirectory("Builds");
        var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions {
            scenes = new[] { ScenePath }, target = BuildTarget.Android,
            locationPathName = "Builds/BeaconAR.apk", options = BuildOptions.Development,
        });
        if (report.summary.result != BuildResult.Succeeded) throw new Exception("Quest build failed: " + report.summary.result);
        Debug.Log("BEACON_APK_READY: " + Path.GetFullPath("Builds/BeaconAR.apk"));
    }
}
