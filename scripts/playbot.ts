/**
 * 自動プレイ（検証用）。人の操作の代わりに、決まった方針で薪を足し、風を送る。
 * テストとシナリオで「標準の遊び方で一周できるか」「強すぎる火を落ち着かせられるか」などを確かめる。
 *   npx tsx scripts/playbot.ts [policy] [layout] [-v]
 */
import { BALANCE, WoodId } from '../src/game/balance';
import { addLogNearFire, placeStep, previewPlacement } from '../src/game/fire/builder';
import { resettle } from '../src/game/fire/placement';
export { addLogNearFire };
import { LAYOUTS, LayoutId } from '../src/game/fire/layouts';
import { FireSim } from '../src/game/fire/sim';
import { FireSession, SessionEvent, isStable } from '../src/game/session';

/**
 * standard：薪が減ったら足し、空気が足りなければ風を送る
 * gentle：ほどよい火を保つよう、火が小さくなりかけたときだけ一本ずつ足す（眺める時間の多い丁寧な遊び方）
 * watch：何もしない（眺めるだけ）
 * hot：強すぎる火にし続ける（薪を足し、強い風を連打）
 * hotRecover：強すぎる火にした後、強すぎる状態が12秒続いたら手を止めて落ち着かせる
 * smother：風を送らず、薪を詰めて足し続ける（煙がこもる）
 * damp：湿った薪を少しずつ足し、風は送らない（species に しめり木 を渡す）
 * lively：元気な火を保つ（火力70前後を目安に早めに薪を足し、空気が足りなければ風で戻す）。強すぎる火（88超）にはしない
 * dampKeep：湿った中薪の火を、細薪だけでつなぎ続ける（風は送らない。弱い火のまま。species に しめり木 を渡す）
 */
export type Policy = 'standard' | 'gentle' | 'watch' | 'hot' | 'hotRecover' | 'smother' | 'damp' | 'lively' | 'dampKeep' | 'none';

export interface BotOptions {
  policy: Policy;
  layout: LayoutId;
  seed?: number;
  /** ひと息10分（short）／ゆっくり20分（long） */
  mode?: 'short' | 'long';
  seconds?: number;
  /** 「しばらく、火を眺める」を押している割合（0..1） */
  watchShare?: number;
  species?: WoodId[];
  /** 火ばさみで、燃えている薪を少しずつ動かして空気の通り道をつくる（意味のある組み替え）の間隔（秒）。0なら動かさない */
  rearrangeEvery?: number;
  setup?: (sim: FireSim, sess: FireSession) => void;
  onStep?: (sim: FireSim, sess: FireSession, events: SessionEvent[]) => void;
}

export interface BotResult {
  sim: FireSim;
  sess: FireSession;
  events: Array<SessionEvent & { at: number }>;
  stableSeconds: number;
  maxHeat: number;
  maxHotRun: number;
  /** 中薪まで火がつながった時刻（着火からの秒） */
  stage0At: number | null;
  outAt: number | null;
  /** 熾火の案内と熾火の始まり（活動時間の秒） */
  emberNoticeAt: number | null;
  emberAt: number | null;
  rows: string[];
}

