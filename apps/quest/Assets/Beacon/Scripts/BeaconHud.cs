using System;
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
        static readonly Color White = Hex("F0F6F9"), Muted = Hex("A6B8C5"), Blue = Hex("62B5FF"), Mint = Hex("93E9CE"), Amber = Hex("FFCC82"), Red = Hex("FF9187");
        TMP_Text oxygen, dose, contact, mode, distance, destination, after, shelter, sky, mapTitle, remaining, alertTitle, alertDetail;
        RectTransform root, alertPanel, arrow;
        Image oxygenBar, doseBar, alertBacking;
        RouteGraphic map;
        ArrowGraphic pointer;
        Sprite rounded;
        string alertKey = "";
        float expandedUntil, north, nextMapUpdate, requestHeld;
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
            { float dx = Mathf.Max(0, Mathf.Abs(x - 31.5f) - 17), dy = Mathf.Max(0, Mathf.Abs(y - 31.5f) - 17); pixels[y * 64 + x] = new Color(1, 1, 1, Mathf.Clamp01(14.5f - Mathf.Sqrt(dx * dx + dy * dy))); }
            tex.SetPixels(pixels); tex.Apply(); return Sprite.Create(tex, new Rect(0, 0, 64, 64), new Vector2(.5f, .5f), 100, 0, SpriteMeshType.FullRect, new Vector4(17, 17, 17, 17));
        }
        Image Image(Transform parent, string name, float x, float y, float w, float h, Color color, bool round = true)
        {
            var image = Rect(name, parent, x, y, w, h).gameObject.AddComponent<Image>(); image.color = color; image.raycastTarget = false;
            if (round) { image.sprite = rounded; image.type = UnityEngine.UI.Image.Type.Sliced; }
            return image;
        }
        RectTransform Panel(string name, float x, float y, float width, float height, float metres)
        {
            var p = Rect(name, root, 0, 0, width, height);
            p.localPosition = new Vector3(x, y, 1.6f); p.localScale = Vector3.one * (metres / width);
            var canvas = p.gameObject.AddComponent<Canvas>(); canvas.renderMode = RenderMode.WorldSpace; canvas.overrideSorting = true; canvas.sortingOrder = 100;
            Image(p, "Outline", 0, 0, width, height, new Color(.55f, .69f, .78f, .25f));
            Image(p, "Backing", 0, 0, width - 2, height - 2, new Color(.045f, .08f, .11f, .91f));
            return p;
        }
        TMP_Text Label(Transform parent, string value, float x, float y, float w, float h, float size, Color color, bool bold = false)
        {
            var text = Rect(value, parent, x, y, w, h).gameObject.AddComponent<TextMeshProUGUI>();
            text.font = font; text.text = value; text.fontSize = size; text.color = color;
            text.fontStyle = bold ? FontStyles.Bold : FontStyles.Normal; text.alignment = TextAlignmentOptions.MidlineLeft;
            text.textWrappingMode = TextWrappingModes.NoWrap; text.overflowMode = TextOverflowModes.Ellipsis; text.raycastTarget = false;
            return text;
        }
        void Start()
        {
            rounded = MakeRounded(); root = Rect("Beacon HUD", rig.centerEyeAnchor, 0, 0, 1, 1);
            root.localPosition = Vector3.zero;
            var left = Panel("Oxygen", -.62f, .47f, 300, 132, .44f);
            Label(left, "OXYGEN LEFT", 0, 42, 254, 30, 19, Muted, true);
            oxygen = Label(left, "—", 0, -1, 254, 62, 48, Mint, true);
            Image(left, "Track", 0, -47, 254, 4, new Color(.35f, .48f, .55f, .4f), false);
            oxygenBar = Image(left, "Remaining", 0, -47, 254, 4, Mint, false);
            var right = Panel("Dose", .62f, .47f, 300, 132, .44f);
            Label(right, "DOSE BUDGET USED", 0, 42, 254, 30, 19, Muted, true);
            dose = Label(right, "—", 0, -1, 254, 62, 48, White, true);
            Image(right, "Track", 0, -47, 254, 4, new Color(.35f, .48f, .55f, .4f), false);
            doseBar = Image(right, "Used", 0, -47, 254, 4, White, false);
            var top = Panel("Mission connection", 0, .52f, 440, 78, .60f);
            contact = Label(top, "CONNECTING", 0, 12, 390, 30, 22, Mint, true);
            mode = Label(top, "BEACON · AR COMPANION", 0, -17, 390, 23, 16, Muted);
            var mapPanel = Panel("Mini map", -.605f, -.37f, 330, 350, .47f);
            mapTitle = Label(mapPanel, "WALKING ROUTE", -15, 145, 260, 28, 19, Blue, true);
            Label(mapPanel, "N ↑", 126, 109, 45, 28, 19, Muted, true);
            map = Rect("Route", mapPanel, 0, 0, 290, 245).gameObject.AddComponent<RouteGraphic>(); map.raycastTarget = false;
            remaining = Label(mapPanel, "Waiting for route", 0, -147, 290, 30, 21, White);
            var navigation = Panel("Next direction", .23f, -.48f, 640, 208, .94f);
            Image(navigation, "Arrow backing", -263, 29, 80, 96, new Color(.38f, .71f, 1, .10f));
            arrow = Rect("Next bearing", navigation, -263, 29, 64, 64); pointer = arrow.gameObject.AddComponent<ArrowGraphic>(); pointer.color = Blue; pointer.raycastTarget = false;
            distance = Label(navigation, "Connecting…", 45, 52, 460, 64, 43, White, true);
            destination = Label(navigation, "Waiting for mission", 45, 8, 460, 38, 26, Muted);
            after = Label(navigation, "", 0, -35, 592, 28, 21, Blue);
            Image(navigation, "Divider", 0, -60, 592, 1, new Color(.6f, .7f, .8f, .20f), false);
            shelter = Label(navigation, "SHELTER —", -150, -82, 292, 26, 19, White, true);
            sky = Label(navigation, "OPEN SKY —", 186, -82, 220, 26, 19, Muted);
            alertPanel = Panel("Alert", 0, .28f, 700, 146, 1.02f);
            alertBacking = Image(alertPanel, "Alert background", 0, 0, 696, 142, Hex("391D22"));
            Label(alertPanel, "!", -302, 0, 40, 90, 61, Red, true);
            alertTitle = Label(alertPanel, "", 32, 26, 580, 44, 32, White, true);
            alertDetail = Label(alertPanel, "", 32, -23, 580, 40, 24, Red);
            alertPanel.gameObject.SetActive(false);
            sound = gameObject.AddComponent<AudioSource>(); sound.spatialBlend = 0; sound.volume = .15f; sound.clip = Chime();
            relay.Changed += Refresh; Refresh();
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
            var s = relay.State; var sel = relay.Selection; var available = relay.Connected && sel != null;
            var cue = available ? Navigation.Upcoming(sel) : null;
            var routeColor = s?.Emergency == true ? Red : sel?.Reroute == true ? Amber : Blue;
            oxygen.text = s == null ? "—" : $"{s.oxygenFraction * 100:0}<size=60%>%</size>";
            dose.text = s == null ? "—" : $"{s.doseFraction * 100:0.0}<size=60%>%</size>";
            oxygen.color = available ? Mint : Muted; dose.color = available ? White : Muted;
            SetBar(oxygenBar, s?.oxygenFraction ?? 0); SetBar(doseBar, s?.doseFraction ?? 0);
            contact.text = s == null ? "CONNECTING TO LAPTOP" : !available ? "DATA OFFLINE" : s.baseLink ? "BASE CONNECTED" : "BASE BLOCKED";
            contact.color = available && s.baseLink ? Mint : Amber;
            mode.text = relay.Synthetic ? "BEACON · SAMPLE ROUTE DEMO" : "BEACON · MARS ROUTE DEMO";
            map.Selection = sel; map.Available = available; map.RouteColor = routeColor; map.Refresh();
            mapTitle.text = sel?.Reroute == true ? "SHELTER ROUTE" : "WALKING ROUTE"; mapTitle.color = routeColor;
            remaining.text = !available ? "GUIDANCE PAUSED" : sel.Next == null ? "AT DESTINATION" : $"{Navigation.DistanceText(sel.Remaining)} remaining";
            pointer.color = routeColor; after.color = routeColor; arrow.gameObject.SetActive(available && sel.Next != null);
            distance.text = !available ? s == null ? "Connecting…" : "Guidance paused" : sel.Next == null ? cue.Title : Navigation.DistanceText(cue.Metres);
            destination.text = !available ? "Check the laptop connection" : sel.Next == null ? "Hold position" : cue.Title;
            after.text = !available ? "Keep USB connected" : sel.Next == null ? "You are at the destination" : cue.Detail;
            shelter.text = s == null ? "SHELTER —" : $"SHELTER  {s.minutesToShelter:0.0} min";
            sky.text = s == null ? "OPEN SKY —" : $"OPEN SKY  {s.openSky * 100:0}%";
            string key = "", title = "", detail = ""; bool emergency = s?.Emergency == true;
            if (emergency) { key = $"emergency:{s.panic}:{sel?.Point.isShelter}:{available}"; title = sel?.Point.isShelter == true ? "Shelter reached" : s.panic ? "Emergency · seek shelter" : "Storm alert · seek shelter"; detail = !available ? "Connection lost · guidance paused" : sel.Point.isShelter ? "Hold position · alert remains active" : "Shelter route is now active"; }
            else if (s != null && !available) { key = "offline"; title = "Connection lost"; detail = "Last values shown · guidance paused"; }
            else if (s?.mode == "warning") { key = "warning"; title = !s.baseLink ? "Base contact blocked" : "Shelter time warning"; detail = "Check your shelter route"; }
            if (key != alertKey) { expandedUntil = emergency ? Time.unscaledTime + 4.5f : 0; if (emergency) sound.Play(); alertKey = key; }
            alertPanel.gameObject.SetActive(key != ""); alertTitle.text = title; alertDetail.text = detail; alertDetail.color = emergency ? Red : Amber;
            alertBacking.color = emergency ? Hex("391D22") : Hex("303026");
        }
        static void SetBar(Image image, double fraction)
        {
            float width = 254 * Mathf.Clamp01((float)fraction); image.rectTransform.sizeDelta = new Vector2(width, 4);
            image.rectTransform.anchoredPosition = new Vector2(-127 + width / 2, -47);
        }
        void LateUpdate()
        {
            if (root == null) return;
            var forward = rig.centerEyeAnchor.forward;
            if (!aligned && Time.timeSinceLevelLoad > 1) { north = Mathf.Atan2(forward.x, forward.z) * Mathf.Rad2Deg; aligned = true; }
            float heading = (float)Navigation.Wrap(Mathf.Atan2(forward.x, forward.z) * Mathf.Rad2Deg - north);
            var sel = relay.Selection;
            if (relay.Connected && sel?.Next != null) arrow.localEulerAngles = new Vector3(0, 0, -(float)Navigation.Relative(Navigation.Bearing(sel.Point.pos, sel.Next.pos), heading));
            if (Time.unscaledTime > nextMapUpdate) { map.Heading = heading; map.Refresh(); nextMapUpdate = Time.unscaledTime + .08f; }
            if (alertPanel.gameObject.activeSelf)
            { bool big = Time.unscaledTime < expandedUntil; alertPanel.localPosition = new Vector3(0, big ? .10f : .29f, 1.6f); alertPanel.localScale = Vector3.one * (1.02f / 700 * (big ? 1 : .84f)); }
            // A deliberate hold avoids an incidental button press rerouting the mission.
            if (OVRInput.Get(OVRInput.Button.Two)) { requestHeld += Time.unscaledDeltaTime; if (requestHeld >= 1 && !requestSent) { relay.RequestShelter(); requestSent = true; } }
            else { requestHeld = 0; requestSent = false; }
        }
    }
}
