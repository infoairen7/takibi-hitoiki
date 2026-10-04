/**
 * 公開前の確認（詳細仕様14章「必須の確認」のうち、遊び方で結果が分かれる項目）。
 *   npx tsx --test tests/*.test.ts
 * 2026-10-04：キャラクターを企画から外したため、タイプの分かれ方（必須4）・おじ火の3種（必須5）は対象外。
 * 代わりに、強すぎる火・こもった煙の案内どおりにすれば火が落ち着くこと（火の世話の発見）を確かめる。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALANCE } from '../src/game/balance';
import { FireSession } from '../src/game/session';
import { addLogNearFire, placeStep } from '../src/game/fire/builder';
import { LAYOUT_ORDER, LAYOUTS } from '../src/game/fire/layouts';
import { FireSim } from '../src/game/fire/sim';
import { buildMemory } from '../src/game/memory';
import { BotResult, nudgeOutward, runBot } from '../scripts/playbot';

const tasksOf = (r: BotResult) => r.events.filter((e) => e.type === 'task').map((e) => (e as { id: string }).id);

// ───────────────────────────── 3. 標準の遊び方で、早期消火せず自然に見送る

for (const id of LAYOUT_ORDER) {
  test(`必須3：標準の遊び方（${LAYOUTS[id].label}）で、中薪まで火がつながり、早期消火せず自然に見送る`, () => {
    const r = runBot({ policy: 'standard', layout: id, seed: 2024, watchShare: 0.2 });
    assert.ok(r.stage0At !== null && r.stage0At < 90, `中薪まで ${r.stage0At}`);
    assert.equal(r.outAt, null, '早く消えた');
    assert.equal(r.sess.endReason, 'natural');
    assert.ok(r.sess.ended);
    const kinds = r.events.map((e) => e.type);
    assert.ok(kinds.indexOf('farewell') < kinds.indexOf('end'), '見送り→終わりの順でない');
    assert.ok(Math.abs(r.sim.session.activeTime - r.sim.endTime) < 0.2, `終わりの時刻 ${r.sim.session.activeTime}`);
    assert.ok(r.events.some((e) => e.type === 'keepsake'), '思い出の写真を撮らない');
  });
}

// ───────────────────────────── 5. 火の世話：案内どおりにすれば、火が落ち着く

test('強すぎる火：案内どおり送風を止めて薪を一本離せば、火が落ち着く（発見「強すぎる火を、落ち着かせる」）', () => {
  let lastFix = -99;
  let hotSince: number | null = null;
  let calmedAt: number | null = null;
  const fixed = runBot({
    policy: 'hotRecover',
    layout: 'igeta',
    seed: 2024,
    onStep: (sim, sess, ev) => {
      if (sim.ignitedAt === null) return;
      const t = sim.time - sim.ignitedAt;
      if (hotSince === null && sim.metrics.heat > BALANCE.fireCare.hotAbove) hotSince = t;
      if (ev.some((e) => e.type === 'task' && e.id === 'f07') && calmedAt === null) calmedAt = t;
      // 案内「送風はひと休み。火ばさみで燃えている薪を一本、外側へ離そう」
      if (hotSince !== null && calmedAt === null && sim.metrics.heat > BALANCE.fireCare.calmHeatAtMost && t - lastFix > 6) {
        nudgeOutward(sim, sess, (q) => q.kind === 'medium' && q.state === 'flaming', [0.1, 0.12, 0.08]);
        lastFix = t;
      }
    },
  });
  assert.ok(hotSince !== null, '強すぎる火にならない');
  assert.ok(tasksOf(fixed).includes('f07'), '案内どおりにしても落ち着かない');
  assert.ok(calmedAt! - hotSince! < 90, `落ち着くまで ${calmedAt! - hotSince!}秒`);
  assert.ok(fixed.sess.stats.rearranges > 0);
  assert.equal(fixed.sess.endReason, 'natural');
});

test('こもった煙：案内どおり薪の間をあけて風を送れば、煙が引く（発見「こもった煙に、空気を通す」）', () => {
  const play = (follow: boolean) => {
    let last = -99;
    let lastFix = -99;
    let lastGust = -99;
    let smokySince: number | null = null;
    return runBot({
      policy: 'watch',
      layout: 'yuttari',
      seed: 31,
      onStep: (sim, sess) => {
        if (sim.phase !== 'burning' || sim.ignitedAt === null || sim.session.emberPhase) return;
        const t = sim.time - sim.ignitedAt;
        if (sim.metrics.smoke > BALANCE.hints.smokyAt) smokySince ??= t;
        if (follow && smokySince !== null && t - smokySince > BALANCE.fireCare.smokyHoldSeconds) {
          // 案内「火ばさみで、薪の間に隙間をつくろう」と、風を少し
          if (t - lastFix > 5) {
            nudgeOutward(sim, sess, (q) => q.kind === 'medium' && q.species === 'shimerigi', [0.08, 0.1, 0.06, 0.12]);
            lastFix = t;
          }
          if (t - lastGust > 4) {
            if (sim.gust(1, 'front')) sess.noteCare(sim, 'gust');
            lastGust = t;
          }
          return;
        }
        // 湿った薪を火の上へ詰めていく（風は送らない）
        if (t > 60 && t - last > 20) {
          if (addLogNearFire(sim, 'shimerigi')) sess.noteCare(sim, 'log');
          last = t;
        }
      },
    });
  };
  const fixed = play(true);
  assert.ok(tasksOf(fixed).includes('f08'), '案内どおりにしても煙が引かない');
  assert.equal(fixed.sess.endReason, 'natural');
});

// ───────────────────────────── 3. 燃え尽きかけた火を戻す・自然な燃料切れ

/** 井桁型を見守るだけで燃やし、at 秒に中薪を足す。fan なら60秒、4秒おきに風（中）を送る */
function addLate(at: number, fan: boolean): { litAfter: number | null; res: BotResult } {
  let added = -1;
  let lastGust = -99;
  let litAfter: number | null = null;
  const res = runBot({
    policy: 'watch',
    layout: 'igeta',
    seed: 31,
    seconds: at + 110,
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
      if (added >= 0 && fan && t < at + 60 && t - lastGust > 4) {
        if (sim.gust(1, 'front')) sess.noteCare(sim, 'gust');
        lastGust = t;
      }
      const p = sim.pieces.find((q) => q.id === added);
      if (p && litAfter === null && p.firstLitAt !== null) litAfter = p.firstLitAt - sim.ignitedAt - at;
    },
  });
  return { litAfter, res };
}

