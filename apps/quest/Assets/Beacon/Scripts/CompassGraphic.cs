using UnityEngine;
using UnityEngine.UI;

namespace Beacon
{
    [RequireComponent(typeof(CanvasRenderer))]
    public sealed class CompassGraphic : MaskableGraphic
    {
        public float Heading, HalfSpan = 70;
        static void Line(VertexHelper vh, Vector2 a, Vector2 b, float width, Color tint)
        {
            var normal = new Vector2(-(b - a).y, (b - a).x).normalized * width * .5f;
            int i = vh.currentVertCount;
            vh.AddVert(a + normal, tint, Vector2.zero); vh.AddVert(a - normal, tint, Vector2.zero);
            vh.AddVert(b - normal, tint, Vector2.zero); vh.AddVert(b + normal, tint, Vector2.zero);
            vh.AddTriangle(i, i + 1, i + 2); vh.AddTriangle(i, i + 2, i + 3);
        }
        protected override void OnPopulateMesh(VertexHelper vh)
        {
            vh.Clear(); float half = rectTransform.rect.width * .5f;
            for (int bearing = 0; bearing < 360; bearing += 5)
            {
                float relative = (float)Navigation.Relative(bearing, Heading);
                if (Mathf.Abs(relative) > HalfSpan) continue;
                float x = relative / HalfSpan * half;
                float opacity = Mathf.Clamp01((HalfSpan - Mathf.Abs(relative)) / 8);
                bool major = bearing % 15 == 0;
                Line(vh, new Vector2(x, -5), new Vector2(x, major ? -13 : -9), major ? 1.8f : 1, new Color(.83f, .9f, .95f, opacity * (major ? .8f : .4f)));
            }
            // A fixed centre tick identifies the direction currently being faced.
            Line(vh, new Vector2(0, 29), new Vector2(0, 34), 2, Color.white);
        }
    }
    [RequireComponent(typeof(CanvasRenderer))]
    public sealed class ArrowGraphic : MaskableGraphic
    {
        protected override void OnPopulateMesh(VertexHelper vh)
        {
            vh.Clear(); var r = rectTransform.rect;
            foreach (var p in new[] { new Vector2(0, .5f), new Vector2(-.36f, -.35f), new Vector2(0, -.18f), new Vector2(.36f, -.35f) })
                vh.AddVert(r.center + new Vector2(p.x * r.width, p.y * r.height), color, Vector2.zero);
            vh.AddTriangle(0, 1, 2); vh.AddTriangle(0, 2, 3);
        }
    }
    [RequireComponent(typeof(CanvasRenderer))]
    public sealed class HudBorderGraphic : MaskableGraphic
    {
        protected override void OnPopulateMesh(VertexHelper vh)
        {
            vh.Clear(); var r=rectTransform.rect; const float t=2;
            void Quad(float x0,float y0,float x1,float y1)
            {
                int i=vh.currentVertCount;
                vh.AddVert(new Vector3(x0,y0),color,Vector2.zero); vh.AddVert(new Vector3(x0,y1),color,Vector2.zero);
                vh.AddVert(new Vector3(x1,y1),color,Vector2.zero); vh.AddVert(new Vector3(x1,y0),color,Vector2.zero);
                vh.AddTriangle(i,i+1,i+2); vh.AddTriangle(i,i+2,i+3);
            }
            Quad(r.xMin,r.yMin,r.xMax,r.yMin+t); Quad(r.xMin,r.yMax-t,r.xMax,r.yMax);
            Quad(r.xMin,r.yMin,r.xMin+t,r.yMax); Quad(r.xMax-t,r.yMin,r.xMax,r.yMax);
        }
    }
}
