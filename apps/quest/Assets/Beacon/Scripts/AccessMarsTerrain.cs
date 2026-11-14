using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Rendering;

namespace Beacon
{
    // Native conversion of Access Mars, Copyright 2017 Google Inc., Apache-2.0.
    // Source/changes/photographic credits are retained in Art/AccessMars.
    public sealed class AccessMarsTerrain : MonoBehaviour
    {
        public TextAsset geometry,metadata;
        public Texture2D[] photographs;
        public Shader surfaceShader;
        public bool Ready { get; private set; }
        public int VisibleTriangles { get; private set; }
        public int CollisionTriangles { get; private set; }
        public IReadOnlyList<Mesh> Meshes => meshes;
        readonly List<Mesh> meshes=new List<Mesh>();
        readonly List<Material> materials=new List<Material>();
        readonly List<MeshCollider> ground=new List<MeshCollider>();
        public void Create()
        {
            if(Ready) return;
            if(geometry==null || metadata==null || surfaceShader==null) throw new InvalidOperationException("Access Mars assets missing");
            var records=(JArray)JObject.Parse(metadata.text)["meshes"];
            using var reader=new BinaryReader(new MemoryStream(geometry.bytes));
            if(new string(reader.ReadChars(4))!="AMVR" || reader.ReadInt32()!=1) throw new InvalidDataException("Invalid Access Mars geometry header");
            int count=reader.ReadInt32();
            if(count!=records.Count || photographs.Length!=count) throw new InvalidDataException("Access Mars manifest mismatch");
            for(int m=0;m<count;m++)
            {
                int vertexCount=reader.ReadInt32(),indexCount=reader.ReadInt32();
                if(vertexCount<=0 || vertexCount>1000000 || indexCount<3 || indexCount%3!=0 || indexCount>3000000) throw new InvalidDataException("Invalid Access Mars mesh size");
                var vertices=new Vector3[vertexCount];var normals=new Vector3[vertexCount];var uv=new Vector2[vertexCount];var indices=new int[indexCount];
                for(int i=0;i<vertexCount;i++) vertices[i]=new Vector3(reader.ReadSingle(),reader.ReadSingle(),reader.ReadSingle());
                for(int i=0;i<vertexCount;i++) normals[i]=new Vector3(reader.ReadSingle(),reader.ReadSingle(),reader.ReadSingle());
                for(int i=0;i<vertexCount;i++) uv[i]=new Vector2(reader.ReadSingle(),reader.ReadSingle());
                for(int i=0;i<indexCount;i++) {indices[i]=reader.ReadInt32();if(indices[i]<0 || indices[i]>=vertexCount) throw new InvalidDataException("Mesh index out of range");}
                string kind=(string)records[m]["kind"],name=(string)records[m]["name"];
                var mesh=new Mesh {name="Access Mars "+name,indexFormat=vertexCount>65535 ? IndexFormat.UInt32:IndexFormat.UInt16};
                mesh.vertices=vertices;mesh.normals=normals;mesh.uv=uv;mesh.triangles=indices;mesh.RecalculateBounds();meshes.Add(mesh);
                if(kind=="collision") continue; // Keep source proxy for verification; walk on the photographed surface itself.
                if(photographs[m]==null) throw new InvalidDataException("Missing Access Mars photograph "+name);
                var tile=new GameObject("Access Mars "+name,typeof(MeshFilter),typeof(MeshRenderer));tile.transform.SetParent(transform,false);
                tile.GetComponent<MeshFilter>().sharedMesh=mesh;
                var material=new Material(surfaceShader);material.mainTexture=photographs[m];materials.Add(material);
                var renderer=tile.GetComponent<MeshRenderer>();renderer.sharedMaterial=material;
                renderer.shadowCastingMode=ShadowCastingMode.Off;renderer.receiveShadows=false;
                renderer.lightProbeUsage=LightProbeUsage.Off;renderer.reflectionProbeUsage=ReflectionProbeUsage.Off;
                VisibleTriangles+=indexCount/3;
                if(kind=="tile") {var collider=tile.AddComponent<MeshCollider>();collider.sharedMesh=mesh;ground.Add(collider);CollisionTriangles+=indexCount/3;}
            }
            if(reader.BaseStream.Position!=reader.BaseStream.Length) throw new InvalidDataException("Unexpected geometry trailing bytes");
            if(VisibleTriangles>1000000) throw new InvalidDataException("Terrain exceeds the triangle budget");
            Ready=true;Debug.Log($"BEACON_ACCESS_MARS: {VisibleTriangles} visible triangles, {CollisionTriangles} photographed collision triangles, 64 tiles");
        }
        public bool GroundAt(Vector3 worldPosition,out RaycastHit hit)
        {
            hit=default;float closest=float.PositiveInfinity;
            var ray=new Ray(worldPosition+Vector3.up*100,Vector3.down);
            foreach(var collider in ground)
            {
                if(collider.Raycast(ray,out var candidate,200) && candidate.distance<closest) {hit=candidate;closest=candidate.distance;}
            }
            return !float.IsPositiveInfinity(closest);
        }
        public bool InSurvey(Vector3 position)
        {
            var local=transform.InverseTransformPoint(position);
            return Mathf.Abs(local.x)<58 && Mathf.Abs(local.z)<58;
        }
        void OnDestroy()
        {
            foreach(var mesh in meshes) Release(mesh);
            foreach(var material in materials) Release(material);
        }
        static void Release(UnityEngine.Object obj) {if(Application.isPlaying) Destroy(obj);else DestroyImmediate(obj);}
    }
}
