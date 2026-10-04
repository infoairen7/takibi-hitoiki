/** 薪を置く共通処理（ゲーム・テスト・シナリオで同じ手順を使う） */
import { BALANCE, DEFAULT_SPECIES, PieceKind, WoodId } from '../balance';
import { hash32 } from '../rng';
import { LayoutStep } from './layouts';
import { Piece, pieceDims } from './model';
import { PlacementResult, computePlacement } from './placement';
import { FireSim } from './sim';

export interface PendingPiece {
  kind: PieceKind;
  species: WoodId;
  shapeSeed: number;
  length: number;
  radius: number;
}

/** 次に置く薪の形（seedから決定的に決める） */
export function nextPendingPiece(sim: FireSim, kind: PieceKind, species?: WoodId): PendingPiece {
  const shapeSeed = hash32(`${sim.seed}:${sim.nextId}:${kind}`);
  const dims = pieceDims(kind, (shapeSeed % 10007) / 10007);
  return { kind, species: species ?? DEFAULT_SPECIES[kind], shapeSeed, ...dims };
}

export function previewPlacement(sim: FireSim, pending: PendingPiece, x: number, z: number, yaw: number, excludeId?: number): PlacementResult {
  const others = sim.pieces.filter((p) => p.id !== excludeId);
  return computePlacement({ kind: pending.kind, length: pending.length, radius: pending.radius, x, z, yaw }, others);
}

export function placeAt(sim: FireSim, pending: PendingPiece, x: number, z: number, yaw: number): { piece: Piece | null; placement: PlacementResult; reason: string | null } {
  const can = sim.canAdd(pending.kind);
  const placement = previewPlacement(sim, pending, x, z, yaw);
  if (!can.ok) return { piece: null, placement, reason: can.reason };
  if (!placement.valid) return { piece: null, placement, reason: placement.reason };
  const piece = sim.addPiece(pending.kind, placement, { length: pending.length, radius: pending.radius }, pending.shapeSeed, pending.species);
  return { piece, placement, reason: null };
}

export function placeStep(sim: FireSim, step: LayoutStep, species?: WoodId) {
  const pending = nextPendingPiece(sim, step.kind, species);
  return placeAt(sim, pending, step.x, step.z, (step.yawDeg * Math.PI) / 180);
}

/**
 * 燃えている場所の上へ、置ける位置を探す（人が炎の上へ薪を渡すのに近い）。
 * 候補ごとに「燃えている区間から受ける上昇気流の強さ」をざっくり見積もり、いちばん強い所へ置く。
 */
export function addLogNearFire(sim: FireSim, species?: WoodId, kind: PieceKind = 'medium'): boolean {
  if (!sim.canAdd(kind).ok) return false;
  const pend = nextPendingPiece(sim, kind, species);
  const flames: Array<[number, number, number, number]> = [];
  for (const p of sim.pieces) {
    p.segs.forEach((s, i) => {
      const w = s.I + s.g * 0.4;
      if (w > 0.05) flames.push([p.segPos[i][0], p.segPos[i][1], p.segPos[i][2], w]);
    });
  }
  let best: { x: number; z: number; yaw: number; score: number } | null = null;
  for (let xi = -3; xi <= 3; xi++) {
    for (let zi = -3; zi <= 3; zi++) {
      for (const yaw of [0, Math.PI / 2]) {
        const x = xi * 0.045;
        const z = zi * 0.045;
        const r = previewPlacement(sim, pend, x, z, yaw);
        if (!r.valid || r.compressesTinder !== null) continue;
        const dx = Math.cos(yaw);
        const dz = -Math.sin(yaw);
        let score = 0;
        for (let k = -3; k <= 3; k++) {
          const px = r.pose.x + dx * k * 0.05;
          const pz = r.pose.z + dz * k * 0.05;
          for (const f of flames) {
            const lat = (px - f[0]) ** 2 + (pz - f[2]) ** 2;
            const up = r.pose.y - f[1];
            score += f[3] * Math.exp(-lat / (2 * 0.045 * 0.045)) * (up > -0.01 ? 1 : 0.3);
          }
        }
        // 積みすぎ（高すぎ）は避ける
        score -= Math.max(0, r.pose.y - BALANCE.tray.floorY - 0.12) * 20;
        if (!best || score > best.score) best = { x, z, yaw, score };
      }
    }
  }
  if (!best) return false;
  return placeAt(sim, pend, best.x, best.z, best.yaw).piece !== null;
}

