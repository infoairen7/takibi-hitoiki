/**
 * 場所（詳細仕様7章：森・湖畔・海辺・雨音の東屋・雪の山小屋・屋上テラス）。
 *
 * ■ 仮素材
 *   湖畔は承認済みの写真（F01の上部）を使う。ほかの5か所は、遠景をその場で絵として描いた「仮の背景」。
 *   地面の質感・天気（雨・雪）・東屋の柱・屋上の手すりも手続き生成。本番の背景素材が届いたら、
 *   PLACE_LOOK の backdrop を画像のURLに替えれば差し替わる（loadBackdrop と同じ口）。
 * 場所は見た目と音だけで、燃焼には影響しない。
 */
import * as THREE from 'three';
import { Rng } from '../game/rng';
import type { PlaceId } from '../data/discoveries';
import { GroundKind } from './textures';

export interface PlaceLook {
  id: PlaceId;
  /** 'photo' は写真の遠景（湖畔）。それ以外は描いた仮の遠景 */
  backdrop: 'photo' | ((ctx: CanvasRenderingContext2D, w: number, h: number) => void);
  ground: GroundKind;
  /** 地面の色味（砂利の色を少し変える） */
  groundTint: number;
  groundRough: number;
  sky: { color: number; intensity: number };
  hemi: { sky: number; ground: number; intensity: number };
  fogDensity: number;
  background: number;
  weather: 'none' | 'rain' | 'snow';
  structure: 'none' | 'pavilion' | 'railing';
  pebbles: boolean;
}

export const PLACE_LOOK: Record<PlaceId, PlaceLook> = {
  lakeside: {
    id: 'lakeside',
    backdrop: 'photo',
    ground: 'gravel',
    groundTint: 0xffffff,
    groundRough: 1,
    sky: { color: 0xa9bddc, intensity: 1.25 },
    hemi: { sky: 0x7c8db0, ground: 0x2e2620, intensity: 1.25 },
    fogDensity: 0.15,
    background: 0x1a2029,
    weather: 'none',
    structure: 'none',
    pebbles: true,
  },
  forest: {
    id: 'forest',
    backdrop: paintForest,
    ground: 'gravel',
    groundTint: 0xc4b8a4,
    groundRough: 1,
    sky: { color: 0x93a6c4, intensity: 1.05 },
    hemi: { sky: 0x6c7c96, ground: 0x2a241c, intensity: 1.1 },
    fogDensity: 0.2,
    background: 0x141a20,
    weather: 'none',
    structure: 'none',
    pebbles: true,
  },
  beach: {
    id: 'beach',
    backdrop: paintBeach,
    ground: 'sand',
    groundTint: 0xffffff,
    groundRough: 1,
    sky: { color: 0xb8c4e2, intensity: 1.3 },
    hemi: { sky: 0x8494b8, ground: 0x3a332a, intensity: 1.3 },
    fogDensity: 0.1,
    background: 0x1a2236,
    weather: 'none',
    structure: 'none',
    pebbles: false,
  },
  pavilion: {
    id: 'pavilion',
    backdrop: paintRainForest,
    ground: 'gravel',
    groundTint: 0x8c8a88,
    groundRough: 0.55,
    sky: { color: 0x8a9aae, intensity: 0.85 },
    hemi: { sky: 0x5e6a7a, ground: 0x2a2622, intensity: 1.05 },
    fogDensity: 0.22,
    background: 0x1a1f25,
    weather: 'rain',
    structure: 'pavilion',
    pebbles: false,
  },
  cabin: {
    id: 'cabin',
    backdrop: paintSnowCabin,
    ground: 'snow',
    groundTint: 0xffffff,
    groundRough: 1,
    sky: { color: 0xc4d4f0, intensity: 1.2 },
    hemi: { sky: 0x9aaacc, ground: 0x5a5e68, intensity: 1.2 },
    fogDensity: 0.12,
    background: 0x1c2638,
    weather: 'snow',
    structure: 'none',
    pebbles: false,
  },
  rooftop: {
    id: 'rooftop',
    backdrop: paintCity,
    ground: 'tiles',
    groundTint: 0xffffff,
    groundRough: 1,
    sky: { color: 0xb09ac8, intensity: 1.0 },
    hemi: { sky: 0x7a6c96, ground: 0x302a2a, intensity: 1.15 },
    fogDensity: 0.08,
    background: 0x1c1628,
    weather: 'none',
    structure: 'railing',
    pebbles: false,
  },
};

