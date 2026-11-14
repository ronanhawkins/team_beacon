using System;
using UnityEngine;

namespace Beacon
{
    public sealed class BeaconPerformance : MonoBehaviour
    {
#if DEVELOPMENT_BUILD || UNITY_EDITOR
        readonly float[] frames=new float[360];
        int count;
        float warmup=3;
        void OnApplicationPause(bool paused) { count=0; warmup=3; }
        void Update()
        {
            if(warmup>0) { warmup-=Time.unscaledDeltaTime; return; }
            if(!Application.isFocused) { count=0; return; }
            frames[count++]=Time.unscaledDeltaTime*1000;
            if(count<frames.Length) return;
            float total=0; foreach(float frame in frames) total+=frame;
            Array.Sort(frames);
            Debug.Log($"BEACON_PERF: {frames.Length} frames, mean {frames.Length*1000/total:0.0} fps, p95 {frames[(int)(frames.Length*.95f)]:0.0} ms");
            count=0;
        }
#endif
    }
}
