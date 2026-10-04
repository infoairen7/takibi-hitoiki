/**
 * 手続き生成のテクスチャ（仮素材）。
 * 実写テクスチャやPBR素材が納品されたら、ここの関数を差し替える。
 * すべて同一オリジンで生成するので、写真の保存（canvas書き出し）を妨げない。
 */
import * as THREE from 'three';
import { Noise2 } from './noise';

type RGB = [number, number, number];

function makeTex(data: Uint8Array, w: number, h: number, srgb: boolean, repeat = true): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** 高さ場から法線マップ（タイル可能） */
function normalFromHeight(hf: Float32Array, w: number, h: number, strength: number): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = hf[y * w + ((x - 1 + w) % w)];
      const r = hf[y * w + ((x + 1) % w)];
      const u = hf[((y - 1 + h) % h) * w + x];
      const d = hf[((y + 1) % h) * w + x];
      let nx = (l - r) * strength;
      let ny = (u - d) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * w + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

function put(data: Uint8Array, i: number, c: RGB, a = 1): void {
  data[i * 4] = Math.max(0, Math.min(255, c[0] * 255));
  data[i * 4 + 1] = Math.max(0, Math.min(255, c[1] * 255));
  data[i * 4 + 2] = Math.max(0, Math.min(255, c[2] * 255));
  data[i * 4 + 3] = Math.max(0, Math.min(255, a * 255));
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function sat(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export interface TexSet {
  map: THREE.DataTexture;
  normal: THREE.DataTexture;
}

/** 割り面の木肌（xが繊維方向） */
export function woodSplitTexture(seed: number, base: RGB): TexSet {
  const W = 256;
  const H = 128;
  const n = new Noise2(seed);
  const data = new Uint8Array(W * H * 4);
  const hf = new Float32Array(W * H);
  const dark: RGB = [base[0] * 0.6, base[1] * 0.52, base[2] * 0.44];
  const light: RGB = [Math.min(1, base[0] * 1.1), Math.min(1, base[1] * 1.08), Math.min(1, base[2] * 1.04)];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / H;
      // 割れた面：繊維の筋と、ささくれ、細い割れ（年輪の線はごく控えめ）
      const warp = (n.fbm(u * 2, v * 3, 3, 2, 3) - 0.5) * 0.08;
      const fiber = n.fbm(u * 2, (v + warp) * 90, 4, 2, 90);
      const coarse = n.fbm(u * 2 + 3, (v + warp) * 14, 3, 2, 14);
      const splinter = Math.pow(n.value(u * 10, (v + warp) * 180, 10, 180), 5);
      const check = 1 - sat(Math.abs(n.fbm(u * 2 + 7, (v + warp) * 22, 3, 2, 22) - 0.5) / 0.012);
      const ring = Math.pow(Math.abs(Math.sin((v * 6 + warp * 8) * Math.PI)), 20) * 0.15;
      const blotch = n.fbm(u * 3 + 11, v * 3, 3, 3, 3);
      let c = mix(base, light, sat((fiber - 0.45) * 2));
      c = mix(c, dark, sat(0.5 - coarse) * 0.55 + ring + sat(0.42 - blotch) * 0.35);
      c = mix(c, dark, splinter * 0.45);
      c = mix(c, [0.12, 0.09, 0.07], check * 0.75);
      put(data, y * W + x, c);
      hf[y * W + x] = fiber * 0.5 + coarse * 0.5 - splinter * 0.35 - check * 0.8;
    }
  }
  return { map: makeTex(data, W, H, true), normal: makeTex(normalFromHeight(hf, W, H, 1.9), W, H, false) };
}

export type BarkStyle = 'ridged' | 'white' | 'smooth' | 'plate';

