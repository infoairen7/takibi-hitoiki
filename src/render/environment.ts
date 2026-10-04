/**
 * 環境：無銘の低い焚き火台・砂利の地面・遠景（仮）・光。
 * 遠景は承認済み画像F01の上部を切り出した仮素材（backdrop_forest_dusk_provisional.jpg）。
 * 本番の背景素材が届いたら loadBackdrop の差し替え口で交換する。
 */
import * as THREE from 'three';
import { BALANCE } from '../game/balance';
import { Rng } from '../game/rng';
import { GroundKind, gravelTexture, groundTexture, metalTexture } from './textures';
import type { TrayId } from '../data/discoveries';
import { Noise2 } from './noise';

const T = BALANCE.tray;

let metalCache: ReturnType<typeof metalTexture> | null = null;

/**
 * 焚き火台。どれも内側の寸法・床の高さは同じ（性能差なし。見た目だけ）。
 * first：無銘の低い金属の台／iron：黒鉄／copper：銅／ceramic：陶器／stone：石
 */
export function buildTray(kind: TrayId = 'first'): THREE.Group {
  if (kind === 'stone') return buildStoneTray();
  const g = new THREE.Group();
  g.name = 'tray';
  const metal = (metalCache ??= metalTexture(21));
  const look: Record<Exclude<TrayId, 'stone'>, THREE.MeshStandardMaterialParameters> = {
    first: { map: metal.map, roughnessMap: metal.rough, roughness: 1, metalness: 0.55, color: 0xe8e4dc },
    iron: { map: metal.map, roughnessMap: metal.rough, roughness: 1.1, metalness: 0.6, color: 0x55504a },
    copper: { map: metal.map, roughnessMap: metal.rough, roughness: 0.85, metalness: 0.85, color: 0xe0946a },
    ceramic: { roughness: 0.32, metalness: 0, color: 0x4f5e68 },
  };
  const mat = new THREE.MeshStandardMaterial(look[kind]);
  const inner = T.innerHalf;
  const th = kind === 'ceramic' ? 0.014 : T.wallThickness;
  const outer = inner + th;
  const floorTop = T.floorY;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(outer * 2, 0.003, outer * 2), mat);
  plate.position.y = floorTop - 0.0015;
  plate.receiveShadow = true;
  plate.castShadow = true;
  g.add(plate);
  const wallH = T.wallHeight;
  const wallGeoX = new THREE.BoxGeometry(outer * 2, wallH, th);
  const wallGeoZ = new THREE.BoxGeometry(th, wallH, outer * 2);
  const walls: Array<[THREE.BufferGeometry, number, number]> = [
    [wallGeoX, 0, -inner - th / 2],
    [wallGeoX, 0, inner + th / 2],
    [wallGeoZ, -inner - th / 2, 0],
    [wallGeoZ, inner + th / 2, 0],
  ];
  for (const [geo, x, z] of walls) {
    const w = new THREE.Mesh(geo, mat);
    w.position.set(x, floorTop + wallH / 2, z);
    w.castShadow = true;
    w.receiveShadow = true;
    g.add(w);
  }
  // 巻き込んだ縁（陶器は厚い丸い縁）
  const rimR = kind === 'ceramic' ? 0.009 : 0.0045;
  const rimMat = mat;
  for (const [len, x, z, rotY] of [
    [outer * 2, 0, -inner - th / 2, 0],
    [outer * 2, 0, inner + th / 2, 0],
    [outer * 2, -inner - th / 2, 0, Math.PI / 2],
    [outer * 2, inner + th / 2, 0, Math.PI / 2],
  ] as Array<[number, number, number, number]>) {
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, len + rimR * 2, 10), rimMat);
    rim.rotation.z = Math.PI / 2;
    rim.rotation.y = rotY;
    rim.position.set(x, floorTop + wallH, z);
    rim.castShadow = true;
    g.add(rim);
  }
  // 脚（陶器は短く太い足と、台座）
  const legGeo = kind === 'ceramic' ? new THREE.CylinderGeometry(0.03, 0.036, T.legHeight, 18) : new THREE.CylinderGeometry(0.011, 0.012, T.legHeight, 14);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, mat);
      leg.position.set(sx * (outer - (kind === 'ceramic' ? 0.05 : 0.028)), T.legHeight / 2, sz * (outer - (kind === 'ceramic' ? 0.05 : 0.028)));
      leg.castShadow = true;
      g.add(leg);
    }
  }
  if (kind === 'ceramic') {
    const base = new THREE.Mesh(new THREE.BoxGeometry(outer * 2 - 0.02, 0.02, outer * 2 - 0.02), mat);
    base.position.y = floorTop - 0.013;
    base.castShadow = true;
    g.add(base);
  }
  if (kind === 'copper') {
    // 銅の取っ手
    const handleMat = new THREE.MeshStandardMaterial({ color: 0xc07a50, metalness: 0.9, roughness: 0.4 });
    for (const sx of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 8, 18, Math.PI), handleMat);
      h.position.set(sx * (outer + 0.004), floorTop + T.wallHeight * 0.6, 0);
      h.rotation.set(0, (sx * Math.PI) / 2, -Math.PI / 2);
      h.rotation.y = sx > 0 ? Math.PI / 2 : -Math.PI / 2;
      g.add(h);
    }
  }
  return g;
}

