using System;
using System.Threading.Tasks;
using UnityEngine;

namespace Beacon
{
    public sealed class BeaconVrScenery : MonoBehaviour
    {
        public OVRCameraRig rig;
        public BeaconMissionView missionView;
        public MissionTerrain terrain;
        public Transform playerRoot;
        public float walkSpeed=1.4f,fastSpeed=4.5f,turnSpeed=40;
        public bool Active { get; private set; }
        public float Speed { get; private set; }
        public bool AtBoundary { get; private set; }
        public bool Sprinting { get; private set; }
        public WaypointBeacon Beacon { get; private set; }
        public MissionBase Base { get; private set; }
        CharacterController body;
        Vector3 velocity;
        float falling,lastNorth,diagnosticAt;
        bool initialized;
        bool advancePending;
        float retryAdvanceAt;
        string advanceKey;
        string completionKey;
        int completionIndex=-1;
        bool destinationReached;
        public SitePosition Position => terrain.MissionPosition(rig.centerEyeAnchor.position);
        public bool InShelter => Active && WalkNavigation.InShelter(missionView.relay.Selection,Position);
        public bool DestinationReached { get {UpdateCompletion();return destinationReached;} }
        public int TargetIndex => Active ? WalkNavigation.TargetIndex(missionView.relay.Selection,Position,DestinationReached):-1;
        public int WaypointIndex => Active ? WalkNavigation.WaypointIndex(missionView.relay.Selection,Position,DestinationReached):-1;
        void UpdateCompletion()
        {
            var relay=missionView.relay;var selection=relay.Selection;
            if(!Active || selection==null) return;
            string key=relay.State.route+":"+relay.State.rerouteFrom+":"+selection.Points[selection.Points.Count-1].id;
            if(key!=completionKey || selection.Index<completionIndex) destinationReached=false;
            completionKey=key;completionIndex=selection.Index;
            // Latch physical arrival before the final relay acknowledgement.
            // A new one-point shelter route can still be unvisited in VR.
            if(selection.Index>=selection.Points.Count-2 && Navigation.Distance(Position,selection.Points[selection.Points.Count-1].pos)<=WalkNavigation.ArrivalRadius)
                destinationReached=true;
        }
        public double GuidanceBearing
        {
            get {int target=TargetIndex;return target<0 ? missionView.Heading : Navigation.Bearing(Position,missionView.relay.Selection.Points[target].pos);}
        }
        public double GuidanceDistance
        {
            get {int target=WaypointIndex;return target<0 ? 0 : Navigation.Distance(Position,missionView.relay.Selection.Points[target].pos);}
        }
        public double Remaining => WalkNavigation.Remaining(missionView.relay.Selection,Position);
        public bool MatchesMission
        {
            get
            {
                Create();var relay=missionView.relay;var p=relay.Selection?.Point.pos;
                return p!=null && relay.Site?.site!=null && relay.Site.site.IndexOf(terrain.Data.site,StringComparison.OrdinalIgnoreCase)>=0 &&
                    Math.Abs(p.z-terrain.HeightAt((float)p.x,(float)p.y))<5;
            }
        }
        public SitePosition ShelterPosition
        {
            get
            {
                var relay=missionView.relay;var selection=relay.Selection;if(selection==null) return null;
                if(selection.Reroute) return selection.Points[selection.Points.Count-1].pos;
                if(selection.Point.shelter.id=="base") return relay.Site?.@base;
                foreach(var route in relay.Document.reroutes.Values)
                    if(route.Count>0 && route[route.Count-1].shelter.id==selection.Point.shelter.id) return route[route.Count-1].pos;
                return null;
            }
        }
        public void Create()
        {
            if(initialized) return;
            terrain.Create();
            body=playerRoot.GetComponent<CharacterController>();body.enabled=false;
            body.radius=.22f;body.skinWidth=.025f;body.stepOffset=.3f;body.slopeLimit=45;body.minMoveDistance=0;
            Beacon=new WaypointBeacon(this);
            Base=new MissionBase(terrain,missionView.font);Base.Sync(missionView.relay.Site);
            initialized=true;terrain.gameObject.SetActive(false);missionView.relay.Changed+=MissionChanged;missionView.relay.SimulationReset+=ResetPosition;
        }
        void MissionChanged() {Base?.Sync(missionView.relay.Site);if(Active && missionView.relay.Connected && !MatchesMission) missionView.SetImmersive(false);}
        void ResetPosition() {completionKey=null;completionIndex=-1;destinationReached=false;ReturnToRoute();TickBeacon();}
        void OnDestroy() {if(missionView?.relay!=null) {missionView.relay.Changed-=MissionChanged;missionView.relay.SimulationReset-=ResetPosition;}Beacon?.Dispose();Base?.Dispose();}
        public void TickBeacon() {Beacon?.Tick();if(missionView.relay.Selection?.Point.sun!=null) Base?.SetSun(missionView.SkyDirection(missionView.relay.Selection.Point.sun));}
        void Start() {Create();SetActive(missionView.Immersive);}
        public void SetActive(bool active)
        {
            Create();if(Active==active) return;
            body.enabled=false;Active=active;velocity=Vector3.zero;falling=0;Speed=0;Sprinting=false;AtBoundary=false;
            // Mode changes restore the physical room frame. Ordinary stick
            // movement stays continuous and acknowledges reached/passed samples.
            playerRoot.SetLocalPositionAndRotation(Vector3.zero,Quaternion.identity);
            terrain.gameObject.SetActive(active);
            if(active)
            {
                ReturnToRoute();
            }
            TickBeacon();
            Debug.Log("BEACON_VR_SCENERY: "+(active ? "Planner-aligned Mars walking" : "AR room restored"));
        }
        public void ReturnToRoute()
        {
            if(!Active || missionView.relay.Selection==null) return;
            body.enabled=false;velocity=Vector3.zero;falling=0;advancePending=false;
            Speed=0;Sprinting=false;AtBoundary=false;retryAdvanceAt=0;advanceKey=null;
            playerRoot.SetLocalPositionAndRotation(Vector3.zero,Quaternion.identity);
            terrain.transform.SetPositionAndRotation(Vector3.zero,Quaternion.Euler(0,missionView.NorthYaw,0));
            var start=terrain.WorldPoint(missionView.relay.Selection.Point.pos);
            var eye=rig.centerEyeAnchor.position;terrain.transform.position=new Vector3(eye.x,0,eye.z)-start;
            lastNorth=missionView.NorthYaw;Physics.SyncTransforms();UpdateCapsule();body.enabled=true;
            Debug.Log("BEACON_VR_ORIGIN: "+missionView.relay.Selection.Point.id);
        }
        public static Vector2 Stick(Vector2 input)
        {
            float length=input.magnitude;
            return length<.15f ? Vector2.zero : input/length*Mathf.Clamp01((length-.15f)/.85f);
        }
        void UpdateCapsule()
        {
            var local=playerRoot.InverseTransformPoint(rig.centerEyeAnchor.position);
            float height=Mathf.Clamp(local.y,.8f,2.3f);var centre=new Vector3(local.x,height*.5f,local.z);
            if(Mathf.Abs(body.height-height)>.01f) body.height=height;
            if((body.center-centre).sqrMagnitude>.0001f) body.center=centre;
        }
        void Update()
        {
            if(!Active || !Application.isFocused) {velocity=Vector3.zero;Speed=0;Sprinting=false;return;}
            Step(OVRInput.Get(OVRInput.Axis2D.PrimaryThumbstick,OVRInput.Controller.LTouch),
                OVRInput.Get(OVRInput.Axis2D.PrimaryThumbstick,OVRInput.Controller.RTouch),
                Mathf.Max(OVRInput.Get(OVRInput.Axis1D.PrimaryHandTrigger,OVRInput.Controller.LTouch),
                    OVRInput.Get(OVRInput.Axis1D.PrimaryIndexTrigger,OVRInput.Controller.RTouch)),Time.deltaTime);
            var relay=missionView.relay;
            UpdateCompletion();
            if(relay.Selection?.Point.sun!=null) terrain.SetSun(missionView.SkyDirection(relay.Selection.Point.sun));
            string key=relay.State?.route+":"+relay.State?.rerouteFrom+":"+relay.State?.waypointIndex;
            if(advanceKey!=key) {advancePending=false;retryAdvanceAt=0;advanceKey=key;}
            if(advancePending && Time.unscaledTime>=retryAdvanceAt) advancePending=false;
            if(relay.Connected && !relay.SimulationCommandPending && WalkNavigation.ShouldAdvance(relay.Selection,Position) && !advancePending && Time.unscaledTime>=retryAdvanceAt)
            {advanceKey=key;_=Advance();}
            if(Time.unscaledTime>=diagnosticAt)
            {
                diagnosticAt=Time.unscaledTime+5;
                var p=Position;
                Debug.Log($"BEACON_VR_MOVE: x={p.x:F2} north={p.y:F2} speed={Speed:F2} sprint={Sprinting} grounded={body.isGrounded} edge={AtBoundary} next={TargetIndex}");
            }
        }
        async Task Advance()
        {
            advancePending=true;retryAdvanceAt=Time.unscaledTime+2;
            bool sent=await missionView.relay.AdvanceWaypoint();
            if(this!=null && !sent) advancePending=false;
        }
        public void Step(Vector2 move,Vector2 turn,float boost,float dt)
        {
            if(!Active || dt<=0) return;dt=Mathf.Min(dt,.05f);
            move=Stick(move);turn=Stick(turn);var eye=rig.centerEyeAnchor;
            float recenter=Mathf.DeltaAngle(lastNorth,missionView.NorthYaw);
            if(Mathf.Abs(recenter)>.0001f) {terrain.transform.RotateAround(eye.position,Vector3.up,recenter);lastNorth=missionView.NorthYaw;Physics.SyncTransforms();}
            playerRoot.RotateAround(eye.position,Vector3.up,turn.x*turnSpeed*dt);
            UpdateCapsule();
            var forward=Vector3.ProjectOnPlane(eye.forward,Vector3.up).normalized;
            if(forward.sqrMagnitude<.1f) forward=playerRoot.forward;
            Sprinting=boost>.6f && move.sqrMagnitude>.01f;
            var wanted=(forward*move.y+Vector3.Cross(Vector3.up,forward)*move.x)*(Sprinting ? fastSpeed:walkSpeed);
            velocity=Vector3.MoveTowards(velocity,wanted,8*dt);
            var displacement=velocity*dt;var destination=eye.position+displacement;
            AtBoundary=!terrain.InSurvey(destination) || !terrain.GroundAt(destination,out _);
            if(AtBoundary) displacement=Vector3.zero;
            if(body.isGrounded && falling<0) falling=-.5f;
            falling=Mathf.Max(-10,falling-3.71f*dt);
            var before=playerRoot.position;body.Move(displacement+Vector3.up*falling*dt);
            Speed=Vector3.ProjectOnPlane(playerRoot.position-before,Vector3.up).magnitude/dt;
        }
        void OnApplicationPause(bool paused) {if(paused) {velocity=Vector3.zero;falling=0;Speed=0;Sprinting=false;}}
    }
}
