using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Beacon
{
    public static class BeaconUi
    {
        public static RectTransform Rect(string name, Transform parent, float x, float y, float width, float height)
        {
            var r = new GameObject(name, typeof(RectTransform)).GetComponent<RectTransform>();
            r.SetParent(parent, false); r.sizeDelta = new Vector2(width,height); r.anchoredPosition = new Vector2(x,y); return r;
        }
        public static TMP_Text Text(Transform parent, TMP_FontAsset font, string value, float x, float y, float width, float height, float size, Color colour)
        {
            var text = Rect(value,parent,x,y,width,height).gameObject.AddComponent<TextMeshProUGUI>();
            text.font = font; text.text = value; text.fontSize = size; text.color = colour;
            text.alignment = TextAlignmentOptions.Center; text.textWrappingMode = TextWrappingModes.NoWrap;
            text.overflowMode = TextOverflowModes.Ellipsis; text.raycastTarget = false;
            text.outlineColor = new Color(0,0,0,.9f); text.outlineWidth = .18f;
            return text;
        }
        public static void Canvas(RectTransform root, float metres, int order = 100)
        {
            root.localScale = Vector3.one * (metres / root.rect.width);
            var canvas = root.gameObject.AddComponent<Canvas>(); canvas.renderMode = RenderMode.WorldSpace;
            canvas.overrideSorting = true; canvas.sortingOrder = order;
        }
        public static Image Backing(Transform parent, float width, float height, Color colour)
        {
            var image = Rect("Panel",parent,0,0,width,height).gameObject.AddComponent<Image>();
            image.color = colour; image.raycastTarget = false; return image;
        }
    }
}
