Shader "Beacon/Mars Atmosphere"
{
    Properties
    {
        _Storm ("Storm strength", Range(0,1)) = 0
        _SunDirection ("Sun direction", Vector) = (0.7,0.25,0.7,0)
        _SunVisibility ("Sun above skyline", Range(0,1)) = 1
        _Immersive ("Opaque VR sky", Range(0,1)) = 0
        _Panorama ("NASA Murray Buttes reference panorama", 2D) = "black" {}
        _PanoramaBounds ("Captured vertical coverage by bearing", 2D) = "white" {}
        _HasPanorama ("Panorama available", Float) = 0
        _NorthYaw ("Calibrated north yaw", Float) = 0
    }
    SubShader
    {
        Tags { "Queue"="Background+10" "RenderType"="Transparent" }
        Cull Off ZWrite Off ZTest LEqual
        Blend SrcAlpha OneMinusSrcAlpha, One OneMinusSrcAlpha
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "UnityCG.cginc"
            struct appdata { float4 vertex : POSITION; UNITY_VERTEX_INPUT_INSTANCE_ID };
            struct v2f { float4 vertex : SV_POSITION; float3 direction : TEXCOORD0; UNITY_VERTEX_OUTPUT_STEREO };
            float _Storm, _SunVisibility, _Immersive;
            float _HasPanorama, _NorthYaw;
            sampler2D _Panorama, _PanoramaBounds;
            float4 _SunDirection;
            v2f vert(appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_OUTPUT(v2f, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.vertex = UnityObjectToClipPos(v.vertex);
                o.direction = mul((float3x3)unity_ObjectToWorld,v.vertex.xyz);
                return o;
            }
            float4 frag(v2f i) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                float3 direction = normalize(i.direction);
                float altitude = direction.y;
                float upper = smoothstep(0.03, 0.65, altitude);
                float horizon = exp2(-abs(altitude + 0.08) * 9);
                float3 colour = lerp(float3(0.56,0.24,0.12), float3(0.64,0.43,0.30), upper);
                // This is a historical, partial cylindrical panorama, not the
                // live DEM. North is at both edges. Keep its original pixels;
                // fade uncovered mosaic areas into the existing sky/ground.
                float azimuth=atan2(direction.x,direction.z)-radians(_NorthYaw);
                float elevation=degrees(asin(clamp(direction.y,-1,1)));
                float2 photoUV=float2(frac(azimuth/(2*UNITY_PI)+1),saturate((elevation+72)/92));
                float3 photo=tex2D(_Panorama,photoUV).rgb;
                // Feather only the uncaptured outer boundary. Thresholding
                // photo brightness here would punch holes in real rock shadows.
                float2 bounds=tex2D(_PanoramaBounds,float2(photoUV.x,.5)).rg;
                float coverage=smoothstep(bounds.x,bounds.x+.075,photoUV.y)*(1-smoothstep(bounds.y-.075,bounds.y,photoUV.y));
                coverage*=smoothstep(-72,-58,elevation)*(1-smoothstep(12,20,elevation));
                float3 ground=float3(.22,.12,.075);
                colour=lerp(colour,ground,(1-smoothstep(-12,0,elevation))*_Immersive);
                colour=lerp(colour,photo,coverage*_Immersive*_HasPanorama);
                colour = lerp(colour, float3(0.47,0.16,0.07), _Storm * 0.36);
                // Thin horizon haze and a stronger overhead tint keep the room
                // legible through the entire AR atmosphere, even during storms.
                float opacity = upper * 0.42 + horizon * (0.10 + _Storm * 0.09);
                float alignment = saturate(dot(direction, normalize(_SunDirection.xyz)));
                float disc = smoothstep(0.999965, 0.999985, alignment) * _SunVisibility;
                float halo = pow(alignment, 420) * _SunVisibility;
                float aureole = pow(alignment, 45) * _SunVisibility;
                colour += float3(0.25,0.13,0.05) * aureole;
                colour = lerp(colour, float3(1.0,0.84,0.57), saturate(disc + halo * 0.65));
                opacity = saturate(opacity + (disc * 0.92 + halo * 0.30) * (1 - _Storm * 0.60));
                return float4(colour, lerp(opacity,1,_Immersive));
            }
            ENDCG
        }
    }
}
