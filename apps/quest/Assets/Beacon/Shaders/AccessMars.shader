Shader "Beacon/Access Mars photographs"
{
    Properties { _MainTex("Original rover photograph",2D)="white"{} }
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
            sampler2D _MainTex;
            struct a {float4 vertex:POSITION;float2 uv:TEXCOORD0;UNITY_VERTEX_INPUT_INSTANCE_ID};
            struct v {float4 vertex:SV_POSITION;float2 uv:TEXCOORD0;float3 world:TEXCOORD1;UNITY_VERTEX_OUTPUT_STEREO};
            v vert(a i) {v o;UNITY_SETUP_INSTANCE_ID(i);UNITY_INITIALIZE_OUTPUT(v,o);UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);o.vertex=UnityObjectToClipPos(i.vertex);o.uv=i.uv;o.world=mul(unity_ObjectToWorld,i.vertex).xyz;return o;}
            float4 frag(v i):SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                float3 colour=tex2D(_MainTex,i.uv).rgb;
                float haze=1-exp(-max(0,distance(i.world,_WorldSpaceCameraPos)-100)*.0012);
                return float4(lerp(colour,float3(.56,.34,.22),haze),1);
            }
            ENDCG
        }
    }
}