/** 石の炉：平たい石を四角く組み、中は石の床。台の床の高さは同じ */
function buildStoneTray(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'tray';
  const rng = new Rng(314);
  const n = new Noise2(15);
  const inner = T.innerHalf;
  const floorTop = T.floorY;
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, vertexColors: false });
  const base = new THREE.Mesh(new THREE.BoxGeometry(inner * 2 + 0.02, floorTop, inner * 2 + 0.02), new THREE.MeshStandardMaterial({ color: 0x4a4744, roughness: 0.95 }));
  base.position.y = floorTop / 2 - 0.001;
  base.receiveShadow = true;
  g.add(base);
  const addStone = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY: number) => {
    const geo = new THREE.BoxGeometry(1, 1, 1, 3, 2, 3);
    const p = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
      const k = 0.86 + 0.14 * n.value(v.x * 3 + x * 40, v.y * 3 + v.z * 3 + z * 40);
      v.multiplyScalar(k);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, stoneMat.clone());
    const shade = rng.range(0.22, 0.38);
    (m.material as THREE.MeshStandardMaterial).color.setRGB(shade, shade * 0.97, shade * 0.93);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  };
  const wallH = T.wallHeight + 0.01;
  for (const side of [-1, 1]) {
    for (const axis of ['x', 'z'] as const) {
      let t = -inner - 0.03;
      while (t < inner + 0.03) {
        const len = rng.range(0.08, 0.13);
        const c = t + len / 2;
        const off = side * (inner + 0.028);
        const h = wallH * rng.range(0.85, 1.12);
        if (axis === 'x') addStone(c, floorTop + h / 2 - 0.01, off, len, h, 0.05, rng.range(-0.08, 0.08));
        else addStone(off, floorTop + h / 2 - 0.01, c, 0.05, h, len, rng.range(-0.08, 0.08));
        t += len + 0.004;
      }
    }
  }
  return g;
}

/**
 * 台の底：熾（赤く光る）・灰・すす。シミュレーションの格子から描く。
 */
export class TrayBed {
  mesh: THREE.Mesh;
  private albedo: THREE.DataTexture;
  private emissive: THREE.DataTexture;
  private S = 128;
  private detail: Float32Array;
  private soot: Float32Array;