/** 樹皮（xが幹の方向） */
export function barkTexture(seed: number, style: BarkStyle): TexSet {
  const W = 256;
  const H = 256;
  const n = new Noise2(seed);
  const data = new Uint8Array(W * H * 4);
  const hf = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const v = y / H;
      let c: RGB;
      let height: number;
      if (style === 'white') {
        // しらかば：白い樹皮、横向きの皮目、ところどころ剥がれ
        const base: RGB = [0.86, 0.85, 0.81];
        const len = n.fbm(u * 6, v * 3, 3, 6, 3);
        const lenticel = Math.pow(sat(1 - Math.abs((n.value(u * 60, v * 5, 60, 5) - 0.5) * 9)), 3) * sat((n.value(u * 7, v * 22, 7, 22) - 0.55) * 5);
        const peel = sat((n.fbm(u * 5 + 3, v * 5, 4, 5, 5) - 0.62) * 6);
        c = mix(base, [0.72, 0.68, 0.6], len * 0.5);
        c = mix(c, [0.12, 0.1, 0.09], lenticel * 0.9);
        c = mix(c, [0.62, 0.45, 0.33], peel * 0.8);
        height = 0.5 - lenticel * 0.4 + peel * 0.2;
      } else if (style === 'smooth') {
        // さくら：赤褐色でなめらか、横の皮目
        const base: RGB = [0.34, 0.2, 0.15];
        const len = n.fbm(u * 5, v * 8, 4, 5, 8);
        const lenticel = Math.pow(sat(1 - Math.abs((n.value(u * 90, v * 4, 90, 4) - 0.5) * 12)), 2) * sat((n.value(u * 9, v * 30, 9, 30) - 0.5) * 4);
        c = mix(base, [0.46, 0.3, 0.22], len);
        c = mix(c, [0.55, 0.42, 0.34], lenticel * 0.7);
        height = len * 0.3 + lenticel * 0.35;
      } else {
        // なら・くぬぎ：幹の方向に長くうねる深い割れ目と、その間の板（等高線状のしわ）
        const sv = style === 'ridged' ? 9 : 5;
        const f1 = n.fbm(u * 2, v * sv, 4, 2, sv);
        const f2 = n.fbm(u * 3 + 5, v * sv * 2, 3, 3, sv * 2);
        const d1 = Math.abs(f1 - 0.5);
        const d2 = Math.abs(f2 - 0.5);
        const fissure = 1 - sat(d1 / 0.045);
        const fissure2 = (1 - sat(d2 / 0.03)) * 0.55;
        const plate = sat(d1 / 0.16);
        const fine = n.fbm(u * 40, v * 70, 3, 40, 70);
        const hue = n.fbm(u * 2 + 9, v * 2, 3, 2, 2);
        const base: RGB = style === 'ridged' ? [0.33, 0.29, 0.25] : [0.37, 0.32, 0.27];
        c = mix([base[0] * 0.8, base[1] * 0.8, base[2] * 0.8], base, hue);
        c = mix(c, [0.5, 0.48, 0.45], sat(plate - 0.4) * (0.3 + fine * 0.6) * 0.7);
        c = mix(c, [0.06, 0.045, 0.04], Math.max(fissure * 0.95, fissure2 * 0.8));
        c = mix(c, [0.22, 0.27, 0.16], sat((n.fbm(u * 3 + 9, v * 3, 3, 3, 3) - 0.68) * 3) * 0.4); // 苔の気配
        height = plate * 0.7 - fissure * 0.7 - fissure2 * 0.3 + fine * 0.15;
      }
      put(data, y * W + x, c);
      hf[y * W + x] = height;
    }
  }
  const strength = style === 'ridged' || style === 'plate' ? 3.4 : 1.4;
  return { map: makeTex(data, W, H, true), normal: makeTex(normalFromHeight(hf, W, H, strength), W, H, false) };
}