test('燃え尽きかけた火：炎が消えても赤い熾がある間は、薪を置いて風を送れば、また燃える', () => {
  // 薪を足す案内（燃料30%）から1分以上たって、炎がほとんど消えた頃（火力60→20）
  for (const at of [300, 360, 400]) {
    const { litAfter } = addLate(at, true);
    assert.ok(litAfter !== null && litAfter < 60, `${at}秒に置いて風を送っても燃えない（${litAfter}）`);
  }
  // 風を送らなくても、熾が強いうちは時間をかけて燃え移る
  const slow = addLate(330, false);
  assert.ok(slow.litAfter !== null && slow.litAfter < 120, `熾の上の薪が燃え移らない（${slow.litAfter}）`);
});

test('自然な燃料切れ：薪を足さずに燃え尽きたら、その時点から熾火の時間へ。延長せず、責めずに見送る（20分モード）', () => {
  const r = runBot({ policy: 'watch', layout: 'igeta', seed: 31, mode: 'long', watchShare: 0.3 });
  const s = r.sim.session;
  assert.equal(s.durationSeconds, BALANCE.session.longSeconds);
  assert.ok(s.fuelSpent, '燃料切れとして扱われない');
  assert.ok(r.emberAt !== null && r.emberAt < BALANCE.session.longSeconds * BALANCE.session.emberStartRatio, `熾火の始まり ${r.emberAt}`);
  // 熾火の長さはいつもと同じ（20分モードの18%）。上限は延長しない
  assert.ok(s.endAt !== null && s.endAt !== undefined && Math.abs(s.endAt - (r.emberAt! + BALANCE.session.longSeconds * (1 - BALANCE.session.emberStartRatio))) < 0.2);
  assert.ok(Math.abs(s.activeTime - s.endAt!) < 0.2, `終了 ${s.activeTime} / ${s.endAt}`);
  assert.equal(r.sess.endReason, 'natural');
  const kinds = r.events.map((e) => e.type);
  assert.ok(kinds.includes('farewell') && kinds.indexOf('farewell') < kinds.indexOf('end'), '見送り→終わりの順でない');
  assert.ok(r.sim.timeline.some((e) => e.text.includes('熾火の時間')));
  const mem = buildMemory(r.sim, r.sess, new Date(2026, 9, 3));
  assert.match(mem.howRaised, /小さくなるまで/);
  assert.equal(mem.moodId, 'spent');
  assert.equal(mem.reason, 'natural');
  // 薪を足していない（発見「組んだ薪だけで、最後まで見送る」の条件）
  assert.equal(r.sess.stats.logsAdded, 0);
  // 燃料切れの判定は、風を送っても火が戻らないほど熾が弱くなってから
  assert.ok(r.sim.metrics.emberPower < BALANCE.session.spentEmberPower);
});