/** 描いた遠景（2048×400）。下端は地面の色へ */
export function paintBackdrop(look: PlaceLook): HTMLCanvasElement | null {
  if (look.backdrop === 'photo') return null;
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 400;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  look.backdrop(ctx, c.width, c.height);
  return c;
}

// ───────────────────────────── 描画の部品

function grad(ctx: CanvasRenderingContext2D, w: number, y0: number, y1: number, stops: Array<[number, string]>): void {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  for (const [t, col] of stops) g.addColorStop(t, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, w, y1 - y0);
}

function stars(ctx: CanvasRenderingContext2D, rng: Rng, w: number, maxY: number, n: number, alpha = 0.7): void {
  for (let i = 0; i < n; i++) {
    const x = rng.next() * w;
    const y = rng.next() * maxY;
    const r = rng.next() < 0.08 ? 1.3 : 0.7;
    ctx.fillStyle = `rgba(230,236,255,${(0.25 + rng.next() * 0.75) * alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 山の稜線（中点変位） */
function ridge(ctx: CanvasRenderingContext2D, rng: Rng, w: number, h: number, baseY: number, amp: number, color: string | CanvasGradient): number[] {
  const n = 257;
  const ys = new Array(n).fill(0);
  let step = n - 1;
  let a = amp;
  ys[0] = rng.range(-1, 1) * amp * 0.5;
  ys[n - 1] = rng.range(-1, 1) * amp * 0.5;
  while (step > 1) {
    const half = step / 2;
    for (let i = half; i < n; i += step) ys[i] = (ys[i - half] + ys[i + half]) / 2 + rng.range(-1, 1) * a;
    a *= 0.55;
    step = half;
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, h);
  const pts: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    const y = baseY + ys[i];
    pts.push(y);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  return pts;
}

/** 針葉樹のシルエット：細い幹、下がり気味の枝の段、ぎざぎざの輪郭（左右は少し非対称） */
function pine(ctx: CanvasRenderingContext2D, rng: Rng, x: number, baseY: number, height: number, color: string, snow: string | null = null): void {
  const tiers = 9 + Math.floor(rng.next() * 6);
  const width = height * rng.range(0.2, 0.3);
  const lean = rng.range(-0.03, 0.03) * height;
  ctx.fillStyle = color;
  ctx.fillRect(x - height * 0.008, baseY - height * 0.16, height * 0.016, height * 0.16);
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers;
    const cx = x + lean * f;
    const y0 = baseY - height * (0.1 + f * 0.86);
    const taper = Math.pow(1 - f, 0.85);
    const twL = width * 0.5 * taper * rng.range(0.7, 1.15);
    const twR = width * 0.5 * taper * rng.range(0.7, 1.15);
    const th = height * 0.16 * (1 - f * 0.35);
    const droop = th * rng.range(0.1, 0.3);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx - twL, y0 + droop);
    const jag = 7;
    for (let j = 1; j <= jag; j++) {
      const u = j / jag;
      ctx.lineTo(cx - twL * (1 - u) + rng.range(-1.5, 1.5), y0 + droop * (1 - u) - th * u + (j % 2 ? rng.range(0, 3) : 0));
    }
    for (let j = jag - 1; j >= 0; j--) {
      const u = j / jag;
      ctx.lineTo(cx + twR * (1 - u) + rng.range(-1.5, 1.5), y0 + droop * (1 - u) - th * u + (j % 2 ? rng.range(0, 3) : 0));
    }
    ctx.closePath();
    ctx.fill();
    if (snow && t % 2 === 0) {
      ctx.fillStyle = snow;
      ctx.beginPath();
      ctx.moveTo(cx - twL * 0.7, y0 + droop * 0.4 - th * 0.25);
      ctx.quadraticCurveTo(cx, y0 - th * 0.75, cx + twR * 0.7, y0 + droop * 0.4 - th * 0.25);
      ctx.quadraticCurveTo(cx, y0 - th * 0.35, cx - twL * 0.7, y0 + droop * 0.4 - th * 0.25);
      ctx.fill();
    }
  }
}

function pineRow(ctx: CanvasRenderingContext2D, rng: Rng, w: number, baseY: number, hMin: number, hMax: number, gapMin: number, gapMax: number, color: string, snow: string | null = null, blur = 0): void {
  // ぼかしは列ごとに一度だけ（木の一段ごとにぼかすと、ソフトウェア描画では非常に重い）
  let target = ctx;
  let layer: HTMLCanvasElement | null = null;
  if (blur > 0) {
    layer = document.createElement('canvas');
    layer.width = ctx.canvas.width;
    layer.height = ctx.canvas.height;
    target = layer.getContext('2d')!;
  }
  let x = rng.range(-20, 10);
  while (x < w + 40) {
    pine(target, rng, x, baseY + rng.range(-6, 6), rng.range(hMin, hMax), color, snow);
    x += rng.range(gapMin, gapMax);
  }
  if (layer) {
    ctx.save();
    ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  }
}

function haze(ctx: CanvasRenderingContext2D, w: number, y: number, hh: number, color: string): void {
  const g = ctx.createLinearGradient(0, y - hh, 0, y + hh);
  g.addColorStop(0, color.replace('A', '0'));
  g.addColorStop(0.5, color.replace('A', '1'));
  g.addColorStop(1, color.replace('A', '0'));
  ctx.fillStyle = g;
  ctx.fillRect(0, y - hh, w, hh * 2);
}

// ───────────────────────────── 場所ごとの遠景

function paintForest(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const rng = new Rng(4101);
  grad(ctx, w, 0, h, [
    [0, '#0f1a2a'],
    [0.42, '#243448'],
    [0.62, '#3a4a5a'],
    [1, '#1f2322'],
  ]);
  stars(ctx, rng, w, h * 0.3, 140, 0.45);
  ridge(ctx, rng, w, h, h * 0.54, 26, '#243040');
  haze(ctx, w, h * 0.6, 26, 'rgba(70,82,96,A)');
  pineRow(ctx, rng, w, h * 0.8, 70, 120, 12, 24, '#223040', null, 1.2);
  haze(ctx, w, h * 0.74, 20, 'rgba(58,70,84,A)');
  pineRow(ctx, rng, w, h * 0.88, 130, 230, 22, 44, '#121b22', null, 0.4);
  // 手前の幹
  for (let i = 0; i < 14; i++) {
    const x = rng.next() * w;
    const tw = rng.range(10, 26);
    ctx.fillStyle = '#080c10';
    ctx.fillRect(x, 0, tw, h * 0.92);
  }
  grad(ctx, w, h * 0.86, h, [
    [0, 'rgba(26,28,27,0)'],
    [0.4, '#1d1e1c'],
    [1, '#2a2926'],
  ]);
}

function paintRainForest(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const rng = new Rng(5202);
  grad(ctx, w, 0, h, [
    [0, '#1a2129'],
    [0.5, '#2a333d'],
    [0.66, '#39424b'],
    [1, '#1c1f21'],
  ]);
  ridge(ctx, rng, w, h, h * 0.56, 20, '#2c3640');
  haze(ctx, w, h * 0.62, 34, 'rgba(78,88,98,A)');
  pineRow(ctx, rng, w, h * 0.82, 70, 120, 14, 28, '#26313a', null, 1.5);
  haze(ctx, w, h * 0.76, 26, 'rgba(70,78,88,A)');
  pineRow(ctx, rng, w, h * 0.9, 120, 210, 26, 50, '#172028', null, 0.6);
  // 雨のすじ（遠くのかすみ）
  ctx.strokeStyle = 'rgba(190,200,215,0.07)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 900; i++) {
    const x = rng.next() * w;
    const y = rng.next() * h;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 3, y + rng.range(14, 30));
    ctx.stroke();
  }
  grad(ctx, w, h * 0.86, h, [
    [0, 'rgba(30,32,33,0)'],
    [0.4, '#202224'],
    [1, '#2b2c2c'],
  ]);
}

function paintBeach(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const rng = new Rng(6303);
  const horizon = h * 0.6;
  grad(ctx, w, 0, horizon, [
    [0, '#0e1730'],
    [0.45, '#243462'],
    [0.8, '#5f5a84'],
    [1, '#c8948a'],
  ]);
  stars(ctx, rng, w, h * 0.35, 220, 0.8);
  // 月
  const mx = w * 0.3;
  const my = h * 0.22;
  const mg = ctx.createRadialGradient(mx, my, 4, mx, my, 70);
  mg.addColorStop(0, 'rgba(255,244,220,0.55)');
  mg.addColorStop(1, 'rgba(255,244,220,0)');
  ctx.fillStyle = mg;
  ctx.fillRect(mx - 70, my - 70, 140, 140);
  ctx.fillStyle = '#fff4e0';
  ctx.beginPath();
  ctx.arc(mx, my, 11, 0, Math.PI * 2);
  ctx.fill();
  // 遠くの岬
  ctx.fillStyle = '#1c2231';
  ctx.beginPath();
  ctx.moveTo(w * 0.62, horizon);
  ctx.quadraticCurveTo(w * 0.7, horizon - 34, w * 0.8, horizon - 22);
  ctx.quadraticCurveTo(w * 0.88, horizon - 30, w * 0.98, horizon - 10);
  ctx.lineTo(w * 0.98, horizon);
  ctx.closePath();
  ctx.fill();
  // 海
  grad(ctx, w, horizon, h * 0.86, [
    [0, '#2c3758'],
    [0.5, '#1c2640'],
    [1, '#121a2a'],
  ]);
  for (let i = 0; i < 700; i++) {
    const y = horizon + Math.pow(rng.next(), 1.6) * (h * 0.86 - horizon);
    const x = rng.next() * w;
    const len = 4 + (y - horizon) * 0.5 * rng.next();
    ctx.fillStyle = `rgba(170,185,220,${0.05 + rng.next() * 0.12})`;
    ctx.fillRect(x, y, len, 1);
  }
  // 月の道
  for (let i = 0; i < 160; i++) {
    const t = rng.next();
    const y = horizon + 2 + t * (h * 0.84 - horizon);
    const spread = 6 + t * 60;
    const x = mx + rng.range(-spread, spread);
    ctx.fillStyle = `rgba(255,236,200,${0.25 + rng.next() * 0.45})`;
    ctx.fillRect(x, y, rng.range(3, 12 + t * 20), 1.2);
  }
  // 波打ちぎわ
  for (let k = 0; k < 3; k++) {
    const y = h * (0.8 + k * 0.025);
    ctx.strokeStyle = `rgba(220,228,240,${0.18 - k * 0.04})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.01 + k * 2) * 3 + rng.range(-1, 1));
    ctx.stroke();
  }
  grad(ctx, w, h * 0.85, h, [
    [0, 'rgba(50,46,42,0)'],
    [0.35, '#3a352f'],
    [1, '#4a443c'],
  ]);
}