/** 木口（年輪）。uv(0.5,0.5)が髄 */
export function endGrainTexture(seed: number, base: RGB): TexSet {
  const S = 160;
  const n = new Noise2(seed);
  const data = new Uint8Array(S * S * 4);
  const hf = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S - 0.5;
      const v = y / S - 0.5;
      const r = Math.hypot(u, v);
      const a = Math.atan2(v, u);
      const wob = n.fbm(Math.cos(a) * 2 + 3, Math.sin(a) * 2 + 3, 3) * 0.05;
      const rings = r * 38 + wob * 38;
      const late = Math.pow(Math.abs(Math.sin(rings * Math.PI)), 10);
      const heart = sat((0.33 - r) * 6);
      // 放射状のひび（乾燥割れ）
      const check = Math.pow(sat(1 - Math.abs(Math.sin(a * 3 + n.value(r * 6, 2) * 2)) * 30), 2) * sat(r * 4 - 0.2);
      const saw = n.fbm(u * 30 + 7, v * 6, 3, 256, 256);
      const g0 = (base[0] + base[1] + base[2]) / 3;
      const eb: RGB = [(g0 * 0.35 + base[0] * 0.65) * 0.85, (g0 * 0.35 + base[1] * 0.65) * 0.82, (g0 * 0.35 + base[2] * 0.65) * 0.8];
      let c = mix(eb, [eb[0] * 0.82, eb[1] * 0.68, eb[2] * 0.56], heart * 0.55);
      c = mix(c, [eb[0] * 0.6, eb[1] * 0.52, eb[2] * 0.44], late * 0.5);
      c = mix(c, [c[0] * 0.85, c[1] * 0.85, c[2] * 0.85], saw * 0.4);
      c = mix(c, [0.08, 0.06, 0.05], check * 0.85);
      put(data, y * S + x, c);
      hf[y * S + x] = -late * 0.2 - check * 0.8 + saw * 0.25;
    }
  }
  return { map: makeTex(data, S, S, true, false), normal: makeTex(normalFromHeight(hf, S, S, 2), S, S, false, false) };
}

/** 砂利の地面（F01の丸い小石の見え方を参照） */
export function gravelTexture(seed: number): TexSet & { rough: THREE.DataTexture } {
  const S = 512;
  const n = new Noise2(seed);
  const data = new Uint8Array(S * S * 4);
  const rdata = new Uint8Array(S * S * 4);
  const hf = new Float32Array(S * S);
  const palette: RGB[] = [
    [0.38, 0.37, 0.35],
    [0.46, 0.43, 0.39],
    [0.3, 0.29, 0.28],
    [0.52, 0.48, 0.42],
    [0.42, 0.34, 0.28],
    [0.24, 0.23, 0.22],
    [0.56, 0.54, 0.5],
    [0.35, 0.31, 0.27],
  ];
  const soil: RGB = [0.1, 0.085, 0.07];
  const layers = [
    { scale: 15, rad: 0.46, w: 1 },
    { scale: 29, rad: 0.44, w: 0.8 },
  ];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      let bestH = -1;
      let col: RGB = soil;
      for (let li = 0; li < layers.length; li++) {
        const L = layers[li];
        const cw = n.worley(u * L.scale, v * L.scale, L.scale, L.scale);
        const r = L.rad * (0.75 + 0.5 * cw.id);
        if (cw.f1 < r) {
          const t = cw.f1 / r;
          const dome = Math.sqrt(Math.max(0, 1 - t * t)) * (1 - li * 0.35) * (0.7 + 0.3 * cw.id);
          if (dome > bestH) {
            bestH = dome;
            const pc = palette[Math.floor(cw.id * palette.length) % palette.length];
            const speck = n.value(u * 350, v * 350, 350, 350);
            const shade = 0.72 + 0.34 * dome;
            col = [pc[0] * shade * (0.9 + speck * 0.2), pc[1] * shade * (0.9 + speck * 0.2), pc[2] * shade * (0.9 + speck * 0.2)];
          }
        }
      }
      if (bestH < 0) {
        const s = n.fbm(u * 100, v * 100, 2, 100, 100);
        col = mix(soil, [0.2, 0.18, 0.16], s);
        bestH = -0.2 + s * 0.1;
      }
      put(data, y * S + x, col);
      hf[y * S + x] = bestH;
      const rough = bestH > 0 ? 0.62 + 0.25 * n.value(u * 45, v * 45, 45, 45) : 0.95;
      rdata[(y * S + x) * 4] = rough * 255;
      rdata[(y * S + x) * 4 + 1] = rough * 255;
      rdata[(y * S + x) * 4 + 2] = rough * 255;
      rdata[(y * S + x) * 4 + 3] = 255;
    }
  }
  return {
    map: makeTex(data, S, S, true),
    normal: makeTex(normalFromHeight(hf, S, S, 5), S, S, false),
    rough: makeTex(rdata, S, S, false),
  };
}

