/**
 * 火吹き筒で狙う場所の候補（キーボード・タップだけでも選べるように）。
 * 薪ごとに、いちばん熱い区間の下。台の底の熾は、いちばん多い所。左から右へ並べる。
 */
import { BALANCE } from '../balance';
import { pieceLabel } from './model';
import { FireSim } from './sim';

export interface TubeSpot {
  x: number;
  z: number;
  label: string;
  /** 熱さの目安（既定の狙いを選ぶ） */
  score: number;
}

export function tubeSpots(sim: FireSim): TubeSpot[] {
  const out: TubeSpot[] = [];
  for (const p of sim.pieces) {
    if (p.state === 'ash' || p.held) continue;
    let bi = 0;
    let best = -1;
    p.segs.forEach((s, i) => {
      const v = s.g + s.I * 0.5 + s.T * 0.2;
      if (v > best) {
        best = v;
        bi = i;
      }
    });
    const pos = p.segPos[bi];
    if (!pos) continue;
    out.push({ x: pos[0], z: pos[2], label: `${pieceLabel(p)}の下`, score: best });
  }
  const nb = BALANCE.bed.cells;
  const cell = (BALANCE.tray.innerHalf * 2) / nb;
  let bc = -1;
  let ci = -1;
  sim.bedCoal.forEach((c, i) => {
    if (c > bc) {
      bc = c;
      ci = i;
    }
  });
  if (ci >= 0 && bc > 0.05) {
    out.push({
      x: -BALANCE.tray.innerHalf + ((ci % nb) + 0.5) * cell,
      z: -BALANCE.tray.innerHalf + (Math.floor(ci / nb) + 0.5) * cell,
      label: '台の底の熾',
      score: bc * BALANCE.bed.power * 2,
    });
  }
  return out.sort((a, b) => a.x - b.x || a.z - b.z);
}

/** 既定の狙い：いちばん熱い所 */
export function defaultTubeSpot(sim: FireSim): TubeSpot | null {
  const spots = tubeSpots(sim);
  if (!spots.length) return null;
  return spots.reduce((a, b) => (b.score > a.score ? b : a));
}