  constructor() {
    const S = this.S;
    this.albedo = new THREE.DataTexture(new Uint8Array(S * S * 4), S, S, THREE.RGBAFormat);
    this.albedo.colorSpace = THREE.SRGBColorSpace;
    this.emissive = new THREE.DataTexture(new Uint8Array(S * S * 4), S, S, THREE.RGBAFormat);
    this.emissive.colorSpace = THREE.SRGBColorSpace;
    for (const t of [this.albedo, this.emissive]) {
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearFilter;
      t.needsUpdate = true;
    }
    const n = new Noise2(77);
    this.detail = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) this.detail[y * S + x] = n.fbm(x / 6, y / 6, 3, 256, 256) * 0.7 + n.value(x * 0.9, y * 0.9) * 0.3;
    this.soot = new Float32Array(S * S);
    const mat = new THREE.MeshStandardMaterial({
      map: this.albedo,
      emissiveMap: this.emissive,
      emissive: new THREE.Color(1, 1, 1),
      emissiveIntensity: 2.2,
      transparent: true,
      roughness: 1,
      metalness: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(T.innerHalf * 2, T.innerHalf * 2), mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = T.floorY + 0.0006;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
  }

  /** coal/ash：sim.bedCoal / bedAsh（cells×cells）。flames：燃えている区間のxz（すすを付ける） */
  update(coal: number[], ash: number[], cells: number, flames: Array<[number, number, number]>, time: number): void {
    const S = this.S;
    const A = this.albedo.image.data as Uint8Array;
    const E = this.emissive.image.data as Uint8Array;
    const half = T.innerHalf;
    // すす：炎の真下が少しずつ黒くなる（戻らない）
    for (const [x, z, p] of flames) {
      const cx = ((x + half) / (half * 2)) * S;
      const cz = ((z + half) / (half * 2)) * S;
      const rad = 10;
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const px = Math.round(cx + dx);
          const pz = Math.round(cz + dy);
          if (px < 0 || pz < 0 || px >= S || pz >= S) continue;
          const d2 = (dx * dx + dy * dy) / (rad * rad);
          if (d2 > 1) continue;
          const i = pz * S + px;
          this.soot[i] = Math.min(1, this.soot[i] + p * 0.004 * (1 - d2));
        }
      }
    }
    const sample = (grid: number[], u: number, v: number): number => {
      const gx = u * cells - 0.5;
      const gz = v * cells - 0.5;
      const x0 = Math.max(0, Math.min(cells - 1, Math.floor(gx)));
      const z0 = Math.max(0, Math.min(cells - 1, Math.floor(gz)));
      const x1 = Math.min(cells - 1, x0 + 1);
      const z1 = Math.min(cells - 1, z0 + 1);
      const fx = Math.max(0, Math.min(1, gx - x0));
      const fz = Math.max(0, Math.min(1, gz - z0));
      const a = grid[z0 * cells + x0];
      const b = grid[z0 * cells + x1];
      const c = grid[z1 * cells + x0];
      const d = grid[z1 * cells + x1];
      return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
    };
    const flick = 0.85 + 0.15 * Math.sin(time * 1.1);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const u = (x + 0.5) / S;
        const v = (y + 0.5) / S;
        const d = this.detail[i];
        const c = sample(coal, u, v);
        const a = sample(ash, u, v);
        const s = this.soot[i];
        // 灰（白っぽい）とすす（黒）
        const ashAmt = Math.min(1, a * 1.1) * (0.5 + d * 0.8);
        const coalAmt = Math.min(1, c * 1.4) * (0.35 + d * 0.9);
        let r = 0.05;
        let g = 0.045;
        let b = 0.04;
        const ar = 0.6 + d * 0.15;
        r = r + (ar - r) * ashAmt;
        g = g + (ar * 0.97 - g) * ashAmt;
        b = b + (ar * 0.92 - b) * ashAmt;
        // 熾は黒い炭の粒
        r *= 1 - coalAmt * 0.7;
        g *= 1 - coalAmt * 0.7;
        b *= 1 - coalAmt * 0.7;
        const alpha = Math.min(1, s * 0.85 + ashAmt * 0.95 + coalAmt);
        A[i * 4] = r * 255;
        A[i * 4 + 1] = g * 255;
        A[i * 4 + 2] = b * 255;
        A[i * 4 + 3] = alpha * 255;
        // 熾の赤い光（粒ごとにゆらぐ）
        const glow = Math.max(0, Math.min(1, c * 1.1 * (0.3 + Math.pow(d, 1.5) * 1.3))) * flick * (1 - ashAmt * 0.5);
        E[i * 4] = Math.min(255, glow * 255);
        E[i * 4 + 1] = Math.min(255, glow * glow * 90);
        E[i * 4 + 2] = Math.min(255, glow * glow * glow * 10);
        E[i * 4 + 3] = 255;
      }
    }
    this.albedo.needsUpdate = true;
    this.emissive.needsUpdate = true;
  }

  reset(): void {
    this.soot.fill(0);
  }

  exportSoot(): number[] {
    return Array.from(this.soot, (v) => Math.round(v * 255));
  }

  importSoot(arr: number[] | undefined): void {
    if (!arr || arr.length !== this.soot.length) return;
    for (let i = 0; i < arr.length; i++) this.soot[i] = arr[i] / 255;
  }
}