/** 焚き火台の金属（すす・熱の変色・錆） */
export function metalTexture(seed: number): { map: THREE.DataTexture; rough: THREE.DataTexture } {
  const S = 256;
  const n = new Noise2(seed);
  const data = new Uint8Array(S * S * 4);
  const rdata = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const brush = n.value(u * 3, v * 200, 3, 200);
      const rust = sat((n.fbm(u * 6, v * 6, 5, 6, 6) - 0.58) * 4);
      const streak = sat((n.fbm(u * 18, v * 1.5, 3, 18, 2) - 0.5) * 2.5) * sat(1.2 - v * 1.1);
      const temper = n.fbm(u * 2 + 5, v * 2, 3, 2, 2);
      let c: RGB = [0.56 + brush * 0.06, 0.56 + brush * 0.06, 0.55 + brush * 0.06];
      c = mix(c, [0.47, 0.42, 0.36], temper * 0.5);
      c = mix(c, [0.42, 0.24, 0.12], rust * 0.75);
      c = mix(c, [0.12, 0.11, 0.1], streak * 0.55);
      put(data, y * S + x, c);
      const rr = 0.36 + rust * 0.45 + streak * 0.3 + brush * 0.08;
      rdata.fill(Math.min(255, rr * 255), (y * S + x) * 4, (y * S + x) * 4 + 3);
      rdata[(y * S + x) * 4 + 3] = 255;
    }
  }
  return { map: makeTex(data, S, S, true), rough: makeTex(rdata, S, S, false) };
}

/** 煙のかたまり（アルファ） */
export function smokePuffTexture(seed: number): THREE.DataTexture {
  const S = 128;
  const n = new Noise2(seed);
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S - 0.5;
      const v = y / S - 0.5;
      const r = Math.hypot(u, v) * 2;
      const f = n.fbm(x / 20, y / 20, 5, 256, 256);
      const a = sat(1 - r) * sat(1 - r * 0.6) * (0.35 + f * 0.9);
      const i = (y * S + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = sat(a) * 255;
    }
  }
  const t = makeTex(data, S, S, false, false);
  return t;
}

/** 汎用のタイル可能なノイズ（R:細かい G:中 B:胞 A:粗い） */
export function noiseTexture(seed: number): THREE.DataTexture {
  const S = 128;
  const n = new Noise2(seed);
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const i = (y * S + x) * 4;
      data[i] = n.fbm(u * 32, v * 32, 3, 32, 32) * 255;
      data[i + 1] = n.fbm(u * 8, v * 8, 4, 8, 8) * 255;
      const w = n.worley(u * 16, v * 16, 16, 16);
      data[i + 2] = sat(w.f1) * 255;
      data[i + 3] = n.fbm(u * 3, v * 3, 3, 3, 3) * 255;
    }
  }
  return makeTex(data, S, S, false);
}

export const SPECIES_WOOD_COLOR: Record<string, RGB> = {
  nara: [0.78, 0.62, 0.44],
  kunugi: [0.72, 0.55, 0.38],
  shirakaba: [0.8, 0.68, 0.5],
  sakura: [0.77, 0.56, 0.42],
  ringo: [0.76, 0.6, 0.45],
  kaede: [0.83, 0.7, 0.52],
  keyaki: [0.74, 0.55, 0.36],
  buna: [0.8, 0.66, 0.5],
  sugi: [0.82, 0.62, 0.45],
  hinoki: [0.87, 0.75, 0.58],
  matsu: [0.84, 0.68, 0.46],
  shimerigi: [0.55, 0.44, 0.34],
};

export type GroundKind = 'gravel' | 'sand' | 'snow' | 'deck' | 'tiles';

