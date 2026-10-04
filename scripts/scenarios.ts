/**
 * 燃焼モデルの因果を数値で確認するシナリオ。
 *   npx tsx scripts/scenarios.ts [name]
 */
import { BALANCE } from '../src/game/balance';
import { placeStep } from '../src/game/fire/builder';
import { LAYOUTS, LayoutId, LayoutStep } from '../src/game/fire/layouts';
import { pieceLabel } from '../src/game/fire/model';
import { FireSim } from '../src/game/fire/sim';

interface Scenario {
  name: string;
  steps: LayoutStep[];
  ignite: boolean;
  seconds: number;
  gusts?: Array<{ at: number; level: number; from?: 'left' | 'front' | 'right' }>;
  /** 火吹き筒：at 秒に (x,z) へひと吹き */
  blows?: Array<{ at: number; level: number; x: number; z: number }>;
}

function layout(id: LayoutId): LayoutStep[] {
  return LAYOUTS[id].steps;
}

export const SCENARIOS: Scenario[] = [
  { name: 'yuttari', steps: layout('yuttari'), ignite: true, seconds: 240 },
  { name: 'igeta', steps: layout('igeta'), ignite: true, seconds: 240 },
  { name: 'tatekake', steps: layout('tatekake'), ignite: true, seconds: 240 },
  { name: 'yose', steps: layout('yose'), ignite: true, seconds: 240 },
  { name: 'tinder-only', steps: [{ kind: 'tinder', x: 0, z: 0, yawDeg: 0 }], ignite: true, seconds: 60 },
  {
    name: 'tinder+medium-no-kindling',
    steps: [
      { kind: 'medium', x: 0, z: -0.09, yawDeg: 0 },
      { kind: 'medium', x: 0, z: 0.09, yawDeg: 0 },
      { kind: 'tinder', x: 0, z: 0, yawDeg: 0 },
    ],
    ignite: true,
    seconds: 120,
  },
  {
    name: 'kindling-far',
    steps: [
      { kind: 'tinder', x: -0.15, z: 0, yawDeg: 0 },
      { kind: 'kindling', x: 0.12, z: 0, yawDeg: 90 },
      { kind: 'kindling', x: 0.16, z: 0, yawDeg: 90 },
      { kind: 'medium', x: 0.1, z: 0.0, yawDeg: 0 },
    ],
    ignite: true,
    seconds: 90,
  },
  {
    name: 'medium-only',
    steps: [
      { kind: 'medium', x: 0, z: -0.05, yawDeg: 0 },
      { kind: 'medium', x: 0, z: 0.05, yawDeg: 0 },
    ],
    ignite: true,
    seconds: 30,
  },
  {
    name: 'flat-crowded',
    steps: [
      { kind: 'tinder', x: 0, z: 0, yawDeg: 0 },
      { kind: 'kindling', x: 0, z: 0.07, yawDeg: 0 },
      { kind: 'kindling', x: 0, z: -0.07, yawDeg: 0 },
      { kind: 'medium', x: 0, z: 0.0, yawDeg: 0 },
      { kind: 'medium', x: 0, z: 0.12, yawDeg: 0 },
      { kind: 'medium', x: 0, z: -0.12, yawDeg: 0 },
    ],
    ignite: true,
    seconds: 180,
  },
  {
    name: 'flat-crowded+wind-mid',
    steps: [
      { kind: 'tinder', x: 0, z: 0, yawDeg: 0 },
      { kind: 'kindling', x: 0, z: 0.07, yawDeg: 0 },
      { kind: 'kindling', x: 0, z: -0.07, yawDeg: 0 },
      { kind: 'medium', x: 0, z: 0.0, yawDeg: 0 },
      { kind: 'medium', x: 0, z: 0.12, yawDeg: 0 },
      { kind: 'medium', x: 0, z: -0.12, yawDeg: 0 },
    ],
    ignite: true,
    seconds: 180,
    gusts: Array.from({ length: 30 }, (_, i) => ({ at: 6 + i * 3.4, level: 1 })),
  },
  {
    name: 'yuttari+wind-strong-early',
    steps: layout('yuttari'),
    ignite: true,
    seconds: 150,
    gusts: Array.from({ length: 8 }, (_, i) => ({ at: 1 + i * 3.4, level: 2 })),
  },
  {
    name: 'yuttari+wind-mid',
    steps: layout('yuttari'),
    ignite: true,
    seconds: 150,
    gusts: Array.from({ length: 12 }, (_, i) => ({ at: 10 + i * 3.4, level: 1 })),
  },
  {
    name: 'offset-kindling-no-wind',
    steps: [
      { kind: 'medium', x: 0, z: -0.09, yawDeg: 0 },
      { kind: 'medium', x: 0, z: 0.09, yawDeg: 0 },
      { kind: 'tinder', x: -0.02, z: 0, yawDeg: 0 },
      { kind: 'kindling', x: 0.055, z: 0, yawDeg: 90 },
      { kind: 'kindling', x: 0.085, z: 0, yawDeg: 90 },
    ],
    ignite: true,
    seconds: 90,
  },
  {
    name: 'offset-kindling-wind-left-mid',
    steps: [
      { kind: 'medium', x: 0, z: -0.09, yawDeg: 0 },
      { kind: 'medium', x: 0, z: 0.09, yawDeg: 0 },
      { kind: 'tinder', x: -0.02, z: 0, yawDeg: 0 },
      { kind: 'kindling', x: 0.055, z: 0, yawDeg: 90 },
      { kind: 'kindling', x: 0.085, z: 0, yawDeg: 90 },
    ],
    ignite: true,
    seconds: 90,
    gusts: Array.from({ length: 6 }, (_, i) => ({ at: 2 + i * 3.4, level: 1, from: 'left' as const })),
  },
  {
    name: 'offset-kindling-wind-right-mid',
    steps: [
      { kind: 'medium', x: 0, z: -0.09, yawDeg: 0 },
      { kind: 'medium', x: 0, z: 0.09, yawDeg: 0 },
      { kind: 'tinder', x: -0.02, z: 0, yawDeg: 0 },
      { kind: 'kindling', x: 0.055, z: 0, yawDeg: 90 },
      { kind: 'kindling', x: 0.085, z: 0, yawDeg: 90 },
    ],
    ignite: true,
    seconds: 90,
    gusts: Array.from({ length: 6 }, (_, i) => ({ at: 2 + i * 3.4, level: 1, from: 'right' as const })),
  },
  {
    name: 'single-medium-over-tinder-kindling',
    steps: [
      { kind: 'tinder', x: 0, z: 0, yawDeg: 0 },
      { kind: 'kindling', x: 0, z: 0, yawDeg: 30 },
      { kind: 'kindling', x: 0, z: 0, yawDeg: 150 },
      { kind: 'medium', x: 0, z: 0, yawDeg: 0 },
    ],
    ignite: true,
    seconds: 300,
  },
];

