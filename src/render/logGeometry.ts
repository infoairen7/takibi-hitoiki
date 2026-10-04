/**
 * 薪の形状（手続き生成の仮モデル）。
 * 軸はローカル+X、長さ方向に -L/2..+L/2。底面は y=-r（床に接する）。
 * 属性 aSeg（長さ方向 0..1）と aSurf（0=樹皮, 1=割り面, 2=木口）で、焦げ・赤熱・灰を区間ごとに塗り分ける。
 * 実モデル（GLB）が納品されたら、同じ属性を持つジオメトリへ差し替える。
 */
import * as THREE from 'three';
import { Rng } from '../game/rng';
import { Noise2 } from './noise';

interface PPt {
  y: number;
  z: number;
  surf: 0 | 1;
}

interface Profile {
  runs: PPt[][];
  pith: [number, number];
}

function arc(cy: number, cz: number, ry: number, rz: number, a0: number, a1: number, n: number, surf: 0 | 1): PPt[] {
  const out: PPt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push({ y: cy + Math.sin(a) * ry, z: cz + Math.cos(a) * rz, surf });
  }
  return out;
}

function line(y0: number, z0: number, y1: number, z1: number, n: number, surf: 0 | 1): PPt[] {
  const out: PPt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({ y: y0 + (y1 - y0) * t, z: z0 + (z1 - z0) * t, surf });
  }
  return out;
}

/** 中薪の断面。runsは反時計回り（外向き法線が外側） */
function mediumProfile(r: number, rng: Rng): Profile {
  const t = rng.next();
  if (t < 0.4) {
    // 四つ割りを樹皮側を下に：割り面が上を向き、木口の年輪は上の角から広がる
    const R = r * 2;
    const spread = rng.range(0.55, 0.72);
    const a0 = -Math.PI / 2 - spread;
    const a1 = -Math.PI / 2 + spread;
    const arcPts = arc(r, 0, R, R * rng.range(0.95, 1.05), a0, a1, 14, 0);
    const right = arcPts[arcPts.length - 1];
    const left = arcPts[0];
    return {
      runs: [arcPts, line(right.y, right.z, r, 0, 5, 1), line(r, 0, left.y, left.z, 5, 1)],
      pith: [r, 0],
    };
  }
  if (t < 0.55) {
    // 半割り：底が割り面、上が樹皮の弧
    const w = r * rng.range(0.95, 1.08);
    const h = r * rng.range(1.75, 1.95);
    return {
      runs: [line(-r, -w, -r, w, 5, 1), arc(-r, 0, h, w, 0, Math.PI, 16, 0)],
      pith: [-r, 0],
    };
  }
  if (t < 0.85) {
    // 四つ割り：髄の角から2枚の割り面、外周が樹皮
    const R = r * rng.range(1.8, 1.95);
    const z0 = -r * 0.95;
    const flip = rng.next() < 0.5;
    const runs = [
      line(-r, z0, -r, z0 + R, 5, 1),
      arc(-r, z0, R, R, 0, Math.PI / 2, 12, 0),
      line(-r + R, z0, -r, z0, 5, 1),
    ];
    if (flip) {
      // 左右反転（向きを保つため順序も反転）
      const mirrored = runs.map((run) => run.map((p) => ({ ...p, z: -p.z })).reverse()).reverse();
      return { runs: mirrored, pith: [-r, -z0] };
    }
    return { runs, pith: [-r, z0] };
  }
  // 板状：3面が割り面、片側に樹皮
  const w = r * rng.range(1.05, 1.2);
  const h = r * rng.range(1.5, 1.7);
  return {
    runs: [
      line(-r, -w, -r, w, 5, 1),
      line(-r, w, -r + h * 0.55, w * 0.9, 3, 1),
      arc(-r + h * 0.55, 0, h * 0.45, w * 0.9, 0, Math.PI, 10, 0),
      line(-r + h * 0.55, -w * 0.9, -r, -w, 3, 1),
    ],
    pith: [-r - r * 2.2, 0],
  };
}

function kindlingProfile(r: number, rng: Rng): Profile {
  const w = r * rng.range(1.0, 1.25);
  const h = r * 2 * rng.range(0.75, 0.95);
  const top = -r + h;
  const skew = r * rng.range(-0.25, 0.25);
  const bark = rng.next() < 0.3;
  return {
    runs: [
      line(-r, -w, -r, w, 2, 1),
      line(-r, w, top, w * 0.85 + skew, 2, 1),
      line(top, w * 0.85 + skew, top + r * 0.12, -w * 0.2, 2, bark ? 0 : 1),
      line(top + r * 0.12, -w * 0.2, top, -w * 0.9 + skew, 2, bark ? 0 : 1),
      line(top, -w * 0.9 + skew, -r, -w, 2, 1),
    ],
    pith: [-r - r * 4, 0],
  };
}