/** 場所ごとの地面（仮素材・手続き生成）。砂利以外は選んだときに作る */
export function groundTexture(kind: Exclude<GroundKind, 'gravel'>, seed = 7): TexSet & { rough: THREE.DataTexture; tile: number } {
  const S = 256;
  const n = new Noise2(seed);
  const data = new Uint8Array(S * S * 4);
  const rdata = new Uint8Array(S * S * 4);
  const hf = new Float32Array(S * S);
  let strength = 2;
  let tile = 0.5;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      let c: RGB;
      let h: number;
      let rough: number;
      if (kind === 'sand') {
        // 砂：細かな粒と、風がつけた浅い波紋
        const grain = n.value(u * 180, v * 180, 180, 180);
        const ripple = Math.sin((v * 7 + (n.fbm(u * 3, v * 3, 3, 3, 3) - 0.5) * 1.2) * Math.PI * 2);
        const tone = n.fbm(u * 4, v * 4, 3, 4, 4);
        c = mix([0.55, 0.5, 0.42], [0.66, 0.6, 0.5], tone);
        c = mix(c, [0.46, 0.41, 0.34], sat(0.5 - ripple * 0.5) * 0.25);
        c = [c[0] * (0.9 + grain * 0.2), c[1] * (0.9 + grain * 0.2), c[2] * (0.9 + grain * 0.2)];
        h = ripple * 0.35 + grain * 0.15;
        rough = 0.95;
        strength = 1.6;
        tile = 1.2;
      } else if (kind === 'snow') {
        // 雪：なだらかなふくらみと、細かなきらめきの粒
        const bump = n.fbm(u * 5, v * 5, 4, 5, 5);
        const fine = n.value(u * 120, v * 120, 120, 120);
        const sparkle = Math.pow(n.value(u * 256, v * 256, 256, 256), 18);
        c = mix([0.72, 0.76, 0.84], [0.88, 0.9, 0.95], bump);
        c = mix(c, [1, 1, 1], sparkle * 0.8);
        h = bump * 0.8 + fine * 0.1;
        rough = 0.75 - sparkle * 0.5;
        strength = 1.2;
        tile = 1.6;
      } else if (kind === 'deck') {
        // 板張り：幅のそろった板、木目、継ぎ目
        const boards = 6;
        const bv = v * boards;
        const bi = Math.floor(bv);
        const bf = bv - bi;
        const off = n.value(bi * 3.1, 0.5, 256, 256);
        const grain = n.fbm(u * 2 + off * 10, bf * 6 + bi * 13, 4, 2, 256);
        const seam = 1 - sat(Math.min(bf, 1 - bf) / 0.03);
        const endSeam = 1 - sat(Math.abs(((u + off) % 1) - 0.5) / 0.004);
        const tone = 0.8 + off * 0.35;
        c = mix([0.32 * tone, 0.24 * tone, 0.17 * tone], [0.42 * tone, 0.32 * tone, 0.22 * tone], grain);
        c = mix(c, [0.08, 0.06, 0.05], Math.max(seam, endSeam) * 0.85);
        h = grain * 0.3 - seam * 0.8 - endSeam * 0.6;
        rough = 0.72 + grain * 0.15;
        strength = 2.2;
        tile = 1.5;
      } else {
        // 屋上のタイル：目地、わずかな汚れ
        const tiles = 4;
        const tu = (u * tiles) % 1;
        const tv = (v * tiles) % 1;
        const id = n.value(Math.floor(u * tiles) * 5.3, Math.floor(v * tiles) * 7.1, 256, 256);
        const grout = 1 - sat(Math.min(tu, 1 - tu, tv, 1 - tv) / 0.02);
        const dirt = n.fbm(u * 6, v * 6, 4, 6, 6);
        const speck = n.value(u * 200, v * 200, 200, 200);
        const base = 0.42 + id * 0.08;
        c = [base * (0.95 + speck * 0.1), base * (0.94 + speck * 0.1), base * (0.92 + speck * 0.1)];
        c = mix(c, [0.25, 0.24, 0.23], sat(dirt - 0.55) * 1.2);
        c = mix(c, [0.16, 0.16, 0.16], grout * 0.8);
        h = -grout * 0.7 + speck * 0.05;
        rough = 0.82;
        strength = 2;
        tile = 1.6;
      }
      put(data, y * S + x, c);
      hf[y * S + x] = h;
      const r = Math.round(Math.min(1, Math.max(0, rough)) * 255);
      const i = (y * S + x) * 4;
      rdata[i] = rdata[i + 1] = rdata[i + 2] = r;
      rdata[i + 3] = 255;
    }
  }
  return { map: makeTex(data, S, S, true), normal: makeTex(normalFromHeight(hf, S, S, strength), S, S, false), rough: makeTex(rdata, S, S, false), tile };
}
