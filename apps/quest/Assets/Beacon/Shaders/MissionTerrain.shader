Shader "Beacon/Measured terrain with illustrative materials"
{
    Properties
    {
        _MainTex("Orbital colour",2D)="white"{}
        _SandTex("Illustrative sand",2D)="white"{}
        _RockTex("Illustrative sandstone",2D)="white"{}
        _SunDir("Sun direction",Vector)=(-.98,.2,.18,0)
        _Cosmetic("Illustrative materials",Float)=1
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
            sampler2D _MainTex,_SandTex,_RockTex;float _Cosmetic;float3 _SunDir;
            struct a {float4 vertex:POSITION;float3 normal:NORMAL;float2 uv:TEXCOORD0;float4 colour:COLOR;UNITY_VERTEX_INPUT_INSTANCE_ID};
            struct v {float4 pos:SV_POSITION;float2 uv:TEXCOORD0;float3 local:TEXCOORD1;float3 world:TEXCOORD2;float3 normal:TEXCOORD3;float3 localNormal:TEXCOORD4;float shadow:TEXCOORD5;UNITY_VERTEX_OUTPUT_STEREO};
            v vert(a i)
            {
                v o;UNITY_SETUP_INSTANCE_ID(i);UNITY_INITIALIZE_OUTPUT(v,o);UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.pos=UnityObjectToClipPos(i.vertex);o.uv=i.uv;o.local=i.vertex.xyz;o.world=mul(unity_ObjectToWorld,i.vertex).xyz;
                o.normal=UnityObjectToWorldNormal(i.normal);o.localNormal=i.normal;o.shadow=i.colour.r;return o;
            }
            float4 frag(v i):SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                float distanceToEye=distance(i.world,_WorldSpaceCameraPos);
                float3 orbital=tex2D(_MainTex,i.uv).rgb;
                float3 n=normalize(i.normal),localN=normalize(i.localNormal);
                float2 weights=pow(abs(localN.xz),4);weights/=max(weights.x+weights.y,.001);
                float3 sand=tex2D(_SandTex,i.local.xz*.6).rgb;
                sand*=lerp(float3(1,1,1),clamp(tex2D(_SandTex,i.local.xz*.079).rgb/float3(.3593,.1924,.0961),.7,1.3),.3);
                float3 rock=tex2D(_RockTex,i.local.zy*.34).rgb*weights.x+tex2D(_RockTex,i.local.xy*.34).rgb*weights.y;
                float cliff=1-smoothstep(.84,.98,abs(localN.y));
                float3 material=lerp(sand,rock,cliff);
                float grain=dot(material,float3(.2126,.7152,.0722));
                // Fine bump shading affects light only, never the actual surface.
                float3 dpdx=ddx(i.world),dpdy=ddy(i.world);
                float3 r1=cross(dpdy,n),r2=cross(n,dpdx);float determinant=dot(dpdx,r1);
                float3 gradient=(ddx(grain)*r1+ddy(grain)*r2)/max(abs(determinant),.000001)*sign(determinant);
                n=normalize(n-gradient*.045*_Cosmetic);
                float nearBlend=1-smoothstep(80,350,distanceToEye);
                float3 colour=lerp(orbital,material,nearBlend*.88*_Cosmetic);
                float diffuse=saturate(dot(n,normalize(_SunDir)));
                colour*=.38+diffuse*.95*i.shadow;
                float haze=1-exp(-max(0,distanceToEye-120)*.0011);
                return float4(lerp(colour,float3(.53,.32,.20),haze),1);
            }
            ENDCG
        }
    }
}
