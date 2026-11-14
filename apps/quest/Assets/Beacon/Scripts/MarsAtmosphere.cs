using System;
using UnityEngine;
using UnityEngine.Rendering;

namespace Beacon
{
    // An illustrative AR atmosphere, not a terrain or weather simulation.
    // Two lightweight mesh draws; no camera feed processing or depth assumptions.
    public sealed class MarsAtmosphere : MonoBehaviour
    {
        public OVRCameraRig rig;
        public BeaconRelay relay;
        public Shader skyShader, dustShader;
        public bool effectsEnabled = true;
        Transform eye, visuals, sky;
        Material skyMaterial, dustMaterial;
        Mesh skyMesh, dustMesh;
        AudioSource wind;
        AudioClip windClip;
        float storm;
        bool aligned, paused;
        public float StormStrength => storm;

        void Start() => CreateVisuals(rig.centerEyeAnchor);
        public void CreateVisuals(Transform viewpoint)
        {
            if (visuals != null) return;
            if (skyShader == null || dustShader == null) throw new InvalidOperationException("Mars atmosphere shaders are missing");
            eye = viewpoint;
            visuals = new GameObject("Mars atmosphere effects").transform;
            visuals.SetParent(transform, false);
            skyMaterial = new Material(skyShader) { name = "Mars sky and sun" };
            dustMaterial = new Material(dustShader) { name = "Airborne ochre dust" };
            skyMesh = MakeDome(); dustMesh = MakeDust();
            sky = Draw("Dusty sky, sun and horizon haze", skyMesh, skyMaterial);
            Draw("Drifting sand and low red mist", dustMesh, dustMaterial);
            SetSun(45);
            wind = gameObject.AddComponent<AudioSource>(); wind.loop = true; wind.spatialBlend = 0;
            wind.volume = .04f; windClip = MakeWind(); wind.clip = windClip;
            SetEffectsEnabled(effectsEnabled);
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
            visuals.gameObject.SetActive(enabled);
            if (enabled && !paused) wind.Play(); else wind.Stop();
            Debug.Log("BEACON_ATMOSPHERE: " + (enabled ? "Mars AR" : "Clear passthrough"));
        }
        public void SetStormStrength(float strength)
        {
            storm = Mathf.Clamp01(strength);
            skyMaterial.SetFloat("_Storm", storm); dustMaterial.SetFloat("_Storm", storm);
            wind.volume = Mathf.Lerp(.04f, .10f, storm);
            wind.pitch = Mathf.Lerp(.8f, 1.05f, storm);
        }
        void SetSun(float azimuth)
        {
            float radians = azimuth * Mathf.Deg2Rad, elevation = 12 * Mathf.Deg2Rad;
            skyMaterial.SetVector("_SunDirection", new Vector4(Mathf.Sin(radians) * Mathf.Cos(elevation), Mathf.Sin(elevation), Mathf.Cos(radians) * Mathf.Cos(elevation), 0));
        }
        void LateUpdate()
        {
            if (visuals == null) return;
            sky.position = eye.position;
            if (OVRInput.GetDown(OVRInput.Button.One, OVRInput.Controller.RTouch)) SetEffectsEnabled(!effectsEnabled);
            if (!aligned && Time.timeSinceLevelLoad > 1 && OVRPlugin.GetNodeOrientationTracked(OVRPlugin.Node.EyeCenter))
            {
                SetSun(Mathf.Atan2(eye.forward.x, eye.forward.z) * Mathf.Rad2Deg + 45);
                aligned = true;
            }
            // Panic alone does not invent weather. Offline data stops driving it.
            bool stormActive = relay != null && relay.Connected && (relay.State?.storm == true || relay.State?.mode == "storm");
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
            Release(skyMesh); Release(dustMesh); Release(skyMaterial); Release(dustMaterial); Release(windClip);
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
        static Mesh MakeDust()
        {
            const int grains = 160, wisps = 24, count = grains + wisps;
            var random = new System.Random(7361);
            float Range(float min, float max) => Mathf.Lerp(min, max, (float)random.NextDouble());
            var vertices = new Vector3[count * 4]; var uv = new Vector2[count * 4];
            var sizes = new Vector2[count * 4]; var drift = new Vector2[count * 4];
            var colours = new Color[count * 4]; var triangles = new int[count * 6];
            var corners = new[] { new Vector2(-1,-1), new Vector2(-1,1), new Vector2(1,1), new Vector2(1,-1) };
            for (int n = 0; n < count; n++)
            {
                bool mist = n >= grains;
                var centre = new Vector3(0, mist ? Range(.10f, .65f) : Range(.08f, n % 5 == 0 ? 3 : 1.1f), Range(-12, 12));
                float radius = Range(.018f, .045f);
                var size = mist ? new Vector2(Range(2.4f, 5.5f), Range(.25f, .55f)) : new Vector2(radius, radius * .38f);
                var motion = new Vector2(mist ? Range(.010f,.018f) : Range(.025f,.045f), Range(0,1));
                var colour = mist ? new Color(.68f,.23f,.09f,.13f) : Color.Lerp(new Color(.64f,.32f,.13f,.55f), new Color(.94f,.65f,.32f,.75f), Range(0,1));
                for (int k = 0; k < 4; k++) { int i = n * 4 + k; vertices[i] = centre; uv[i] = corners[k]; sizes[i] = size; drift[i] = motion; colours[i] = colour; }
                int t = n * 6, v = n * 4;
                triangles[t] = v; triangles[t+1] = v+1; triangles[t+2] = v+2;
                triangles[t+3] = v; triangles[t+4] = v+2; triangles[t+5] = v+3;
            }
            var mesh = new Mesh { name = "184 lightweight dust billboards", vertices = vertices, uv = uv, uv2 = sizes, uv3 = drift, colors = colours, triangles = triangles };
            // Vertex animation crosses the field; static centres alone are not its bounds.
            mesh.bounds = new Bounds(new Vector3(0,2,0), new Vector3(38,9,30));
            mesh.UploadMeshData(true); return mesh;
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
