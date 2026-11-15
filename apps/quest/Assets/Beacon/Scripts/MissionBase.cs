using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.Rendering;

namespace Beacon
{
    // Illustrative habitat, not NASA terrain or input to the shelter planner.
    // Its origin is the exported base; buildings leave that arrival point clear.
    public sealed class MissionBase : IDisposable
    {
        public Transform Root {get;private set;}
        public int Triangles => mesh==null ? 0:mesh.triangles.Length/3;
        readonly MissionTerrain terrain;
        readonly TMP_FontAsset font;
        Material material;
        Mesh mesh;
        SitePosition anchor;
        readonly List<Vector3> vertices=new List<Vector3>();
        readonly List<Color> colours=new List<Color>();
        readonly List<int> indices=new List<int>();
        static readonly Color Shell=new Color(.8f,.79f,.72f), Trim=new Color(.25f,.27f,.28f),
            Orange=new Color(.86f,.29f,.10f), Glass=new Color(.075f,.19f,.22f), Solar=new Color(.07f,.12f,.19f);
        public MissionBase(MissionTerrain ground,TMP_FontAsset textFont) {terrain=ground;font=textFont;}
        public void Sync(MissionSite site)
        {
            bool matches=site?.@base!=null && site.site!=null && site.site.IndexOf(terrain.Data.site,StringComparison.OrdinalIgnoreCase)>=0;
            if(Root!=null) Root.gameObject.SetActive(matches);
            if(!matches) return;
            if(anchor!=null && Math.Abs(anchor.x-site.@base.x)<.001 && Math.Abs(anchor.y-site.@base.y)<.001) return;
            Clear();anchor=new SitePosition {x=site.@base.x,y=site.@base.y,z=site.@base.z};
            Root=new GameObject("Mission base · illustrative habitat").transform;Root.SetParent(terrain.transform,false);
            Root.localPosition=terrain.LocalPoint((float)anchor.x,(float)anchor.y);
            material=new Material(Resources.Load<Shader>("BeaconBase"));
            float floor=Ground(7,3)+.35f;
            // Octagonal pressure module with an orange service band and airlock.
            Module(new Vector3(7,floor,3),7,Shell);
            Module(new Vector3(7,floor-.035f,5.9f),.22f,Orange,1.025f);
            Box("Airlock",new Vector3(7,floor+1.2f,-.62f),new Vector3(1.6f,2.4f,.32f),Trim);
            Box("Hatch",new Vector3(7,floor+1.22f,-.80f),new Vector3(1.15f,1.95f,.06f),Shell,false);
            Box("Hatch window",new Vector3(7,floor+1.65f,-.84f),new Vector3(.65f,.52f,.04f),Glass,false);
            Box("Hatch handle",new Vector3(7.4f,floor+1,-.88f),new Vector3(.09f,.3f,.08f),Orange,false);
            for(int i=0;i<3;i++) Box("Observation window",new Vector3(4.37f,floor+2,1+i*1.7f),new Vector3(.04f,.72f,1.05f),Glass,false);
            Box("Habitat collision",new Vector3(7,floor+1.65f,3),new Vector3(5.2f,3.3f,7),Shell,true,false);
            for(int x=0;x<2;x++) for(int z=0;z<2;z++)
            {
                float xx=5+x*4,zz=.5f+z*5;
                Box("Landing leg",new Vector3(xx,(floor+Ground(xx,zz))*.5f,zz),new Vector3(.4f,floor-Ground(xx,zz)+.12f,.4f),Trim);
            }
            // Grounded solar racks, behind and to the other side of the clear apron.
            for(int row=0;row<2;row++)
            {
                float x=-6,z=3+row*4,y=Ground(x,z);
                Box("Solar frame",new Vector3(x,y+.85f,z),new Vector3(5,.14f,2.8f),Trim);
                for(int cell=0;cell<5;cell++) for(int strip=0;strip<2;strip++)
                    Box("Solar cell",new Vector3(x-2+cell,y+.935f,z-.68f+strip*1.36f),new Vector3(.94f,.025f,1.27f),Solar,false);
                Box("Solar stand",new Vector3(x-1.7f,y+.4f,z),new Vector3(.18f,.8f,2),Trim);
                Box("Solar stand",new Vector3(x+1.7f,y+.4f,z),new Vector3(.18f,.8f,2),Trim);
            }
            float mastY=Ground(3,8);
            Box("Comms mast",new Vector3(3,mastY+2.6f,8),new Vector3(.15f,5.2f,.15f),Trim);
            Box("Antenna",new Vector3(3,mastY+4.8f,8),new Vector3(1.7f,.09f,.09f),Shell,false);
            Box("Antenna",new Vector3(3,mastY+4.4f,8),new Vector3(1.1f,.07f,.07f),Shell,false);
            for(int i=0;i<3;i++) Box("Supply case",new Vector3(9+i*.65f,Ground(9+i*.65f,-3)+.3f,-3),new Vector3(.55f,.6f,.7f),i==1 ? Orange:Trim);
            // Four flat apron markers identify the base centre without blocking it.
            foreach(float x in new[]{-2f,2f}) foreach(float z in new[]{-2f,2f})
                Box("Apron marking",new Vector3(x,Ground(x,z)+.025f,z),new Vector3(.65f,.025f,.14f),Shell,false);
            var sign=BeaconUi.Rect("Base sign",Root,0,0,500,130);BeaconUi.Canvas(sign,1.8f,5);
            sign.localPosition=new Vector3(7,floor+2.9f,-.54f);
            BeaconUi.Text(sign,font,"BEACON  /  BASE",0,0,490,120,43,Color.white);
            mesh=new Mesh {name="Simple base mesh"};mesh.SetVertices(vertices);mesh.SetColors(colours);mesh.SetTriangles(indices,0);mesh.RecalculateNormals();mesh.RecalculateBounds();
            Root.gameObject.AddComponent<MeshFilter>().sharedMesh=mesh;
            var renderer=Root.gameObject.AddComponent<MeshRenderer>();renderer.sharedMaterial=material;
            renderer.shadowCastingMode=ShadowCastingMode.Off;renderer.receiveShadows=false;
            renderer.lightProbeUsage=LightProbeUsage.Off;renderer.reflectionProbeUsage=ReflectionProbeUsage.Off;
            Debug.Log($"BEACON_BASE: {anchor.x:0.0}, {anchor.y:0.0}; {Triangles} illustrative triangles");
        }
        float Ground(float x,float z) => terrain.HeightAt((float)anchor.x+x,(float)anchor.y+z)-terrain.HeightAt((float)anchor.x,(float)anchor.y);
        void Quad(Vector3 a,Vector3 b,Vector3 c,Vector3 d,Color colour)
        {
            int n=vertices.Count;vertices.AddRange(new[]{a,b,c,d});for(int i=0;i<4;i++) colours.Add(colour);
            indices.AddRange(new[]{n,n+1,n+2,n,n+2,n+3});
        }
        void Box(string name,Vector3 centre,Vector3 size,Color colour,bool solid=true,bool visible=true)
        {
            if(solid) {var collider=Root.gameObject.AddComponent<BoxCollider>();collider.center=centre;collider.size=size;}
            if(!visible) return;
            Vector3 a=centre-size*.5f,b=centre+size*.5f;
            Quad(new Vector3(a.x,a.y,a.z),new Vector3(a.x,b.y,a.z),new Vector3(b.x,b.y,a.z),new Vector3(b.x,a.y,a.z),colour);
            Quad(new Vector3(b.x,a.y,b.z),new Vector3(b.x,b.y,b.z),new Vector3(a.x,b.y,b.z),new Vector3(a.x,a.y,b.z),colour);
            Quad(new Vector3(a.x,a.y,b.z),new Vector3(a.x,b.y,b.z),new Vector3(a.x,b.y,a.z),new Vector3(a.x,a.y,a.z),colour);
            Quad(new Vector3(b.x,a.y,a.z),new Vector3(b.x,b.y,a.z),new Vector3(b.x,b.y,b.z),new Vector3(b.x,a.y,b.z),colour);
            Quad(new Vector3(a.x,b.y,a.z),new Vector3(a.x,b.y,b.z),new Vector3(b.x,b.y,b.z),new Vector3(b.x,b.y,a.z),colour);
            Quad(new Vector3(a.x,a.y,b.z),new Vector3(a.x,a.y,a.z),new Vector3(b.x,a.y,a.z),new Vector3(b.x,a.y,b.z),colour);
        }
        void Module(Vector3 bottom,float length,Color colour,float scale=1)
        {
            Vector2[] rim={new Vector2(-2,0),new Vector2(2,0),new Vector2(2.6f,.6f),new Vector2(2.6f,2.7f),new Vector2(2,3.3f),new Vector2(-2,3.3f),new Vector2(-2.6f,2.7f),new Vector2(-2.6f,.6f)};
            for(int i=0;i<rim.Length;i++)
            {
                var a=bottom+new Vector3(rim[i].x*scale,rim[i].y*scale,-length*.5f);
                var b=bottom+new Vector3(rim[(i+1)%rim.Length].x*scale,rim[(i+1)%rim.Length].y*scale,-length*.5f);
                var depth=Vector3.forward*length;
                Quad(a,b,b+depth,a+depth,colour);
                var mid=bottom+new Vector3(0,1.65f*scale,-length*.5f);
                Quad(mid,b,a,mid,colour);Quad(mid+depth,a+depth,b+depth,mid+depth,colour);
            }
        }
        public void SetSun(Vector3 direction) {if(material!=null) material.SetVector("_SunDir",direction);}
        void Clear()
        {
            Release(Root==null ? null:Root.gameObject);Release(mesh);Release(material);
            Root=null;mesh=null;material=null;vertices.Clear();colours.Clear();indices.Clear();
        }
        static void Release(UnityEngine.Object value) {if(value==null) return;if(Application.isPlaying) UnityEngine.Object.Destroy(value);else UnityEngine.Object.DestroyImmediate(value);}
        public void Dispose() {Clear();anchor=null;}
    }
}