export function runBot(opt: BotOptions): BotResult {
  const seed = opt.seed ?? 2024;
  const sim = new FireSim(seed, opt.mode ?? 'short');
  const sess = new FireSession(sim.seed, sim.session.durationSeconds);
  sess.noteLayout(opt.layout);
  opt.setup?.(sim, sess);
  for (const st of LAYOUTS[opt.layout].steps) {
    placeStep(sim, st, st.kind === 'medium' && opt.species ? opt.species[sim.countOf('medium', true) % opt.species.length] : undefined);
    sess.notePlaced(sim, st.kind, sim.pieces[sim.pieces.length - 1]?.species);
  }
  if (opt.policy !== 'none') sim.startLighter();
  const seconds = opt.seconds ?? sim.session.durationSeconds + 20;
  const res: BotResult = {
    sim,
    sess,
    events: [],
    stableSeconds: 0,
    maxHeat: 0,
    maxHotRun: 0,
    stage0At: null,
    outAt: null,
    emberNoticeAt: null,
    emberAt: null,
    rows: [],
  };
  let lastCare = -99;
  let lastGust = -99;
  let lastMove = -99;
  let hotRun = 0;
  let watching = false;
  let hotDone = false;
  const steps = Math.round(seconds * BALANCE.sim.hz);
  for (let i = 0; i < steps; i++) {
    const t = sim.ignitedAt === null ? 0 : sim.time - sim.ignitedAt;
    const m = sim.metrics;
    const live = sim.phase === 'burning' && !sim.session.emberPhase && !sim.session.ended;
    // 眺める：一定の割合で「しばらく、火を眺める」
    const share = opt.watchShare ?? 0;
    const wantWatch = share > 0 && live && (i % 600) / 600 < share;
    if (wantWatch !== watching) {
      watching = wantWatch;
      sess.setWatching(watching);
    }
    if (live && (opt.policy === 'standard' || opt.policy === 'hotRecover')) {
      const mediums = sim.pieces.filter((p) => p.kind === 'medium' && p.state !== 'ash');
      const burning = mediums.filter((p) => p.state === 'flaming').length;
      const lowFuel = m.fuelRatio < 0.3 || (sim.stage0Done && m.heat < 45);
      if (t - lastCare > 6 && lowFuel && burning < 3 && mediums.length < 5 && m.oxygen >= 42) {
        const sp = opt.species ? opt.species[sim.countOf('medium', true) % opt.species.length] : undefined;
        if (addLogNearFire(sim, sp)) {
          sess.noteCare(sim, 'log');
          lastCare = t;
        }
      } else if (t - lastGust > 8 && m.oxygen < 45 && m.flamingSegs > 0) {
        if (sim.gust(1, 'front')) sess.noteCare(sim, 'gust');
        lastGust = t;
      }
    }
    if (live && opt.policy === 'gentle') {
      const mediums = sim.pieces.filter((p) => p.kind === 'medium' && p.state !== 'ash');
      const flaming = mediums.filter((p) => p.state === 'flaming').length;
      if (t - lastCare > 12 && sim.stage0Done && m.heat < 48 && flaming < 3 && mediums.length < 5 && m.oxygen >= 46) {
        const sp = opt.species ? opt.species[sim.countOf('medium', true) % opt.species.length] : undefined;
        if (addLogNearFire(sim, sp)) {
          sess.noteCare(sim, 'log');
          lastCare = t;
        }
      } else if (t - lastGust > 10 && m.oxygen < 46 && m.flamingSegs > 0) {
        if (sim.gust(1, 'front')) sess.noteCare(sim, 'gust');
        lastGust = t;
      }
    }
    if (live && opt.policy === 'lively') {
      const mediums = sim.pieces.filter((p) => p.kind === 'medium' && p.state !== 'ash');
      const flaming = mediums.filter((p) => p.state === 'flaming').length;
      if (t - lastCare > 5 && sim.stage0Done && m.heat < 66 && flaming < 4 && mediums.length < 5 && m.oxygen >= 45) {
        const sp = opt.species ? opt.species[sim.countOf('medium', true) % opt.species.length] : undefined;
        if (addLogNearFire(sim, sp)) {
          sess.noteCare(sim, 'log');
          lastCare = t;
        }
      } else if (t - lastGust > 6 && m.oxygen < 45 && m.heat < 80 && m.flamingSegs > 0) {
        if (sim.gust(1, 'front')) sess.noteCare(sim, 'gust');
        lastGust = t;
      }
    }
    if (live && opt.rearrangeEvery && t > 100 && t - lastMove > opt.rearrangeEvery && isStable(m.heat, m.oxygen, m.smoke)) {
      // 燃えている中薪を一本、外側へ少しずらして空気の通り道をつくる
      nudgeOutward(sim, sess, (q) => q.kind === 'medium' && q.state === 'flaming', [0.04, 0.03, 0.05]);
      lastMove = t;
    }
    if (live && opt.policy === 'smother' && t > 60) {
      // 風は送らず、火のそばへ薪を詰めていく
      const alive = sim.pieces.filter((p) => p.kind === 'medium' && p.state !== 'ash').length;
      if (t - lastCare > 10 && alive < 9) {
        const sp = opt.species ? opt.species[sim.countOf('medium', true) % opt.species.length] : undefined;
        if (addLogNearFire(sim, sp)) {
          sess.noteCare(sim, 'log');
          lastCare = t;
        }
      }
    }
    if (live && opt.policy === 'dampKeep' && t > 30 && t - lastCare > 10 && m.flamingSegs > 0) {
      if (addLogNearFire(sim, undefined, 'kindling')) sess.noteCare(sim, 'log');
      lastCare = t;
    }
    if (live && opt.policy === 'damp' && t > 40) {
      const alive = sim.pieces.filter((p) => p.kind === 'medium' && p.state !== 'ash').length;
      if (t - lastCare > 14 && alive < 6) {
        const sp = opt.species ? opt.species[sim.countOf('medium', true) % opt.species.length] : 'shimerigi';
        if (addLogNearFire(sim, sp)) {
          sess.noteCare(sim, 'log');
          lastCare = t;
        }
      }
    }
    if (opt.policy === 'hotRecover' && res.maxHotRun >= 12) hotDone = true;
    if (live && (opt.policy === 'hot' || (opt.policy === 'hotRecover' && !hotDone))) {
      if (t > 90) {
        if (t - lastCare > 3 && addLogNearFire(sim)) {
          sess.noteCare(sim, 'log');
          lastCare = t;
        }
        if (t - lastGust > 3.2) {
          if (sim.gust(2, 'front')) sess.noteCare(sim, 'gust');
          lastGust = t;
        }
      }
    }
    sim.step();
    const simEvents = sim.drainEvents();
    const ev = sess.step(sim, simEvents);
    for (const e of ev) res.events.push({ ...e, at: t });
    for (const e of simEvents) {
      if (e.type === 'stage0' && res.stage0At === null) res.stage0At = t;
      if (e.type === 'allOut' && res.outAt === null) res.outAt = t;
      if (e.type === 'emberNotice') res.emberNoticeAt = sim.session.activeTime;
      if (e.type === 'emberPhase') res.emberAt = sim.session.activeTime;
    }
    opt.onStep?.(sim, sess, ev);
    res.maxHeat = Math.max(res.maxHeat, m.heat);
    if (m.heat > 88) {
      hotRun += BALANCE.sim.dt;
      res.maxHotRun = Math.max(res.maxHotRun, hotRun);
    } else hotRun = 0;
    if (i % 300 === 299) {
      const mm = sim.metrics;
      res.rows.push(
        `${t.toFixed(0).padStart(4)} h=${mm.heat.toFixed(0).padStart(3)} o=${mm.oxygen.toFixed(0).padStart(3)} s=${mm.smoke.toFixed(0).padStart(3)} fuel=${mm.fuelRatio.toFixed(2)} stable=${sess.stats.stableSeconds.toFixed(0).padStart(4)} n=${sim.pieces.filter((p) => p.state !== 'ash').length}${sim.session.emberPhase ? ' EMB' : ''}${sim.session.ended ? ' END' : ''}`,
      );
    }
    if (sess.ended) break;
  }
  res.stableSeconds = sess.stats.stableSeconds;
  return res;
}

