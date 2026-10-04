/**
 * 風：周囲のそよ風（seed付き）＋プレイヤーの送風。
 * 見た目（炎の傾き）はすぐ反応し、火力（シミュレーション）へは遅れて効く。
 */
import { BALANCE } from '../balance';
import { Rng } from '../rng';

const W = BALANCE.wind;

export type WindFrom = 'left' | 'front' | 'right';

export const WIND_FROM_LABEL: Record<WindFrom, string> = { left: '左から', front: '手前から', right: '右から' };

/** 風が吹いていく向き（xz単位ベクトル） */
export function windVector(from: WindFrom): [number, number] {
  if (from === 'left') return [1, -0.25];
  if (from === 'right') return [-1, -0.25];
  return [0, -1];
}

export interface WindSnapshot {
  /** シミュレーションが使う実効の風（遅れと平滑あり） */
  phys: [number, number];
  physStrength: number;
  /** 見た目の目標（即時） */
  target: [number, number];
  gustActive: boolean;
  gustLevel: number;
}

export interface WindState {
  ambientAngle: number;
  ambientStrength: number;
  ambientTargetAngle: number;
  ambientTargetStrength: number;
  ambientTimer: number;
  gustT: number; // 送風開始からの時間（-1で無効）
  gustLevel: number;
  gustDir: [number, number];
  lastGustAt: number;
  delayLine: [number, number][];
  phys: [number, number];
}

export function createWindState(rng: Rng): WindState {
  const a = rng.range(0, Math.PI * 2);
  const s = rng.range(W.ambientMin, W.ambientMax);
  const delay = Math.round(W.physicalDelay * BALANCE.sim.hz);
  return {
    ambientAngle: a,
    ambientStrength: s,
    ambientTargetAngle: a,
    ambientTargetStrength: s,
    ambientTimer: W.ambientChangeSeconds,
    gustT: -1,
    gustLevel: 0,
    gustDir: [0, -1],
    lastGustAt: -999,
    delayLine: new Array(delay).fill([0, 0]).map(() => [0, 0] as [number, number]),
    phys: [0, 0],
  };
}

export function gustEnvelope(t: number): number {
  if (t < 0) return 0;
  if (t < W.gustAttack) return t / W.gustAttack;
  if (t < W.gustAttack + W.gustHold) return 1;
  const r = t - W.gustAttack - W.gustHold;
  if (r < W.gustRelease) return 1 - r / W.gustRelease;
  return 0;
}

export const GUST_DURATION = W.gustAttack + W.gustHold + W.gustRelease;

/** 送風を受け付けるか。短い間隔の連打は無視する（強まらない） */
export function requestGust(ws: WindState, time: number, level: number, from: WindFrom): boolean {
  if (time - ws.lastGustAt < W.minInterval) return false;
  const running = ws.gustT >= 0 && ws.gustT < GUST_DURATION;
  ws.lastGustAt = time;
  ws.gustLevel = W.levels[Math.max(0, Math.min(2, level))];
  ws.gustDir = windVector(from);
  // 途中で押しても強さは積み上げず、保持区間へ戻すだけ
  ws.gustT = running ? Math.min(ws.gustT, W.gustAttack) : 0;
  return true;
}

/** 目標の風（即時）。見た目にも使う */
export function windTarget(ws: WindState): [number, number] {
  const ax = Math.cos(ws.ambientAngle) * ws.ambientStrength;
  const az = Math.sin(ws.ambientAngle) * ws.ambientStrength;
  const g = gustEnvelope(ws.gustT) * ws.gustLevel;
  return [ax + ws.gustDir[0] * g, az + ws.gustDir[1] * g];
}

export function stepWind(ws: WindState, dt: number, rng: Rng): void {
  ws.ambientTimer -= dt;
  if (ws.ambientTimer <= 0) {
    ws.ambientTimer = W.ambientChangeSeconds * rng.range(0.7, 1.4);
    ws.ambientTargetAngle = ws.ambientAngle + rng.range(-0.9, 0.9);
    ws.ambientTargetStrength = rng.range(W.ambientMin, W.ambientMax);
  }
  const k = 1 - Math.exp(-dt / 3);
  ws.ambientAngle += (ws.ambientTargetAngle - ws.ambientAngle) * k;
  ws.ambientStrength += (ws.ambientTargetStrength - ws.ambientStrength) * k;
  if (ws.gustT >= 0) {
    ws.gustT += dt;
    if (ws.gustT > GUST_DURATION) ws.gustT = -1;
  }
  // 遅延線：数ステップ前の目標をシミュレーションへ
  const target = windTarget(ws);
  ws.delayLine.push(target);
  const delayed = ws.delayLine.shift() ?? target;
  const kp = 1 - Math.exp(-dt / W.physicalTau);
  ws.phys = [ws.phys[0] + (delayed[0] - ws.phys[0]) * kp, ws.phys[1] + (delayed[1] - ws.phys[1]) * kp];
}

export function windSnapshot(ws: WindState): WindSnapshot {
  return {
    phys: ws.phys,
    physStrength: Math.hypot(ws.phys[0], ws.phys[1]),
    target: windTarget(ws),
    gustActive: ws.gustT >= 0,
    gustLevel: ws.gustLevel,
  };
}
