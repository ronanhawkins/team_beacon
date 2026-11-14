Shader "Beacon/Access Mars photographs"
{
    Properties
    {
        _MainTex("Original rover photograph",2D)="white"{}
        _DetailTex("Synthetic surface detail",2D)="gray"{}
        _Cosmetic("Cosmetic fill enabled",Float)=1
    }
    SubShader
    {
        Tags {"RenderType"="Opaque" "Queue"="Geometry"}
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "UnityCG.cginc"
            sampler2D _MainTex,_DetailTex;float _Cosmetic;
            struct a {float4 vertex:POSITION;float3 normal:NORMAL;float2 uv:TEXCOORD0;UNITY_VERTEX_INPUT_INSTANCE_ID};
            struct v {float4 vertex:SV_POSITION;float2 uv:TEXCOORD0;float3 world:TEXCOORD1;float3 local:TEXCOORD2;float3 normal:TEXCOORD3;UNITY_VERTEX_OUTPUT_STEREO};
            v vert(a i) {v o;UNITY_SETUP_INSTANCE_ID(i);UNITY_INITIALIZE_OUTPUT(v,o);UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);o.vertex=UnityObjectToClipPos(i.vertex);o.uv=i.uv;o.local=i.vertex.xyz;o.normal=i.normal;o.world=mul(unity_ObjectToWorld,i.vertex).xyz;return o;}
            float4 frag(v i):SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                float3 colour=tex2D(_MainTex,i.uv).rgb;
                float viewDistance=distance(i.world,_WorldSpaceCameraPos);
                // Object-space projection stays attached to the original mesh,
                // including across adjacent photo tiles and explicit recentering.
                float3 weights=pow(abs(normalize(i.normal)),4);weights/=max(dot(weights,1),.001);
                float3 p=i.local*.45;
                float3 detail=tex2D(_DetailTex,p.zy).rgb*weights.x+tex2D(_DetailTex,p.xz).rgb*weights.y+tex2D(_DetailTex,p.xy).rgb*weights.z;
                float3 mean=float3(.3593,.1924,.0961);
                float meanLuma=dot(mean,float3(.2126,.7152,.0722));
                float nearDetail=1-smoothstep(25,100,viewDistance);
                float grain=clamp(dot(detail,float3(.2126,.7152,.0722))/meanLuma,.55,1.6);
                float high=max(colour.r,max(colour.g,colour.b)),low=min(colour.r,min(colour.g,colour.b));
                float luma=dot(colour,float3(.2126,.7152,.0722));
                float neutral=(1-smoothstep(.11,.24,(high-low)/max(high,.001)))*smoothstep(.015,.05,luma);
                // Only colour/detail is invented. Preserve source luminance,
                // mesh positions, collision, skyline and every mission reading.
                float3 filled=lerp(mean,detail,nearDetail)/meanLuma*clamp(luma*.93,.025,.42);
                float3 enhanced=colour*lerp(1,grain,.18*nearDetail);
                colour=lerp(colour,lerp(enhanced,filled,neutral*.96),saturate(_Cosmetic));
                float haze=1-exp(-max(0,viewDistance-100)*.0012);
                return float4(lerp(colour,float3(.56,.34,.22),haze),1);
            }
            ENDCG
        }
    }
}