function paintSnowCabin(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const rng = new Rng(7404);
  grad(ctx, w, 0, h, [
    [0, '#0d172d'],
    [0.45, '#22345a'],
    [0.62, '#3a4c6e'],
    [1, '#2a3346'],
  ]);
  stars(ctx, rng, w, h * 0.28, 120, 0.55);
  // 雪山
  const mtn = ctx.createLinearGradient(0, h * 0.28, 0, h * 0.62);
  mtn.addColorStop(0, '#b8c6e0');
  mtn.addColorStop(1, '#5a6a8c');
  ridge(ctx, rng, w, h, h * 0.44, 46, mtn);
  ridge(ctx, rng, w, h, h * 0.6, 22, '#6f7f9f');
  haze(ctx, w, h * 0.63, 22, 'rgba(150,165,195,A)');
  pineRow(ctx, rng, w, h * 0.8, 60, 110, 14, 30, '#1c2833', '#b8c6dc', 1.1);
  // 山小屋
  const cx = w * 0.68;
  const cy = h * 0.8;
  ctx.fillStyle = '#2b2320';
  ctx.fillRect(cx - 60, cy - 46, 120, 46);
  ctx.fillStyle = '#d8e0ee';
  ctx.beginPath();
  ctx.moveTo(cx - 74, cy - 44);
  ctx.lineTo(cx, cy - 92);
  ctx.lineTo(cx + 74, cy - 44);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#231c19';
  ctx.fillRect(cx + 28, cy - 100, 12, 30);
  for (const [dx, dy] of [
    [-34, -30],
    [18, -30],
  ]) {
    const glow = ctx.createRadialGradient(cx + dx + 8, cy + dy + 8, 2, cx + dx + 8, cy + dy + 8, 40);
    glow.addColorStop(0, 'rgba(255,190,110,0.5)');
    glow.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(cx + dx - 32, cy + dy - 32, 80, 80);
    ctx.fillStyle = '#ffc07a';
    ctx.fillRect(cx + dx, cy + dy, 16, 16);
  }
  // 煙突の煙
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = `rgba(200,210,230,${0.05 * (1 - i / 18)})`;
    ctx.beginPath();
    ctx.arc(cx + 34 + i * 3, cy - 104 - i * 6, 6 + i * 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  pineRow(ctx, rng, w, h * 0.9, 120, 200, 34, 70, '#0f171e', '#d4deee', 0.3);
  // 舞う雪（遠景）
  for (let i = 0; i < 600; i++) {
    ctx.fillStyle = `rgba(235,240,255,${0.15 + rng.next() * 0.4})`;
    ctx.beginPath();
    ctx.arc(rng.next() * w, rng.next() * h * 0.9, rng.range(0.5, 1.6), 0, Math.PI * 2);
    ctx.fill();
  }
  grad(ctx, w, h * 0.86, h, [
    [0, 'rgba(150,165,190,0)'],
    [0.35, '#9aa8c0'],
    [1, '#b6c2d6'],
  ]);
}

function paintCity(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const rng = new Rng(8505);
  grad(ctx, w, 0, h, [
    [0, '#110e22'],
    [0.4, '#281d44'],
    [0.64, '#643a5c'],
    [0.78, '#a45a58'],
    [1, '#3a2530'],
  ]);
  stars(ctx, rng, w, h * 0.22, 50, 0.35);
  const layers = [
    { base: h * 0.74, hMin: 30, hMax: 110, wMin: 24, wMax: 60, color: '#2d2544', lit: 0.12 },
    { base: h * 0.84, hMin: 50, hMax: 190, wMin: 30, wMax: 80, color: '#191424', lit: 0.3 },
  ];
  for (const L of layers) {
    let x = -10;
    while (x < w + 20) {
      const bw = rng.range(L.wMin, L.wMax);
      const bh = rng.range(L.hMin, L.hMax) * (rng.next() < 0.1 ? 1.5 : 1);
      ctx.fillStyle = L.color;
      ctx.fillRect(x, L.base - bh, bw, bh + h);
      // 窓
      for (let yy = L.base - bh + 6; yy < L.base - 4; yy += 7) {
        for (let xx = x + 4; xx < x + bw - 4; xx += 6) {
          if (rng.next() < L.lit) {
            ctx.fillStyle = rng.next() < 0.7 ? `rgba(255,214,150,${0.5 + rng.next() * 0.5})` : `rgba(190,220,255,${0.5 + rng.next() * 0.4})`;
            ctx.fillRect(xx, yy, 3, 3);
          }
        }
      }
      if (bh > 150 && rng.next() < 0.6) {
        ctx.fillStyle = '#ff4a3a';
        ctx.beginPath();
        ctx.arc(x + bw / 2, L.base - bh - 3, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      x += bw + rng.range(0, 8);
    }
  }
  // 遠くの街あかり（ぼけ）
  for (let i = 0; i < 90; i++) {
    const x = rng.next() * w;
    const y = h * rng.range(0.84, 1);
    const r = rng.range(6, 18);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const warm = rng.next() < 0.75;
    g.addColorStop(0, warm ? 'rgba(255,190,120,0.35)' : 'rgba(255,140,190,0.3)');
    g.addColorStop(1, 'rgba(255,190,120,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

// ───────────────────────────── 天気（雨・雪）

const WEATHER_VERT = /* glsl */ `
attribute float aSeed;
uniform float uPixel;
uniform float uSize;
varying float vSeed;
varying float vDepth;
void main() {
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_PointSize = min(uSize * uPixel / max(0.2, -mv.z), 14.0);
  gl_Position = projectionMatrix * mv;
}
`;

const RAIN_FRAG = /* glsl */ `
uniform float uAlpha;
varying float vSeed;
varying float vDepth;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float line = 1.0 - smoothstep(0.02, 0.07, abs(p.x + p.y * 0.08));
  float len = 1.0 - smoothstep(0.3, 0.5, abs(p.y));
  float a = line * len * uAlpha * (0.5 + 0.5 * vSeed) * clamp(vDepth / 1.5, 0.2, 1.0);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.78, 0.83, 0.9) * a, a);
}
`;

const SNOW_FRAG = /* glsl */ `
uniform float uAlpha;
varying float vSeed;
varying float vDepth;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  float a = (1.0 - smoothstep(0.15, 0.5, d)) * uAlpha * (0.55 + 0.45 * vSeed);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.92, 0.95, 1.0) * a, a);
}
`;

export class Weather {
  readonly points: THREE.Points;
  readonly uniforms: { uPixel: { value: number }; uSize: { value: number }; uAlpha: { value: number } };
  private pos: Float32Array;
  private vel: Float32Array;
  private seeds: Float32Array;
  private rng = new Rng(9091);
  private count: number;
  /** 描く粒の数（軽量のときは減らす） */
  private active: number;

  constructor(
    readonly kind: 'rain' | 'snow',
    count: number,
    /** 屋根の下など、降らない範囲 */
    private covered: ((x: number, z: number) => boolean) | null,
  ) {
    this.count = count;
    this.active = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) this.spawn(i, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seeds, 1));
    this.uniforms = { uPixel: { value: 500 }, uSize: { value: kind === 'rain' ? 0.09 : 0.022 }, uAlpha: { value: kind === 'rain' ? 0.5 : 0.85 } };
    const mat = new THREE.ShaderMaterial({
      vertexShader: WEATHER_VERT,
      fragmentShader: kind === 'rain' ? RAIN_FRAG : SNOW_FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 14;
  }

  private spawn(i: number, anywhere: boolean): void {
    const r = this.rng;
    let x = 0;
    let z = 0;
    for (let k = 0; k < 8; k++) {
      x = r.range(-4, 4);
      z = r.range(-6, 0.25);
      if (!this.covered || !this.covered(x, z)) break;
    }
    const y = anywhere ? r.range(0, 3.2) : 3.2 + r.range(0, 0.5);
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.seeds[i] = r.next();
    if (this.kind === 'rain') {
      this.vel[i * 3] = r.range(-0.1, 0.1);
      this.vel[i * 3 + 1] = -r.range(4.5, 6.5);
      this.vel[i * 3 + 2] = r.range(-0.1, 0.1);
    } else {
      this.vel[i * 3] = r.range(-0.08, 0.08);
      this.vel[i * 3 + 1] = -r.range(0.25, 0.55);
      this.vel[i * 3 + 2] = r.range(-0.08, 0.08);
    }
  }

  /** 描く粒の数を変える（0..1 の割合） */
  setShare(share: number): void {
    this.active = Math.max(1, Math.min(this.count, Math.round(this.count * share)));
    this.points.geometry.setDrawRange(0, this.active);
  }

  update(dt: number, t: number, wind: THREE.Vector2, fire: THREE.Vector3): void {
    const n = this.active;
    for (let i = 0; i < n; i++) {
      const s = this.seeds[i];
      let vx = this.vel[i * 3] + wind.x * (this.kind === 'rain' ? 0.6 : 0.9);
      const vz = this.vel[i * 3 + 2] + wind.y * (this.kind === 'rain' ? 0.6 : 0.9);
      if (this.kind === 'snow') vx += Math.sin(t * (0.6 + s) + s * 20) * 0.12;
      this.pos[i * 3] += vx * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += vz * dt;
      const x = this.pos[i * 3];
      const y = this.pos[i * 3 + 1];
      const z = this.pos[i * 3 + 2];
      // 地面・屋根の下・焚き火の真上（雪は熱で消える）
      const nearFire = Math.hypot(x - fire.x, z - fire.z) < 0.35 && y < 1.0;
      if (y < 0 || (this.covered && this.covered(x, z)) || nearFire || Math.abs(x) > 4.5 || z > 0.45) this.spawn(i, false);
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

// ───────────────────────────── 東屋・手すり

export function buildStructure(kind: 'pavilion' | 'railing', deckTex: { map: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture } | null): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'pavilion') {
    const wood = new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.8 });
    // 板張りの床（台の周り）
    if (deckTex) {
      for (const t of [deckTex.map, deckTex.normal, deckTex.rough]) t.repeat.set(2, 2);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.03, 2.9), new THREE.MeshStandardMaterial({ map: deckTex.map, normalMap: deckTex.normal, roughnessMap: deckTex.rough, roughness: 1 }));
      deck.position.set(0, -0.015, -0.05);
      deck.receiveShadow = true;
      g.add(deck);
    }
    for (const [x, z] of [
      [-1.4, -1.45],
      [1.4, -1.45],
      [-1.4, 1.35],
      [1.4, 1.35],
    ]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.6, 0.09), wood);
      post.position.set(x, 0.8, z);
      post.castShadow = true;
      g.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.1, 0.12), wood);
    beam.position.set(0, 1.55, -1.45);
    g.add(beam);
    // 軒先から落ちるしずくの列（雨の粒子とは別の、動かない細い筋）
    const dripMat = new THREE.MeshBasicMaterial({ color: 0x9fb0c4, transparent: true, opacity: 0.18, depthWrite: false });
    for (let i = 0; i < 26; i++) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(0.004, 1.5), dripMat);
      d.position.set(-1.35 + i * 0.108 + ((i * 37) % 7) * 0.004, 0.75, -1.5);
      g.add(d);
    }
  } else {
    const metal = new THREE.MeshStandardMaterial({ color: 0x2e2c30, roughness: 0.45, metalness: 0.8 });
    for (let x = -4; x <= 4.01; x += 0.5) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.0, 8), metal);
      post.position.set(x, 0.5, -1.9);
      g.add(post);
    }
    for (const y of [1.0, 0.52, 0.08]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(y === 1.0 ? 0.022 : 0.01, y === 1.0 ? 0.022 : 0.01, 8, 8), metal);
      rail.rotation.z = Math.PI / 2;
      rail.position.set(0, y, -1.9);
      g.add(rail);
    }
    // ガラス板（ほのかな映り込み）
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(8, 0.9), new THREE.MeshStandardMaterial({ color: 0x8aa0c0, transparent: true, opacity: 0.08, roughness: 0.1, metalness: 0.2, depthWrite: false }));
    glass.position.set(0, 0.52, -1.9);
    g.add(glass);
    // 屋上の縁（この先は街）
    const edge = new THREE.Mesh(new THREE.BoxGeometry(9, 0.12, 0.2), new THREE.MeshStandardMaterial({ color: 0x3a3836, roughness: 0.9 }));
    edge.position.set(0, 0.0, -1.98);
    g.add(edge);
  }
  return g;
}