let gravelCache: ReturnType<typeof gravelTexture> | null = null;
const groundCache = new Map<string, ReturnType<typeof groundTexture>>();

export function groundTextures(kind: Exclude<GroundKind, 'gravel'>): ReturnType<typeof groundTexture> {
  let t = groundCache.get(kind);
  if (!t) {
    t = groundTexture(kind);
    groundCache.set(kind, t);
  }
  return t;
}

export interface GroundOptions {
  kind: GroundKind;
  tint: number;
  rough: number;
  pebbles: boolean;
  /** 屋上：床の範囲（この先は街） */
  terrace?: boolean;
  /** 東屋：外の地面は板張りの床より少し低い */
  lowered?: boolean;
}

export function buildGround(quality: 'low' | 'standard' | 'high', opt: GroundOptions = { kind: 'gravel', tint: 0xffffff, rough: 1, pebbles: true }): THREE.Group {
  const g = new THREE.Group();
  let mat: THREE.MeshStandardMaterial;
  if (opt.kind === 'gravel') {
    const tex = (gravelCache ??= gravelTexture(3));
    const rep = 40 / 0.31;
    for (const t of [tex.map, tex.normal, tex.rough]) t.repeat.set(rep, rep);
    mat = new THREE.MeshStandardMaterial({
      map: tex.map,
      normalMap: tex.normal,
      normalScale: new THREE.Vector2(1.2, 1.2),
      roughnessMap: tex.rough,
      roughness: opt.rough,
      metalness: 0,
      color: opt.tint,
    });
  } else {
    const tex = groundTextures(opt.kind);
    const size = opt.terrace ? 10 : 40;
    const rep = size / tex.tile;
    for (const t of [tex.map, tex.normal, tex.rough]) t.repeat.set(rep, rep);
    mat = new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normal, roughnessMap: tex.rough, roughness: opt.rough, metalness: 0, color: opt.tint });
  }
  const ground = new THREE.Mesh(opt.terrace ? new THREE.PlaneGeometry(10, 6) : new THREE.PlaneGeometry(40, 40), mat);
  ground.rotation.x = -Math.PI / 2;
  if (opt.terrace) ground.position.z = 1.05;
  if (opt.lowered) ground.position.y = -0.03;
  ground.receiveShadow = true;
  g.add(ground);
  if (!opt.pebbles) return g;

  // 手前の小石（立体）。低品質では減らす
  const count = quality === 'low' ? 60 : 200;
  const rng = new Rng(99);
  const base = new THREE.IcosahedronGeometry(1, 1);
  const p = base.getAttribute('position') as THREE.BufferAttribute;
  const n = new Noise2(5);
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
    const k = 0.85 + n.value(v.x * 2 + 5, v.y * 2 + v.z * 2) * 0.3;
    v.multiplyScalar(k);
    p.setXYZ(i, v.x, v.y * 0.62, v.z);
  }
  base.computeVertexNormals();
  const pebMat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0 });
  const peb = new THREE.InstancedMesh(base, pebMat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  const palette = [0x5e5b57, 0x6f6a62, 0x4a4845, 0x7c766c, 0x6a5a4c, 0x3e3c3a, 0x8a857c];
  for (let i = 0; i < count; i++) {
    let x = 0;
    let z = 0;
    for (let tries = 0; tries < 10; tries++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(0.36, 1.2);
      x = Math.cos(a) * r;
      z = Math.sin(a) * r * 0.9 + 0.1;
      if (Math.abs(x) > 0.34 || Math.abs(z) > 0.34) break;
    }
    const s = rng.range(0.004, 0.011);
    q.setFromEuler(new THREE.Euler(rng.range(-0.3, 0.3), rng.range(0, Math.PI * 2), rng.range(-0.3, 0.3)));
    m.compose(new THREE.Vector3(x, s * 0.25, z), q, new THREE.Vector3(s * rng.range(0.9, 1.4), s, s * rng.range(0.9, 1.3)));
    peb.setMatrixAt(i, m);
    col.setHex(palette[rng.int(0, palette.length - 1)]);
    col.multiplyScalar(rng.range(0.85, 1.1));
    peb.setColorAt(i, col);
  }
  peb.castShadow = quality !== 'low';
  peb.receiveShadow = true;
  g.add(peb);
  return g;
}

