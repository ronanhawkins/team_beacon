using System;
using System.IO;
using Beacon;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class BeaconAtmospherePreview
{
    // Offline material preview on neutral grey; this is not a Quest capture.
    [MenuItem("Beacon/Render atmosphere preview")]
    public static void Render()
    {
        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        var camera = new GameObject("Preview camera").AddComponent<Camera>();
        camera.transform.position = new Vector3(0,1.65f,0);
        camera.transform.rotation = Quaternion.Euler(-5,35,0);
        camera.clearFlags = CameraClearFlags.SolidColor; camera.backgroundColor = new Color(.26f,.28f,.30f,1);
        camera.nearClipPlane = .05f; camera.farClipPlane = 100; camera.fieldOfView = 70;
        camera.stereoTargetEye = StereoTargetEyeMask.None;
        var atmosphere = new GameObject("Preview atmosphere").AddComponent<MarsAtmosphere>();
        atmosphere.skyShader = AssetDatabase.LoadAssetAtPath<Shader>("Assets/Beacon/Shaders/MarsAtmosphere.shader");
        atmosphere.CreateVisuals(camera.transform);
        var target = new RenderTexture(1280,720,24,RenderTextureFormat.ARGB32); target.Create(); camera.targetTexture = target;
        string folder = Path.GetFullPath("../../.local"); Directory.CreateDirectory(folder);
        foreach (bool storm in new[] { false, true })
        {
            atmosphere.SetStormStrength(storm ? 1 : 0);
            camera.Render(); RenderTexture.active = target;
            var image = new Texture2D(1280,720,TextureFormat.RGB24,false);
            image.ReadPixels(new Rect(0,0,1280,720),0,0); image.Apply();
            File.WriteAllBytes(Path.Combine(folder,storm ? "mars-atmosphere-storm.png" : "mars-atmosphere-calm.png"),image.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(image);
        }
        RenderTexture.active = null; camera.targetTexture = null; target.Release(); UnityEngine.Object.DestroyImmediate(target);
        foreach (var shader in new[] { atmosphere.skyShader })
            if (ShaderUtil.ShaderHasError(shader)) throw new Exception("Atmosphere shader did not compile: " + shader.name);
        UnityEngine.Object.DestroyImmediate(atmosphere.gameObject); UnityEngine.Object.DestroyImmediate(camera.gameObject);
        Debug.Log("BEACON_ATMOSPHERE_PREVIEW_READY");
    }
}
