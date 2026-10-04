/** seed付き乱数（sfc32）。状態を保存・復元できる。 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number | [number, number, number, number]) {
    if (Array.isArray(seed)) {
      [this.a, this.b, this.c, this.d] = seed;
    } else {
      // splitmix32でseedを4語へ展開
      let s = seed >>> 0;
      const next = () => {
        s = (s + 0x9e3779b9) >>> 0;
        let z = s;
        z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
        z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
        return (z ^ (z >>> 16)) >>> 0;
      };
      this.a = next();
      this.b = next();
      this.c = next();
      this.d = next();
    }
  }

  next(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) >>> 0;
    return t / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  int(lo: number, hiInclusive: number): number {
    return lo + Math.floor(this.next() * (hiInclusive - lo + 1));
  }

  state(): [number, number, number, number] {
    return [this.a, this.b, this.c, this.d];
  }
}

/** 文字列などから32bitのhash */
export function hash32(x: string | number): number {
  const s = String(x);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** 整数座標からの決定的な乱数値 0..1（描画の揺らぎ用） */
export function hashNoise(i: number, j = 0, k = 0): number {
  let h = Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(k | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