export interface RunResult {
  name: string;
  placed: number;
  rejected: string[];
  ignitedTinder: number | null;
  firstKindling: number | null;
  firstMedium: number | null;
  stage0: number | null;
  mediumsLit: number;
  kindlingLit: number;
  maxHeat: number;
  maxSmoke: number;
  outAt: number | null;
  timeline: string[];
  samples: string[];
  sim: FireSim;
}

export function runScenario(sc: Scenario, seed = 12345, verbose = false): RunResult {
  const sim = new FireSim(seed);
  const rejected: string[] = [];
  let placed = 0;
  for (const st of sc.steps) {
    const r = placeStep(sim, st);
    if (r.piece) placed++;
    else rejected.push(`${st.kind}@${st.x},${st.z}: ${r.reason}`);
  }
  let t0: number | null = null;
  if (sc.ignite) {
    sim.startLighter();
    t0 = sim.time;
  }
  const res: RunResult = {
    name: sc.name,
    placed,
    rejected,
    ignitedTinder: null,
    firstKindling: null,
    firstMedium: null,
    stage0: null,
    mediumsLit: 0,
    kindlingLit: 0,
    maxHeat: 0,
    maxSmoke: 0,
    outAt: null,
    timeline: [],
    samples: [],
    sim,
  };
  const steps = Math.round(sc.seconds * BALANCE.sim.hz);
  const gusts = (sc.gusts ?? []).slice();
  const blows = (sc.blows ?? []).slice();
  for (let i = 0; i < steps; i++) {
    const tNow = sim.time - (t0 ?? 0);
    while (gusts.length && gusts[0].at <= tNow) {
      const g = gusts.shift()!;
      sim.gust(g.level, g.from ?? 'front');
    }
    while (blows.length && blows[0].at <= tNow) {
      const b = blows.shift()!;
      sim.blow(b.x, b.z, b.level);
    }
    sim.step();
    const rel = sim.time - (t0 ?? 0);
    for (const e of sim.drainEvents()) {
      if (e.type === 'ignite' && res.ignitedTinder === null) res.ignitedTinder = rel;
      if (e.type === 'spread' && e.kind === 'kindling' && res.firstKindling === null) res.firstKindling = rel;
      if (e.type === 'spread' && e.kind === 'medium' && res.firstMedium === null) res.firstMedium = rel;
      if (e.type === 'stage0') res.stage0 = rel;
      if (e.type === 'allOut' && res.outAt === null) res.outAt = rel;
    }
    res.maxHeat = Math.max(res.maxHeat, sim.metrics.heat);
    res.maxSmoke = Math.max(res.maxSmoke, sim.metrics.smoke);
    if (verbose && (i < 900 ? i % 30 === 29 : i % 100 === 99)) {
      const m = sim.metrics;
      res.samples.push(
        `t=${rel.toFixed(0).padStart(3)} heat=${m.heat.toFixed(0).padStart(3)} O2=${m.oxygen.toFixed(0).padStart(3)} smoke=${m.smoke.toFixed(0).padStart(3)} fl=${m.flamingSegs} em=${m.emberSegs} ` +
          sim.pieces.map((p) => `${pieceLabel(p).slice(0, 3)}:${p.state[0]}${(Math.max(...p.segs.map((s) => s.T))).toFixed(2)}/${Math.max(...p.segs.map((s) => s.air)).toFixed(2)}`).join(' '),
      );
    }
  }
  res.mediumsLit = sim.pieces.filter((p) => p.kind === 'medium' && p.firstLitAt !== null).length;
  res.kindlingLit = sim.pieces.filter((p) => p.kind === 'kindling' && p.firstLitAt !== null).length;
  res.timeline = sim.timeline.map((e) => `${e.t.toFixed(1).padStart(6)}s ${e.text}`);
  return res;
}

