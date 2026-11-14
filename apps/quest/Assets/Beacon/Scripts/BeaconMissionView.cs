using System;
using TMPro;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.UI;

namespace Beacon
{
    public sealed class BeaconMissionView : MonoBehaviour
    {
        public OVRCameraRig rig;
        public BeaconRelay relay;
        public TMP_FontAsset font;
        public Shader skylineShader;
        public OVRPassthroughLayer passthrough;
        public MarsAtmosphere atmosphere;
        public BeaconVrScenery vrScenery;
        public float NorthYaw { get; private set; }
        public float Heading => (float)Navigation.Wrap(EyeYaw - NorthYaw);
        public bool Immersive { get; private set; }
        public bool RingVisible { get; private set; } = true;
        public event Action Recentered;
        public event Action<string> ActionFeedback;
        float EyeYaw => Mathf.Atan2(rig.centerEyeAnchor.forward.x,rig.centerEyeAnchor.forward.z) * Mathf.Rad2Deg;
        Transform ring;
        Mesh mesh;
        Material material;
        readonly float[] elevations = new float[72];
        readonly Vector3[] vertices = new Vector3[73 * 6];
        readonly Color[] colours = new Color[73 * 6];
        float targetNorth;
        bool aligned, hasSamples;
        string pointKey;
        string earthText="Earth",baseText="Base",shelterText="Shelter";
        static readonly string[] Cardinals={"N","E","S","W"};
        Marker sun, earth, baseMarker, shelter;
        readonly Marker[] cardinal = new Marker[4];
        sealed class Marker { public RectTransform root; public TMP_Text label; public Image dot; }

