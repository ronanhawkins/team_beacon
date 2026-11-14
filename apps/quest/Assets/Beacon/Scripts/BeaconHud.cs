using TMPro;
using UnityEngine;
using UnityEngine.UI;
using System.Threading.Tasks;

namespace Beacon
{
    public sealed class BeaconHud : MonoBehaviour
    {
        public OVRCameraRig rig;
        public TMP_FontAsset font;
        public BeaconRelay relay;
        public BeaconMissionView missionView;
        const float Depth=1.2f, CompassWidth=720, CompassHalfSpan=70;
        static readonly Color White=new Color(.94f,.97f,1), Muted=new Color(.67f,.75f,.80f), Mint=new Color(.55f,.94f,.79f), Amber=new Color(1,.77f,.38f), Red=new Color(1,.48f,.40f);
        RectTransform root,waypoint;
        readonly TMP_Text[] bearings=new TMP_Text[24], readings=new TMP_Text[5];
        readonly TMP_Text[] readingCaptions=new TMP_Text[5];
        readonly Image[] statBackings=new Image[6];
        static readonly string[] Captions={"SHELTER","BASE","SUNLIGHT","OXYGEN","DOSE USED"};
        static readonly string[] LastCaptions={"SHELTER","LAST BASE","LAST SUN","LAST O2","LAST DOSE"};
        TMP_Text openSky,skyCaption,science,scienceCaption,alert,viewMode,nextDistance;
        RectTransform sciencePanel;
        RectTransform feedbackPanel,holdBar;
        TMP_Text feedback;
        CompassGraphic compass;
        ArrowGraphic waypointGraphic;
        HudBorderGraphic border;
        CanvasGroup alertGroup;
        Image alertBacking;
        AudioSource sound;
        float pulseUntil,requestHeld,feedbackUntil,requestDeadline,shelterNoticeUntil;
        string shelterNoticeCaption,shelterNotice;
        public string ShelterNotice => shelterNotice;
        public float ShelterHoldProgress => Mathf.Clamp01(requestHeld);
        bool requestSent,requestPending,wasEmergency;
        bool wasImmersive,wasBoundary;


