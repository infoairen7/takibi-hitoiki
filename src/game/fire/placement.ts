/**
 * 薪の置き方：自由な剛体物理を使わず、事前に決まった規則で「支持点」へ吸着させる。
 *
 * 1. 置きたい位置・向きで、薪の軸に沿って下にある物の高さを調べる
 * 2. その高さの上側凸包のうち、重心（中央）をまたぐ辺に薪が乗る
 *    → 床に寝る／別の薪へ立てかかる／2本に橋渡しされる、が自然に決まる
 * 3. 丸い薪の上に平行に乗った場合など、横へ転がる方向へ少し滑らせる
 * 4. 台からはみ出す場合は内側へ寄せる
 */
import { BALANCE, PieceKind, isLog } from '../balance';
import { Piece, Pose, Support, Vec3, axisDir, pieceEnds } from './model';

export interface PlacementInput {
  kind: PieceKind;
  length: number;
  radius: number;
  x: number;
  z: number;
  yaw: number;
}

export interface PlacementResult {
  pose: Pose;
  supports: Support[];
  valid: boolean;
  reason: string | null;
  /** 床にべったり寝ているか */
  onFloor: boolean;
  /** 重い薪が火口を押しつぶすか（火口のid） */
  compressesTinder: number | null;
  /** 置き位置を台の内側へ寄せたか */
  clamped: boolean;
}

const T = BALANCE.tray;
const SAMPLES = 15;

function tinderTop(k: Piece, px: number, pz: number): number {
  const d = Math.hypot(px - k.pose.x, pz - k.pose.z);
  const r = k.radius;
  if (d >= r) return -Infinity;
  const h = BALANCE.pieces.tinder.height;
  // 木毛は柔らかいので少し沈む
  return T.floorY + h * 0.72 * Math.sqrt(Math.max(0, 1 - (d / r) * (d / r)));
}

/** 他の薪kに、半径rMeの薪の軸が点(px,pz)で触れるときの軸の高さ。触れなければ-Infinity */
function axisHeightOver(k: Piece, px: number, pz: number, rMe: number): number {
  if (k.kind === 'tinder') {
    const top = tinderTop(k, px, pz);
    return top === -Infinity ? -Infinity : top + rMe;
  }
  const [A, B] = pieceEnds(k);
  const abx = B[0] - A[0];
  const abz = B[2] - A[2];
  const len2 = abx * abx + abz * abz;
  let t = len2 > 1e-9 ? ((px - A[0]) * abx + (pz - A[2]) * abz) / len2 : 0.5;
  t = Math.min(1, Math.max(0, t));
  const qx = A[0] + abx * t;
  const qy = A[1] + (B[1] - A[1]) * t;
  const qz = A[2] + abz * t;
  const w = Math.hypot(px - qx, pz - qz);
  const R = rMe + k.radius;
  if (w >= R) return -Infinity;
  return qy + Math.sqrt(R * R - w * w);
}

/** 薪kの下面の高さ（火口がすき間へ潜り込めるかの判定用） */
function undersideOver(k: Piece, px: number, pz: number, reach: number): number {
  if (k.kind === 'tinder') return tinderTop(k, px, pz) === -Infinity ? Infinity : T.floorY;
  const [A, B] = pieceEnds(k);
  const abx = B[0] - A[0];
  const abz = B[2] - A[2];
  const len2 = abx * abx + abz * abz;
  let t = len2 > 1e-9 ? ((px - A[0]) * abx + (pz - A[2]) * abz) / len2 : 0.5;
  t = Math.min(1, Math.max(0, t));
  const qx = A[0] + abx * t;
  const qy = A[1] + (B[1] - A[1]) * t;
  const qz = A[2] + abz * t;
  const w = Math.hypot(px - qx, pz - qz);
  if (w >= k.radius + reach) return Infinity;
  return qy - k.radius;
}

interface Sample {
  s: number;
  h: number;
  by: number | 'floor';
  x: number;
  z: number;
}

function upperHull(pts: Sample[]): Sample[] {
  const hull: Sample[] = [];
  for (const p of pts) {
    while (hull.length >= 2) {
      const a = hull[hull.length - 2];
      const b = hull[hull.length - 1];
      // bがaとpを結ぶ線より下なら除く（上側凸包）
      const cross = (b.s - a.s) * (p.h - a.h) - (b.h - a.h) * (p.s - a.s);
      if (cross >= 0) hull.pop();
      else break;
    }
    hull.push(p);
  }
  return hull;
}

interface Rest {
  y: number;
  pitch: number;
  supports: Support[];
  onFloor: boolean;
  compresses: number | null;
}