        void Start() => CreateVisuals();
        public void CreateVisuals()
        {
            if (ring != null) return;
            ring = new GameObject("Waypoint skyline ring").transform; ring.SetParent(transform,false);
            var terrain = new GameObject("72-sample blocked sky",typeof(MeshFilter),typeof(MeshRenderer)); terrain.transform.SetParent(ring,false);
            mesh = new Mesh { name="Blended waypoint skyline" }; mesh.MarkDynamic();
            var triangles = new int[72 * 18]; int t = 0;
            for (int i=0;i<72;i++) for(int strip=0;strip<3;strip++)
            {
                int a=i*6+strip*2,b=a+6;
                triangles[t++]=a; triangles[t++]=b; triangles[t++]=a+1;
                triangles[t++]=a+1; triangles[t++]=b; triangles[t++]=b+1;
            }
            mesh.vertices=vertices; mesh.triangles=triangles;
            mesh.bounds=new Bounds(Vector3.zero,Vector3.one*13);
            terrain.GetComponent<MeshFilter>().sharedMesh=mesh;
            material=new Material(skylineShader);
            var renderer=terrain.GetComponent<MeshRenderer>(); renderer.sharedMaterial=material;
            renderer.shadowCastingMode=ShadowCastingMode.Off; renderer.receiveShadows=false;
            renderer.lightProbeUsage=LightProbeUsage.Off; renderer.reflectionProbeUsage=ReflectionProbeUsage.Off;
            sun=MakeMarker("Sun"); earth=MakeMarker("Earth"); baseMarker=MakeMarker("Base"); shelter=MakeMarker("Shelter");
            for(int i=0;i<4;i++) cardinal[i]=MakeMarker(Cardinals[i],true);
            relay.Changed+=Refresh; Refresh();
        }
        Marker MakeMarker(string name,bool bearing=false)
        {
            var root=BeaconUi.Rect(name,ring,0,0,300,90); BeaconUi.Canvas(root,bearing ? .60f : 1.1f,30);
            var label=BeaconUi.Text(root,font,name,0,27,300,64,bearing ? 46 : 30,Color.white);
            var dot=BeaconUi.Backing(root,9,9,Color.white);
            if(bearing) dot.gameObject.SetActive(false);
            return new Marker { root=root,label=label,dot=dot };
        }
        public static Vector3 Direction(float azimuth,float elevation)
        {
            float az=azimuth*Mathf.Deg2Rad,el=elevation*Mathf.Deg2Rad;
            return new Vector3(Mathf.Sin(az)*Mathf.Cos(el),Mathf.Sin(el),Mathf.Cos(az)*Mathf.Cos(el));
        }
        public Vector3 SkyDirection(SkyBody body) => Quaternion.Euler(0,NorthYaw,0)*Direction((float)body.az,(float)body.el);
        void Refresh()
        {
            if(relay.Selection==null) return;
            var p=relay.Selection.Point; var s=relay.State;
            earthText=$"Earth · {s.earthDelayMinutes:0.#} min";
            baseText=$"Base · {p.@base.distance:0} m";
            shelterText=p.isShelter ? "In shelter" : $"{MissionPresentation.ShelterName(p.shelter.id, p.shelter.label)} · {s.minutesToShelter:0.0} min";
            string key=relay.State.route+":"+relay.State.rerouteFrom+":"+relay.Selection.Point.id;
            if(key!=pointKey)
            {
                // Route changes must never rotate north, the Sun or the scenery.
                // Only initial calibration / an explicit recenter sets this frame.
                pointKey=key;
                if(!hasSamples) { for(int i=0;i<72;i++) elevations[i]=(float)relay.Selection.Point.skyline[i]; hasSamples=true; }
            }
        }
        public void Calibrate() { targetNorth=EyeYaw-(float)(relay.State?.headingDeg ?? 0); NorthYaw=targetNorth; aligned=true; }
        public void Recenter()
        {
            targetNorth=EyeYaw-(float)(relay.State?.headingDeg ?? 0); aligned=true;
            Recentered?.Invoke(); Debug.Log("BEACON_VIEW: Recentered");
        }
        public void SetImmersive(bool enabled)
        {
            if(enabled && (relay.Selection==null || !relay.Connected || vrScenery==null || !vrScenery.MatchesMission))
            {ActionFeedback?.Invoke("VR NEEDS MATCHING MISSION DATA");return;}
            Immersive=enabled;
            if(passthrough!=null) passthrough.hidden=enabled;
            if(atmosphere!=null) atmosphere.SetImmersive(enabled);
            if(vrScenery!=null) vrScenery.SetActive(enabled);
            Debug.Log("BEACON_VIEW: "+(enabled ? "Murray Buttes VR" : "AR passthrough"));
        }
        void Update()
        {
            if(OVRInput.GetDown(OVRInput.Button.One,OVRInput.Controller.LTouch)) SetImmersive(!Immersive);
            if(OVRInput.GetDown(OVRInput.Button.Two,OVRInput.Controller.LTouch))
            {
                if(Immersive) {vrScenery.ReturnToRoute();ActionFeedback?.Invoke("RETURNED TO ROUTE");}
                else RingVisible=!RingVisible;
            }
            if(OVRInput.GetDown(OVRInput.Button.PrimaryThumbstick,OVRInput.Controller.LTouch)) Recenter();
        }
        void LateUpdate()
        {
            if(!aligned && relay.Connected && relay.Selection!=null && Time.timeSinceLevelLoad>1 && OVRPlugin.GetNodeOrientationTracked(OVRPlugin.Node.EyeCenter)) Calibrate();
            Tick(Time.unscaledDeltaTime);
        }
        public void Tick(float delta)
        {
            if(ring==null) return;
            NorthYaw=Mathf.LerpAngle(NorthYaw,targetNorth,1-Mathf.Exp(-delta*5));
            ring.position=rig.centerEyeAnchor.position; ring.rotation=Quaternion.Euler(0,NorthYaw,0);
            bool available=relay.Connected && relay.Selection!=null;
            ring.gameObject.SetActive(available && (RingVisible || Immersive));
            if(!available) return;
            var p=relay.Selection.Point; var s=relay.State;
            Color tone=s.Emergency ? new Color(1,.48f,.34f) : s.mode=="warning" ? new Color(1,.72f,.38f) : new Color(.85f,.62f,.42f);
            float blend=1-Mathf.Exp(-delta*5);
            for(int i=0;i<72;i++) elevations[i]=Mathf.Lerp(elevations[i],(float)p.skyline[i],blend);
            for(int i=0;i<=72;i++)
            {
                float az=i*5,el=elevations[i%72]; int v=i*6;
                // The measured mask covers blocked SKY only. Never paint the
                // room's floor or the photographic ground with a flat silhouette.
                vertices[v]=Direction(az,0)*6;
                vertices[v+1]=Direction(az,el)*6;
                vertices[v+2]=Direction(az,el-.12f)*5.995f;
                vertices[v+3]=Direction(az,el+.12f)*5.995f;
                vertices[v+4]=Direction(az,-.055f)*5.99f; vertices[v+5]=Direction(az,.055f)*5.99f;
                colours[v]=new Color(tone.r,tone.g,tone.b,0);
                colours[v+1]=new Color(tone.r,tone.g,tone.b,Immersive ? 0 : .045f);
                // Keep the measured AR shading, but never draw the unwanted
                // floating contour over either the room or the VR landscape.
                colours[v+2]=colours[v+3]=Color.clear;
                colours[v+4]=colours[v+5]=Color.clear;
            }
            mesh.vertices=vertices; mesh.colors=colours;
            Place(sun,(float)p.sun.az,(float)p.sun.el,"Sun",new Color(1,.83f,.43f),p.sun.visible && s.sunlit);
            Place(earth,(float)p.earth.az,(float)p.earth.el,earthText,new Color(.56f,.76f,1),p.earth.visible && s.earthLink);
            float baseAz=(float)p.@base.az,shelterAz=(float)s.shelterBearingDeg;
            bool showBase=MissionPresentation.ShowBaseMarker(p),showShelter=MissionPresentation.ShowShelterMarker(p);
            string baseLabel=baseText,shelterLabel=shelterText;
            if(Immersive && vrScenery.Active)
            {
                vrScenery.terrain.SetSun(SkyDirection(p.sun));var position=vrScenery.Position;
                if(relay.Site?.@base!=null)
                {
                    baseAz=(float)Navigation.Bearing(position,relay.Site.@base);double distance=Navigation.Distance(position,relay.Site.@base);
                    baseLabel="Base · "+Navigation.DistanceText(distance);showBase=distance>WalkNavigation.ArrivalRadius;
                }
                var destination=vrScenery.ShelterPosition;
                if(destination!=null)
                {
                    shelterAz=(float)Navigation.Bearing(position,destination);double distance=Navigation.Distance(position,destination);
                    shelterLabel=MissionPresentation.ShelterName(p.shelter.id,p.shelter.label)+" · "+Navigation.DistanceText(distance);
                    showShelter=distance>WalkNavigation.ArrivalRadius;
                }
            }
            Place(baseMarker,baseAz,-1,baseLabel,Color.white,p.@base.visible && s.baseLink);
            Place(shelter,shelterAz,4,shelterLabel,tone,true);
            baseMarker.root.gameObject.SetActive(showBase);shelter.root.gameObject.SetActive(showShelter);
            shelter.root.localScale *= s.Emergency ? 1+.06f*Mathf.Sin(Time.unscaledTime*4) : 1;
            for(int i=0;i<4;i++) Place(cardinal[i],i*90,-5,Cardinals[i],Color.white,true,true);
        }
        void Place(Marker marker,float az,float el,string text,Color colour,bool visible,bool bearing=false)
        {
            marker.root.localPosition=Direction(az,el)*5.8f;
            marker.root.rotation=Quaternion.LookRotation(marker.root.position-rig.centerEyeAnchor.position,Vector3.up);
            marker.root.localScale=Vector3.one*((bearing ? .60f : 1.1f)/300);
            marker.label.text=text; colour.a=visible ? 1 : .32f;
            marker.label.color=colour; marker.dot.color=colour;
        }
        void OnDestroy()
        {
            if(relay!=null) relay.Changed-=Refresh;
            if(Application.isPlaying) { Destroy(mesh); Destroy(material); }
            else { DestroyImmediate(mesh); DestroyImmediate(material); }
        }
    }
}
