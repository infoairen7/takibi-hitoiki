/**
 * 一回の焚き火の進行役（FireSession）：見送り・思い出・火の世話の発見・保存の引き継ぎ。
 * 2026-10-04：キャラクターを企画から外したあとの、焚き火だけの進行を確かめる。
 *   npx tsx --test tests/*.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALANCE } from '../src/game/balance';
import { addLogNearFire, placeStep } from '../src/game/fire/builder';
import { LAYOUTS, LayoutId } from '../src/game/fire/layouts';
import { FireSim } from '../src/game/fire/sim';
import { buildMemory, fireMood, shareText } from '../src/game/memory';
import { FireSession, LegacyCompanionSnapshot, SessionEvent } from '../src/game/session';
import { CLOSING_LINES, FIRE_NAMES, MOOD_LABEL } from '../src/data/texts';
import { SCHEMA_VERSION, SavedSession, validateSession } from '../src/persistence/storage';
import { BotResult, runBot } from '../scripts/playbot';

const hz = BALANCE.sim.hz;
const taskIds = (ev: SessionEvent[]) => ev.filter((e) => e.type === 'task').map((e) => (e as { id: string }).id);

/** 組んで火を灯したところ（操作は呼び出し側で） */
function lit(seed: number, layout: LayoutId = 'igeta') {
  const sim = new FireSim(seed);
  const sess = new FireSession(sim.seed, sim.session.durationSeconds);
  sess.noteLayout(layout);
  for (const st of LAYOUTS[layout].steps) {
    placeStep(sim, st);
    sess.notePlaced(sim, st.kind, sim.pieces[sim.pieces.length - 1]?.species);
  }
  sim.startLighter();
  const events: SessionEvent[] = [];
  const step = () => {
    sim.step();
    const ev = sess.step(sim, sim.drainEvents());
    events.push(...ev);
    return ev;
  };
  const tIgn = () => (sim.ignitedAt === null ? 0 : sim.time - sim.ignitedAt);
  return { sim, sess, events, step, tIgn };
}

// ───────────────────────────── 見送り

test('「今日はここまで」：15秒かけて見送って終わる。二度押しても一度だけ。終わった後は何も起きない', () => {
  const g = lit(11);
  while (g.sim.session.activeTime < 120) g.step();
  const ev = g.sess.beginManualFarewell(g.sim);
  assert.deepEqual(ev, [{ type: 'farewell', reason: 'manual', duration: BALANCE.farewell.manualSeconds }]);
  assert.deepEqual(g.sess.beginManualFarewell(g.sim), [], '二度目の見送りが始まった');
  const start = g.sim.time;
  // 見送りの間の世話は記録に入れない
  const care = g.sess.careCount;
  g.sess.noteCare(g.sim, 'gust');
  assert.equal(g.sess.careCount, care);
  let endAt: number | null = null;
  for (let i = 0; i < 30 * hz && endAt === null; i++) {
    const out = g.step();
    if (out.some((e) => e.type === 'end')) endAt = g.sim.time;
  }
  assert.ok(endAt !== null, '終わらない');
  assert.ok(Math.abs(endAt! - start - BALANCE.farewell.manualSeconds) <= 0.11, `見送り ${endAt! - start}秒`);
  assert.equal(g.sess.endReason, 'manual');
  assert.ok(g.sim.session.ended);
  assert.deepEqual(g.sess.step(g.sim, []), []);
  const m = buildMemory(g.sim, g.sess, new Date(2026, 9, 4));
  assert.equal(m.moodId, 'early');
  assert.equal(m.reason, 'manual');
  assert.match(m.howRaised, /早めに/);
  assert.ok(CLOSING_LINES.early.includes(m.closing));
});

