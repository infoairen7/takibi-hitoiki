/**
 * 炎：燃えている区間の上面に「炎の舌」を結びつけて描く。
 * - 各舌は縦長の板（円柱ビルボード）で、上昇するノイズで輪郭と明るい芯を作る
 * - 外側の薄い層と内側の明るい層は位相と速さをずらす
 * - 風：根元は早く、先端は遅れて傾く（uWindRoot / uWindTip）
 * - 近くで一緒に燃える区間はまとまって大きな炎の胴になる
 * 画像の差し替えではなく、区間の位置・強さから毎フレーム配置する。
 */
import * as THREE from 'three';
import { GLSL_NOISE } from './glsl';

export const FLAME_KIND = { tinder: 0, kindling: 1, medium: 2, lighter: 3, body: 4, ember: 5 } as const;

export interface FlameInstance {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  seed: number;
  intensity: number;
  kind: number;
  /** 外側の薄い層=0 / 内側の芯=1 */
  layer: number;
}

const VERT = /* glsl */ `
attribute vec3 aRoot;
attribute vec4 aParams; // width, height, seed, intensity
attribute vec2 aKind;   // kind, layer
uniform float uTime;
uniform vec2 uWindRoot;
uniform vec2 uWindTip;
varying vec2 vUv;
varying float vSeed;
varying float vIntensity;
varying float vKind;
varying float vLayer;
void main() {
  float w = aParams.x;
  float h = aParams.y;
  float seed = aParams.z;
  float I = aParams.w;
  float y = position.y;
  // カメラの右方向（水平）
  vec3 camRight = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
  // 揺らぎ：先端ほど大きく遅い
  float t = uTime;
  float sway = sin(t * (2.1 + seed * 0.9) + seed * 6.28 + y * 2.6) * 0.07 + sin(t * (4.3 + seed) + seed * 3.1 + y * 5.0) * 0.035;
  sway *= y * y * h;
  // 風：根元は早い風、先端は遅れた風（先端が遅れて傾く）
  float windLen = length(uWindTip);
  vec2 bend = uWindRoot * y * h * 0.55 + (uWindTip - uWindRoot) * y * y * h * 0.9 + uWindTip * y * y * h * 0.35;
  // 強い風では炎が低く寝る
  float hh = h * (1.0 - 0.28 * clamp(windLen, 0.0, 1.0));
  vec3 p = aRoot;
  p += camRight * (position.x * w + sway);
  p.y += y * hh;
  p.x += bend.x;
  p.z += bend.y;
  vUv = vec2(position.x + 0.5, y);
  vSeed = seed;
  vIntensity = I;
  vKind = aKind.x;
  vLayer = aKind.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
${GLSL_NOISE}
uniform float uTime;
uniform float uBright;
varying vec2 vUv;
varying float vSeed;
varying float vIntensity;
varying float vKind;
varying float vLayer;

vec3 flameRamp(float t) {
  vec3 c = vec3(0.0);
  c = mix(c, vec3(0.5, 0.05, 0.0), smoothstep(0.0, 0.16, t));
  c = mix(c, vec3(1.0, 0.25, 0.02), smoothstep(0.12, 0.38, t));
  c = mix(c, vec3(1.0, 0.52, 0.1), smoothstep(0.36, 0.64, t));
  c = mix(c, vec3(1.0, 0.8, 0.4), smoothstep(0.62, 0.95, t));
  return c;
}

void main() {
  vec2 uv = vUv;
  float x = uv.x - 0.5;
  float y = uv.y;
  float layer = vLayer;
  float spd = mix(1.2, 1.9, layer) * (vKind < 0.5 ? 1.35 : 1.0);
  float t = uTime * spd + vSeed * 17.0;
  // 上へ流れる乱れ（高いほど大きく横へ揺れる）
  float n1 = gb_fbm2(vec2(x * 2.4 + vSeed * 5.0, y * 2.0 - t * 1.15));
  float n2 = gb_fbm2(vec2(x * 6.0 - vSeed * 3.0, y * 4.6 - t * 2.3));
  float n3 = gb_vnoise2(vec2(vSeed * 11.0, uTime * 0.9 * spd));
  float xw = x + (n1 - 0.5) * 0.75 * pow(y, 1.1) + (n2 - 0.5) * 0.24 * (0.2 + y);
  // 根元は細く、少し上で膨らみ、先へ細る
  float width = 0.32 * mix(0.42, 1.0, smoothstep(0.0, 0.22, y)) * pow(max(1.0 - y, 0.0), 0.62) * (0.8 + 0.4 * n1);
  width *= mix(1.0, 0.58, layer);
  float body = 1.0 - smoothstep(width * 0.3, width, abs(xw));
  body *= 1.0 - smoothstep(0.36, 0.49, abs(x));
  // 先端：時間で高さが変わり、舌のようにちぎれる
  float tipH = mix(0.5, 0.95, n3) * mix(1.0, 0.8, layer);
  float tipCut = y + (n2 - 0.5) * 0.4 + (n1 - 0.5) * 0.28;
  float tip = 1.0 - smoothstep(tipH - 0.35, tipH, tipCut);
  float base = smoothstep(0.0, 0.05, y);
  float d = body * tip * base;
  // 芯は柱にせず、根元近くでまだらに明るい
  float core = (1.0 - smoothstep(0.0, width * 0.5, abs(xw))) * smoothstep(0.02, 0.12, y) * (1.0 - smoothstep(0.12, 0.5, y));
  core *= smoothstep(0.25, 0.7, n2 + 0.15);
  float temp = d * (0.42 + 0.45 * core) * (1.0 - 0.55 * y);
  temp *= mix(0.62, 1.0, layer) * clamp(vIntensity * 1.1, 0.0, 1.0);
  temp = clamp(temp, 0.0, 1.0);
  vec3 col = flameRamp(temp);
  // 小さな炎の根元に青み
  float blue = (1.0 - smoothstep(0.0, 0.14, y)) * body * (vKind < 1.5 || vKind > 2.5 ? 0.55 : 0.15) * (1.0 - smoothstep(0.3, 0.9, vIntensity));
  col += vec3(0.1, 0.22, 0.85) * blue * 0.5;
  float a = smoothstep(0.02, 0.35, temp) * d * mix(0.6, 0.85, layer) * (vKind > 3.5 && vKind < 4.5 ? 0.7 : 1.0);
  col *= (0.42 + 0.6 * smoothstep(0.6, 0.95, temp)) * uBright;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col * a, a);
}
`;

