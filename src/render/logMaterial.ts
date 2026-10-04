/**
 * 薪の材質：樹皮・割り面・木口を1つの材質で描き、区間ごとの
 * 温まり（トースト色）→焦げ（熱源側から）→亀裂の赤熱→白い灰 を別々のマスクで進める。
 */
import * as THREE from 'three';
import { GLSL_NOISE } from './glsl';
import { TexSet } from './textures';

export const MAX_SEGS = 8;

export interface LogTextures {
  bark: TexSet;
  wood: TexSet;
  end: TexSet;
}

export interface LogUniforms {
  uBarkMap: { value: THREE.Texture };
  uBarkNormal: { value: THREE.Texture };
  uEndMap: { value: THREE.Texture };
  uEndNormal: { value: THREE.Texture };
  uChar: { value: number[] };
  uGlow: { value: number[] };
  uAsh: { value: number[] };
  uTemp: { value: number[] };
  uSegCount: { value: number };
  uHeatDir: { value: THREE.Vector3 };
  uUpLocal: { value: THREE.Vector3 };
  uTime: { value: number };
  uMoist: { value: number };
  uHighlight: { value: number };
  uRadius: { value: number };
  uSeed: { value: number };
  uFade: { value: number };
  uBurnFront: { value: number };
  uShrink: { value: number };
  uGlowBoost: { value: number };
}

