using UnityEngine;
using UnityEngine.UI;

namespace Beacon
{
    public sealed class RouteGraphic : MaskableGraphic
    {
        public MissionSelection Selection;
        public float Heading;
        public bool Available;
        public Color RouteColor = new Color(.38f, .71f, 1);
        public void Refresh() => SetVerticesDirty();
        static void Quad(VertexHelper vh, Vector2 a, Vector2 b, float width, Color c)
        {
            if ((a - b).sqrMagnitude < .0001f) return;
            var normal = new Vector2(-(b - a).y, (b - a).x).normalized * width * .5f;
            int i = vh.currentVertCount;
            vh.AddVert(a + normal, c, Vector2.zero); vh.AddVert(a - normal, c, Vector2.zero);
            vh.AddVert(b - normal, c, Vector2.zero); vh.AddVert(b + normal, c, Vector2.zero);
            vh.AddTriangle(i, i + 1, i + 2); vh.AddTriangle(i, i + 2, i + 3);
        }
        static void Disc(VertexHelper vh, Vector2 center, float radius, Color c)
        {
            int start = vh.currentVertCount; vh.AddVert(center, c, Vector2.zero);
            for (int j = 0; j <= 24; j++) { float a = j * Mathf.PI * 2 / 24; vh.AddVert(center + new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * radius, c, Vector2.zero); if (j > 0) vh.AddTriangle(start, start + j, start + j + 1); }
        }
        protected override void OnPopulateMesh(VertexHelper vh)
        {
            vh.Clear(); var s = Selection; if (s == null) return;
            var rect = rectTransform.rect;
            var grid = new Color(.65f, .77f, .84f, .09f);
            for (float x = rect.xMin + 20; x < rect.xMax; x += 35) Quad(vh, new Vector2(x, rect.yMin), new Vector2(x, rect.yMax), 1, grid);
            for (float y = rect.yMin + 20; y < rect.yMax; y += 35) Quad(vh, new Vector2(rect.xMin, y), new Vector2(rect.xMax, y), 1, grid);
            double minX = double.MaxValue, minY = double.MaxValue, maxX = double.MinValue, maxY = double.MinValue;
            foreach (var p in s.Points) { minX = System.Math.Min(minX, p.pos.x); maxX = System.Math.Max(maxX, p.pos.x); minY = System.Math.Min(minY, p.pos.y); maxY = System.Math.Max(maxY, p.pos.y); }
            float scale = Mathf.Min((rect.width - 44) / Mathf.Max(35, (float)(maxX - minX)), (rect.height - 44) / Mathf.Max(35, (float)(maxY - minY)));
            Vector2 Pos(SitePosition p) => rect.center + new Vector2((float)(p.x - (minX + maxX) / 2), (float)(p.y - (minY + maxY) / 2)) * scale;
            for (int i = 0; i < s.Points.Count - 1; i++)
            {
                var a = Pos(s.Points[i].pos); var b = Pos(s.Points[i + 1].pos);
                Quad(vh, a, b, 5, new Color(.30f, .41f, .48f));
                if (i < s.Index || !Available) continue;
                float length = Vector2.Distance(a, b);
                for (float d = 0; d < length; d += 15) Quad(vh, Vector2.Lerp(a, b, d / length), Vector2.Lerp(a, b, Mathf.Min(d + 7, length) / length), 5, RouteColor);
            }
            foreach (var p in s.Points) { Disc(vh, Pos(p.pos), p.isShelter ? 7 : 3.5f, new Color(.83f, .91f, .94f)); if (p.isShelter) Disc(vh, Pos(p.pos), 3, new Color(.1f, .16f, .20f)); }
            var current = Pos(s.Point.pos);
            Disc(vh, current, 16, new Color(.06f, .11f, .15f));
            var rotation = Quaternion.Euler(0, 0, -Heading);
            int vi = vh.currentVertCount;
            foreach (var point in new[] { new Vector2(0, 14), new Vector2(-10, -9), new Vector2(0, -5), new Vector2(10, -9) }) vh.AddVert(current + (Vector2)(rotation * point), Available ? new Color(.38f, .71f, 1) : Color.gray, Vector2.zero);
            vh.AddTriangle(vi, vi + 1, vi + 2); vh.AddTriangle(vi, vi + 2, vi + 3);
        }
    }
    public sealed class ArrowGraphic : MaskableGraphic
    {
        protected override void OnPopulateMesh(VertexHelper vh)
        {
            vh.Clear(); var r = rectTransform.rect;
            foreach (var p in new[] { new Vector2(0, .5f), new Vector2(-.36f, -.35f), new Vector2(0, -.18f), new Vector2(.36f, -.35f) }) vh.AddVert(r.center + new Vector2(p.x * r.width, p.y * r.height), color, Vector2.zero);
            vh.AddTriangle(0, 1, 2); vh.AddTriangle(0, 2, 3);
        }
    }
}
