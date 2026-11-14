using TMPro;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.UI;

namespace Beacon
{
    // A rendering-only marker in the same measured frame as walking/navigation.
    // It never advances the route or chooses a destination.
    public sealed class WaypointBeacon
    {
        readonly BeaconVrScenery scenery;
        readonly Transform root,beam;
        readonly RectTransform labelRoot;
        readonly TMP_Text label;
        readonly Image diamond;
        readonly Mesh beamMesh,ringMesh;
        readonly Material material;
        readonly float[] beamAlpha;
        readonly Color[] beamColours;
        Vector3 lastAnchor=new Vector3(float.PositiveInfinity,0,0);
        Color lastTone;
        public bool Visible => root!=null && root.gameObject.activeInHierarchy;
        public Vector3 WorldPosition => root.position;
        public int TargetIndex { get; private set; }=-1;
        public Color Tone { get; private set; }

        public WaypointBeacon(BeaconVrScenery owner)
        {
            scenery=owner;
            root=new GameObject("Next waypoint beacon").transform;
            root.SetParent(owner.terrain.transform,false);
            material=new Material(owner.missionView.skylineShader) {name="Waypoint beacon glow"};
            beamMesh=new Mesh {name="Soft tapered waypoint light"};
            float[] xs={-.5f,-.08f,-.025f,.025f,.08f,.5f},alphas={0,.12f,.75f,.75f,.12f,0};
            float[] ys={0,.04f,.72f,1},fade={.3f,1,.5f,0};
            var vertices=new Vector3[xs.Length*ys.Length];beamAlpha=new float[vertices.Length];beamColours=new Color[vertices.Length];
            var indices=new int[(xs.Length-1)*(ys.Length-1)*6];int t=0;
            for(int y=0;y<ys.Length;y++) for(int x=0;x<xs.Length;x++)
            {
                int i=y*xs.Length+x;vertices[i]=new Vector3(xs[x],ys[y],0);beamAlpha[i]=alphas[x]*fade[y];
                if(y==ys.Length-1 || x==xs.Length-1) continue;
                indices[t++]=i;indices[t++]=i+xs.Length;indices[t++]=i+1;
                indices[t++]=i+1;indices[t++]=i+xs.Length;indices[t++]=i+xs.Length+1;
            }
            beamMesh.vertices=vertices;beamMesh.triangles=indices;beamMesh.RecalculateBounds();
            beam=Surface("Light column",beamMesh);
            ringMesh=new Mesh {name="Waypoint ground ring"};Surface("Ground location",ringMesh);
            labelRoot=BeaconUi.Rect("Waypoint distance",root,0,0,300,90);BeaconUi.Canvas(labelRoot,1.2f,25);
            label=BeaconUi.Text(labelRoot,owner.missionView.font,"",0,16,300,54,32,Color.white);
            diamond=BeaconUi.Backing(labelRoot,14,14,Color.white);
            diamond.rectTransform.anchoredPosition=new Vector2(0,-24);diamond.rectTransform.localEulerAngles=new Vector3(0,0,45);
            root.gameObject.SetActive(false);
        }
        Transform Surface(string name,Mesh mesh)
        {
            var part=new GameObject(name,typeof(MeshFilter),typeof(MeshRenderer));part.transform.SetParent(root,false);
            part.GetComponent<MeshFilter>().sharedMesh=mesh;
            var renderer=part.GetComponent<MeshRenderer>();renderer.sharedMaterial=material;
            renderer.shadowCastingMode=ShadowCastingMode.Off;renderer.receiveShadows=false;
            renderer.lightProbeUsage=LightProbeUsage.Off;renderer.reflectionProbeUsage=ReflectionProbeUsage.Off;
            return part.transform;
        }
        public void Tick()
        {
            var relay=scenery.missionView.relay;var selection=relay.Selection;
            TargetIndex=scenery.Active && relay.Connected ? scenery.TargetIndex:-1;
            double distance=TargetIndex>=0 ? Navigation.Distance(scenery.Position,selection.Points[TargetIndex].pos):0;
            bool show=TargetIndex>=0 && distance>WalkNavigation.ArrivalRadius;
            root.gameObject.SetActive(show);if(!show) return;
            var point=selection.Points[TargetIndex];var anchor=scenery.terrain.LocalPoint((float)point.pos.x,(float)point.pos.y);
            root.localPosition=anchor+Vector3.up*.06f;
            Tone=relay.State.Emergency ? new Color(1,.46f,.24f) : selection.Reroute ? new Color(1,.76f,.32f) : new Color(.38f,1,.81f);
            if(lastTone!=Tone)
            {
                for(int i=0;i<beamColours.Length;i++) beamColours[i]=new Color(Tone.r,Tone.g,Tone.b,beamAlpha[i]);
                beamMesh.colors=beamColours;lastTone=Tone;
                lastAnchor=new Vector3(float.PositiveInfinity,0,0);
            }
            if((lastAnchor-anchor).sqrMagnitude>.0001f) {BuildRing(point.pos,anchor);lastAnchor=anchor;}
            var eye=scenery.rig.centerEyeAnchor.position;
            var away=Vector3.ProjectOnPlane(root.position-eye,Vector3.up);
            if(away.sqrMagnitude>.001f) beam.rotation=Quaternion.LookRotation(away,Vector3.up);
            float height=Mathf.Clamp((float)distance*.16f,6,80);
            beam.localScale=new Vector3(Mathf.Clamp((float)distance*.02f,.5f,4),height,1);
            labelRoot.position=root.position+Vector3.up*Mathf.Min(height*.55f,32);
            labelRoot.rotation=Quaternion.LookRotation(labelRoot.position-eye,Vector3.up);
            labelRoot.localScale=Vector3.one*(Mathf.Clamp((float)distance*.22f,.5f,120)/300);
            string caption=point.isShelter ? "SHELTER" : TargetIndex==selection.Index ? "RETURN":"NEXT";
            label.text=caption+" · "+Navigation.DistanceText(distance);label.color=new Color(.94f,1,.98f);diamond.color=Tone;
        }
        void BuildRing(SitePosition point,Vector3 anchor)
        {
            const int count=48;var vertices=new Vector3[count*2];var colours=new Color[count*2];var indices=new int[count*6];
            for(int i=0;i<count;i++)
            {
                float a=i*2*Mathf.PI/count;
                for(int edge=0;edge<2;edge++)
                {
                    float radius=edge==0 ? .67f:.73f;
                    vertices[i*2+edge]=scenery.terrain.LocalPoint((float)point.x+Mathf.Sin(a)*radius,(float)point.y+Mathf.Cos(a)*radius)-anchor;
                    colours[i*2+edge]=new Color(Tone.r,Tone.g,Tone.b,.8f);
                }
                int p=i*2,n=((i+1)%count)*2,t=i*6;
                indices[t]=p;indices[t+1]=n;indices[t+2]=p+1;indices[t+3]=p+1;indices[t+4]=n;indices[t+5]=n+1;
            }
            ringMesh.Clear();ringMesh.vertices=vertices;ringMesh.colors=colours;ringMesh.triangles=indices;ringMesh.RecalculateBounds();
        }
        public void Dispose()
        {
            foreach(var item in new Object[]{root!=null ? root.gameObject:null,beamMesh,ringMesh,material})
                if(item!=null) {if(Application.isPlaying) Object.Destroy(item);else Object.DestroyImmediate(item);}
        }
    }
}