const isMain = process.argv[1] && process.argv[1].endsWith('scenarios.ts');
if (isMain) {
  const only = process.argv[2];
  const verbose = process.argv.includes('-v');
  for (const sc of SCENARIOS) {
    if (only && only !== '-v' && sc.name !== only) continue;
    const r = runScenario(sc, 12345, verbose);
    const f = (x: number | null) => (x === null ? '  -  ' : x.toFixed(1).padStart(5));
    console.log(
      `${sc.name.padEnd(36)} placed=${r.placed} tinder=${f(r.ignitedTinder)} kind=${f(r.firstKindling)} med=${f(r.firstMedium)} stage0=${f(r.stage0)} mLit=${r.mediumsLit} kLit=${r.kindlingLit} maxHeat=${r.maxHeat.toFixed(0)} maxSmoke=${r.maxSmoke.toFixed(0)} out=${f(r.outAt)}`,
    );
    if (r.rejected.length) console.log('   rejected:', r.rejected.join(' | '));
    if (verbose) {
      for (const p of r.sim.pieces) {
        console.log(`   ${pieceLabel(p)} pose y=${p.pose.y.toFixed(3)} pitch=${((p.pose.pitch * 180) / Math.PI).toFixed(1)} supports=${p.supports.map((s) => s.by).join(',')} comp=${p.compressed}`);
      }
      r.timeline.forEach((l) => console.log('   ', l));
      r.samples.forEach((l) => console.log('   ', l));
    }
  }
}