export function createLogMaterial(tex: LogTextures, opts: { tinder?: boolean; segCount: number; radius: number; seed: number }): {
  material: THREE.MeshStandardMaterial;
  uniforms: LogUniforms;
} {
  const uniforms: LogUniforms = {
    uBarkMap: { value: tex.bark.map },
    uBarkNormal: { value: tex.bark.normal },
    uEndMap: { value: tex.end.map },
    uEndNormal: { value: tex.end.normal },
    uChar: { value: new Array(MAX_SEGS).fill(0) },
    uGlow: { value: new Array(MAX_SEGS).fill(0) },
    uAsh: { value: new Array(MAX_SEGS).fill(0) },
    uTemp: { value: new Array(MAX_SEGS).fill(0) },
    uSegCount: { value: opts.segCount },
    uHeatDir: { value: new THREE.Vector3(0, -1, 0) },
    uUpLocal: { value: new THREE.Vector3(0, 1, 0) },
    uTime: { value: 0 },
    uMoist: { value: 0.1 },
    uHighlight: { value: 0 },
    uRadius: { value: opts.radius },
    uSeed: { value: (opts.seed % 997) / 97 },
    uFade: { value: 1 },
    uBurnFront: { value: 0 },
    uShrink: { value: 0 },
    uGlowBoost: { value: 1 },
  };
  const mat = new THREE.MeshStandardMaterial({
    map: tex.wood.map,
    normalMap: tex.wood.normal,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 0.82,
    metalness: 0,
    side: opts.tinder ? THREE.DoubleSide : THREE.FrontSide,
  });
  const tinder = !!opts.tinder;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.defines = { ...(shader.defines ?? {}), GB_SEGS: MAX_SEGS, ...(tinder ? { GB_TINDER: 1 } : {}) };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aSeg;
attribute float aSurf;
#ifdef GB_TINDER
attribute float aBurn;
varying float vBurn;
uniform float uShrink;
#endif
varying float vSeg;
varying float vSurf;
varying vec3 vLocalPos;
varying vec3 vLocalNormal;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vSeg = aSeg;
vSurf = aSurf;
vLocalPos = position;
vLocalNormal = normal;
#ifdef GB_TINDER
vBurn = aBurn;
float shr = uShrink * smoothstep(0.0, 0.6, 1.0 - aBurn * 0.5);
transformed.y = mix(transformed.y, -0.017 + (transformed.y + 0.017) * 0.3, shr);
transformed.xz *= mix(1.0, 0.82, shr);
#endif`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${GLSL_NOISE}
uniform sampler2D uBarkMap;
uniform sampler2D uBarkNormal;
uniform sampler2D uEndMap;
uniform sampler2D uEndNormal;
uniform float uChar[GB_SEGS];
uniform float uGlow[GB_SEGS];
uniform float uAsh[GB_SEGS];
uniform float uTemp[GB_SEGS];
uniform float uSegCount;
uniform vec3 uHeatDir;
uniform vec3 uUpLocal;
uniform float uTime;
uniform float uMoist;
uniform float uHighlight;
uniform float uRadius;
uniform float uSeed;
uniform float uFade;
uniform float uBurnFront;
uniform float uGlowBoost;
varying float vSeg;
varying float vSurf;
varying vec3 vLocalPos;
varying vec3 vLocalNormal;
#ifdef GB_TINDER
varying float vBurn;
#endif
float gbCharM;
float gbGlowM;
float gbAshM;
float gbSb;
float gbSe;
float gbSs;
vec3 gbEmber(float t) {
  vec3 c = mix(vec3(0.45, 0.02, 0.0), vec3(1.0, 0.22, 0.02), smoothstep(0.0, 0.6, t));
  return mix(c, vec3(1.0, 0.55, 0.15), smoothstep(0.65, 1.0, t));
}`,
      )
      .replace(
        '#include <map_fragment>',
        `
gbSb = 1.0 - step(0.5, vSurf);
gbSe = step(1.5, vSurf);
gbSs = 1.0 - gbSb - gbSe;
vec4 cWood = texture2D(map, vMapUv);
vec4 cBark = texture2D(uBarkMap, vMapUv);
vec4 cEnd = texture2D(uEndMap, vMapUv);
vec4 albedo = cBark * gbSb + cWood * gbSs + cEnd * gbSe;

float fs = clamp(vSeg * uSegCount - 0.5, 0.0, uSegCount - 1.0);
int i0 = int(floor(fs));
int i1 = min(i0 + 1, int(uSegCount) - 1);
float ft = fract(fs);
float charV = mix(uChar[i0], uChar[i1], ft);
float glowV = mix(uGlow[i0], uGlow[i1], ft);
float ashV = mix(uAsh[i0], uAsh[i1], ft);
float tempV = mix(uTemp[i0], uTemp[i1], ft);

vec3 lp = vLocalPos / max(uRadius, 0.004);
float n1 = gb_fbm3(lp * 1.3 + uSeed);
float n2 = gb_vnoise3(lp * 5.0 + uSeed * 3.0);
vec3 ln = normalize(vLocalNormal);
float facing = dot(ln, normalize(uHeatDir)) * 0.5 + 0.5;
float upF = dot(ln, normalize(uUpLocal)) * 0.5 + 0.5;

#ifdef GB_TINDER
  // 火口：着火点から燃え広がる
  float front = uBurnFront - vBurn + (n1 - 0.5) * 0.25;
  gbCharM = smoothstep(0.0, 0.12, front);
  float band = smoothstep(-0.02, 0.06, front) * (1.0 - smoothstep(0.08, 0.3, front));
  gbGlowM = band * glowV;
  gbAshM = smoothstep(0.35, 0.9, front) * ashV;
#else
  float edge = n1 * 0.55 + (1.0 - facing) * 0.42;
  gbCharM = smoothstep(edge, edge + 0.14, charV * 1.18);
  // 亀裂（亀甲状の割れ）：軸方向と周方向で縦横比を変える
  float ang = atan(vLocalPos.y, vLocalPos.z) * uRadius;
  vec2 cc = gbSe > 0.5 ? vLocalPos.yz * 48.0 : vec2(vLocalPos.x * 34.0, ang * 58.0);
  vec2 cl = gb_cell2(cc + uSeed * 7.0);
  float crack = 1.0 - smoothstep(0.012, 0.05, cl.y - cl.x);
  // 深く焦げた所だけ亀裂が開く
  float charDepth = smoothstep(0.55, 1.0, charV);
  float crackOpen = crack * charDepth * smoothstep(0.35, 0.75, gb_vnoise3(lp * 0.8 + uSeed * 2.0) + charDepth * 0.4);
  // 下側・熱源側ほど赤く（上面は灰と黒い炭）
  float underside = 1.0 - upF * 0.75;
  gbGlowM = glowV * gbCharM * (crackOpen * 0.85 * (0.4 + 0.6 * underside) + 0.12 * smoothstep(0.55, 0.95, n1) * underside + 0.04);
  float ashEdge = gb_vnoise3(lp * 2.2 + uSeed * 5.0) * 0.75 + 0.3 - upF * 0.15;
  gbAshM = smoothstep(ashEdge, ashEdge + 0.18, ashV) * gbCharM;
  albedo.rgb = mix(albedo.rgb, albedo.rgb * 0.3, crack * gbCharM * charDepth * 0.5);
#endif

// 温まる：乾いた木がわずかにトースト色になる
albedo.rgb = mix(albedo.rgb, albedo.rgb * vec3(0.72, 0.55, 0.4), smoothstep(0.3, 1.0, tempV) * 0.45 * (1.0 - gbCharM));
// 湿り：暗く
albedo.rgb *= 1.0 - 0.35 * uMoist;
// 焦げ
vec3 charCol = vec3(0.026, 0.023, 0.021) * (0.75 + 0.6 * n2);
albedo.rgb = mix(albedo.rgb, charCol, gbCharM);
// 灰
vec3 ashCol = vec3(0.34, 0.33, 0.32) * (0.75 + 0.4 * n2);
albedo.rgb = mix(albedo.rgb, ashCol, gbAshM);
diffuseColor *= albedo;
diffuseColor.a *= uFade;
`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = mix(mix(0.9, 0.74, gbSs), 0.97, gbCharM);
roughnessFactor = mix(roughnessFactor, 1.0, gbAshM);
roughnessFactor = mix(roughnessFactor, 0.45, uMoist * 0.6);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `vec3 mapN = (texture2D(uBarkNormal, vNormalMapUv).xyz * gbSb + texture2D(normalMap, vNormalMapUv).xyz * gbSs + texture2D(uEndNormal, vNormalMapUv).xyz * gbSe) * 2.0 - 1.0;
mapN.xy *= normalScale * (1.0 - gbAshM * 0.6);
normal = normalize(tbn * mapN);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `float pulse = 0.78 + 0.22 * sin(uTime * 1.3 + n1 * 9.0) * sin(uTime * 0.71 + n2 * 4.0);
float gAmt = gbGlowM * (1.0 - gbAshM * 0.75) * pulse * uGlowBoost;
totalEmissiveRadiance += gbEmber(clamp(gAmt, 0.0, 1.0)) * gAmt * 2.4;
float rim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.0);
totalEmissiveRadiance += vec3(0.93, 0.71, 0.51) * uHighlight * (0.12 + rim * 0.9);`,
      );
  };
  mat.customProgramCacheKey = () => (tinder ? 'gb-log-tinder' : 'gb-log');
  return { material: mat, uniforms };
}
