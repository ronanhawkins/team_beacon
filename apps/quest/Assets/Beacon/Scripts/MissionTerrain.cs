using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using UnityEngine;
using UnityEngine.Rendering;

namespace Beacon
{
    // The planner's original 1 m elevation grid, with purely cosmetic materials.
    public sealed class MissionTerrain : MonoBehaviour
    {
        [Serializable] public sealed class Layout
        {
            public int version,width,height,backgroundWidth,shadowWidth;
            public string site;
            public float originX,originY,spacing,heightOrigin,backgroundSpacing,backgroundOrigin,shadowSpacing;
            public SitePosition[] mainRoute;
        }
        public TextAsset heights,backgroundHeights,metadata,shadowData;
        public Texture2D orbital,backgroundPhoto,cosmeticDetail,rockDetail;
        public Shader surfaceShader;
        public Layout Data {get;private set;}
        public bool Ready {get;private set;}
        public int VisibleTriangles {get;private set;}
        public int CollisionTriangles {get;private set;}
        public IReadOnlyList<Mesh> Meshes => meshes;
        readonly List<Mesh> meshes=new List<Mesh>();
        readonly List<Material> materials=new List<Material>();
        readonly List<MeshCollider> ground=new List<MeshCollider>();
        float[] detail,background,shadow;
        float CentreX => Data.originX+(Data.width-1)*Data.spacing*.5f;
        float CentreY => Data.originY+(Data.height-1)*Data.spacing*.5f;
        static float[] Read(TextAsset file,int count)
        {
            if(file==null || file.bytes.Length!=count*4 || !BitConverter.IsLittleEndian) throw new InvalidOperationException("Invalid terrain height data");
            var result=new float[count];Buffer.BlockCopy(file.bytes,0,result,0,file.bytes.Length);
            foreach(var value in result) if(!float.IsFinite(value)) throw new InvalidOperationException("Nonfinite terrain height");
            return result;
        }
        static float Sample(float[] values,int width,int height,float col,float row)
        {
            col=Mathf.Clamp(col,0,width-1);row=Mathf.Clamp(row,0,height-1);
            int x=Mathf.Min((int)col,width-2),y=Mathf.Min((int)row,height-2);
            return Mathf.Lerp(Mathf.Lerp(values[y*width+x],values[y*width+x+1],col-x),
                Mathf.Lerp(values[(y+1)*width+x],values[(y+1)*width+x+1],col-x),row-y);
        }
        public float HeightAt(float x,float y)
        {
            if(x>=Data.originX && x<=Data.originX+(Data.width-1)*Data.spacing && y>=Data.originY && y<=Data.originY+(Data.height-1)*Data.spacing)
                return Sample(detail,Data.width,Data.height,(x-Data.originX)/Data.spacing,Data.height-1-(y-Data.originY)/Data.spacing);
            return Sample(background,Data.backgroundWidth,Data.backgroundWidth,(x-Data.backgroundOrigin)/Data.backgroundSpacing,
                Data.backgroundWidth-1-(y-Data.backgroundOrigin)/Data.backgroundSpacing);
        }
        public Vector3 LocalPoint(float x,float y) => new Vector3(x-CentreX,HeightAt(x,y)-Data.heightOrigin,y-CentreY);
        public Vector3 WorldPoint(SitePosition p) => transform.TransformPoint(LocalPoint((float)p.x,(float)p.y));
        public SitePosition MissionPosition(Vector3 world)
        {
            var p=transform.InverseTransformPoint(world);return new SitePosition {x=p.x+CentreX,y=p.z+CentreY,z=p.y+Data.heightOrigin};
        }
        public void Create()
        {
            if(Ready) return;
            if(metadata==null || surfaceShader==null || orbital==null || backgroundPhoto==null) throw new InvalidOperationException("Mission terrain assets missing");
            Data=JsonConvert.DeserializeObject<Layout>(metadata.text);
            if(Data?.version!=1 || Data.width<2 || Data.height<2 || Data.spacing<=0) throw new InvalidOperationException("Invalid mission terrain metadata");
            detail=Read(heights,Data.width*Data.height);background=Read(backgroundHeights,Data.backgroundWidth*Data.backgroundWidth);
            shadow=Read(shadowData,Data.shadowWidth*Data.shadowWidth);
            var nearMaterial=MakeMaterial(orbital);var farMaterial=MakeMaterial(backgroundPhoto);
            for(int row=0;row<Data.height-1;row+=100) for(int col=0;col<Data.width-1;col+=100)
            {
                int columns=Math.Min(100,Data.width-1-col),rows=Math.Min(100,Data.height-1-row);
                float left=Data.originX+col*Data.spacing,bottom=Data.originY+row*Data.spacing;
                var chunk=new GameObject($"Survey tile {col/100},{row/100}");chunk.transform.SetParent(transform,false);
                var levels=new LOD[3];
                for(int level=0;level<3;level++)
                {
                    int step=1<<level;
                    var mesh=Grid(left,bottom,columns*Data.spacing,rows*Data.spacing,columns/step,rows/step,false,true);
                    var renderer=Surface(chunk.transform,"LOD "+level,mesh,nearMaterial);
                    levels[level]=new LOD(level==0 ? .55f : level==1 ? .16f : .005f,new Renderer[]{renderer});
                    if(level==0)
                    {
                        VisibleTriangles+=mesh.triangles.Length/3;
                        var collider=renderer.gameObject.AddComponent<MeshCollider>();collider.sharedMesh=mesh;ground.Add(collider);
                        CollisionTriangles+=mesh.triangles.Length/3;
                    }
                }
                var lod=chunk.AddComponent<LODGroup>();lod.SetLODs(levels);lod.RecalculateBounds();
            }
            // Eight coarse surrounding rectangles meet the detailed tile's edge.
            float[] xs={2,Data.originX,Data.originX+(Data.width-1)*Data.spacing,2998};
            float[] ys={2,Data.originY,Data.originY+(Data.height-1)*Data.spacing,2998};
            for(int y=0;y<3;y++) for(int x=0;x<3;x++)
            {
                if(x==1 && y==1) continue;
                float w=xs[x+1]-xs[x],h=ys[y+1]-ys[y];
                var mesh=Grid(xs[x],ys[y],w,h,Mathf.CeilToInt(w/16),Mathf.CeilToInt(h/16),true,false);
                Surface(transform,"Distant terrain",mesh,farMaterial);VisibleTriangles+=mesh.triangles.Length/3;
            }
            MakeStones(nearMaterial);
            if(VisibleTriangles>1000000) throw new InvalidOperationException("Mission scenery exceeds triangle budget");
            Ready=true;Debug.Log($"BEACON_MISSION_TERRAIN: {VisibleTriangles} maximum visible triangles, planner frame, 1 m detail with LOD");
        }
        Material MakeMaterial(Texture2D photo)
        {
            var material=new Material(surfaceShader);material.mainTexture=photo;
            material.SetTexture("_SandTex",cosmeticDetail);material.SetTexture("_RockTex",rockDetail);
            material.SetFloat("_Cosmetic",1);materials.Add(material);return material;
        }
        MeshRenderer Surface(Transform parent,string name,Mesh mesh,Material material)
        {
            var obj=new GameObject(name,typeof(MeshFilter),typeof(MeshRenderer));obj.transform.SetParent(parent,false);
            obj.GetComponent<MeshFilter>().sharedMesh=mesh;var renderer=obj.GetComponent<MeshRenderer>();renderer.sharedMaterial=material;
            renderer.shadowCastingMode=ShadowCastingMode.Off;renderer.receiveShadows=false;renderer.lightProbeUsage=LightProbeUsage.Off;
            renderer.reflectionProbeUsage=ReflectionProbeUsage.Off;return renderer;
        }
        Vector3 NormalAt(float x,float y)
            => new Vector3(HeightAt(x-.5f,y)-HeightAt(x+.5f,y),1,HeightAt(x,y-.5f)-HeightAt(x,y+.5f)).normalized;
        Mesh Grid(float x,float y,float w,float h,int nx,int ny,bool far,bool skirt)
        {
            var vertices=new List<Vector3>();var normals=new List<Vector3>();var uv=new List<Vector2>();var indices=new List<int>();var colours=new List<Color>();
            void Vertex(float px,float py,float drop=0)
            {
                vertices.Add(LocalPoint(px,py)-Vector3.up*drop);normals.Add(NormalAt(px,py));
                uv.Add(far ? new Vector2(px/3000,py/3000) : new Vector2((px-Data.originX+.5f)/(Data.width*Data.spacing),(py-Data.originY+.5f)/(Data.height*Data.spacing)));
                colours.Add(new Color(far ? 1:ShadowAt(px,py),1,1,1));
            }
            for(int row=0;row<=ny;row++) for(int col=0;col<=nx;col++) Vertex(x+w*col/nx,y+h*row/ny);
            for(int row=0;row<ny;row++) for(int col=0;col<nx;col++)
            {
                int a=row*(nx+1)+col,b=a+nx+1;indices.AddRange(new[]{a,b,a+1,a+1,b,b+1});
            }
            if(skirt)
            {
                var edge=new List<int>();for(int c=0;c<=nx;c++) edge.Add(c);
                for(int r=1;r<=ny;r++) edge.Add(r*(nx+1)+nx);
                for(int c=nx-1;c>=0;c--) edge.Add(ny*(nx+1)+c);
                for(int r=ny-1;r>0;r--) edge.Add(r*(nx+1));
                int lower=vertices.Count;
                foreach(int i in edge) {vertices.Add(vertices[i]-Vector3.up*.8f);normals.Add(normals[i]);uv.Add(uv[i]);colours.Add(colours[i]);}
                for(int i=0;i<edge.Count;i++) {int n=(i+1)%edge.Count;indices.AddRange(new[]{edge[i],lower+i,edge[n],edge[n],lower+i,lower+n});}
            }
            var mesh=new Mesh {name=far ? "Orbital background" : "Measured 1 m terrain",indexFormat=vertices.Count>65535 ? IndexFormat.UInt32:IndexFormat.UInt16};
            mesh.SetVertices(vertices);mesh.SetNormals(normals);mesh.SetUVs(0,uv);mesh.SetColors(colours);mesh.SetTriangles(indices,0);mesh.RecalculateBounds();meshes.Add(mesh);return mesh;
        }
        float ShadowAt(float x,float y) => Sample(shadow,Data.shadowWidth,Data.shadowWidth,(x-Data.originX)/Data.shadowSpacing,Data.shadowWidth-1-(y-Data.originY)/Data.shadowSpacing);
        void MakeStones(Material material)
        {
            // Small decorative stones add near-ground parallax; they never enter
            // collision, skyline, shelter choice or planner exports.
            if(Data.mainRoute==null || Data.mainRoute.Length<2) return;
            var random=new System.Random(1455);
            var v=new List<Vector3>();var uv=new List<Vector2>();var triangles=new List<int>();var colours=new List<Color>();
            Vector3[] shape={new Vector3(0,1,0),new Vector3(1,0,0),new Vector3(.35f,0,1),new Vector3(-.8f,0,.65f),new Vector3(-.8f,0,-.6f),new Vector3(.4f,0,-1),new Vector3(0,-.45f,0)};
            for(int n=0;n<1800;n++)
            {
                int segment=random.Next(Data.mainRoute.Length-1);float t=(float)random.NextDouble();var a=Data.mainRoute[segment];var b=Data.mainRoute[segment+1];
                float x=Mathf.Lerp((float)a.x,(float)b.x,t)+((float)random.NextDouble()-.5f)*45;
                float y=Mathf.Lerp((float)a.y,(float)b.y,t)+((float)random.NextDouble()-.5f)*45;
                float size=Mathf.Lerp(.035f,.4f,Mathf.Pow((float)random.NextDouble(),2));
                var p=LocalPoint(x,y)+Vector3.up*size*.12f;var rotation=Quaternion.Euler(0,(float)random.NextDouble()*360,0);
                int start=v.Count;
                foreach(var q in shape) {v.Add(p+rotation*Vector3.Scale(q,new Vector3(size,size*.45f,size*.8f)));uv.Add(new Vector2((x-Data.originX+.5f)/Data.width,(y-Data.originY+.5f)/Data.height));colours.Add(new Color(ShadowAt(x,y),1,1,1));}
                for(int i=1;i<=5;i++) {int next=i==5 ? 1:i+1;triangles.AddRange(new[]{start,start+next,start+i,start+6,start+i,start+next});}
            }
            var mesh=new Mesh {name="Illustrative loose stones",indexFormat=IndexFormat.UInt16};mesh.SetVertices(v);mesh.SetUVs(0,uv);mesh.SetColors(colours);mesh.SetTriangles(triangles,0);mesh.RecalculateNormals();mesh.RecalculateBounds();meshes.Add(mesh);
            Surface(transform,"Illustrative loose stones",mesh,material);VisibleTriangles+=triangles.Count/3;
        }
        public bool GroundAt(Vector3 position,out RaycastHit hit)
        {
            hit=default;float nearest=float.PositiveInfinity;var ray=new Ray(position+Vector3.up*300,Vector3.down);
            foreach(var collider in ground) if(collider.Raycast(ray,out var candidate,600) && candidate.distance<nearest) {hit=candidate;nearest=candidate.distance;}
            return !float.IsPositiveInfinity(nearest);
        }
        public bool InSurvey(Vector3 world)
        {
            var p=MissionPosition(world);return p.x>Data.originX+2 && p.y>Data.originY+2 && p.x<Data.originX+(Data.width-1)*Data.spacing-2 && p.y<Data.originY+(Data.height-1)*Data.spacing-2;
        }
        public void SetSun(Vector3 worldDirection) {foreach(var m in materials) m.SetVector("_SunDir",worldDirection);}
        public void SetCosmeticEnabled(bool enabled) {foreach(var m in materials) m.SetFloat("_Cosmetic",enabled ? 1:0);}
        void OnDestroy() {foreach(var m in meshes) Release(m);foreach(var m in materials) Release(m);}
        static void Release(UnityEngine.Object value) {if(Application.isPlaying) Destroy(value);else DestroyImmediate(value);}
    }
}
