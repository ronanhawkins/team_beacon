using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Beacon
{
    // Presentation only: never changes mission progression or planner values.
    public sealed class WaypointPhotoCard
    {
        [Serializable] public sealed class Photo {public string waypoint,resource,caption,credit;public double x,y;public float[] crop;}
        [Serializable] public sealed class Catalog {public string site;public float west,south,extent;public Photo[] photos;}
        readonly RectTransform root;
        readonly CanvasGroup group;
        readonly TMP_Text title,caption,credit;
        readonly RawImage image;
        readonly Image pin;
        readonly Catalog catalog;
        readonly Dictionary<string,Texture2D> textures=new Dictionary<string,Texture2D>();
        readonly HashSet<string> shown=new HashSet<string>();
        string routeKey;
        int lastIndex=-1;
        float until;
        public bool Visible => root.gameObject.activeSelf;
        public string WaypointId {get;private set;}
        public string PhotoResource {get;private set;}
        public RectTransform Root => root;
        public RawImage Image => image;
        public WaypointPhotoCard(RectTransform surface,TMP_FontAsset font)
        {
            root=surface;group=root.gameObject.AddComponent<CanvasGroup>();group.blocksRaycasts=false;group.interactable=false;
            title=BeaconUi.Text(root,font,"",0,98,288,58,25,Color.white);
            title.textWrappingMode=TextWrappingModes.Normal;title.enableAutoSizing=true;title.fontSizeMin=21;title.fontSizeMax=25;
            image=BeaconUi.Rect("Real location photo",root,0,0,280,132).gameObject.AddComponent<RawImage>();image.raycastTarget=false;
            pin=BeaconUi.Backing(image.transform,8,8,new Color(1,.65f,.22f));pin.rectTransform.localEulerAngles=new Vector3(0,0,45);
            caption=BeaconUi.Text(root,font,"",0,-83,294,24,18,Color.white);
            credit=BeaconUi.Text(root,font,"",0,-108,294,23,15,new Color(.76f,.82f,.85f));
            var data=Resources.Load<TextAsset>("WaypointPhotos/catalog");
            if(data!=null) catalog=JsonConvert.DeserializeObject<Catalog>(data.text);
            root.gameObject.SetActive(false);
        }
        public void Reset() {shown.Clear();routeKey=null;lastIndex=-1;until=0;WaypointId=null;root.gameObject.SetActive(false);}
        static bool Named(MissionSelection selection,int index)
            => index==0 || index==selection.Points.Count-1 || selection.Points[index].isScienceStop || selection.Points[index].isShelter;
        public void Tick(MissionState state,MissionSelection selection,MissionSite site,SitePosition position,bool walking,bool connected,float now)
        {
            bool valid=connected && selection!=null && position!=null && catalog!=null && site?.site!=null &&
                site.site.IndexOf(catalog.site,StringComparison.OrdinalIgnoreCase)>=0;
            if(!valid) {root.gameObject.SetActive(false);return;}
            string key=site.site+":"+state.route+":"+state.rerouteFrom;
            if(key!=routeKey || selection.Index<lastIndex) {Reset();routeKey=key;}
            lastIndex=selection.Index;
            // Photos yield to the solar-storm instructions. Nothing is acknowledged
            // as seen, so an arrival photo can appear after the emergency ends.
            if(state.Emergency) {until=0;root.gameObject.SetActive(false);return;}
            int arrived=-1;
            if(!walking) {if(Named(selection,selection.Index)) arrived=selection.Index;}
            else
            {
                double closest=WalkNavigation.ArrivalRadius;
                // Include the next point before its relay acknowledgement, and
                // the previous one if that acknowledgement arrived this frame.
                for(int i=Math.Max(0,selection.Index-1);i<=Math.Min(selection.Points.Count-1,selection.Index+1);i++)
                {
                    if(!Named(selection,i)) continue;
                    double distance=Navigation.Distance(position,selection.Points[i].pos);
                    if(distance<=closest) {closest=distance;arrived=i;}
                }
            }
            if(arrived>=0)
            {
                var point=selection.Points[arrived];
                if(!shown.Contains(point.id) && SetPhoto(point))
                {shown.Add(point.id);WaypointId=point.id;until=now+5;Debug.Log("BEACON_ARRIVAL_PHOTO: "+point.id+" / "+PhotoResource);}
            }
            bool show=now<until;root.gameObject.SetActive(show);
            if(show) group.alpha=Mathf.Clamp01((until-now)/.4f);
        }
        Texture2D Load(string name)
        {
            if(!textures.TryGetValue(name,out var texture)) {texture=Resources.Load<Texture2D>("WaypointPhotos/"+name);textures[name]=texture;}
            return texture;
        }
        bool SetPhoto(Waypoint point)
        {
            Photo photo=null;
            foreach(var item in catalog.photos)
                if(item.waypoint==point.id && Navigation.Distance(point.pos,new SitePosition {x=item.x,y=item.y})<5) {photo=item;break;}
            PhotoResource=photo?.resource ?? "HiRISE";var texture=Load(PhotoResource);if(texture==null) return false;
            image.texture=texture;image.uvRect=new Rect(0,0,1,1);pin.gameObject.SetActive(photo==null);
            if(photo?.crop?.Length==4) image.uvRect=new Rect(photo.crop[0],photo.crop[1],photo.crop[2],photo.crop[3]);
            float ratio=texture.width*image.uvRect.width/(texture.height*image.uvRect.height);
            if(photo==null)
            {
                float u=((float)point.pos.x-catalog.west)/catalog.extent,v=((float)point.pos.y-catalog.south)/catalog.extent;
                if(u<0 || u>1 || v<0 || v>1) return false;
                float span=80/catalog.extent,left=Mathf.Clamp(u-span*.5f,0,1-span),bottom=Mathf.Clamp(v-span*.5f,0,1-span);
                image.uvRect=new Rect(left,bottom,span,span);ratio=1;
                image.rectTransform.sizeDelta=new Vector2(132,132);
                pin.rectTransform.anchoredPosition=new Vector2(((u-left)/span-.5f)*132,((v-bottom)/span-.5f)*132);
            }
            else image.rectTransform.sizeDelta=ratio>280f/132 ? new Vector2(280,280/ratio):new Vector2(132*ratio,132);
            title.text="ARRIVED · "+point.Name;
            caption.text=photo?.caption ?? "HiRISE · orbital view";
            credit.text=photo?.credit ?? "NASA/JPL-Caltech/UArizona/USGS";
            return true;
        }
    }
}
