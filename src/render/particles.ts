/**
 * 煙と火の粉。
 * 煙：湿り・空気不足・くすぶりの発生源（区間）から出し、上昇しながら広がって風に流れる。
 * 火の粉：常時シャワーにせず、爆ぜ・薪の投入・崩れ・強い風のときに少量。上昇して暗くなる。
 */
import * as THREE from 'three';
import { Rng } from '../game/rng';

interface SmokeP {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  size: number;
  grow: number;
  rot: number;
  spin: number;
  shade: number;
  alpha: number;
}

const SMOKE_VERT = /* glsl */ `
attribute vec4 aPos;   // xyz, size
attribute vec4 aLook;  // alpha, rot, shade, warm
varying vec2 vUv;
varying vec4 vLook;
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float c = cos(aLook.y);
  float s = sin(aLook.y);
  vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * aPos.w;
  vec3 p = aPos.xyz + right * q.x + up * q.y;
  vUv = position.xy + 0.5;
  vLook = aLook;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const SMOKE_FRAG = /* glsl */ `
uniform sampler2D uPuff;
uniform vec3 uCool;
uniform vec3 uWarm;
varying vec2 vUv;
varying vec4 vLook;
void main() {
  float a = texture2D(uPuff, vUv).a * vLook.x;
  if (a < 0.004) discard;
  vec3 col = mix(uCool * vLook.z, uWarm, vLook.w);
  gl_FragColor = vec4(col, a);
}
`;

export class SmokeSystem {
  mesh: THREE.Mesh;
  private ps: SmokeP[] = [];
  private geo: THREE.InstancedBufferGeometry;
  private aPos: THREE.InstancedBufferAttribute;
  private aLook: THREE.InstancedBufferAttribute;
  max: number;
  private rng = new Rng(4711);
  uniforms: { uPuff: { value: THREE.Texture }; uCool: { value: THREE.Color }; uWarm: { value: THREE.Color } };

  constructor(puff: THREE.Texture, max: number) {
    this.max = max;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(200 * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aLook = new THREE.InstancedBufferAttribute(new Float32Array(200 * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aLook', this.aLook);
    geo.instanceCount = 0;
    this.geo = geo;
    this.uniforms = { uPuff: { value: puff }, uCool: { value: new THREE.Color(0.36, 0.39, 0.44) }, uWarm: { value: new THREE.Color(0.85, 0.48, 0.26) } };
    const mat = new THREE.ShaderMaterial({
      vertexShader: SMOKE_VERT,
      fragmentShader: SMOKE_FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
  }

  emit(x: number, y: number, z: number, strength: number, shade: number): void {
    if (this.ps.length >= this.max) return;
    const r = this.rng;
    this.ps.push({
      x: x + r.range(-0.012, 0.012),
      y,
      z: z + r.range(-0.012, 0.012),
      vx: r.range(-0.01, 0.01),
      vy: r.range(0.1, 0.18),
      vz: r.range(-0.01, 0.01),
      age: 0,
      life: r.range(3.2, 5.8),
      size: r.range(0.03, 0.05),
      grow: r.range(0.035, 0.065),
      rot: r.range(0, Math.PI * 2),
      spin: r.range(-0.4, 0.4),
      shade,
      alpha: Math.min(0.32, 0.07 + strength * 0.12),
    });
  }

  update(dt: number, wind: [number, number], fire: THREE.Vector3, heat: number): void {
    const arrP = this.aPos.array as Float32Array;
    const arrL = this.aLook.array as Float32Array;
    let n = 0;
    const alive: SmokeP[] = [];
    for (const p of this.ps) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const t = p.age / p.life;
      // 浮力は時間とともに弱まり、風に流される
      p.vy += (0.05 * (1 - t) - p.vy * 0.25) * dt;
      p.vx += (wind[0] * 0.28 - p.vx) * 0.9 * dt + Math.sin(p.age * 1.7 + p.rot) * 0.012 * dt;
      p.vz += (wind[1] * 0.28 - p.vz) * 0.9 * dt + Math.cos(p.age * 1.3 + p.rot) * 0.012 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.size += p.grow * dt;
      p.rot += p.spin * dt;
      const fadeIn = Math.min(1, p.age / 0.5);
      const fadeOut = 1 - t * t;
      const a = p.alpha * fadeIn * fadeOut;
      // 火の近くは下から照らされて暖色
      const dx = p.x - fire.x;
      const dy = p.y - fire.y;
      const dz = p.z - fire.z;
      const warm = Math.min(0.85, (heat / 100) * Math.exp(-(dx * dx + dy * dy * 0.5 + dz * dz) / 0.03));
      arrP[n * 4] = p.x;
      arrP[n * 4 + 1] = p.y;
      arrP[n * 4 + 2] = p.z;
      arrP[n * 4 + 3] = p.size;
      arrL[n * 4] = a;
      arrL[n * 4 + 1] = p.rot;
      arrL[n * 4 + 2] = p.shade;
      arrL[n * 4 + 3] = warm;
      n++;
      alive.push(p);
    }
    this.ps = alive;
    this.geo.instanceCount = n;
    this.aPos.needsUpdate = true;
    this.aLook.needsUpdate = true;
  }

  get count(): number {
    return this.ps.length;
  }

  clear(): void {
    this.ps = [];
    this.geo.instanceCount = 0;
  }
}

interface Spark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  heat: number;
  seed: number;
}

const SPARK_VERT = /* glsl */ `
attribute vec4 aSpark; // heat, size, age01, seed
varying float vHeat;
varying float vAge;
uniform float uPixel;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSpark.y * uPixel / -mv.z;
  vHeat = aSpark.x;
  vAge = aSpark.z;
}
`;

const SPARK_FRAG = /* glsl */ `
varying float vHeat;
varying float vAge;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = smoothstep(1.0, 0.0, r);
  vec3 hot = vec3(1.0, 0.85, 0.5);
  vec3 cool = vec3(0.9, 0.2, 0.02);
  vec3 col = mix(cool, hot, vHeat) * (1.2 + 2.2 * vHeat);
  a *= (1.0 - vAge * vAge);
  if (a < 0.01) discard;
  gl_FragColor = vec4(col * a, a);
}
`;

export class SparkSystem {
  points: THREE.Points;
  private sparks: Spark[] = [];
  private geo: THREE.BufferGeometry;
  private pos: THREE.BufferAttribute;
  private attr: THREE.BufferAttribute;
  max: number;
  private rng = new Rng(9001);
  uniforms: { uPixel: { value: number } };

  constructor(max: number) {
    this.max = max;
    this.geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(120 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.attr = new THREE.BufferAttribute(new Float32Array(120 * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.pos);
    this.geo.setAttribute('aSpark', this.attr);
    this.geo.setDrawRange(0, 0);
    this.uniforms = { uPixel: { value: 600 } };
    const mat = new THREE.ShaderMaterial({
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 13;
  }

  burst(x: number, y: number, z: number, count: number, power = 1): void {
    const r = this.rng;
    for (let i = 0; i < count && this.sparks.length < this.max; i++) {
      const a = r.range(0, Math.PI * 2);
      const s = r.range(0.05, 0.35) * power;
      this.sparks.push({
        x: x + r.range(-0.02, 0.02),
        y: y + r.range(0, 0.02),
        z: z + r.range(-0.02, 0.02),
        vx: Math.cos(a) * s * 0.5,
        vy: r.range(0.35, 1.1) * (0.6 + power * 0.5),
        vz: Math.sin(a) * s * 0.5,
        age: 0,
        life: r.range(0.9, 2.4),
        heat: r.range(0.7, 1),
        seed: r.next(),
      });
    }
  }

  update(dt: number, wind: [number, number]): void {
    const P = this.pos.array as Float32Array;
    const A = this.attr.array as Float32Array;
    let n = 0;
    const alive: Spark[] = [];
    for (const s of this.sparks) {
      s.age += dt;
      if (s.age >= s.life) continue;
      const t = s.age / s.life;
      // 上昇気流・揺らぎ・風・空気抵抗
      s.vy += (0.55 * (1 - t) - 0.35) * dt;
      s.vx += (wind[0] * 0.8 - s.vx) * 0.8 * dt + Math.sin(s.age * 9 + s.seed * 30) * 0.5 * dt;
      s.vz += (wind[1] * 0.8 - s.vz) * 0.8 * dt + Math.cos(s.age * 7 + s.seed * 20) * 0.5 * dt;
      s.vx *= 1 - 0.6 * dt;
      s.vy *= 1 - 0.5 * dt;
      s.vz *= 1 - 0.6 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      s.heat = Math.max(0, s.heat - dt * 0.55);
      P[n * 3] = s.x;
      P[n * 3 + 1] = s.y;
      P[n * 3 + 2] = s.z;
      A[n * 4] = s.heat;
      A[n * 4 + 1] = 0.0035 + 0.003 * s.heat;
      A[n * 4 + 2] = t;
      A[n * 4 + 3] = s.seed;
      n++;
      alive.push(s);
    }
    this.sparks = alive;
    this.geo.setDrawRange(0, n);
    this.pos.needsUpdate = true;
    this.attr.needsUpdate = true;
  }

  get count(): number {
    return this.sparks.length;
  }

  clear(): void {
    this.sparks = [];
    this.geo.setDrawRange(0, 0);
  }
}