export class FlameField {
  mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private root: THREE.InstancedBufferAttribute;
  private params: THREE.InstancedBufferAttribute;
  private kinds: THREE.InstancedBufferAttribute;
  uniforms: { uTime: { value: number }; uWindRoot: { value: THREE.Vector2 }; uWindTip: { value: THREE.Vector2 }; uBright: { value: number } };
  readonly max: number;

  constructor(max = 220) {
    this.max = max;
    const base = new THREE.PlaneGeometry(1, 1, 1, 12);
    base.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    this.root = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.params = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.kinds = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
    this.root.setUsage(THREE.DynamicDrawUsage);
    this.params.setUsage(THREE.DynamicDrawUsage);
    this.kinds.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aRoot', this.root);
    geo.setAttribute('aParams', this.params);
    geo.setAttribute('aKind', this.kinds);
    geo.instanceCount = 0;
    this.geo = geo;
    this.uniforms = {
      uTime: { value: 0 },
      uWindRoot: { value: new THREE.Vector2() },
      uWindTip: { value: new THREE.Vector2() },
      uBright: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendEquation: THREE.AddEquation,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  setInstances(list: FlameInstance[]): void {
    const n = Math.min(list.length, this.max);
    const r = this.root.array as Float32Array;
    const p = this.params.array as Float32Array;
    const k = this.kinds.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const f = list[i];
      r[i * 3] = f.x;
      r[i * 3 + 1] = f.y;
      r[i * 3 + 2] = f.z;
      p[i * 4] = f.width;
      p[i * 4 + 1] = f.height;
      p[i * 4 + 2] = f.seed;
      p[i * 4 + 3] = f.intensity;
      k[i * 2] = f.kind;
      k[i * 2 + 1] = f.layer;
    }
    this.geo.instanceCount = n;
    this.root.needsUpdate = true;
    this.params.needsUpdate = true;
    this.kinds.needsUpdate = true;
  }
}