export interface LogShape {
  geometry: THREE.BufferGeometry;
  /** 見た目の最大半径（ゴーストの輪郭などに使う） */
  extent: number;
}

export function buildLogGeometry(kind: 'kindling' | 'medium' | 'large', length: number, r: number, seed: number): LogShape {
  const rng = new Rng(seed);
  const noise = new Noise2(seed ^ 0x5bd1e995);
  // 中薪・太薪は割った太い薪の断面、細薪は細い焚き付け
  const thick = kind !== 'kindling';
  const prof = thick ? mediumProfile(r, rng) : kindlingProfile(r, rng);
  const rings = thick ? 16 : 10;
  const L = length;

  // 端の切り口：わずかに斜め、細薪はささくれ
  const endTilt = [rng.range(-0.14, 0.14), rng.range(-0.14, 0.14)];
  const endPhi = [rng.range(0, Math.PI * 2), rng.range(0, Math.PI * 2)];

  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const seg: number[] = [];
  const surf: number[] = [];
  const idx: number[] = [];

  // 各runの点に凹凸を加える（床に接する底面はほぼ平らに保つ）
  const ringOffset = (xi: number, p: PPt, k: number): [number, number] => {
    const xN = xi / rings;
    const bump = thick ? (p.surf === 0 ? 0.09 : 0.035) : 0.05;
    const nY = p.y;
    const nZ = p.z;
    const len = Math.hypot(nY, nZ) || 1;
    const floorLock = p.y < -r * 0.98 ? 0.1 : 1;
    const d = (noise.fbm(xN * 5 + k * 0.37, k * 0.21 + 3, 3) - 0.5) * 2 * bump * r * floorLock;
    const taper = 1 + (noise.value(xN * 2 + 11, 1) - 0.5) * 0.08;
    return [nY * taper + (nY / len) * d, nZ * taper + (nZ / len) * d];
  };

  const endX = (side: 0 | 1, y: number, z: number, k: number): number => {
    const base = side === 0 ? -L / 2 : L / 2;
    const tilt = endTilt[side] * (y * Math.cos(endPhi[side]) + z * Math.sin(endPhi[side]));
    let jag = 0;
    if (kind === 'kindling') jag = (noise.value(k * 1.7 + side * 9, 5) - 0.5) * 0.028;
    else jag = (noise.value(k * 0.9 + side * 9, 7) - 0.5) * 0.006;
    return base + tilt + (side === 0 ? -jag : jag);
  };

  // 外周の点（端の輪を作るため全runを連結）
  const ringPts: Array<{ y: number; z: number; k: number }>[] = [];

  let perimeterK = 0;
  for (const run of prof.runs) {
    const start = pos.length / 3;
    // runの長さ（v座標）
    const cum: number[] = [0];
    for (let i = 1; i < run.length; i++) cum.push(cum[i - 1] + Math.hypot(run[i].y - run[i - 1].y, run[i].z - run[i - 1].z));
    for (let xi = 0; xi <= rings; xi++) {
      for (let i = 0; i < run.length; i++) {
        const p = run[i];
        const k = perimeterK + i;
        const [y, z] = ringOffset(xi, p, k);
        let x = -L / 2 + (L * xi) / rings;
        if (xi === 0) x = endX(0, y, z, k);
        if (xi === rings) x = endX(1, y, z, k);
        pos.push(x, y, z);
        nor.push(0, 0, 0);
        uv.push((x + L / 2) / 0.26, (cum[i] + perimeterK * 0.0005) / 0.2);
        seg.push((x + L / 2) / L);
        surf.push(p.surf);
        if (xi === 0 || xi === rings) {
          const ringIdx = xi === 0 ? 0 : 1;
          ringPts[ringIdx] = ringPts[ringIdx] ?? [];
          // runの終点は次のrunの始点と同じなので除く
          if (i < run.length - 1) ringPts[ringIdx].push({ y, z, k });
        }
      }
    }
    const n = run.length;
    for (let xi = 0; xi < rings; xi++) {
      for (let i = 0; i < n - 1; i++) {
        const a = start + xi * n + i;
        const b = start + (xi + 1) * n + i;
        const c = start + (xi + 1) * n + i + 1;
        const d = start + xi * n + i + 1;
        idx.push(a, b, d, b, c, d);
      }
    }
    perimeterK += run.length;
  }

  // 側面の法線（run内でなめらか）
  const tmp = new THREE.BufferGeometry();
  tmp.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  tmp.setIndex(idx);
  tmp.computeVertexNormals();
  const nAttr = tmp.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < nAttr.count; i++) {
    nor[i * 3] = nAttr.getX(i);
    nor[i * 3 + 1] = nAttr.getY(i);
    nor[i * 3 + 2] = nAttr.getZ(i);
  }

  // 木口のふた（扇形）。uvは髄を中心に
  const capScale = 1 / (r * 4.4);
  for (const side of [0, 1] as const) {
    const pts = ringPts[side];
    if (!pts || pts.length < 3) continue;
    let cy = 0;
    let cz = 0;
    for (const p of pts) {
      cy += p.y;
      cz += p.z;
    }
    cy /= pts.length;
    cz /= pts.length;
    const center = pos.length / 3;
    const cx = endX(side, cy, cz, 0);
    const nx = side === 0 ? -1 : 1;
    const pushV = (x: number, y: number, z: number) => {
      pos.push(x, y, z);
      nor.push(nx, 0, 0);
      uv.push((z - prof.pith[1]) * capScale + 0.5, (y - prof.pith[0]) * capScale + 0.5);
      seg.push(side === 0 ? 0 : 1);
      surf.push(2);
    };
    pushV(cx, cy, cz);
    for (const p of pts) pushV(endX(side, p.y, p.z, p.k), p.y, p.z);
    for (let i = 0; i < pts.length; i++) {
      const a = center + 1 + i;
      const b = center + 1 + ((i + 1) % pts.length);
      if (side === 0) idx.push(center, a, b);
      else idx.push(center, b, a);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSeg', new THREE.Float32BufferAttribute(seg, 1));
  g.setAttribute('aSurf', new THREE.Float32BufferAttribute(surf, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  let extent = 0;
  for (let i = 0; i < pos.length; i += 3) extent = Math.max(extent, Math.hypot(pos[i + 1], pos[i + 2]));
  return { geometry: g, extent };
}

/**
 * 火口：細かな木毛（削りくず）の束。薄いリボンを多数ねじって重ねる。
 * aSeg=0.5、aSurf=1。燃え広がりは aBurn（着火点からの距離 0..1）で表す。
 */
export function buildTinderGeometry(radius: number, height: number, seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const burn: number[] = [];
  const idx: number[] = [];
  const ribbons = 150;
  const steps = 14;
  const ignite = [0, -height * 0.3, radius * 0.6]; // 手前の縁（ライターが当たる側）
  for (let rb = 0; rb < ribbons; rb++) {
    // 束の中の出発点（楕円体）
    const a = rng.range(0, Math.PI * 2);
    const rr = Math.sqrt(rng.next()) * radius * 0.85;
    const cx = Math.cos(a) * rr;
    const cz = Math.sin(a) * rr;
    const cy = -height / 2 + rng.range(0.002, height * (1 - (rr / radius) * 0.6));
    const dirA = rng.range(0, Math.PI * 2);
    const curl = rng.range(0.004, 0.011);
    const turns = rng.range(0.8, 2.4);
    const len = rng.range(0.035, 0.085);
    const width = rng.range(0.003, 0.0055);
    const tilt = rng.range(-0.35, 0.35);
    const start = pos.length / 3;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const ang = t * turns * Math.PI * 2;
      // 進行方向に沿ったらせん（木毛のカール）
      const fx = Math.cos(dirA) * (t - 0.5) * len;
      const fz = Math.sin(dirA) * (t - 0.5) * len;
      const ox = -Math.sin(dirA) * Math.cos(ang) * curl;
      const oz = Math.cos(dirA) * Math.cos(ang) * curl;
      const oy = Math.sin(ang) * curl + tilt * (t - 0.5) * len * 0.5;
      let x = cx + fx + ox;
      let y = cy + oy;
      let z = cz + fz + oz;
      // 束の外へはみ出しすぎない
      const d = Math.hypot(x, z);
      if (d > radius * 1.05) {
        x *= (radius * 1.05) / d;
        z *= (radius * 1.05) / d;
      }
      y = Math.max(-height / 2 + 0.001, Math.min(height / 2, y));
      // リボンの幅方向（らせんの接線に垂直）
      const wx = Math.cos(dirA) * 0.3 * width;
      const wz = Math.sin(dirA) * 0.3 * width;
      const wy = width * Math.cos(ang);
      const nx = -Math.sin(ang) * -Math.sin(dirA);
      const ny = Math.abs(Math.cos(ang)) * 0.3 + 0.7;
      const nz = -Math.sin(ang) * Math.cos(dirA);
      for (const sgn of [-1, 1]) {
        pos.push(x + wx * sgn * 0.5, y + wy * sgn * 0.5, z + wz * sgn * 0.5);
        const nl = Math.hypot(nx, ny, nz) || 1;
        nor.push(nx / nl, ny / nl, nz / nl);
        uv.push(t * 0.3 + rb * 0.13, sgn * 0.02 + rb * 0.07);
        const bd = Math.hypot(x - ignite[0], (y - ignite[1]) * 1.5, z - ignite[2]) / (radius * 2.1);
        burn.push(Math.min(1, bd));
      }
    }
    for (let s = 0; s < steps; s++) {
      const a0 = start + s * 2;
      idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSeg', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill(0.5), 1));
  g.setAttribute('aSurf', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill(1), 1));
  g.setAttribute('aBurn', new THREE.Float32BufferAttribute(burn, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
