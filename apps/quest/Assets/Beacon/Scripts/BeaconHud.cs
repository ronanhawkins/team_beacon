using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Beacon
{
    public sealed class BeaconHud : MonoBehaviour
    {
        public OVRCameraRig rig;
        public TMP_FontAsset font;
        public BeaconRelay relay;
        // Closer than the original dashboard, with a much smaller angular size.
        const float HudDepth = 1.2f, CompassWidth = 600, CompassHalfSpan = 70;
        static readonly Color White = Hex("F0F6F9"), Muted = Hex("9BAEBB"), Blue = Hex("72C7FF"), Mint = Hex("93E9CE"), Amber = Hex("FFCC82"), Red = Hex("FF9187");
        TMP_Text oxygen, dose, contact, doseCaption, alertTitle, alertDetail;
        readonly TMP_Text[] bearings = new TMP_Text[24];
        RectTransform root, waypoint;
        CanvasGroup alertGroup;
        Image alertBacking;
        CompassGraphic compass;
        ArrowGraphic waypointGraphic;
        Sprite rounded;
        string alertKey = "";
        float pulseUntil, north, nextCompassUpdate, requestHeld;
        bool aligned, requestSent;
        AudioSource sound;

        static Color Hex(string s) { ColorUtility.TryParseHtmlString("#" + s, out var c); return c; }
        static RectTransform Rect(string name, Transform parent, float x, float y, float w, float h)
        {
            var r = new GameObject(name, typeof(RectTransform)).GetComponent<RectTransform>();
            r.SetParent(parent, false); r.sizeDelta = new Vector2(w, h); r.anchoredPosition = new Vector2(x, y); return r;
        }
        Sprite MakeRounded()
        {
            var tex = new Texture2D(64, 64, TextureFormat.RGBA32, false) { filterMode = FilterMode.Bilinear };
            var pixels = new Color[64 * 64];
            for (int y = 0; y < 64; y++) for (int x = 0; x < 64; x++)
            {
                float dx = Mathf.Max(0, Mathf.Abs(x - 31.5f) - 17), dy = Mathf.Max(0, Mathf.Abs(y - 31.5f) - 17);
                pixels[y * 64 + x] = new Color(1, 1, 1, Mathf.Clamp01(14.5f - Mathf.Sqrt(dx * dx + dy * dy)));
            }
            tex.SetPixels(pixels); tex.Apply();
            return Sprite.Create(tex, new Rect(0, 0, 64, 64), new Vector2(.5f, .5f), 100, 0, SpriteMeshType.FullRect, new Vector4(17, 17, 17, 17));
        }
        Image Backing(Transform parent, float width, float height, Color color)
        {
            var image = Rect("Tint", parent, 0, 0, width, height).gameObject.AddComponent<Image>();
            image.sprite = rounded; image.type = Image.Type.Sliced; image.color = color; image.raycastTarget = false; return image;
        }
        RectTransform Surface(string name, float yaw, float pitch, float width, float height, float metres)
        {
            var p = Rect(name, root, 0, 0, width, height);
            p.localPosition = new Vector3(Mathf.Tan(yaw * Mathf.Deg2Rad) * HudDepth, Mathf.Tan(pitch * Mathf.Deg2Rad) * HudDepth, HudDepth);
            p.localScale = Vector3.one * (metres / width);
            var canvas = p.gameObject.AddComponent<Canvas>(); canvas.renderMode = RenderMode.WorldSpace;
            canvas.overrideSorting = true; canvas.sortingOrder = 100;
            return p;
        }
        TMP_Text Label(Transform parent, string value, float x, float y, float w, float h, float size, Color color, bool bold = false)
        {
            var text = Rect(value, parent, x, y, w, h).gameObject.AddComponent<TextMeshProUGUI>();
            text.font = font; text.text = value; text.fontSize = size; text.color = color;
            text.fontStyle = bold ? FontStyles.Bold : FontStyles.Normal; text.alignment = TextAlignmentOptions.MidlineLeft;
            text.textWrappingMode = TextWrappingModes.NoWrap; text.overflowMode = TextOverflowModes.Ellipsis; text.raycastTarget = false;
            text.outlineColor = new Color(0, 0, 0, .85f); text.outlineWidth = .15f;
            return text;
        }
        void Start()
        {
            rounded = MakeRounded(); root = Rect("Beacon peripheral HUD", rig.centerEyeAnchor, 0, 0, 1, 1); root.localPosition = Vector3.zero;
            var left = Surface("Oxygen corner", -35, -25, 240, 72, .19f);
            Backing(left, 240, 72, new Color(.025f, .045f, .06f, .48f));
            oxygen = Label(left, "O2 --", 0, 10, 214, 38, 32, Mint, true);
            contact = Label(left, "CONNECTING", 0, -20, 214, 20, 15, Muted);
            var right = Surface("Dose corner", 35, -25, 240, 72, .19f);
            Backing(right, 240, 72, new Color(.025f, .045f, .06f, .48f));
            dose = Label(right, "DOSE --", 0, 10, 214, 38, 32, White, true);
            doseCaption = Label(right, "BUDGET USED", 0, -20, 214, 20, 15, Muted);

            var tape = Surface("Top compass", 0, 27, CompassWidth, 72, .66f);
            Backing(tape, CompassWidth, 72, new Color(.025f, .045f, .06f, .30f));
            compass = Rect("Compass ticks", tape, 0, 0, CompassWidth, 72).gameObject.AddComponent<CompassGraphic>();
            compass.HalfSpan = CompassHalfSpan; compass.raycastTarget = false;
            string[] cardinal = { "N", "NE", "E", "SE", "S", "SW", "W", "NW" };
            for (int i = 0; i < bearings.Length; i++)
            {
                bool major = i % 3 == 0;
                bearings[i] = Label(tape, major ? cardinal[i / 3] : (i * 15).ToString(), 0, 12, 54, 27, major ? 22 : 16, major ? White : Muted, major);
                bearings[i].alignment = TextAlignmentOptions.Center;
            }
            // The sole navigation marker lives on the compass. It turns sideways
            // at the tape edge when the waypoint is outside the visible bearings.
            waypoint = Rect("Waypoint arrow", tape, 0, -22, 16, 16);
            waypointGraphic = waypoint.gameObject.AddComponent<ArrowGraphic>(); waypointGraphic.color = Blue; waypointGraphic.raycastTarget = false;

            var alert = Surface("Corner alert", 34, 25, 280, 80, .25f);
            alertBacking = Backing(alert, 280, 80, new Color(.22f, .04f, .05f, .78f));
            alertTitle = Label(alert, "", 0, 15, 254, 30, 24, Red, true);
            alertDetail = Label(alert, "", 0, -18, 254, 25, 17, White);
            alertGroup = alert.gameObject.AddComponent<CanvasGroup>(); alert.gameObject.SetActive(false);
            sound = gameObject.AddComponent<AudioSource>(); sound.spatialBlend = 0; sound.volume = .15f; sound.clip = Chime();
            relay.Changed += Refresh; Refresh(); UpdateCompass(0);
        }
        void OnDestroy() { if (relay != null) relay.Changed -= Refresh; }
        static AudioClip Chime()
        {
            const int rate = 24000; var clip = AudioClip.Create("Beacon alert", rate / 3, 1, rate, false); var samples = new float[rate / 3];
            for (int i = 0; i < samples.Length; i++) { float t = (float)i / rate; samples[i] = Mathf.Sin(2 * Mathf.PI * (t < .16f ? 660 : 880) * t) * Mathf.Sin(Mathf.PI * i / samples.Length) * .5f; }
            clip.SetData(samples, 0); return clip;
        }
        void Refresh()
        {
            var s = relay.State; var sel = relay.Selection; bool available = relay.Connected && sel != null;
            oxygen.text = s == null ? "O2 --" : $"<size=60%>O2</size> {s.oxygenFraction * 100:0}<size=65%>%</size>";
            dose.text = s == null ? "DOSE --" : $"<size=55%>DOSE</size> {s.doseFraction * 100:0.0}<size=65%>%</size>";
            oxygen.color = available ? Mint : Muted; dose.color = available ? White : Muted;
            contact.text = s == null ? "CONNECTING" : !available ? "OFFLINE / LAST DATA" : s.baseLink ? "BASE LINK OK" : "BASE LINK LOST";
            contact.color = available && s.baseLink ? Muted : Amber;
            doseCaption.text = s != null && !available ? "LAST DATA" : "BUDGET USED";
            waypointGraphic.color = s?.Emergency == true ? Red : sel?.Reroute == true ? Amber : Blue;
            waypoint.gameObject.SetActive(available && sel.Next != null);
            string key = "", title = "", detail = ""; bool emergency = s?.Emergency == true;
            if (emergency)
            {
                bool sheltered = available && sel.Point.isShelter;
                key = $"emergency:{s.panic}:{sheltered}:{available}"; title = s.panic ? "EMERGENCY" : "STORM ALERT";
                detail = !available ? "DATA OFFLINE" : sheltered ? "IN SHELTER / HOLD" : "SEEK SHELTER";
            }
            else if (s != null && !available) { key = "offline"; title = "DATA OFFLINE"; detail = "CHECK USB"; }
            else if (s?.mode == "warning") { key = "warning"; title = !s.baseLink ? "BASE LINK LOST" : "SHELTER WARNING"; detail = "CHECK WATCH"; }
            if (key != alertKey) { pulseUntil = emergency ? Time.unscaledTime + 3 : 0; if (emergency) sound.Play(); alertKey = key; }
            alertGroup.gameObject.SetActive(key != ""); alertTitle.text = title; alertDetail.text = detail;
            alertTitle.color = emergency ? Red : Amber;
            alertBacking.color = emergency ? new Color(.22f, .04f, .05f, .78f) : new Color(.15f, .12f, .025f, .72f);
        }
        void UpdateCompass(float heading)
        {
            compass.Heading = heading; compass.SetVerticesDirty();
            for (int i = 0; i < bearings.Length; i++)
            {
                float relative = (float)Navigation.Relative(i * 15, heading);
                bool visible = Mathf.Abs(relative) < CompassHalfSpan - 5;
                bearings[i].gameObject.SetActive(visible);
                if (visible) bearings[i].rectTransform.anchoredPosition = new Vector2(relative / CompassHalfSpan * CompassWidth * .5f, 12);
            }
            var sel = relay.Selection;
            if (relay.Connected && sel?.Next != null)
            {
                float relative = (float)Navigation.Relative(Navigation.Bearing(sel.Point.pos, sel.Next.pos), heading);
                waypoint.anchoredPosition = new Vector2(Mathf.Clamp(relative / CompassHalfSpan, -.96f, .96f) * CompassWidth * .5f, -22);
                waypoint.localEulerAngles = new Vector3(0, 0, Mathf.Abs(relative) > CompassHalfSpan ? -Mathf.Sign(relative) * 90 : 0);
            }
        }
        void LateUpdate()
        {
            if (root == null) return;
            var forward = rig.centerEyeAnchor.forward;
            if (!aligned && Time.timeSinceLevelLoad > 1 && OVRPlugin.GetNodeOrientationTracked(OVRPlugin.Node.EyeCenter))
            { north = Mathf.Atan2(forward.x, forward.z) * Mathf.Rad2Deg; aligned = true; }
            float heading = (float)Navigation.Wrap(Mathf.Atan2(forward.x, forward.z) * Mathf.Rad2Deg - north);
            if (Time.unscaledTime >= nextCompassUpdate) { UpdateCompass(heading); nextCompassUpdate = Time.unscaledTime + 1f / 45; }
            if (alertGroup.gameObject.activeSelf) alertGroup.alpha = Time.unscaledTime < pulseUntil ? .82f + .18f * Mathf.Sin(Time.unscaledTime * 5) : 1;
            if (OVRInput.Get(OVRInput.Button.Two)) { requestHeld += Time.unscaledDeltaTime; if (requestHeld >= 1 && !requestSent) { relay.RequestShelter(); requestSent = true; } }
            else { requestHeld = 0; requestSent = false; }
        }
    }
}
