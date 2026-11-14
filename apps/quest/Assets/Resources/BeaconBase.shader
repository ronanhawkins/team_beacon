Shader "Beacon/Simple base"
{
    Properties { _SunDir("Sun direction",Vector)=(-.98,.2,.18,0) }
    SubShader
    {
        Tags { "RenderType"="Opaque" }
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "UnityCG.cginc"
            float3 _SunDir;
            struct a {float4 vertex:POSITION;float3 normal:NORMAL;float4 colour:COLOR;UNITY_VERTEX_INPUT_INSTANCE_ID};
            struct v {float4 pos:SV_POSITION;float3 normal:TEXCOORD0;float3 world:TEXCOORD1;float4 colour:COLOR;UNITY_VERTEX_OUTPUT_STEREO};
            v vert(a i)
            {
                v o;UNITY_SETUP_INSTANCE_ID(i);UNITY_INITIALIZE_OUTPUT(v,o);UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.pos=UnityObjectToClipPos(i.vertex);o.normal=UnityObjectToWorldNormal(i.normal);
                o.world=mul(unity_ObjectToWorld,i.vertex).xyz;o.colour=i.colour;return o;
            }
            float4 frag(v i):SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                float light=.42+.65*saturate(dot(normalize(i.normal),normalize(_SunDir)));
                float haze=1-exp(-max(0,distance(i.world,_WorldSpaceCameraPos)-120)*.0011);
                return float4(lerp(i.colour.rgb*light,float3(.53,.32,.20),haze),1);
            }
            ENDCG
        }
    }
}
