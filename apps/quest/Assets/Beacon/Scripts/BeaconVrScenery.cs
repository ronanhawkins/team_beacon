using System;
using UnityEngine;

namespace Beacon
{
    public sealed class BeaconVrScenery : MonoBehaviour
    {
        public OVRCameraRig rig;
        public BeaconMissionView missionView;
        public AccessMarsTerrain terrain;
        public Transform playerRoot;
        public Vector2 sourceStart=new Vector2(12.25f,-4.39f);
        // Visual registration to the Quela waypoint, not a geodetic transform.
        public float alignmentYaw=257.8f;
        public float walkSpeed=1.4f,fastSpeed=4.5f,turnSpeed=40;
        public bool Active { get; private set; }
        public float Speed { get; private set; }
        public bool AtBoundary { get; private set; }
        public bool Sprinting { get; private set; }
        CharacterController body;
        Vector3 velocity;
        float falling,lastNorth,diagnosticAt;
        bool initialized;
        public void Create()
        {
            if(initialized) return;
            terrain.Create();
            body=playerRoot.GetComponent<CharacterController>();body.enabled=false;
            body.radius=.22f;body.skinWidth=.025f;body.stepOffset=.3f;body.slopeLimit=45;body.minMoveDistance=0;
            initialized=true;terrain.gameObject.SetActive(false);
        }
        void Start() {Create();SetActive(missionView.Immersive);}
        public void SetActive(bool active)
        {
            Create();if(Active==active) return;
            body.enabled=false;Active=active;velocity=Vector3.zero;falling=0;Speed=0;Sprinting=false;AtBoundary=false;
            // Reset only when crossing AR/VR modes. Stick locomotion never
            // teleports, advances a waypoint, or sends a route-change event.
            playerRoot.SetLocalPositionAndRotation(Vector3.zero,Quaternion.identity);
            terrain.gameObject.SetActive(active);
            if(active)
            {
                terrain.transform.SetPositionAndRotation(Vector3.zero,Quaternion.Euler(0,missionView.NorthYaw+alignmentYaw,0));
                var start=terrain.transform.TransformPoint(new Vector3(sourceStart.x,0,sourceStart.y));Physics.SyncTransforms();
                if(!terrain.GroundAt(start,out var ground)) throw new InvalidOperationException("Access Mars start is outside the photographed ground");
                terrain.transform.position=-ground.point;lastNorth=missionView.NorthYaw;Physics.SyncTransforms();
                UpdateCapsule();body.enabled=true;
            }
            Debug.Log("BEACON_VR_SCENERY: "+(active ? "Access Mars walking" : "AR room restored"));
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
            if(Time.unscaledTime>=diagnosticAt)
            {
                diagnosticAt=Time.unscaledTime+5;
                var p=terrain.transform.InverseTransformPoint(rig.centerEyeAnchor.position);
                Debug.Log($"BEACON_VR_MOVE: x={p.x:F2} z={p.z:F2} speed={Speed:F2} sprint={Sprinting} grounded={body.isGrounded} edge={AtBoundary}");
            }
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