test('灯す前と見送りの間は、世話を数えない。火ばさみの小さな往復は組み替えに数えない', () => {
  const g = lit(12);
  const sim0 = new FireSim(12);
  const s0 = new FireSession(sim0.seed, sim0.session.durationSeconds);
  s0.noteCare(sim0, 'log');
  s0.noteCare(sim0, 'gust');
  assert.equal(s0.careCount, 0, '灯す前の世話を数えた');
  while (g.tIgn() < 40) g.step();
  g.sess.noteCare(g.sim, 'rearrange', BALANCE.fireCare.rearrangeMinMove / 2);
  assert.equal(g.sess.stats.rearranges, 0);
  g.sess.noteCare(g.sim, 'rearrange', BALANCE.fireCare.rearrangeMinMove);
  g.sess.noteCare(g.sim, 'blow');
  g.sess.noteCare(g.sim, 'log');
  assert.deepEqual([g.sess.stats.rearranges, g.sess.stats.blows, g.sess.stats.logsAdded], [1, 1, 1]);
  assert.equal(g.sess.careCount, 3);
});

// ───────────────────────────── 思い出

test('思い出：同じ火なら同じ名前・同じ結びの一文。結びの一文は、その火の様子の候補から選ぶ', () => {
  const a = runBot({ policy: 'watch', layout: 'igeta', seed: 2024, watchShare: 0.5 });
  const b = runBot({ policy: 'watch', layout: 'igeta', seed: 2024, watchShare: 0.5 });
  const d = new Date(2026, 9, 4);
  const ma = buildMemory(a.sim, a.sess, d);
  const mb = buildMemory(b.sim, b.sess, d);
  assert.deepEqual(ma, mb);
  assert.ok(FIRE_NAMES.includes(ma.fireName));
  assert.ok(CLOSING_LINES[ma.moodId].includes(ma.closing));
  assert.equal(ma.mood, MOOD_LABEL[ma.moodId]);
  assert.equal(ma.layout, LAYOUTS.igeta.label);
  assert.equal(ma.dateLabel, '2026.10.04');
  assert.ok(ma.record.stableRate > 0.3 && ma.record.stableRate <= 1, `落ち着いた火 ${ma.record.stableRate}`);
  assert.ok(ma.record.maxHeat !== null && ma.record.maxHeat >= 50 && ma.record.maxHeat <= 100);
  // 思い出のIDは、以前の版（seed-日付）と重ならない形
  assert.match(ma.id, /^t-[0-9a-z]+-20261004$/);
  // 共有の文：題と火の名前だけ（キャラクターの名前・台詞は入らない）
  const sh = shareText(ma);
  assert.match(sh, /#焚き火とひと息/);
  assert.ok(sh.includes(ma.fireName));
  assert.ok(!/ギャル|火の精|おじ火/.test(sh + ma.closing + ma.howRaised + ma.careLabel));
  // 火の名前は seed で変わる（12候補のうち、いくつかに散らばる）
  const names = new Set(Array.from({ length: 24 }, (_, i) => new FireSession(1000 + i, 600).fireName));
  assert.ok(names.size >= 6, `名前の散らばり ${names.size}`);
});

test('火の様子：早めに休ませた・戻った・湿った・燃え尽きた・小さい・よく燃えた・世話した・おだやか の順に決める', () => {
  const sim = (fuelSpent = false) => ({ session: { fuelSpent } }) as unknown as FireSim;
  const sess = (f: (s: FireSession) => void) => {
    const s = new FireSession(5, 600);
    s.stats.windowSeconds = 300;
    s.stats.heatSum = 50 * 300;
    s.stats.maxHeat = 70;
    f(s);
    return s;
  };
  assert.equal(fireMood(sim(), sess(() => {})), 'calm');
  assert.equal(fireMood(sim(), sess((s) => (s.endReason = 'manual'))), 'early');
  assert.equal(fireMood(sim(true), sess((s) => (s.stats.revived = true))), 'revived');
  assert.equal(fireMood(sim(true), sess((s) => (s.stats.dampSeconds = 150))), 'damp');
  assert.equal(fireMood(sim(true), sess(() => {})), 'spent');
  assert.equal(fireMood(sim(), sess((s) => (s.stats.maxHeat = 45))), 'small');
  assert.equal(fireMood(sim(), sess((s) => (s.stats.maxHeat = 85))), 'lively');
  assert.equal(fireMood(sim(), sess((s) => (s.stats.gusts = 5))), 'tended');
  for (const k of Object.keys(MOOD_LABEL) as Array<keyof typeof MOOD_LABEL>) assert.ok(CLOSING_LINES[k].length >= 2, `${k} の結びの一文が足りない`);
});

test('思い出の写真：火が育った節目（火力45・60・75）ごとに一度ずつ撮る。育たない火でも熾火に入れば一枚撮る', () => {
  const r = runBot({ policy: 'standard', layout: 'igeta', seed: 2024 });
  const ranks = r.events.filter((e) => e.type === 'keepsake').map((e) => (e as { rank: number }).rank);
  assert.deepEqual(ranks, [1, 2, 3]);
  // 火力が45に届かない火（熾火に入るところで撮る）
  const g = lit(3);
  g.sess.stats.maxHeat = 0;
  const fake = { ...g.sim, time: 10, ignitedAt: 0, phase: 'burning', session: { ...g.sim.session, emberPhase: true }, metrics: { ...g.sim.metrics, heat: 20 } } as unknown as FireSim;
  const ev = g.sess.step(fake, [{ type: 'emberPhase' } as never]);
  assert.deepEqual(ev.filter((e) => e.type === 'keepsake'), [{ type: 'keepsake', rank: 0.5 }]);
  assert.deepEqual(g.sess.step(fake, [{ type: 'emberPhase' } as never]).filter((e) => e.type === 'keepsake'), []);
});

// ───────────────────────────── 火の世話の発見

test('風で火を渡す：着火の直後に風を送ると、少しのうちに細薪へ火が移る（発見）。風を送らなければ、その発見にはならない', () => {
  const run = (gust: boolean) => {
    const g = lit(2024);
    let last = -99;
    while (g.tIgn() < 60) {
      if (gust && g.tIgn() > 1 && g.tIgn() - last >= 2.5 && !g.sess.stats.windSpread) {
        if (g.sim.gust(1, 'front')) g.sess.noteCare(g.sim, 'gust');
        last = g.tIgn();
      }
      g.step();
    }
    return g;
  };
  const withWind = run(true);
  assert.ok(taskIds(withWind.events).includes('f05'), '風を送っても発見にならない');
  assert.ok(withWind.sess.stats.gusts > 0);
  assert.ok(!taskIds(run(false).events).includes('f05'), '風を送らずに発見になった');
});

/** 見守るだけで燃やし、炎が消えて熾だけになった at 秒に中薪を足して、道具で起こす */
function revive(at: number, tool: 'tube' | 'fan' | 'none'): BotResult {
  let added = -1;
  let last = -99;
  return runBot({
    policy: 'watch',
    layout: 'igeta',
    seed: 31,
    seconds: at + 100,
    onStep: (sim, sess) => {
      if (sim.ignitedAt === null) return;
      const t = sim.time - sim.ignitedAt;
      if (added < 0 && t >= at) {
        const before = new Set(sim.pieces.map((p) => p.id));
        if (addLogNearFire(sim)) {
          sess.noteCare(sim, 'log');
          added = sim.pieces.find((p) => !before.has(p.id))!.id;
        }
      }
      const p = sim.pieces.find((q) => q.id === added);
      if (!p || t > at + 60 || p.firstLitAt !== null) return;
      if (tool === 'fan' && t - last > 4) {
        if (sim.gust(1, 'front')) sess.noteCare(sim, 'gust');
        last = t;
      }
      if (tool === 'tube' && t - last > BALANCE.tube.minInterval + 0.05) {
        let bi = 0;
        p.segs.forEach((s, i) => {
          if (s.T > p.segs[bi].T) bi = i;
        });
        if (sim.blow(p.segPos[bi][0], p.segPos[bi][2], 1)) sess.noteCare(sim, 'blow');
        last = t;
      }
    },
  });
}

test('熾から火を戻す：炎が消えて熾だけになっても、薪を足して吹けば戻る（発見）。火吹き筒で戻せば、その発見も', () => {
  const tube = revive(400, 'tube');
  const tTube = taskIds(tube.events);
  assert.ok(tTube.includes('f04') && tTube.includes('f03'), `火吹き筒：${tTube}`);
  assert.equal(buildMemory(tube.sim, tube.sess).moodId, 'revived');
  const fan = revive(400, 'fan');
  const tFan = taskIds(fan.events);
  assert.ok(tFan.includes('f04'), `うちわ：${tFan}`);
  assert.ok(!tFan.includes('f03'), 'うちわで戻しても火吹き筒の発見になった');
  // 何もしない（熾だけのまま）なら、戻した発見にはならない
  const none = runBot({ policy: 'watch', layout: 'igeta', seed: 31 });
  assert.ok(!taskIds(none.events).includes('f04'));
  assert.notEqual(buildMemory(none.sim, none.sess).moodId, 'revived');
});

test('続けて眺める：落ち着いた火を60秒（20分なら120秒）眺め続けると発見。途中で戻ると数え直す', () => {
  const r = runBot({ policy: 'watch', layout: 'igeta', seed: 2024, watchShare: 1 });
  const at = r.events.find((e) => e.type === 'task' && e.id === 't21')?.at;
  assert.ok(at !== undefined, '眺め続けても発見にならない');
  assert.ok(r.sess.stats.watchStreakMax >= BALANCE.discovery.stableWatchSeconds);
  // 50秒ごとに操作へ戻る（600刻みのうち500刻みだけ眺める）
  const broken = runBot({ policy: 'watch', layout: 'igeta', seed: 2024, watchShare: 50 / 60 });
  assert.ok(!taskIds(broken.events).includes('t21'), '途中で戻っても数え直さない');
  assert.ok(broken.sess.watchRate > 0.6);
  const long = runBot({ policy: 'watch', layout: 'igeta', seed: 2024, watchShare: 1, mode: 'long' });
  const atLong = long.events.find((e) => e.type === 'task' && e.id === 't21')?.at;
  assert.ok(atLong !== undefined && atLong >= at! + BALANCE.discovery.stableWatchSeconds - 1, `20分モード ${atLong} / ${at}`);
});

// ───────────────────────────── 保存の引き継ぎ

function savedWith(extra: Partial<SavedSession>): SavedSession {
  const g = lit(9);
  while (g.tIgn() < 30) g.step();
  return JSON.parse(JSON.stringify({ schemaVersion: SCHEMA_VERSION, savedAt: '2026-10-04T10:00:00.000Z', sim: g.sim.serialize(), ...extra }));
}

test('続きの保存：その回の記録は、書き出して読み直しても同じ。壊れた値・知らない終わり方は読まない', () => {
  const g = lit(21);
  while (g.tIgn() < 200) g.step();
  g.sess.setWatching(true);
  for (let i = 0; i < 30 * hz; i++) g.step();
  const snap = JSON.parse(JSON.stringify(g.sess.serialize()));
  const ok = savedWith({ session: snap });
  assert.ok(validateSession(ok));
  const back = FireSession.deserialize(ok.session!);
  assert.equal(back.fingerprint(), g.sess.fingerprint());
  assert.equal(back.fireName, g.sess.fireName);
  assert.equal(back.watchRate, g.sess.watchRate);
  assert.ok(!validateSession({ ...ok, session: { ...snap, endReason: 'early' } }), '知らない終わり方を読んだ');
  assert.ok(!validateSession({ ...ok, session: { ...snap, stats: { ...snap.stats, stableSeconds: -1 } } }));
  assert.ok(!validateSession({ ...ok, session: { ...snap, v: 3 } }));
  assert.ok(!validateSession({ ...ok, session: { ...snap, fireName: 'x'.repeat(65) } }));
  assert.ok(!validateSession({ ...ok, schemaVersion: SCHEMA_VERSION + 1 }));
});

test('前の版（キャラクターがいた版）の続きの保存：火の進み・見送り・記録だけを引き継ぐ', () => {
  const legacy: LegacyCompanionSnapshot = {
    v: 1,
    seed: 77,
    duration: 600,
    farewell: { reason: 'early', start: 400, dur: 10 },
    ended: false,
    endReason: null,
    stats: { windowSeconds: 200, stableSeconds: 150, watchSeconds: 40, logs: 3, gusts: 2, rearranges: 1, layoutId: 'igeta', species: ['nara', 7, 'sakura'], kindlingUsed: true, growth: 0.8, personality: { calm: 3 } },
    fireName: 'ほのか',
  };
  const saved = savedWith({ schemaVersion: 2, companion: legacy });
  assert.ok(validateSession(saved));
  const s = FireSession.fromLegacy(saved.companion!);
  assert.equal(s.fireName, 'ほのか');
  assert.equal(s.farewell?.reason, 'manual', '前の版の「生まれた後に消えた」を、最後まで見送った回にしない');
  assert.equal(s.farewell?.start, 400);
  assert.deepEqual([s.stats.windowSeconds, s.stats.stableSeconds, s.stats.watchSeconds, s.stats.logsAdded, s.stats.gusts, s.stats.rearranges], [200, 150, 40, 3, 2, 1]);
  assert.deepEqual(s.stats.species, ['nara', 'sakura']);
  assert.equal(s.stableRate, 0.75);
  // 以前の版は火力を記録していない：火力で火の様子を決めず、カードにも出さない
  assert.equal(s.stats.heatKnown, false);
  const ended = FireSession.fromLegacy({ ...legacy, farewell: null, ended: true, endReason: 'natural' });
  const m = buildMemory({ session: { fuelSpent: false, activeTime: 600, durationSeconds: 600 } } as unknown as FireSim, ended, new Date(2026, 9, 4));
  assert.notEqual(m.moodId, 'small');
  assert.equal(m.record.maxHeat, null);
  assert.equal(m.reason, 'natural');
  assert.equal(FireSession.fromLegacy({ ...legacy, farewell: { reason: 'natural', start: 590, dur: 10 } }).farewell?.reason, 'natural');
  // 今の形式で保存し直せる
  assert.ok(validateSession({ ...saved, schemaVersion: SCHEMA_VERSION, companion: null, session: JSON.parse(JSON.stringify(s.serialize())) }));
  // 壊れた前の版の保存は読まない
  assert.ok(!validateSession({ ...saved, companion: { ...legacy, duration: 0 } }));
  assert.ok(!validateSession({ ...saved, companion: { ...legacy, fireName: 'x'.repeat(65) } }));
  // 足りない項目は 0 として読む（数字でない値も）
  const thin = FireSession.fromLegacy({ v: 1, seed: 1, duration: 600, stats: { windowSeconds: 'x', stableSeconds: -5 } });
  assert.equal(thin.stats.windowSeconds, 0);
  assert.equal(thin.stats.stableSeconds, 0);
  assert.equal(thin.farewell, null);
});

test('同じ seed・同じ操作なら、その回の記録と発見の順番まで同じ（決定性）', () => {
  const a = runBot({ policy: 'lively', layout: 'tatekake', seed: 88, watchShare: 0.3, rearrangeEvery: 40 });
  const b = runBot({ policy: 'lively', layout: 'tatekake', seed: 88, watchShare: 0.3, rearrangeEvery: 40 });
  assert.equal(a.sess.fingerprint(), b.sess.fingerprint());
  assert.deepEqual(a.events, b.events);
  assert.equal(JSON.stringify(a.sess.serialize()), JSON.stringify(b.sess.serialize()));
});

test('同じ seed でも、遊び方で思い出の「火の様子」が分かれる（キャラクターのタイプの代わり）', () => {
  const mood = (policy: 'watch' | 'hot' | 'standard', layout: LayoutId) => {
    const r = runBot({ policy, layout, seed: 2024, watchShare: policy === 'watch' ? 0.5 : 0.2 });
    return buildMemory(r.sim, r.sess).moodId;
  };
  assert.equal(mood('watch', 'igeta'), 'calm', '見守るだけ（井桁型）');
  assert.equal(mood('watch', 'yose'), 'spent', '見守るだけ（寄せ薪型：薪を足さずに燃え尽きる）');
  assert.equal(mood('hot', 'igeta'), 'lively', '強い火');
  assert.equal(mood('standard', 'igeta'), 'revived', '炎が消えかけてから薪を足した');
});