test('燃料切れの途中で保存・再開しても、熾火の始まりと終わりの時刻が変わらない', () => {
  const a = runBot({ policy: 'watch', layout: 'igeta', seed: 31, mode: 'long' });
  // 燃料切れの確認中（数秒前）で保存して、続きから
  const cut = a.emberAt! - 4;
  type Snap = { sim: ReturnType<FireSim['serialize']>; sess: ReturnType<FireSession['serialize']> };
  const box: { snap: Snap | null } = { snap: null };
  runBot({
    policy: 'watch',
    layout: 'igeta',
    seed: 31,
    mode: 'long',
    onStep: (sim, sess) => {
      if (!box.snap && sim.session.activeTime >= cut) box.snap = JSON.parse(JSON.stringify({ sim: sim.serialize(), sess: sess.serialize() }));
    },
  });
  assert.ok(box.snap);
  const sim = FireSim.deserialize(box.snap.sim);
  const sess = FireSession.deserialize(box.snap.sess);
  assert.ok((sim.session.spentFor ?? 0) > 0, '確認中の秒数が保存されていない');
  let emberAt: number | null = null;
  for (let i = 0; i < 6000 && !sess.ended; i++) {
    sim.step();
    const ev = sim.drainEvents();
    if (emberAt === null && ev.some((e) => e.type === 'emberPhase')) emberAt = sim.session.activeTime;
    sess.step(sim, ev);
  }
  assert.ok(emberAt !== null && Math.abs(emberAt - a.emberAt!) < 0.15, `熾火の始まり ${emberAt} / ${a.emberAt}`);
  assert.ok(Math.abs(sim.session.activeTime - a.sim.session.activeTime) < 0.15);
  assert.equal(sess.endReason, 'natural');
});

test('中薪まで火がつながる前に、炎も熾も消えたら「火が消えた」として、火口からやり直せる（燃えているふりを続けない）', () => {
  // 湿った中薪だけで組むと、細薪が燃え尽きた後に火が残らない
  const r = runBot({ policy: 'damp', layout: 'yuttari', seed: 31, species: ['shimerigi'], seconds: 200 });
  assert.equal(r.sim.phase, 'out');
  assert.ok(r.outAt !== null && r.outAt < 120, `消えたことになるまで ${r.outAt}秒`);
  assert.equal(r.sim.stage0Done, false);
  assert.equal(r.sim.canIgnite().ok, false, '火口がまだ残っている');
  assert.equal(r.sess.farewell, null, '見送りに入った');
});

// ───────────────────────────── 8. 保存の再読み込みで、その回の記録と見送りの時刻が保たれる

test('必須8：途中で保存・再開しても、その回の記録・発見・見送りの時刻がそのまま続く', () => {
  const live = runBot({ policy: 'hot', layout: 'igeta', seed: 2024, seconds: 260 });
  const sim = FireSim.deserialize(JSON.parse(JSON.stringify(live.sim.serialize())));
  const sess = FireSession.deserialize(JSON.parse(JSON.stringify(live.sess.serialize())));
  assert.equal(sess.fingerprint(), live.sess.fingerprint());
  // そのまま（何もせずに）最後まで続けると、元の続きと同じ時刻に同じ結果になる
  const run = (s: FireSim, c: FireSession) => {
    const out: string[] = [];
    for (let i = 0; i < 6000 && !c.ended; i++) {
      s.step();
      for (const e of c.step(s, s.drainEvents())) out.push(`${s.tick}:${e.type}:${e.type === 'task' ? e.id : e.type === 'keepsake' ? e.rank : ''}`);
    }
    return out;
  };
  const a = run(live.sim, live.sess);
  const b = run(sim, sess);
  assert.deepEqual(b, a);
  assert.ok(a.some((x) => x.includes(':end:')), '最後まで行かない');
  assert.equal(sim.fingerprint(), live.sim.fingerprint());
  assert.equal(sess.fingerprint(), live.sess.fingerprint());
});

// ───────────────────────────── 見直しで見つかったこと