function restLine(input: PlacementInput, cx: number, cz: number, others: Piece[]): Rest {
  const r = input.radius;
  const dirx = Math.cos(input.yaw);
  const dirz = -Math.sin(input.yaw);
  const pts: Sample[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const s = -input.length / 2 + (input.length * i) / (SAMPLES - 1);
    const x = cx + dirx * s;
    const z = cz + dirz * s;
    let h = T.floorY + r;
    let by: number | 'floor' = 'floor';
    for (const k of others) {
      const hk = axisHeightOver(k, x, z, r);
      if (hk > h) {
        h = hk;
        by = k.id;
      }
    }
    pts.push({ s, h, by, x, z });
  }
  const hull = upperHull(pts);
  let j = 0;
  while (j < hull.length - 2 && hull[j + 1].s < 0) j++;
  let a = hull[j];
  let b = hull[Math.min(j + 1, hull.length - 1)];
  if (a === b) b = a;
  const slope = b.s !== a.s ? (b.h - a.h) / (b.s - a.s) : 0;
  const y0 = a.h + slope * (0 - a.s);
  // 線に接している標本点＝支持点
  const supports: Support[] = [];
  let compresses: number | null = null;
  let floorContacts = 0;
  for (const p of pts) {
    const ly = y0 + slope * p.s;
    if (Math.abs(ly - p.h) < 0.0015) {
      const contactY = p.h - r;
      if (p.by === 'floor') floorContacts++;
      const prev = supports[supports.length - 1];
      if (!prev || prev.by !== p.by || Math.hypot(prev.point[0] - p.x, prev.point[2] - p.z) > 0.05) {
        supports.push({ point: [p.x, contactY, p.z], by: p.by });
      }
      if (p.by !== 'floor') {
        const k = others.find((o) => o.id === p.by);
        if (k && k.kind === 'tinder' && isLog(input.kind)) compresses = k.id;
      }
    }
  }
  return {
    y: y0,
    pitch: Math.atan(slope),
    supports,
    onFloor: floorContacts >= 3 && Math.abs(slope) < 0.01,
    compresses,
  };
}

function tinderRest(input: PlacementInput, cx: number, cz: number, others: Piece[]): { ok: boolean; y: number } {
  const h = BALANCE.pieces.tinder.height;
  // 木毛は少し押し込める
  const clearance = T.floorY + h * 0.85;
  const probe: [number, number][] = [[0, 0]];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    probe.push([Math.cos(a) * input.radius * 0.8, Math.sin(a) * input.radius * 0.8]);
  }
  for (const k of others) {
    for (const [dx, dz] of probe) {
      const u = undersideOver(k, cx + dx, cz + dz, 0.0);
      if (u < clearance) return { ok: false, y: T.floorY + h / 2 };
    }
  }
  return { ok: true, y: T.floorY + h / 2 };
}

function boundsViolation(input: PlacementInput, pose: Pose): [number, number] {
  const lim = T.innerHalf - input.radius - 0.004;
  if (input.kind === 'tinder') {
    const l2 = T.innerHalf - input.radius - 0.004;
    const vx = Math.abs(pose.x) > l2 ? Math.sign(pose.x) * (Math.abs(pose.x) - l2) : 0;
    const vz = Math.abs(pose.z) > l2 ? Math.sign(pose.z) * (Math.abs(pose.z) - l2) : 0;
    return [vx, vz];
  }
  const [A, B] = pieceEnds({ pose, length: input.length });
  let vx = 0;
  let vz = 0;
  for (const p of [A, B]) {
    if (Math.abs(p[0]) > lim) {
      const v = Math.sign(p[0]) * (Math.abs(p[0]) - lim);
      if (Math.abs(v) > Math.abs(vx)) vx = v;
    }
    if (Math.abs(p[2]) > lim) {
      const v = Math.sign(p[2]) * (Math.abs(p[2]) - lim);
      if (Math.abs(v) > Math.abs(vz)) vz = v;
    }
  }
  return [vx, vz];
}

