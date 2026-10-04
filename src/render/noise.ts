/** テクスチャ生成用のCPUノイズ（seed付き・決定的） */
import { Rng } from '../game/rng';

export class Noise2 {
  private perm: Uint8Array;
  constructor(seed: number) {
    const rng = new Rng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  private h(ix: number, iy: number): number {
    return this.perm[(this.perm[ix & 255] + iy) & 255] / 255;
  }

  /** 値ノイズ 0..1。periodで周期化（タイル可能） */
  value(x: number, y: number, px = 256, py = 256): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const x0 = ((ix % px) + px) % px;
    const y0 = ((iy % py) + py) % py;
    const x1 = (x0 + 1) % px;
    const y1 = (y0 + 1) % py;
    const a = this.h(x0, y0);
    const b = this.h(x1, y0);
    const c = this.h(x0, y1);
    const d = this.h(x1, y1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }

  fbm(x: number, y: number, oct = 4, px = 256, py = 256): number {
    let s = 0;
    let a = 0.5;
    let f = 1;
    let n = 0;
    for (let i = 0; i < oct; i++) {
      s += a * this.value(x * f, y * f, px * f, py * f);
      n += a;
      a *= 0.5;
      f *= 2;
    }
    return s / n;
  }

  /** 周期付きの胞状ノイズ：最も近い点との距離(f1)と2番目(f2)、点のid */
  worley(x: number, y: number, px: number, py: number): { f1: number; f2: number; id: number } {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let f1 = 9;
    let f2 = 9;
    let id = 0;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const cx = ix + i;
        const cy = iy + j;
        const wx = ((cx % px) + px) % px;
        const wy = ((cy % py) + py) % py;
        const hx = this.h(wx, wy);
        const hy = this.h(wy + 17, wx + 31);
        const dx = cx + hx - x;
        const dy = cy + hy - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = this.h(wx + 7, wy + 3);
        } else if (d < f2) f2 = d;
      }
    }
    return { f1, f2, id };
  }
}
