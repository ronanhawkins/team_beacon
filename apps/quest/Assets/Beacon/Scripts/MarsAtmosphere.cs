using System;
using UnityEngine;
using UnityEngine.Rendering;

namespace Beacon
{
    // An illustrative AR atmosphere, not a terrain or weather simulation.
    // One static sky draw; no moving particles or camera-feed processing.
    public sealed class MarsAtmosphere : MonoBehaviour
    {
        public OVRCameraRig rig;
        public BeaconRelay relay;
        public BeaconMissionView missionView;
        public Shader skyShader;
        public Texture2D panorama, panoramaBounds;
        public bool externalVrScenery;
        public bool effectsEnabled = true;
        Transform eye, visuals, sky;
        Material skyMaterial;
        Mesh skyMesh;
        AudioSource wind;
        AudioClip windClip;
        float storm;
        bool paused, immersive;
        public float StormStrength => storm;

        void Start() => CreateVisuals(rig.centerEyeAnchor);
        public void CreateVisuals(Transform viewpoint)
        {
            if (visuals != null) return;
            if (skyShader == null) throw new InvalidOperationException("Mars atmosphere shaders are missing");
            eye = viewpoint;
            visuals = new GameObject("Mars atmosphere effects").transform;
            visuals.SetParent(transform, false);
            skyMaterial = new Material(skyShader) { name = "Mars sky and sun" };
            skyMaterial.SetFloat("_SunVisibility",0);
            skyMaterial.SetTexture("_Panorama",panorama);
            skyMaterial.SetTexture("_PanoramaBounds",panoramaBounds);
            skyMaterial.SetFloat("_HasPanorama",panorama!=null && !externalVrScenery ? 1 : 0);
            skyMesh = MakeDome();
            sky = Draw("Dusty sky, sun and horizon haze", skyMesh, skyMaterial);
            sky.position=eye.position;
            wind = gameObject.AddComponent<AudioSource>(); wind.loop = true; wind.spatialBlend = 0;
            wind.volume = .04f; windClip = MakeWind(); wind.clip = windClip;
            SetEffectsEnabled(effectsEnabled);
            SetImmersive(immersive);
            UpdateSun();
        }
        Transform Draw(string name, Mesh mesh, Material material)
        {
            var obj = new GameObject(name, typeof(MeshFilter), typeof(MeshRenderer));
            obj.transform.SetParent(visuals, false);
            obj.GetComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = obj.GetComponent<MeshRenderer>(); renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off; renderer.receiveShadows = false;
            renderer.lightProbeUsage = LightProbeUsage.Off; renderer.reflectionProbeUsage = ReflectionProbeUsage.Off;
            return obj.transform;
        }
        public void SetEffectsEnabled(bool enabled)
        {
            effectsEnabled = enabled;
            if (visuals == null) return;
            visuals.gameObject.SetActive(enabled || immersive);
            if (enabled && !paused) wind.Play(); else wind.Stop();
            Debug.Log("BEACON_ATMOSPHERE: " + (enabled ? "Mars AR" : "Clear passthrough"));
        }
        public void SetImmersive(bool enabled)
        {
            immersive=enabled;
            if(visuals==null) return;
            skyMaterial.SetFloat("_Immersive",enabled ? 1 : 0);
            visuals.gameObject.SetActive(effectsEnabled || enabled);
        }
        public void UpdateSun()
        {
            if(skyMaterial==null || missionView==null) return;
            skyMaterial.SetFloat("_NorthYaw",missionView.NorthYaw);
            bool available=relay!=null && relay.Connected && relay.Selection!=null;
            skyMaterial.SetFloat("_SunVisibility",available && relay.Selection.Point.sun.visible && relay.State.sunlit ? 1 : 0);
            if(available) skyMaterial.SetVector("_SunDirection",missionView.SkyDirection(relay.Selection.Point.sun));
        }
        public void SetStormStrength(float strength)
        {
            storm = Mathf.Clamp01(strength);
            skyMaterial.SetFloat("_Storm", storm);
            wind.volume = Mathf.Lerp(.04f, .10f, storm);
            wind.pitch = Mathf.Lerp(.8f, 1.05f, storm);
        }
        void LateUpdate()
        {
            if (visuals == null) return;
            sky.position = eye.position;
            if (OVRInput.GetDown(OVRInput.Button.One, OVRInput.Controller.RTouch)) SetEffectsEnabled(!effectsEnabled);
            UpdateSun();
            // A panic request is not a solar-storm event. Only the actual storm
            // flag strengthens these artistic effects; offline data fades calm.
            bool stormActive = relay != null && MissionPresentation.StormAtmosphere(relay.State,relay.Connected);
            SetStormStrength(Mathf.MoveTowards(storm, stormActive ? 1 : 0, Time.unscaledDeltaTime / 4));
        }
        void OnApplicationPause(bool pause)
        {
            paused = pause;
            if (wind == null) return;
            if (!pause && effectsEnabled) wind.Play(); else wind.Stop();
        }
        void OnDestroy()
        {
            if (visuals != null) Release(visuals.gameObject);
            Release(skyMesh); Release(skyMaterial); Release(windClip);
        }
        static void Release(UnityEngine.Object asset)
        { if (asset == null) return; if (Application.isPlaying) Destroy(asset); else DestroyImmediate(asset); }
        static Mesh MakeDome()
        {
            const int longitude = 48, latitude = 24;
            var vertices = new Vector3[(longitude + 1) * (latitude + 1)];
            var triangles = new int[longitude * latitude * 6];
            for (int y = 0; y <= latitude; y++) for (int x = 0; x <= longitude; x++)
            {
                float az = x * Mathf.PI * 2 / longitude, el = y * Mathf.PI / latitude;
                vertices[y * (longitude + 1) + x] = new Vector3(Mathf.Sin(el) * Mathf.Sin(az), Mathf.Cos(el), Mathf.Sin(el) * Mathf.Cos(az)) * 40;
            }
            int index = 0;
            for (int y = 0; y < latitude; y++) for (int x = 0; x < longitude; x++)
            {
                int a = y * (longitude + 1) + x, b = a + longitude + 1;
                triangles[index++] = a; triangles[index++] = b; triangles[index++] = a + 1;
                triangles[index++] = a + 1; triangles[index++] = b; triangles[index++] = b + 1;
            }
            var mesh = new Mesh { name = "Low-poly atmosphere dome", vertices = vertices, triangles = triangles };
            mesh.RecalculateBounds(); mesh.UploadMeshData(true); return mesh;
        }
        static AudioClip MakeWind()
        {
            const int rate = 16000, length = rate * 6;
            var samples = new float[length]; var random = new System.Random(163);
            float low = 0;
            for (int i = 0; i < length; i++)
            {
                low = low * .985f + ((float)random.NextDouble() * 2 - 1) * .015f;
                float envelope = .7f + .15f * Mathf.Sin(i * Mathf.PI * 2 / length) + .15f * Mathf.Sin(i * Mathf.PI * 6 / length);
                float seam = Mathf.Min(1, Mathf.Min(i, length - 1 - i) / 400f);
                samples[i] = low * envelope * seam * 3;
            }
            var clip = AudioClip.Create("Soft Martian wind", length, 1, rate, false); clip.SetData(samples, 0); return clip;
        }
    }
}