/** 置ける場所の計算。othersには置こうとしている薪自身を含めない */
export function computePlacement(input: PlacementInput, others: Piece[]): PlacementResult {
  const active = others.filter((o) => !o.held && o.state !== 'ash');
  let cx = input.x;
  let cz = input.z;
  let clamped = false;

  if (input.kind === 'tinder') {
    for (let it = 0; it < 3; it++) {
      const [vx, vz] = boundsViolation(input, { x: cx, y: 0, z: cz, yaw: input.yaw, pitch: 0, roll: 0 });
      if (vx === 0 && vz === 0) break;
      cx -= vx;
      cz -= vz;
      clamped = true;
    }
    const t = tinderRest(input, cx, cz, active);
    const pose: Pose = { x: cx, y: t.y, z: cz, yaw: input.yaw, pitch: 0, roll: 0 };
    return {
      pose,
      supports: [{ point: [cx, T.floorY, cz], by: 'floor' }],
      valid: t.ok,
      reason: t.ok ? null : 'ここは重なっています。すき間か、空いた場所へ。',
      onFloor: true,
      compressesTinder: null,
      clamped,
    };
  }

  const px = -Math.sin(input.yaw); // 軸に垂直な水平方向
  const pz = -Math.cos(input.yaw);
  let rest = restLine(input, cx, cz, active);

  // 横へ転がる：ほぼ平行な丸い薪の上に乗ったときだけ、中心が下がる方向へ滑らせる
  // （交差して乗っている場合は摩擦で止まるものとして動かさない）
  const parallelSupport = (r: Rest) =>
    r.supports.some((s) => {
      if (s.by === 'floor') return false;
      const k = active.find((o) => o.id === s.by);
      if (!k || k.kind === 'tinder') return false;
      return Math.abs(Math.cos(k.pose.yaw - input.yaw)) > 0.8;
    });
  if (parallelSupport(rest)) {
    const step = 0.004;
    for (let i = 0; i < 40; i++) {
      const l = restLine(input, cx + px * step, cz + pz * step, active);
      const rr = restLine(input, cx - px * step, cz - pz * step, active);
      const dl = rest.y - l.y;
      const dr = rest.y - rr.y;
      const best = Math.max(dl, dr);
      if (best < 1e-5) break;
      if (dl >= dr) {
        cx += px * step;
        cz += pz * step;
        rest = l;
      } else {
        cx -= px * step;
        cz -= pz * step;
        rest = rr;
      }
    }
  }

  for (let it = 0; it < 4; it++) {
    const pose: Pose = { x: cx, y: rest.y, z: cz, yaw: input.yaw, pitch: rest.pitch, roll: 0 };
    const [vx, vz] = boundsViolation(input, pose);
    if (vx === 0 && vz === 0) break;
    cx -= vx;
    cz -= vz;
    clamped = true;
    rest = restLine(input, cx, cz, active);
  }

  const pose: Pose = { x: cx, y: rest.y, z: cz, yaw: input.yaw, pitch: rest.pitch, roll: 0 };
  let valid = true;
  let reason: string | null = null;
  const [vx, vz] = boundsViolation(input, pose);
  const d = axisDir(pose);
  const topY = Math.max(pose.y + d[1] * input.length * 0.5, pose.y - d[1] * input.length * 0.5) + input.radius;
  if (vx !== 0 || vz !== 0) {
    valid = false;
    reason = '台からはみ出します。向きを変えてみよう。';
  } else if (Math.abs(rest.pitch) > 0.8) {
    valid = false;
    reason = 'ここは傾きすぎて、薪が滑ります。';
  } else if (topY > T.floorY + T.maxStackHeight) {
    valid = false;
    reason = '高く積みすぎです。';
  }
  return {
    pose,
    supports: rest.supports,
    valid,
    reason,
    onFloor: rest.onFloor,
    compressesTinder: rest.compresses,
    clamped,
  };
}

/**
 * 薪を取り除いたり動かしたあと、上に乗っていた薪を落ち着かせる。
 * 低いものから順に、同じ水平位置・向きで置き直す。
 */
export function resettle(pieces: Piece[], lengthOf: (p: Piece) => number = (p) => p.length): Map<number, PlacementResult> {
  const out = new Map<number, PlacementResult>();
  const order = pieces.filter((p) => !p.held).sort((a, b) => a.pose.y - b.pose.y);
  const settled: Piece[] = [];
  for (const p of order) {
    const res = computePlacement(
      { kind: p.kind, length: lengthOf(p), radius: p.radius, x: p.pose.x, z: p.pose.z, yaw: p.pose.yaw },
      settled,
    );
    out.set(p.id, res);
    settled.push({ ...p, pose: res.pose });
  }
  return out;
}

/** 表示用：支持点の数とすき間の目安 */
export function describeSupports(res: PlacementResult): string {
  const n = res.supports.length;
  if (res.onFloor) return '床に寝かせる';
  const onWood = res.supports.filter((s) => s.by !== 'floor').length;
  if (onWood >= 2) return '2点で橋渡し';
  if (onWood === 1 && n >= 2) return '立てかける';
  return `支え ${n}点`;
}

export function vecDistXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}