        RectTransform Surface(string name,float yaw,float pitch,float width,float height,float metres)
        {
            var p=BeaconUi.Rect(name,root,0,0,width,height);
            p.localPosition=new Vector3(Mathf.Tan(yaw*Mathf.Deg2Rad)*Depth,Mathf.Tan(pitch*Mathf.Deg2Rad)*Depth,Depth);
            BeaconUi.Canvas(p,metres); return p;
        }
        TMP_Text Text(Transform parent,string value,float x,float y,float w,float h,float size,Color colour)
            => BeaconUi.Text(parent,font,value,x,y,w,h,size,colour);
        void Start() => CreateVisuals();
        public void CreateVisuals()
        {
            if(root!=null) return;
            root=BeaconUi.Rect("Readable peripheral HUD",rig.centerEyeAnchor,0,0,1,1); root.localPosition=Vector3.zero;
            for(int i=0;i<5;i++)
            {
                bool left=i>=3;float pitch=left ? (i==3 ? -7:-16) : 2-i*9;
                var card=Surface("Side reading "+Captions[i],left ? -24:24,pitch,250,88,.32f);
                statBackings[i]=BeaconUi.Backing(card,250,88,new Color(.025f,.04f,.055f,.44f));
                readingCaptions[i]=Text(card,Captions[i],0,25,230,25,19,Muted);
                readings[i]=Text(card,"--",0,-12,230,52,36,White);
                if(i==0)
                {
                    var progress=BeaconUi.Backing(card,0,4,Mint); holdBar=progress.rectTransform;
                    holdBar.pivot=new Vector2(0,.5f);holdBar.anchoredPosition=new Vector2(-115,-39);
                }
            }
            var sky=Surface("Open sky",-24,2,250,96,.32f);
            statBackings[5]=BeaconUi.Backing(sky,250,96,new Color(.025f,.04f,.055f,.40f));
            skyCaption=Text(sky,"OPEN SKY",0,29,230,24,19,Muted);
            openSky=Text(sky,"--%",0,-11,230,65,46,Mint);
            sciencePanel=Surface("Science stop",24,11,280,80,.34f);
            BeaconUi.Backing(sciencePanel,280,80,new Color(.025f,.04f,.055f,.42f));
            scienceCaption=Text(sciencePanel,"SCIENCE STOP",0,24,258,22,18,Muted);
            science=Text(sciencePanel,"",0,-12,258,48,28,White);

            var tape=Surface("Lowered compass",0,16,CompassWidth,88,.84f);
            BeaconUi.Backing(tape,CompassWidth,88,new Color(.025f,.04f,.055f,.32f));
            compass=BeaconUi.Rect("Compass ticks",tape,0,0,CompassWidth,72).gameObject.AddComponent<CompassGraphic>();
            compass.HalfSpan=CompassHalfSpan; compass.raycastTarget=false;
            string[] cardinal={"N","NE","E","SE","S","SW","W","NW"};
            for(int i=0;i<bearings.Length;i++)
            {
                bool major=i%3==0;
                bearings[i]=Text(tape,major ? cardinal[i/3] : (i*15).ToString(),0,13,65,40,major ? 32 : 26,major ? White : Muted);
            }
            waypoint=BeaconUi.Rect("Single waypoint arrow",tape,0,-27,23,23);
            waypointGraphic=waypoint.gameObject.AddComponent<ArrowGraphic>(); waypointGraphic.raycastTarget=false;
            nextDistance=Text(tape,"",0,-50,140,24,18,White);
            viewMode=Text(tape,"AR · X: VR",0,58,250,23,18,Muted);

            var alertPanel=Surface("Emergency status",0,9,780,54,.90f);
            alertBacking=BeaconUi.Backing(alertPanel,780,54,new Color(.24f,.04f,.035f,.8f));
            alert=Text(alertPanel,"",0,0,750,50,34,White);
            alertGroup=alertPanel.gameObject.AddComponent<CanvasGroup>();
            var frame=Surface("Peripheral alert border",0,0,1000,650,1.72f);
            border=BeaconUi.Rect("Border",frame,0,0,1000,650).gameObject.AddComponent<HudBorderGraphic>(); border.raycastTarget=false;
            feedbackPanel=Surface("Brief action feedback",-24,-24,320,84,.38f);
            BeaconUi.Backing(feedbackPanel,320,84,new Color(.025f,.04f,.055f,.55f));
            feedback=Text(feedbackPanel,"",0,3,300,68,23,White);
            feedback.textWrappingMode=TextWrappingModes.Normal;
            sound=gameObject.AddComponent<AudioSource>(); sound.spatialBlend=0; sound.volume=.15f; sound.clip=Chime();
            relay.Changed+=Refresh; missionView.Recentered+=OnRecenter;missionView.ActionFeedback+=OnFeedback; Refresh(); Tick();
        }
        public void Refresh()
        {
            if(root==null) return;
            var s=relay.State; var sel=relay.Selection; bool live=relay.Connected && sel!=null;
            var p=sel?.Point;
            openSky.text=s==null ? "--%" : $"{s.openSky*100:0.0}<size=65%>%</size>";
            openSky.color=live ? Mint : Muted; skyCaption.text=live ? "OPEN SKY" : s==null ? "WAITING" : "LAST DATA";
            readings[0].text=!live ? "--" : p.isShelter ? "IN SHELTER" : $"{s.minutesToShelter:0.0} min";
            readings[0].fontSize=live && p.isShelter ? 28 : 36;
            readings[1].text=s==null ? "--" : s.baseLink ? "LINK OK" : "LINK LOST";
            readings[2].text=s==null ? "--" : s.sunlit ? "SUNLIT" : "SHADE";
            readings[3].text=s==null ? "--" : $"{s.oxygenFraction*100:0}%";
            readings[4].text=s==null ? "--" : $"{s.doseFraction*100:0.0}%";
            for(int i=0;i<readings.Length;i++)
            { readings[i].color=live ? White : Muted; readingCaptions[i].text=!live && s!=null ? LastCaptions[i] : Captions[i]; }
            if(live) { readings[1].color=s.baseLink ? Mint : Amber; readings[3].color=Mint; }
            bool showScience=live && p.isScienceStop;
            sciencePanel.gameObject.SetActive(showScience);
            if(showScience) { scienceCaption.text="SCIENCE STOP"; science.text=p.Name; }
            waypoint.gameObject.SetActive(live && sel.Next!=null);
            waypointGraphic.color=s?.Emergency==true ? Red : sel?.Reroute==true ? Amber : new Color(.45f,.8f,1);
            bool emergency=s?.Emergency==true;
            string title=MissionPresentation.Alert(s,live,p?.isShelter==true);
            if(emergency && !wasEmergency) { pulseUntil=Time.unscaledTime+3; sound.Play(); }
            wasEmergency=emergency;
            alertGroup.gameObject.SetActive(title!=""); alert.text=title;
            alertBacking.color=emergency ? new Color(.26f,.035f,.025f,.8f) : new Color(.16f,.11f,.025f,.8f);
            border.gameObject.SetActive(MissionPresentation.AlertBorder(s,live)); border.color=emergency ? new Color(1,.18f,.10f,.58f) : new Color(1,.65f,.15f,.35f);
            if(requestPending && live && s.route=="reroute") { requestPending=false; ShelterFeedback("FOLLOW ARROW","ROUTE READY"); Pulse(.12f); }
        }
        public void Tick()
        {
            if(root==null || missionView==null) return;
            foreach(var backing in statBackings) backing.enabled=missionView.Immersive;
            if(missionView.Immersive && !wasImmersive) ShowFeedback("L WALK · R TURN\nHOLD LEFT GRIP: SPRINT",6);
            if(!missionView.Immersive && wasImmersive) ShowFeedback("AR · ROOM VIEW RESTORED");
            wasImmersive=missionView.Immersive;
            bool boundary=missionView.Immersive && missionView.vrScenery!=null && missionView.vrScenery.AtBoundary;
            if(boundary && !wasBoundary) ShowFeedback("EDGE OF RECONSTRUCTION");
            wasBoundary=boundary;
            float heading=missionView.Heading;
            compass.Heading=heading; compass.SetVerticesDirty();
            for(int i=0;i<bearings.Length;i++)
            {
                float relative=(float)Navigation.Relative(i*15,heading); bool visible=Mathf.Abs(relative)<CompassHalfSpan-6;
                bearings[i].gameObject.SetActive(visible);
                if(visible) bearings[i].rectTransform.anchoredPosition=new Vector2(relative/CompassHalfSpan*CompassWidth*.5f,13);
            }
            bool walking=missionView.Immersive && missionView.vrScenery!=null && missionView.vrScenery.Active;
            bool hasTarget=relay.Connected && (walking ? missionView.vrScenery.TargetIndex>=0 : relay.Selection?.Next!=null);
            waypoint.gameObject.SetActive(hasTarget);nextDistance.gameObject.SetActive(hasTarget && walking);
            if(hasTarget)
            {
                float relative=(float)Navigation.Relative(walking ? missionView.vrScenery.GuidanceBearing : relay.State.headingDeg,heading);
                waypoint.anchoredPosition=new Vector2(Mathf.Clamp(relative/CompassHalfSpan,-.96f,.96f)*CompassWidth*.5f,-27);
                waypoint.localEulerAngles=new Vector3(0,0,Mathf.Abs(relative)>CompassHalfSpan ? -Mathf.Sign(relative)*90 : 0);
                nextDistance.text=Navigation.DistanceText(missionView.vrScenery?.GuidanceDistance ?? 0);
                nextDistance.rectTransform.anchoredPosition=new Vector2(Mathf.Clamp(waypoint.anchoredPosition.x,-290,290),-50);
            }
            if(walking && relay.Connected && relay.Selection!=null)
            {
                bool atShelter=missionView.vrScenery.InShelter;
                if(relay.State.Emergency) alert.text=MissionPresentation.Alert(relay.State,true,atShelter);
            }
            viewMode.text=missionView.Immersive ? "VR · X: AR" : "AR · X: VR";
            if(alertGroup.gameObject.activeSelf) alertGroup.alpha=Time.unscaledTime<pulseUntil ? .88f+.12f*Mathf.Sin(Time.unscaledTime*5) : 1;
            if(requestPending && !relay.Connected) {requestPending=false;ShelterFeedback("CHECK USB","LAPTOP OFFLINE");}
            if(requestPending && Time.unscaledTime>=requestDeadline) { requestPending=false; ShelterFeedback("HOLD B TO RETRY","NO REPLY"); }
            bool holding=requestHeld>0 && !requestSent;
            bool sprinting=missionView.Immersive && missionView.vrScenery!=null && missionView.vrScenery.Sprinting;
            feedbackPanel.gameObject.SetActive(Time.unscaledTime<feedbackUntil || sprinting);
            holdBar.gameObject.SetActive(holding);
            if(sprinting && Time.unscaledTime>=feedbackUntil) feedback.text="SPRINT";
            // Always restore the ordinary shelter reading before applying a
            // temporary result, so expired feedback cannot leave stale text.
            if(relay.Connected && relay.Selection!=null)
            {
                bool covered=walking ? missionView.vrScenery.InShelter : relay.Selection.Point.isShelter;
                readings[0].text=covered ? "IN SHELTER" : walking && relay.Selection.Point.isShelter ? (relay.Selection.Reroute ? "RETURN TO SHELTER" : "BASE · "+Navigation.DistanceText(Navigation.Distance(missionView.vrScenery.Position,relay.Selection.Point.pos))) : $"{relay.State.minutesToShelter:0.0} min";
                readings[0].fontSize=covered || relay.Selection.Point.isShelter ? 24:36;
                readingCaptions[0].text=relay.Selection.Reroute && walking && !covered ? "SHELTER · "+Navigation.DistanceText(missionView.vrScenery.Remaining) : "SHELTER · HOLD B";
            }
            else {readings[0].text="--";readings[0].fontSize=36;readingCaptions[0].text="SHELTER · OFFLINE";}
            if(holding)
            {
                readingCaptions[0].text="HOLD B · 1 SEC";
                holdBar.sizeDelta=new Vector2(230*ShelterHoldProgress,4);
            }
            else if(Time.unscaledTime<shelterNoticeUntil)
            {
                readingCaptions[0].text=shelterNoticeCaption;readings[0].text=shelterNotice;readings[0].fontSize=24;
            }
        }
        void ShowFeedback(string text,float seconds=2.5f) { feedback.text=text; feedbackUntil=Time.unscaledTime+seconds; }
        void OnRecenter() => ShowFeedback("VIEW RECENTERED");
        void OnFeedback(string text) => ShowFeedback(text,4);
        void ShelterFeedback(string caption,string text,float seconds=6)
        {
            shelterNoticeCaption=caption;shelterNotice=text;shelterNoticeUntil=Time.unscaledTime+seconds;
            Debug.Log("BEACON_SHELTER: "+text+" | "+caption);
        }
        void Pulse(float seconds)
        {
            if(Application.isPlaying) StartCoroutine(PulseController(seconds));
        }
        System.Collections.IEnumerator PulseController(float seconds)
        {
            OVRInput.SetControllerVibration(1,.25f,OVRInput.Controller.RTouch);
            yield return new WaitForSecondsRealtime(seconds);
            OVRInput.SetControllerVibration(0,0,OVRInput.Controller.RTouch);
        }
        async Task RequestShelterWithFeedback()
        {
            if(!relay.Connected) { ShelterFeedback("CHECK USB","LAPTOP OFFLINE"); return; }
            if(requestPending) { ShelterFeedback("SHELTER REQUEST","WAITING…"); return; }
            bool walking=missionView.Immersive && missionView.vrScenery?.Active==true;
            if(walking ? missionView.vrScenery.InShelter : relay.Selection?.Point.isShelter==true) { ShelterFeedback("HOLD POSITION","ALREADY SAFE"); return; }
            if(relay.State?.route=="reroute") { ShelterFeedback("FOLLOW ARROW","ROUTE ACTIVE"); return; }
            requestPending=true; requestDeadline=Time.unscaledTime+5; ShelterFeedback("SHELTER REQUEST","REQUESTING…",5);
            int? from=walking ? WalkNavigation.ClosestMain(relay.Document,missionView.vrScenery.Position):(int?)null;
            bool sent=await relay.RequestShelter(from);
            if(this==null) return;
            if(!sent) { requestPending=false; ShelterFeedback("CHECK USB · RETRY","REQUEST FAILED"); }
            else if(requestPending) { requestDeadline=Time.unscaledTime+5; ShelterFeedback("SHELTER REQUEST","WAITING…",5); }
        }
        public Task ProcessShelterButton(bool pressed,float deltaTime)
        {
            if(pressed)
            {
                if(requestHeld==0) {shelterNoticeUntil=0;Pulse(.04f);Debug.Log("BEACON_SHELTER_BUTTON: right B pressed");}
                requestHeld+=Mathf.Clamp(deltaTime,0,.1f);
                if(requestHeld>=1 && !requestSent) { requestSent=true; Pulse(.08f);return RequestShelterWithFeedback(); }
            }
            else
            {
                if(requestHeld>0 && !requestSent) ShelterFeedback("RIGHT CONTROLLER","HOLD B · 1 SEC",4);
                requestHeld=0;requestSent=false;
            }
            return Task.CompletedTask;
        }
        void LateUpdate()
        {
            if(Application.isFocused) _=ProcessShelterButton(OVRInput.Get(OVRInput.RawButton.B,OVRInput.Controller.RTouch),Time.unscaledDeltaTime);
            Tick();
        }
        void OnApplicationFocus(bool focused)
        {
            if(!focused) {requestHeld=0;requestSent=false;if(Application.isPlaying) OVRInput.SetControllerVibration(0,0,OVRInput.Controller.RTouch);}
        }
        void OnDestroy()
        {
            if(Application.isPlaying) OVRInput.SetControllerVibration(0,0,OVRInput.Controller.RTouch);
            if(relay!=null) relay.Changed-=Refresh;
            if(missionView!=null) missionView.Recentered-=OnRecenter;
            if(missionView!=null) missionView.ActionFeedback-=OnFeedback;
            if(sound!=null && sound.clip!=null) { if(Application.isPlaying) Destroy(sound.clip); else DestroyImmediate(sound.clip); }
        }
        static AudioClip Chime()
        {
            const int rate=24000; var clip=AudioClip.Create("Beacon alert",rate/3,1,rate,false); var samples=new float[rate/3];
            for(int i=0;i<samples.Length;i++) { float t=(float)i/rate; samples[i]=Mathf.Sin(2*Mathf.PI*(t<.16f ? 660 : 880)*t)*Mathf.Sin(Mathf.PI*i/samples.Length)*.5f; }
            clip.SetData(samples,0); return clip;
        }
    }
}
