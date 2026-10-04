import { BALANCE, DEFAULT_SPECIES, PieceKind, WOODS, WoodId, isLog } from '../balance';

export type Vec3 = [number, number, number];

/** 薪の姿勢。軸はローカル+X。yaw→pitch（持ち上げ）→roll（軸回り）の順に回す */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
}

export type BurnState = 'raw' | 'warming' | 'flaming' | 'ember' | 'ash';

export const BURN_STATE_LABEL: Record<BurnState, string> = {
  raw: 'まだ木の色',
  warming: '温まっている',
  flaming: '燃えている',
  ember: '赤く熾っている',
  ash: '灰になった',
};

/** 1区間（薪の長さ方向を等分した一部）の燃焼状態 */
export interface Segment {
  /** 温まり具合。0=周囲温度、1=着火点 */
  T: number;
  /** 湿り 0..1 */
  m: number;
  /** 残り燃料 */
  f: number;
  f0: number;
  /** 炎の強さ 0..1 */
  I: number;
  /** 焦げ 0..1（戻らない） */
  c: number;
  /** 赤熱 0..1 */
  g: number;
  /** 灰 0..1 */
  ash: number;
  /** 局所の空気 0..1.5 */
  air: number;
  /** この区間から出る煙量 */
  smoke: number;
  /** 一度でも炎が出たか */
  lit: boolean;
}

export interface Support {
  point: Vec3;
  /** 支えている薪のid、または床 */
  by: number | 'floor';
}

export interface Piece {
  id: number;
  kind: PieceKind;
  species: WoodId;
  /** 種類ごとの通し番号（細薪①など） */
  ordinal: number;
  length: number;
  radius: number;
  pose: Pose;
  segs: Segment[];
  state: BurnState;
  supports: Support[];
  /** 火口の上に重い薪が乗っているか（空気が減る） */
  compressed: boolean;
  /** 火ばさみで持ち上げ中 */
  held: boolean;
  /** 熱が来た方向（ローカル座標、焦げの広がり用） */
  heatDir: Vec3;
  firstLitAt: number | null;
  /** 描画用の形状seed */
  shapeSeed: number;
  /** 以下は計算用キャッシュ */
  segPos: Vec3[];
  crowd: number[];
  floorPen: number[];
  lifted: boolean[];
}

export function axisDir(p: Pose): Vec3 {
  const cp = Math.cos(p.pitch);
  return [cp * Math.cos(p.yaw), Math.sin(p.pitch), -cp * Math.sin(p.yaw)];
}

export function pieceEnds(piece: Pick<Piece, 'pose' | 'length'>): [Vec3, Vec3] {
  const d = axisDir(piece.pose);
  const h = piece.length / 2;
  const { x, y, z } = piece.pose;
  return [
    [x - d[0] * h, y - d[1] * h, z - d[2] * h],
    [x + d[0] * h, y + d[1] * h, z + d[2] * h],
  ];
}

/** 区間中心の位置（ワールド） */
export function computeSegPositions(piece: Piece): Vec3[] {
  const n = piece.segs.length;
  if (piece.kind === 'tinder') return [[piece.pose.x, piece.pose.y, piece.pose.z]];
  const d = axisDir(piece.pose);
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const s = -piece.length / 2 + ((i + 0.5) * piece.length) / n;
    out.push([piece.pose.x + d[0] * s, piece.pose.y + d[1] * s, piece.pose.z + d[2] * s]);
  }
  return out;
}

export function pieceDims(kind: PieceKind, rand01: number): { length: number; radius: number } {
  const P = BALANCE.pieces;
  if (kind === 'tinder') return { length: P.tinder.radius * 2, radius: P.tinder.radius };
  if (kind === 'kindling') return { length: P.kindling.length * (0.94 + 0.12 * rand01), radius: P.kindling.radius };
  const L = kind === 'large' ? P.large : P.medium;
  return {
    length: L.lengthMin + (L.lengthMax - L.lengthMin) * rand01,
    radius: L.radius * (0.93 + 0.14 * ((rand01 * 7.31) % 1)),
  };
}

export function createPiece(
  id: number,
  kind: PieceKind,
  ordinal: number,
  pose: Pose,
  dims: { length: number; radius: number },
  shapeSeed: number,
  species: WoodId = DEFAULT_SPECIES[kind],
): Piece {
  const spec = BALANCE.pieces[kind];
  const wood = WOODS[species];
  const n = spec.segments;
  const fuelPerSeg = (spec.fuel * (isLog(kind) ? wood.fuelScale ?? 1 : 1)) / n;
  const moisture = kind === 'tinder' ? 0.05 : wood.moisture;
  const segs: Segment[] = [];
  for (let i = 0; i < n; i++) {
    segs.push({ T: 0, m: moisture, f: fuelPerSeg, f0: fuelPerSeg, I: 0, c: 0, g: 0, ash: 0, air: 1, smoke: 0, lit: false });
  }
  const piece: Piece = {
    id,
    kind,
    species,
    ordinal,
    length: dims.length,
    radius: dims.radius,
    pose: { ...pose },
    segs,
    state: 'raw',
    supports: [],
    compressed: false,
    held: false,
    heatDir: [0, -1, 0],
    firstLitAt: null,
    shapeSeed,
    segPos: [],
    crowd: new Array(n).fill(0),
    floorPen: new Array(n).fill(0),
    lifted: new Array(n).fill(false),
  };
  piece.segPos = computeSegPositions(piece);
  return piece;
}

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

export function pieceLabel(p: Pick<Piece, 'kind' | 'ordinal' | 'species'>): string {
  const base = BALANCE.pieces[p.kind].label;
  if (p.kind === 'tinder') return base;
  const num = CIRCLED[p.ordinal - 1] ?? String(p.ordinal);
  return isLog(p.kind) ? `${base}${num}（${WOODS[p.species].label}）` : `${base}${num}`;
}

/** 区間の状態から薪全体の状態を決める */
export function derivePieceState(piece: Piece): BurnState {
  let anyFlame = false;
  let anyEmber = false;
  let warm = false;
  let fuel = 0;
  let fuel0 = 0;
  for (const s of piece.segs) {
    if (s.I > 0.05) anyFlame = true;
    if (s.g > 0.12) anyEmber = true;
    if (s.T > 0.25) warm = true;
    fuel += s.f;
    fuel0 += s.f0;
  }
  if (anyFlame) return 'flaming';
  if (anyEmber) return 'ember';
  if (fuel < fuel0 * BALANCE.burn.ashFuelRatio * 2 || piece.segs.every((s) => s.ash > 0.85)) return 'ash';
  if (warm) return 'warming';
  return 'raw';
}

export function dist3(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
