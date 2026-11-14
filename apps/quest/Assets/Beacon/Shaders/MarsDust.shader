Shader "Beacon/Mars Dust"
{
    Properties { _Storm ("Storm strength", Range(0,1)) = 0 }
    SubShader
    {
        Tags { "Queue"="Transparent-100" "RenderType"="Transparent" "IgnoreProjector"="True" }
        Cull Off ZWrite Off ZTest LEqual
        Blend SrcAlpha OneMinusSrcAlpha, One OneMinusSrcAlpha
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "UnityCG.cginc"
            struct appdata
            {
                float4 vertex : POSITION;
                float2 uv : TEXCOORD0;
                float2 size : TEXCOORD1;
                float2 drift : TEXCOORD2;
                float4 colour : COLOR;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };
            struct v2f
            {
                float4 vertex : SV_POSITION;
                float2 uv : TEXCOORD0;
                float4 colour : COLOR;
                UNITY_VERTEX_OUTPUT_STEREO
            };
            float _Storm;
            v2f vert(appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_OUTPUT(v2f, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                float phase = frac(_Time.y * v.drift.x + v.drift.y);
                float3 centre = mul(unity_ObjectToWorld, v.vertex).xyz;
                centre.x += (phase - 0.5) * 24;
                centre.y += sin(phase * 6.283 + v.drift.y * 17) * 0.08;
                float3 right = UNITY_MATRIX_I_V._m00_m10_m20;
                float3 up = UNITY_MATRIX_I_V._m01_m11_m21;
                float3 position = centre + right * v.uv.x * v.size.x + up * v.uv.y * v.size.y;
                o.vertex = mul(UNITY_MATRIX_VP, float4(position, 1));
                o.uv = v.uv;
                o.colour = v.colour;
                // No particles close to the face; fade wrap-around at the edges.
                o.colour.a *= smoothstep(0, 0.12, phase) * (1 - smoothstep(0.85, 1, phase));
                o.colour.a *= smoothstep(1.1, 2.8, distance(centre, _WorldSpaceCameraPos));
                o.colour.a *= lerp(0.55, 1.35, _Storm);
                return o;
            }
            float4 frag(v2f i) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                float radius = dot(i.uv, i.uv);
                float softness = saturate(exp2(-radius * 5) - 0.03125) / 0.96875;
                return float4(i.colour.rgb, softness * i.colour.a);
            }
            ENDCG
        }
    }
}
