using TMPro;
using UnityEngine;
using UnityEngine.UI;

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
        TMP_Text openSky,skyCaption,science,scienceCaption,alert,decision,credit,viewMode;
        RectTransform sciencePanel,decisionPanel;
        CompassGraphic compass;
        ArrowGraphic waypointGraphic;
        HudBorderGraphic border;
        CanvasGroup alertGroup;
        Image alertBacking;
        AudioSource sound;
        string alertKey="";
        float pulseUntil,requestHeld;
        bool requestSent;

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
            var strip=Surface("Quiet mission line",0,-18,1000,74,1.1f);
            BeaconUi.Backing(strip,1000,74,new Color(.025f,.04f,.055f,.58f));
            string[] captions={"SHELTER","BASE","SUNLIGHT","OXYGEN","DOSE USED"};
            for(int i=0;i<5;i++)
            {
                float x=(i-2)*200;
                Text(strip,captions[i],x,25,188,27,20,Muted);
                readings[i]=Text(strip,"--",x,-11,188,48,36,White);
            }
            var sky=Surface("Open sky",-24,-6,210,102,.29f);
            BeaconUi.Backing(sky,210,102,new Color(.025f,.04f,.055f,.40f));
            skyCaption=Text(sky,"OPEN SKY",0,31,190,24,19,Muted);
            openSky=Text(sky,"--%",0,-11,190,65,46,Mint);
            sciencePanel=Surface("Science stop",24,-6,280,102,.36f);
            BeaconUi.Backing(sciencePanel,280,102,new Color(.025f,.04f,.055f,.48f));
            scienceCaption=Text(sciencePanel,"SCIENCE STOP",0,29,258,25,18,Muted);
            science=Text(sciencePanel,"",0,-10,258,55,28,White);

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
            viewMode=Text(tape,"AR · X: VR",0,58,250,23,18,Muted);

            var alertPanel=Surface("Emergency status",0,9,780,54,.90f);
            alertBacking=BeaconUi.Backing(alertPanel,780,54,new Color(.24f,.04f,.035f,.8f));
            alert=Text(alertPanel,"",0,0,750,50,34,White);
            alertGroup=alertPanel.gameObject.AddComponent<CanvasGroup>();
            var frame=Surface("Peripheral alert border",0,0,1000,650,1.72f);
            border=BeaconUi.Rect("Border",frame,0,0,1000,650).gameObject.AddComponent<HudBorderGraphic>(); border.raycastTarget=false;
            decisionPanel=Surface("Shelter choice reason",0,-22.3f,1100,42,1.15f);
            decision=Text(decisionPanel,"",0,0,1090,42,24,White);
            var source=Surface("Data credit",0,-26,1100,28,1.12f);
            credit=Text(source,"",0,0,1100,28,18,Muted);
            sound=gameObject.AddComponent<AudioSource>(); sound.spatialBlend=0; sound.volume=.15f; sound.clip=Chime();
            relay.Changed+=Refresh; Refresh(); Tick();
        }
        public void Refresh()
        {
            if(root==null) return;
            var s=relay.State; var sel=relay.Selection; bool live=relay.Connected && sel!=null;
            var p=sel?.Point;
            openSky.text=s==null ? "--%" : $"{s.openSky*100:0.0}<size=65%>%</size>";
            openSky.color=live ? Mint : Muted; skyCaption.text=live ? "OPEN SKY" : "LAST DATA";
            readings[0].text=!live ? "--" : p.isShelter ? "IN SHELTER" : $"{s.minutesToShelter:0.0} min";
            readings[0].fontSize=live && p.isShelter ? 28 : 36;
            readings[1].text=s==null ? "--" : s.baseLink ? "LINK OK" : "LINK LOST";
            readings[2].text=s==null ? "--" : s.sunlit ? "SUNLIT" : "SHADE";
            readings[3].text=s==null ? "--" : $"{s.oxygenFraction*100:0}%";
            readings[4].text=s==null ? "--" : $"{s.doseFraction*100:0.0}%";
            for(int i=0;i<readings.Length;i++) readings[i].color=live ? White : Muted;
            if(live) { readings[1].color=s.baseLink ? Mint : Amber; readings[3].color=Mint; }
            bool showScience=live && p.isScienceStop;
            sciencePanel.gameObject.SetActive(showScience);
            if(showScience) { scienceCaption.text="SCIENCE STOP"; science.text=p.Name; }
            waypoint.gameObject.SetActive(live && sel.Next!=null);
            waypointGraphic.color=s?.Emergency==true ? Red : sel?.Reroute==true ? Amber : new Color(.45f,.8f,1);
            string key="",title="";
            bool emergency=s?.Emergency==true;
            if(!live && s!=null) { key="offline"; title="DATA OFFLINE · CHECK USB"; }
            else if(emergency)
            {
                key="emergency:"+s.panic+":"+p.isShelter;
                title=p.isShelter ? "IN SHELTER · HOLD POSITION" : s.panic ? "EMERGENCY · SEEK SHELTER" : "SOLAR STORM, TAKE COVER";
            }
            else if(s?.mode=="warning") { key="warning"; title=MissionPresentation.Warning(s); }
            if(key!=alertKey) { pulseUntil=emergency ? Time.unscaledTime+3 : 0; if(emergency) sound.Play(); alertKey=key; }
            alertGroup.gameObject.SetActive(key!=""); alert.text=title;
            alertBacking.color=emergency ? new Color(.26f,.035f,.025f,.8f) : new Color(.16f,.11f,.025f,.8f);
            border.gameObject.SetActive(live && s.mode!="nominal"); border.color=emergency ? new Color(1,.18f,.10f,.58f) : new Color(1,.65f,.15f,.35f);
            decision.text=live ? MissionPresentation.Decision(s,relay.Document) : "";
            decisionPanel.gameObject.SetActive(!string.IsNullOrEmpty(decision.text));
            credit.text=MissionPresentation.Credit(relay.Site);
        }
        public void Tick()
        {
            if(root==null || missionView==null) return;
            float heading=missionView.Heading;
            compass.Heading=heading; compass.SetVerticesDirty();
            for(int i=0;i<bearings.Length;i++)
            {
                float relative=(float)Navigation.Relative(i*15,heading); bool visible=Mathf.Abs(relative)<CompassHalfSpan-6;
                bearings[i].gameObject.SetActive(visible);
                if(visible) bearings[i].rectTransform.anchoredPosition=new Vector2(relative/CompassHalfSpan*CompassWidth*.5f,13);
            }
            if(relay.Connected && relay.Selection?.Next!=null)
            {
                float relative=(float)Navigation.Relative(relay.State.headingDeg,heading);
                waypoint.anchoredPosition=new Vector2(Mathf.Clamp(relative/CompassHalfSpan,-.96f,.96f)*CompassWidth*.5f,-27);
                waypoint.localEulerAngles=new Vector3(0,0,Mathf.Abs(relative)>CompassHalfSpan ? -Mathf.Sign(relative)*90 : 0);
            }
            viewMode.text=missionView.Immersive ? "VR · X: AR" : "AR · X: VR";
            if(alertGroup.gameObject.activeSelf) alertGroup.alpha=Time.unscaledTime<pulseUntil ? .88f+.12f*Mathf.Sin(Time.unscaledTime*5) : 1;
        }
        void LateUpdate()
        {
            Tick();
            if(OVRInput.Get(OVRInput.Button.Two,OVRInput.Controller.RTouch))
            { requestHeld+=Time.unscaledDeltaTime; if(requestHeld>=1 && !requestSent) { relay.RequestShelter(); requestSent=true; } }
            else { requestHeld=0; requestSent=false; }
        }
        void OnDestroy() { if(relay!=null) relay.Changed-=Refresh; }
        static AudioClip Chime()
        {
            const int rate=24000; var clip=AudioClip.Create("Beacon alert",rate/3,1,rate,false); var samples=new float[rate/3];
            for(int i=0;i<samples.Length;i++) { float t=(float)i/rate; samples[i]=Mathf.Sin(2*Mathf.PI*(t<.16f ? 660 : 880)*t)*Mathf.Sin(Mathf.PI*i/samples.Length)*.5f; }
            clip.SetData(samples,0); return clip;
        }
    }
}
