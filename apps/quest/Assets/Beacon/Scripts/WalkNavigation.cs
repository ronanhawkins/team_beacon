using System;

namespace Beacon
{
    // Follows the supplied path. It never searches terrain or chooses a shelter.
    public static class WalkNavigation
    {
        public const double ArrivalRadius=2.5;
        // Mission destinations are distinct from the dense samples used to
        // follow a path. A diversion always ends at its chosen shelter.
        public static int WaypointIndex(MissionSelection selection,SitePosition position,bool destinationReached=false)
        {
            if(selection==null || position==null) return -1;
            for(int i=selection.Index+1;i<selection.Points.Count;i++)
                if(selection.Reroute ? i==selection.Points.Count-1 : IsStop(selection,i)) return i;
            return !destinationReached && Navigation.Distance(position,selection.Point.pos)>ArrivalRadius ? selection.Index:-1;
        }
        static bool IsStop(MissionSelection selection,int index)
            => index==selection.Points.Count-1 || selection.Points[index].isScienceStop || selection.Points[index].isShelter;
        public static int TargetIndex(MissionSelection selection,SitePosition position,bool destinationReached=false)
        {
            if(selection==null || position==null) return -1;
            for(int i=selection.Index+1;i<selection.Points.Count;i++)
            {
                if(!IsStop(selection,i) && (Navigation.Distance(selection.Points[i-1].pos,selection.Points[i].pos)<=.1 || PassedPoint(selection,i,position))) continue;
                return i;
            }
            return !destinationReached && Navigation.Distance(position,selection.Point.pos)>ArrivalRadius ? selection.Index:-1;
        }
        public static bool ShouldAdvance(MissionSelection selection,SitePosition position)
        {
            if(selection==null || position==null || selection.Index+1>=selection.Points.Count) return false;
            // Relay `next` advances exactly one index, including coincident
            // points; MissionSelection.Next intentionally skips those for UI.
            int next=selection.Index+1;var point=selection.Points[next].pos;
            return Navigation.Distance(position,point)<=ArrivalRadius ||
                (!IsStop(selection,next) && Navigation.Distance(selection.Point.pos,point)<=.1) || PassedPoint(selection,next,position);
        }
        static double Along(SitePosition p,SitePosition a,SitePosition b)
        {
            double x=b.x-a.x,y=b.y-a.y,length=x*x+y*y;
            return length<.0001 ? 0:((p.x-a.x)*x+(p.y-a.y)*y)/length;
        }
        static double SegmentDistance(SitePosition p,SitePosition a,SitePosition b)
        {
            double t=Math.Max(0,Math.Min(1,Along(p,a,b)));
            double x=p.x-(a.x+(b.x-a.x)*t),y=p.y-(a.y+(b.y-a.y)*t);
            return Math.Sqrt(x*x+y*y);
        }
        static bool PassedPoint(MissionSelection selection,int index,SitePosition position)
        {
            // Being closer to the goal alone is insufficient on a hairpin.
            // Also require crossing the incoming point's plane, or reaching
            // the outgoing leg more closely than the incoming leg.
            if(index<=0 || IsStop(selection,index)) return false;
            int goal=WaypointIndex(selection,position);if(goal<=index) return false;
            var before=selection.Points[index-1].pos;var point=selection.Points[index].pos;
            var after=selection.Points[index+1].pos;var destination=selection.Points[goal].pos;
            if(Navigation.Distance(position,destination)+.5>=Navigation.Distance(point,destination)) return false;
            if(Along(position,before,point)>1) return true;
            return Along(position,point,after)>0 && SegmentDistance(position,point,after)+.5<SegmentDistance(position,before,point);
        }
        public static bool InShelter(MissionSelection selection,SitePosition position)
            => selection?.Point.isShelter==true && Navigation.Distance(position,selection.Point.pos)<=ArrivalRadius;
        public static int ClosestMain(RouteDocument document,SitePosition position)
        {
            int closest=0;double distance=double.PositiveInfinity;
            for(int i=0;i<document.main.Count;i++)
            {
                double d=Navigation.Distance(position,document.main[i].pos);
                if(d<distance) {distance=d;closest=i;}
            }
            return closest;
        }
        public static double Remaining(MissionSelection selection,SitePosition position)
        {
            int target=TargetIndex(selection,position);
            if(target<0) return selection?.Point.isShelter==true && position!=null ? Navigation.Distance(position,selection.Point.pos):0;
            double total=Navigation.Distance(position,selection.Points[target].pos);
            for(int i=target;i<selection.Points.Count-1;i++) total+=Navigation.Distance(selection.Points[i].pos,selection.Points[i+1].pos);
            return total;
        }
    }
}
