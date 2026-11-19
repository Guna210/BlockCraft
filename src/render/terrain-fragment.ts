import { bayerGlsl } from './dither';

export const FS_CHUNK = `#version 300 es
precision highp float;
flat in float v_leaf;
flat in float v_fluid;
flat in float v_flow;
#ifdef BLOOM_EMISSIVE
flat in float v_emissive;
#endif
in vec3 v_normal;
uniform float u_fluidTime;
uniform int u_fastLeaves;
uniform highp sampler2D u_sceneDepth;
uniform mat4 u_inverseViewProj;
uniform vec2 u_viewport;
in vec2 v_unwrappedUV;
flat in vec2 v_tileOrigin;
in vec3 v_light;
in vec3 v_tint;
flat in float v_grassSide;
in vec3 v_worldPos;
in vec3 v_fogColor;
in float v_puddle;
uniform vec3 u_cameraPos;
uniform float u_fogStart;
uniform float u_fogEnd;
uniform sampler2D u_atlasSampler;
uniform vec2 u_atlasSize;
uniform bool u_underwater;
uniform vec3 u_waterFogColor;
uniform highp int u_isCutout;
uniform int u_isWireframe;
uniform float u_fade;
const float BAYER_4X4[16] = ${bayerGlsl()};
#ifdef BLOOM_EMISSIVE
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragEmissive;
#else
out vec4 fragColor;
#endif
void main() {
  if (u_fade < 1.0) {
    ivec2 pixel = ivec2(gl_FragCoord.xy);
    if (BAYER_4X4[(pixel.y & 3) * 4 + (pixel.x & 3)] >= u_fade) discard;
  }
  if (u_isWireframe == 1) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
#ifdef BLOOM_EMISSIVE
    fragEmissive = vec4(0.0);
#endif
    return;
  }
  vec2 uv = v_unwrappedUV;
  if (v_fluid > 0.5) {
    uv = abs(v_normal.y) > 0.5 ? v_worldPos.xz : vec2(abs(v_normal.x) > 0.5 ? v_worldPos.z : v_worldPos.x, -v_worldPos.y);
    if (v_flow > 8.5 || abs(v_normal.y) < 0.5) uv.y -= u_fluidTime * 0.35;
    else if (v_flow > 0.5) {
      float angle = (v_flow - 1.0) * 0.785398163;
      uv -= vec2(cos(angle), sin(angle)) * u_fluidTime * 0.22;
    }
  }
  vec2 tileSize = vec2(16.0) / u_atlasSize;
  vec2 halfTexel = vec2(0.5) / u_atlasSize;
  vec2 tileUV = clamp(v_tileOrigin + fract(uv) * tileSize, v_tileOrigin + halfTexel, v_tileOrigin + tileSize - halfTexel);
  vec4 texColor = textureGrad(u_atlasSampler, tileUV, dFdx(uv) * tileSize, dFdy(uv) * tileSize);
#ifdef LOD_TERRAIN
  // The padded atlas stops at mip 2. Fade to a four-tap tile average below a screen pixel.
  if (v_fluid < 0.5) {
    float footprint = max(length(dFdx(uv)), length(dFdy(uv)));
    float blend = smoothstep(0.3, 1.0, footprint);
    if (blend > 0.0) {
      vec4 average = (textureLod(u_atlasSampler, v_tileOrigin + vec2(.25, .25) * tileSize, 2.0)
        + textureLod(u_atlasSampler, v_tileOrigin + vec2(.75, .25) * tileSize, 2.0)
        + textureLod(u_atlasSampler, v_tileOrigin + vec2(.25, .75) * tileSize, 2.0)
        + textureLod(u_atlasSampler, v_tileOrigin + vec2(.75, .75) * tileSize, 2.0)) * .25;
      texColor = mix(texColor, average, blend);
    }
  }
#endif
  if (u_fastLeaves == 1 && v_leaf > 0.5) {
    // Fast leaves are opaque cubes: gaps in the sprite become a dark leaf colour.
    texColor = texColor.a < 0.5 ? vec4(0.11, 0.17, 0.08, 1.0) : vec4(texColor.rgb, 1.0);
  } else if (u_isCutout == 1 && texColor.a < 0.5) discard;
  // Grass side alpha selects the tinted fringe; its dirt base stays untinted and opaque.
  vec3 tint = mix(v_tint, mix(vec3(1.0), v_tint, texColor.a), v_grassSide);
  vec3 litColor = texColor.rgb * tint * v_light;
  float alpha = mix(texColor.a, 1.0, v_grassSide);
  if (v_fluid > 0.5 && v_fluid < 1.5 && u_underwater) alpha = 1.0;
  if (v_fluid > 1.5) { litColor = texColor.rgb; alpha = 1.0; }
  if (v_fluid > 0.5 && v_fluid < 1.5 && !u_underwater) {
    vec2 screenUV = gl_FragCoord.xy / u_viewport;
    float depth = texture(u_sceneDepth, screenUV).r;
    vec4 behind = u_inverseViewProj * vec4(screenUV * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec3 scenePos = behind.xyz / behind.w;
    float thickness = depth >= 0.999999 ? 32.0 : max(0.0, length(scenePos-u_cameraPos)-length(v_worldPos-u_cameraPos));
    float absorption = 1.0 - exp(-thickness * 0.16);
    litColor = mix(litColor, vec3(0.025,0.085,0.19) * max(v_light,vec3(0.2)), absorption);
    vec3 view = normalize(u_cameraPos-v_worldPos);
    vec3 surfaceNormal = normalize(cross(dFdx(v_worldPos),dFdy(v_worldPos)));
    float fresnel = 0.02 + 0.30 * pow(1.0-abs(dot(view,surfaceNormal)),5.0);
    litColor = mix(litColor, v_fogColor, fresnel);
    alpha = mix(0.26,0.96,absorption) + fresnel * 0.12;
  }
  if (v_puddle > 0.001) {
    litColor *= (1.0 - 0.22 * v_puddle);
  }
  float horizDist = u_underwater ? length(v_worldPos - u_cameraPos) : length((v_worldPos - u_cameraPos).xz);
  float fogFactor = u_fogEnd > u_fogStart ? smoothstep(u_fogStart, u_fogEnd, horizDist) : 0.0;
  vec3 finalColor = mix(litColor, u_underwater ? u_waterFogColor : v_fogColor, fogFactor);
  fragColor = vec4(finalColor, alpha);
#ifdef BLOOM_EMISSIVE
  float emissivePeak = max(texColor.r, max(texColor.g, texColor.b));
  float bloomGate = v_emissive > 0.001 ? smoothstep(0.30, 0.70, emissivePeak) : 0.0;
  float glowStrength = v_emissive * (1.0 - fogFactor) * bloomGate;
  fragEmissive = vec4(texColor.rgb * tint * glowStrength, alpha);
#endif
}
`;