/** 遠景（仮素材）。下端は霧の色へなじませる */
export function buildBackdrop(texture: THREE.Texture, fogColor: THREE.Color): THREE.Mesh {
  const radius = 9;
  const arc = Math.PI * 1.1;
  const img = texture.image as { width: number; height: number };
  const aspect = img.width / img.height;
  const height = (radius * arc) / aspect;
  const geo = new THREE.CylinderGeometry(radius, radius, height, 48, 1, true, -arc / 2 + Math.PI, arc);
  geo.scale(-1, 1, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: texture }, uFog: { value: fogColor }, uDim: { value: 0.92 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform vec3 uFog; uniform float uDim;
      varying vec2 vUv;
      void main() {
        vec3 c = texture2D(uMap, vec2(1.0 - vUv.x, vUv.y)).rgb * uDim;
        float f = 1.0 - smoothstep(0.0, 0.07, vUv.y);
        c = mix(c, uFog, f);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  // 地面の少し下から始めて、写真の砂利帯を地面の奥へつなぐ
  mesh.position.set(0, height / 2 - 0.55, 0.9);
  mesh.renderOrder = -10;
  return mesh;
}

/** 夕暮れの空の環境光（金属・樹皮の反射用） */
export function buildEnvironmentMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: /* glsl */ `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
    fragmentShader: /* glsl */ `varying vec3 vP; void main(){
      float h = normalize(vP).y;
      vec3 sky = mix(vec3(0.16,0.2,0.3), vec3(0.06,0.08,0.13), smoothstep(0.0, 0.8, h));
      vec3 hor = vec3(0.25,0.26,0.3);
      vec3 grd = vec3(0.05,0.045,0.04);
      vec3 c = h > 0.0 ? mix(hor, sky, smoothstep(0.0, 0.25, h)) : mix(hor, grd, smoothstep(0.0, 0.12, -h));
      gl_FragColor = vec4(c, 1.0);
    }`,
  });
  scene.add(new THREE.Mesh(geo, mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.02);
  pmrem.dispose();
  return rt.texture;
}

/** 画像の下端の平均色（霧の色に使う） */
export function sampleBottomColor(img: HTMLImageElement | ImageBitmap): THREE.Color {
  try {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 16;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('no ctx');
    ctx.drawImage(img as CanvasImageSource, 0, (img as HTMLImageElement).height * 0.8, (img as HTMLImageElement).width, (img as HTMLImageElement).height * 0.14, 0, 0, 64, 16);
    const d = ctx.getImageData(0, 0, 64, 16).data;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
    }
    const n = d.length / 4;
    return new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
  } catch {
    return new THREE.Color(0x2a2e31);
  }
}