/**
 * 火ばさみで薪を一本、台の外側へずらす（持つ→上の薪が落ち着く→置く。画面の火ばさみと同じ手順）。
 * 動かせたら true。動かした距離は「組み替え」として記録する
 */
export function nudgeOutward(sim: FireSim, sess: FireSession, pick: (p: FireSim['pieces'][number]) => boolean, dists: number[]): boolean {
  const p = sim.pieces.find((q) => !q.held && q.state !== 'ash' && pick(q));
  if (!p) return false;
  const pend = { kind: p.kind, species: p.species, shapeSeed: p.shapeSeed, length: p.length, radius: p.radius };
  const from = { ...p.pose };
  const out = Math.hypot(from.x, from.z) > 0.01 ? Math.atan2(from.z, from.x) : 0;
  sim.holdPiece(p.id);
  sim.applyResettle(resettle(sim.pieces.filter((q) => q.id !== p.id && q.state !== 'ash')));
  let placed = false;
  for (const d of dists) {
    const pl = previewPlacement(sim, pend, from.x + Math.cos(out) * d, from.z + Math.sin(out) * d, from.yaw, p.id);
    if (!pl.valid) continue;
    sim.dropPiece(p.id, pl);
    sess.noteCare(sim, 'rearrange', Math.hypot(pl.pose.x - from.x, pl.pose.z - from.z));
    placed = true;
    break;
  }
  if (!placed) sim.dropPiece(p.id, previewPlacement(sim, pend, from.x, from.z, from.yaw, p.id));
  sim.applyResettle(resettle(sim.pieces.filter((q) => q.state !== 'ash')));
  return placed;
}

const isMain = process.argv[1] && process.argv[1].endsWith('playbot.ts');
if (isMain) {
  const policies = (process.argv[2] ? [process.argv[2]] : ['watch', 'standard', 'hot', 'hotRecover']) as Policy[];
  const layouts = (process.argv[3] ? [process.argv[3]] : ['yuttari', 'igeta', 'tatekake', 'yose']) as LayoutId[];
  for (const policy of policies) {
    for (const layout of layouts) {
      const r = runBot({ policy, layout, watchShare: policy === 'watch' ? 0.6 : 0.2 });
      const f = (x: number | null) => (x === null ? '  -  ' : x.toFixed(0).padStart(5));
      console.log(
        `${policy.padEnd(10)} ${layout.padEnd(9)} stable=${r.stableSeconds.toFixed(0).padStart(4)} stage0=${f(r.stage0At)} out=${f(r.outAt)} maxHeat=${r.maxHeat.toFixed(0)} hotRun=${r.maxHotRun.toFixed(0)} end=${r.sess.endReason ?? '-'} tasks=${r.events.filter((e) => e.type === 'task').map((e) => (e as { id: string }).id).join(',')}`,
      );
      if (process.argv.includes('-v')) {
        r.rows.forEach((l) => console.log('   ', l));
        r.events.forEach((e) => console.log('    @', e.at.toFixed(0), JSON.stringify(e)));
      }
    }
  }
}
