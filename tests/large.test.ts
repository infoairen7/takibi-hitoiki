/**
 * 太薪（詳細仕様：太薪は火が育った後で選べる。大きな火や熾火の時間を変える。初動から自動で燃えない。
 * 中薪・太薪は最大5本。湿った太薪へ移らないケース）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALANCE, PieceKind, WoodId } from '../src/game/balance';
import { addLogNearFire, placeStep } from '../src/game/fire/builder';
import { pieceDims } from '../src/game/fire/model';
import { FireSim } from '../src/game/fire/sim';
import { runBot } from '../scripts/playbot';

/** 井桁型を見守るだけで燃やし、着火 at 秒後に薪を1本足す（fan なら60秒、4秒おきに風） */
function addOne(kind: PieceKind, species: WoodId, at: number, fan = false) {
  let added = -1;
  let lastGust = -99;
  let litAfter: number | null = null;
  const res = runBot({
    policy: 'watch',
    layout: 'igeta',
    seed: 31,
    onStep: (sim, sess) => {
      if (sim.ignitedAt === null) return;
      const t = sim.time - sim.ignitedAt;
      if (added === -1 && t >= at) {
        const before = new Set(sim.pieces.map((p) => p.id));
        assert.ok(addLogNearFire(sim, species, kind), `${at}秒に${kind}を置けない：${sim.canAdd(kind).reason}`);
        sess.noteCare(sim, 'log');
        added = sim.pieces.find((p) => !before.has(p.id))!.id;
      }
      if (added >= 0 && fan && t < at + 60 && t - lastGust > 4) {
        if (sim.gust(1, 'front')) sess.noteCare(sim, 'gust');
        lastGust = t;
      }
      const p = sim.pieces.find((q) => q.id === added);
      if (p && litAfter === null && p.firstLitAt !== null) litAfter = p.firstLitAt - sim.ignitedAt - at;
    },
  });
  // 燃え尽きて灰になった薪は台から消える（残りは0）
  const p = res.sim.pieces.find((q) => q.id === added);
  const fuelLeft = p ? p.segs.reduce((a, s) => a + s.f, 0) / p.segs.reduce((a, s) => a + s.f0, 0) : 0;
  return { litAfter, fuelLeft, res };
}

test('太薪：形は中薪より太く長い。燃料は約2倍', () => {
  const m = pieceDims('medium', 0.5);
  const l = pieceDims('large', 0.5);
  assert.ok(l.radius > m.radius * 1.25, `太さ ${l.radius} / ${m.radius}`);
  assert.ok(l.length >= m.length);
  assert.ok(BALANCE.pieces.large.fuel >= BALANCE.pieces.medium.fuel * 1.8);
});

test('太薪：火が中薪まで育つまでは選べない（着火前・着火直後）', () => {
  const sim = new FireSim(41);
  const r = sim.canAdd('large');
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /育ってから/);
  assert.equal(placeStep(sim, { kind: 'large', x: 0, z: 0, yawDeg: 0 }).piece, null);
  // 中薪が安定して燃えた後（第0段階の完了）なら選べる
  const res = runBot({ policy: 'watch', layout: 'igeta', seed: 31, seconds: 200 });
  assert.ok(res.sim.stage0Done);
  assert.equal(res.sim.canAdd('large').ok, true);
});

test('太薪：中薪と太薪はあわせて5本まで（火口・細薪は別枠）', () => {
  const sim = new FireSim(42);
  sim.stage0Done = true; // 枠だけを確かめる（UIからは火が育った後だけ）
  const spots = [-0.2, -0.1, 0, 0.1, 0.2, 0.25];
  let placed = 0;
  spots.forEach((z, i) => {
    if (placeStep(sim, { kind: i % 2 ? 'large' : 'medium', x: 0, z, yawDeg: 0 }).piece) placed++;
  });
  assert.equal(sim.countOf('medium') + sim.countOf('large'), BALANCE.logs.maxTotal);
  assert.ok(placed <= BALANCE.logs.maxTotal);
  const more = sim.canAdd('large');
  assert.equal(more.ok, false);
  assert.match(more.reason ?? '', /あわせて5本/);
  assert.equal(sim.canAdd('kindling').ok, true, '細薪は別枠');
});

test('太薪：ライターと火口だけでは燃えない（初動から自動で燃えない）', () => {
  const sim = new FireSim(43);
  sim.stage0Done = true; // 物理だけを確かめる
  placeStep(sim, { kind: 'tinder', x: 0, z: 0, yawDeg: 0 });
  placeStep(sim, { kind: 'large', x: 0, z: -0.07, yawDeg: 0 });
  placeStep(sim, { kind: 'large', x: 0, z: 0.07, yawDeg: 0 });
  assert.equal(sim.startLighter(), true);
  for (let i = 0; i < 1200; i++) {
    sim.lighter.remaining = 1;
    sim.step();
  }
  assert.ok(sim.pieces.filter((p) => p.kind === 'large').every((p) => p.firstLitAt === null), '太薪がライターと火口だけで燃えた');
});

test('太薪：育った火の上では中薪より遅れて燃え移り、長く残る', () => {
  const med = addOne('medium', 'nara', 150);
  const big = addOne('large', 'nara', 150);
  assert.ok(med.litAfter !== null && big.litAfter !== null, `燃え移らない（中${med.litAfter} 太${big.litAfter}）`);
  assert.ok(big.litAfter! > med.litAfter!, `太薪の方が早い（中${med.litAfter} 太${big.litAfter}）`);
  assert.ok(big.litAfter! < 40, `太薪が遅すぎる（${big.litAfter}）`);
  // 終わりの時点で、中薪は燃え尽き、太薪はまだ残る
  assert.ok(big.fuelLeft > med.fuelLeft + 0.05, `残り 中${med.fuelLeft.toFixed(2)} 太${big.fuelLeft.toFixed(2)}`);
});

test('太薪：弱った火に置くと、風を送らないと燃え移らない。送れば移る', () => {
  const still = addOne('large', 'nara', 330);
  assert.equal(still.litAfter, null, `弱った火の太薪が勝手に燃えた（${still.litAfter}）`);
  const fanned = addOne('large', 'nara', 330, true);
  assert.ok(fanned.litAfter !== null && fanned.litAfter < 60, `風を送っても燃えない（${fanned.litAfter}）`);
  // 中薪なら同じ時刻でも熾の熱で時間をかけて移る（太さの違い）
  const med = addOne('medium', 'nara', 330);
  assert.ok(med.litAfter !== null, '中薪も燃え移らない');
});

test('太薪：湿った太薪（しめり木）は、落ち着いた火へは移らない', () => {
  const r = addOne('large', 'shimerigi', 240);
  assert.equal(r.litAfter, null, `湿った太薪へ移った（${r.litAfter}）`);
  assert.ok(r.fuelLeft > 0.95);
});
