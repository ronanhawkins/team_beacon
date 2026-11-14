using System;

namespace Beacon
{
    // Follows the supplied path. It never searches terrain or chooses a shelter.
    public static class WalkNavigation
    {
        public const double ArrivalRadius=2.5;
        public static int TargetIndex(MissionSelection selection,SitePosition position)
        {
            if(selection==null || position==null) return -1;
            for(int i=selection.Index+1;i<selection.Points.Count;i++)
                if(Navigation.Distance(selection.Point.pos,selection.Points[i].pos)>.1) return i;
            return Navigation.Distance(position,selection.Point.pos)>ArrivalRadius ? selection.Index:-1;
        }
        public static bool ReachedNext(MissionSelection selection,SitePosition position)
            => selection?.Next!=null && Navigation.Distance(position,selection.Next.pos)<=ArrivalRadius;
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
            int target=TargetIndex(selection,position);if(target<0) return 0;
            double total=Navigation.Distance(position,selection.Points[target].pos);
            for(int i=target;i<selection.Points.Count-1;i++) total+=Navigation.Distance(selection.Points[i].pos,selection.Points[i+1].pos);
            return total;
        }
    }
}