test('燃料切れの確認中に薪を置いて風を送れば、その薪が温まっている間は熾火の時間へ入らない（火が戻る）', () => {
  // 20分モードで薪を足さずに燃やし、炎が消えて熾が弱くなってきた頃（熾の発熱1.6。燃料切れの判定は1.2未満）に、
  // 熾のいちばん赤い所へ中薪を置いて風を送る
  const base = runBot({ policy: 'watch', layout: 'igeta', seed: 31, mode: 'long' });
  let placed = -1;
  let lastGust = -99;
  let litAt: number | null = null;
  const r = runBot({
    policy: 'watch',
    layout: 'igeta',
    seed: 31,
    mode: 'long',
    onStep: (sim, sess) => {
      const pp = sim.pieces.find((q) => q.id === placed);
      if (pp && litAt === null && pp.firstLitAt !== null) litAt = sim.session.activeTime;
      if (sim.ignitedAt === null || sim.session.emberPhase) return;
      const a = sim.session.activeTime;
      const m = sim.metrics;
      if (placed < 0 && a > 200 && m.flamingSegs === 0 && m.emberSegs === 0 && m.emberPower <= 1.6) {
        const nb = BALANCE.bed.cells;
        const cell = (BALANCE.tray.innerHalf * 2) / nb;
        let bi = 0;
        for (let i = 0; i < nb * nb; i++) if (sim.bedCoal[i] > sim.bedCoal[bi]) bi = i;
        const x = -BALANCE.tray.innerHalf + ((bi % nb) + 0.5) * cell;
        const z = -BALANCE.tray.innerHalf + (Math.floor(bi / nb) + 0.5) * cell;
        for (const yawDeg of [0, 90, 45]) {
          const res = placeStep(sim, { kind: 'medium', x, z, yawDeg });
          if (res.piece) {
            placed = res.piece.id;
            sess.noteCare(sim, 'log');
            break;
          }
        }
      }
      if (placed >= 0 && a - lastGust > 4) {
        if (sim.gust(1, 'front')) sess.noteCare(sim, 'gust');
        lastGust = a;
      }
    },
  });
  assert.ok(placed >= 0, '置けなかった');
  assert.ok(litAt !== null, '置いた薪に火が移らない');
  assert.ok(r.emberAt === null || r.emberAt > litAt!, `薪が温まっている途中で熾火の時間に入った（熾火 ${r.emberAt} / 着火 ${litAt}）`);
  assert.ok(r.emberAt === null || r.emberAt > base.emberAt!, `熾火の時間が早まった（${r.emberAt} / ${base.emberAt}）`);
});

test('中薪まで火がつながる前でも、温まっている薪があるあいだは「消えた」にしない', () => {
  // 火口と細薪だけで燃やし、細薪が燃え尽きかけた頃に中薪を置いて風を送る
  let placed = -1;
  let placedAt = 0;
  let lastGust = -99;
  const r = runBot({
    policy: 'none',
    layout: 'yuttari',
    seed: 31,
    seconds: 240,
    setup: (sim) => {
      // 中薪を置かない組み方：ゆったり型から中薪を除く
      void sim;
    },
    onStep: (sim, sess) => {
      if (sim.phase === 'prepare' && sim.lighter.remaining <= 0 && sim.time > 0.2 && sim.ignitedAt === null) {
        for (const q of [...sim.pieces]) if (q.kind === 'medium') sim.removePiece(q.id);
        sim.drainEvents();
        sim.startLighter();
        return;
      }
      if (sim.ignitedAt === null) return;
      const t = sim.time - sim.ignitedAt;
      if (placed < 0 && sim.metrics.flamingSegs === 0 && t > 20) {
        if (addLogNearFire(sim)) {
          placed = sim.pieces[sim.pieces.length - 1].id;
          placedAt = t;
          sess.noteCare(sim, 'log');
        }
      }
      // 置いてから1分だけ風を送る（それでも戻らなければ、あきらめる）
      if (placed >= 0 && t - placedAt < 60 && t - lastGust > 4) {
        if (sim.gust(1, 'front')) sess.noteCare(sim, 'gust');
        lastGust = t;
      }
    },
  });
  assert.ok(placed >= 0, '細薪が燃え尽きる場面が来なかった');
  assert.equal(r.sim.stage0Done || r.sim.pieces.some((q) => q.id === placed && q.firstLitAt !== null) || r.outAt !== null, true);
  // 置いた薪に火が戻ったなら、その前に「消えた」になっていない。戻らなかったなら、温まりきらずに「消えた」になる
  const lit = r.sim.pieces.find((q) => q.id === placed)?.firstLitAt ?? null;
  if (lit !== null) assert.ok(r.outAt === null || r.outAt > lit - r.sim.ignitedAt!, `温まっている途中で「消えた」になった（${r.outAt}）`);
  else assert.ok(r.outAt !== null, '火が戻らないのに、燃えているふりが続いた');
});

test('「もう一度」で同じ保存から始め直しても、元の保存（風の状態など）は書き換わらない', () => {
  const a = runBot({ policy: 'none', layout: 'igeta', seed: 77, seconds: 1 });
  const snap = a.sim.serialize();
  const before = JSON.stringify(snap);
  const b = FireSim.deserialize(snap);
  b.startLighter();
  for (let i = 0; i < 300; i++) {
    if (i % 40 === 0) b.gust(1, 'front');
    b.step();
  }
  assert.equal(JSON.stringify(snap), before);
  // 同じ保存から二度始めると、同じ結果になる
  const run = () => {
    const c = FireSim.deserialize(snap);
    c.startLighter();
    for (let i = 0; i < 300; i++) {
      if (i % 40 === 0) c.gust(1, 'front');
      c.step();
    }
    return c.fingerprint();
  };
  assert.equal(run(), run());
});
