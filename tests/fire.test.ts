/**
 * 第0段階の受入条件を数値で確認するテスト。
 *   npx tsx --test tests/*.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALANCE } from '../src/game/balance';
import { GameClock } from '../src/game/clock';
import { nextPendingPiece, placeAt, placeStep } from '../src/game/fire/builder';
import { LAYOUTS, LAYOUT_ORDER } from '../src/game/fire/layouts';
import { computePlacement } from '../src/game/fire/placement';
import { FireSim } from '../src/game/fire/sim';
import { runScenario, SCENARIOS } from '../scripts/scenarios';

const byName = (n: string) => SCENARIOS.find((s) => s.name === n)!;

test('空の台から始まる：薪も火もない', () => {
  const sim = new FireSim(1);
  assert.equal(sim.pieces.length, 0);
  assert.equal(sim.metrics.heat, 0);
  assert.equal(sim.phase, 'prepare');
});

test('火口が必要：火口がないと着火できない', () => {
  const sim = new FireSim(2);
  placeStep(sim, { kind: 'medium', x: 0, z: 0, yawDeg: 0 });
  const chk = sim.canIgnite();
  assert.equal(chk.ok, false);
  assert.match(chk.reason ?? '', /太い薪だけでは/);
  assert.equal(sim.startLighter(), false);
});

test('太薪だけでは着火しない：ライターを当て続けても中薪は燃えない', () => {
  const sim = new FireSim(3);
  placeStep(sim, { kind: 'medium', x: 0, z: -0.05, yawDeg: 0 });
  placeStep(sim, { kind: 'medium', x: 0, z: 0.05, yawDeg: 0 });
  // 強制的にライターの熱を中薪へ当てる（UIからは不可能な操作）
  for (let i = 0; i < 600; i++) {
    sim.lighter.remaining = 1;
    sim.lighter.tip = [0, BALANCE.tray.floorY + 0.03, 0.02];
    sim.step();
  }
  assert.ok(sim.pieces.every((p) => p.state !== 'flaming'), '中薪がライターだけで燃えた');
});

test('火口だけでは燃え尽きて、ほかへは移らない', () => {
  const r = runScenario(byName('tinder-only'));
  assert.ok(r.ignitedTinder !== null && r.ignitedTinder < 3, '火口に火がつかない');
  assert.ok(r.outAt !== null, '火口だけの火が消えない');
});

test('火口＋中薪（細薪なし）では中薪へ移らない', () => {
  const r = runScenario(byName('tinder+medium-no-kindling'));
  assert.equal(r.firstMedium, null);
  assert.equal(r.firstKindling, null);
});

test('細薪が遠いと燃え移らない', () => {
  const r = runScenario(byName('kindling-far'));
  assert.equal(r.firstKindling, null);
});

for (const id of LAYOUT_ORDER) {
  test(`推奨配置「${LAYOUTS[id].label}」：火口→細薪→中薪の順に燃え移り、90秒以内に中薪が安定する`, () => {
    const r = runScenario(byName(id));
    assert.equal(r.rejected.length, 0, r.rejected.join(','));
    assert.ok(r.ignitedTinder !== null);
    assert.ok(r.firstKindling !== null, '細薪へ移らない');
    assert.ok(r.firstMedium !== null, '中薪へ移らない');
    assert.ok(r.ignitedTinder! < r.firstKindling!, '順序：火口→細薪');
    assert.ok(r.firstKindling! < r.firstMedium!, '順序：細薪→中薪');
    assert.ok(r.firstKindling! > 2, '細薪への燃え移りが速すぎる（瞬間移動に見える）');
    assert.ok(r.firstMedium! > 12, '中薪への燃え移りが速すぎる');
    assert.ok(r.stage0 !== null && r.stage0 < 90, `第0段階の目標に届かない: ${r.stage0}`);
    assert.equal(r.outAt, null, '標準の組み方で早く消えた');
  });
}

test('送風：風下に細薪があると燃え移り、風上・風なしでは移らない', () => {
  const none = runScenario(byName('offset-kindling-no-wind'));
  const toward = runScenario(byName('offset-kindling-wind-left-mid'));
  const away = runScenario(byName('offset-kindling-wind-right-mid'));
  assert.equal(none.firstKindling, null);
  assert.ok(toward.firstKindling !== null, '風下へ燃え移らない');
  assert.equal(away.firstKindling, null);
});

test('送りすぎ：着火直後に強い風を送り続けると中薪まで育たない', () => {
  const strong = runScenario(byName('yuttari+wind-strong-early'));
  const calm = runScenario(byName('yuttari'));
  assert.equal(strong.firstMedium, null);
  assert.ok(calm.firstMedium !== null);
});

test('連打は有利にならない：短い間隔の送風は受け付けない', () => {
  const sim = new FireSim(9);
  assert.equal(sim.gust(1, 'front'), true);
  sim.step();
  assert.equal(sim.gust(2, 'front'), false);
});

test('同じseed・同じ操作なら同じ結果（決定性）', () => {
  const a = runScenario(byName('igeta'), 777);
  const b = runScenario(byName('igeta'), 777);
  assert.equal(a.sim.fingerprint(), b.sim.fingerprint());
});

function runWithFps(fps: number, seconds: number): FireSim {
  const sim = new FireSim(4242);
  for (const st of LAYOUTS.yuttari.steps) placeStep(sim, st);
  const clock = new GameClock();
  let t = 0;
  let ignited = false;
  const gustTimes = [20, 40, 41, 60];
  const frame = 1 / fps;
  while (t < seconds) {
    const steps = clock.advance(frame);
    for (let i = 0; i < steps; i++) {
      // 入力はシミュレーション時刻で決まる（描画FPSに依存しない）
      if (!ignited && sim.time >= 1) {
        sim.startLighter();
        ignited = true;
      }
      while (gustTimes.length && sim.time >= gustTimes[0]) {
        sim.gust(1, 'front');
        gustTimes.shift();
      }
      sim.step();
    }
    t += frame;
  }
  return sim;
}

test('30fpsと60fpsで燃焼・時間がずれない', () => {
  const a = runWithFps(30, 150);
  const b = runWithFps(60, 150);
  assert.ok(Math.abs(a.tick - b.tick) <= 1, `tick差: ${a.tick} vs ${b.tick}`);
  // tick数を揃えて比較
  while (a.tick < b.tick) a.step();
  while (b.tick < a.tick) b.step();
  assert.equal(a.fingerprint(), b.fingerprint());
});

test('長いフレーム停止の後にまとめて消費しない', () => {
  const clock = new GameClock();
  const steps = clock.advance(30); // 30秒止まっていたフレーム
  assert.ok(steps <= BALANCE.sim.maxStepsPerFrame);
});

test('停止理由は複数を保持し、すべて解除されたときだけ再開する', () => {
  const clock = new GameClock();
  clock.pause('journal');
  clock.pause('hidden');
  assert.equal(clock.advance(0.1), 0);
  clock.resume('journal');
  assert.equal(clock.paused, true, '手帳を閉じても非表示なら再開しない');
  assert.equal(clock.advance(0.1), 0);
  clock.resume('hidden');
  assert.equal(clock.paused, false);
  assert.ok(clock.advance(0.1) >= 1);
});

test('保存と再開：途中で保存・復元しても結果が同じ', () => {
  const sc = byName('tatekake');
  const full = runScenario({ ...sc, seconds: 120 }, 55);
  const half = runScenario({ ...sc, seconds: 60 }, 55);
  const json = JSON.stringify(half.sim.serialize());
  const restored = FireSim.deserialize(JSON.parse(json));
  for (let i = 0; i < 600; i++) restored.step();
  assert.equal(restored.fingerprint(), full.sim.fingerprint());
});

test('火ばさみで燃えている薪を動かすと、燃焼源（区間の位置）も追従する', () => {
  const r = runScenario({ ...byName('yuttari'), seconds: 60 }, 5);
  const sim = r.sim;
  const burning = sim.pieces.find((p) => p.kind === 'medium' && p.state === 'flaming')!;
  assert.ok(burning, '燃えている中薪がない');
  const before = burning.segPos.map((p) => [...p]);
  sim.holdPiece(burning.id);
  sim.setHeldPose(burning.id, { ...burning.pose, x: burning.pose.x + 0.1, y: burning.pose.y + 0.03 });
  const after = burning.segPos;
  assert.ok(Math.abs(after[0][0] - before[0][0] - 0.1) < 1e-9);
  const pend = { kind: burning.kind, species: burning.species, shapeSeed: 1, length: burning.length, radius: burning.radius };
  const pl = computePlacement({ kind: pend.kind, length: pend.length, radius: pend.radius, x: 0.15, z: 0.15, yaw: 0 }, sim.pieces.filter((p) => p.id !== burning.id));
  sim.dropPiece(burning.id, pl);
  sim.step();
  assert.ok(Math.abs(burning.segPos[3][2] - 0.15) < 0.02, '置き直した位置に区間が移っていない');
});

test('置き方：2本の中薪へ渡した細薪は2点で支えられ、床から浮いて隙間ができる', () => {
  const sim = new FireSim(10);
  placeStep(sim, { kind: 'medium', x: 0, z: -0.09, yawDeg: 0 });
  placeStep(sim, { kind: 'medium', x: 0, z: 0.09, yawDeg: 0 });
  const r = placeStep(sim, { kind: 'kindling', x: 0, z: 0, yawDeg: 90 });
  assert.ok(r.piece);
  const woodSupports = r.placement.supports.filter((s) => s.by !== 'floor');
  assert.equal(woodSupports.length, 2);
  assert.ok(r.piece!.pose.y - r.piece!.radius > BALANCE.tray.floorY + 0.05, '床から浮いていない');
});

test('置き方：奥の薪へ立てかけると傾き、片方は床に着く', () => {
  const sim = new FireSim(11);
  placeStep(sim, { kind: 'medium', x: 0, z: -0.1, yawDeg: 0 });
  const r = placeStep(sim, { kind: 'kindling', x: 0, z: -0.01, yawDeg: 90 });
  assert.ok(r.piece);
  assert.ok(Math.abs(r.piece!.pose.pitch) > 0.1, '傾いていない');
  assert.ok(r.placement.supports.some((s) => s.by === 'floor'));
  assert.ok(r.placement.supports.some((s) => s.by !== 'floor'));
});

test('置き方：火口は立てかけた細薪の下の隙間へ入れられるが、寝ている薪の上には置けない', () => {
  const sim = new FireSim(12);
  placeStep(sim, { kind: 'medium', x: 0, z: -0.1, yawDeg: 0 });
  placeStep(sim, { kind: 'kindling', x: 0, z: -0.01, yawDeg: 90 });
  const ok = placeStep(sim, { kind: 'tinder', x: 0, z: -0.01, yawDeg: 0 });
  assert.ok(ok.piece, `隙間へ入らない: ${ok.reason}`);
  const sim2 = new FireSim(13);
  placeStep(sim2, { kind: 'medium', x: 0, z: 0, yawDeg: 0 });
  const ng = placeStep(sim2, { kind: 'tinder', x: 0, z: 0, yawDeg: 0 });
  assert.equal(ng.piece, null);
  assert.match(ng.reason ?? '', /重なっています/);
});

test('置き方：丸い薪の真上に平行に置くと横へ転がって落ち着く', () => {
  const sim = new FireSim(14);
  placeStep(sim, { kind: 'medium', x: 0, z: 0, yawDeg: 0 });
  const r = placeStep(sim, { kind: 'medium', x: 0, z: 0.005, yawDeg: 0 });
  assert.ok(r.piece);
  assert.ok(Math.abs(r.piece!.pose.z) > 0.03, '真上に乗ったまま');
});

test('置き方：台の外へ出る位置は内側へ寄せる', () => {
  const sim = new FireSim(15);
  const pend = nextPendingPiece(sim, 'medium');
  const r = placeAt(sim, pend, 0.25, 0, 0);
  assert.ok(r.piece, r.reason ?? '');
  assert.ok(r.placement.clamped);
  assert.ok(r.piece!.pose.x + r.piece!.length / 2 <= BALANCE.tray.innerHalf);
});

test('本数の上限：中薪5本・細薪6本・火口1束', () => {
  const sim = new FireSim(16);
  const spots = [-0.2, -0.1, 0, 0.1, 0.2, 0.25];
  let placed = 0;
  for (const z of spots) if (placeStep(sim, { kind: 'medium', x: 0, z, yawDeg: 0 }).piece) placed++;
  assert.equal(sim.countOf('medium'), BALANCE.pieces.medium.maxCount);
  assert.ok(placed <= 5);
  placeStep(sim, { kind: 'tinder', x: 0.2, z: 0.2, yawDeg: 0 });
  const second = placeStep(sim, { kind: 'tinder', x: -0.2, z: 0.2, yawDeg: 0 });
  assert.equal(second.piece, null);
});

test('熾火へ入ると薪を足せなくなり（見守る）、その15秒前に案内が出る', () => {
  const r = runScenario({ ...byName('yuttari'), seconds: 5 }, 3);
  const sim = r.sim;
  sim.session.activeTime = sim.session.durationSeconds * BALANCE.session.emberStartRatio - 16;
  const types: string[] = [];
  for (let i = 0; i < 30; i++) {
    sim.step();
    types.push(...sim.drainEvents().map((e) => e.type));
  }
  assert.ok(types.includes('emberNotice'));
  assert.ok(!types.includes('emberPhase'));
  for (let i = 0; i < 150; i++) {
    sim.step();
    types.push(...sim.drainEvents().map((e) => e.type));
  }
  assert.ok(types.includes('emberPhase'));
  assert.equal(sim.canAdd('medium').ok, false);
});

test('組み方の違い（詳細仕様6章の基礎空気量 立てかけ85＞井桁75＞ゆったり65＞寄せ45）：燃えている間の空気の順が同じ。井桁・立てかけは早く強い火に、寄せ薪は小さく落ち着く', () => {
  const measure = (id: (typeof LAYOUT_ORDER)[number]) => {
    const sim = new FireSim(12345);
    for (const st of LAYOUTS[id].steps) placeStep(sim, st);
    sim.startLighter();
    const t0 = sim.time;
    let ox = 0;
    let heat = 0;
    let n = 0;
    let hot: number | null = null;
    for (let i = 0; i < 1800; i++) {
      sim.step();
      sim.drainEvents();
      const t = sim.time - t0;
      if (hot === null && sim.metrics.heat >= 60) hot = t;
      if (t > 30 && t < 180) {
        ox += sim.metrics.oxygen;
        heat += sim.metrics.heat;
        n++;
      }
    }
    return { oxygen: ox / n, heat: heat / n, hot };
  };
  const m = Object.fromEntries(LAYOUT_ORDER.map((id) => [id, measure(id)])) as Record<(typeof LAYOUT_ORDER)[number], ReturnType<typeof measure>>;
  const byAir = [...LAYOUT_ORDER].sort((a, b) => m[b].oxygen - m[a].oxygen);
  const bySpec = [...LAYOUT_ORDER].sort((a, b) => LAYOUTS[b].baseAir - LAYOUTS[a].baseAir);
  assert.deepEqual(byAir, bySpec, LAYOUT_ORDER.map((id) => `${id} ${m[id].oxygen.toFixed(1)}`).join(' / '));
  // 井桁・立てかけは早く強い火（火力60）に届き、ゆったりはゆっくり、寄せ薪は届かない
  assert.ok(m.igeta.hot !== null && m.tatekake.hot !== null && m.yuttari.hot !== null);
  assert.ok(m.igeta.hot! < m.yuttari.hot! - 30 && m.tatekake.hot! < m.yuttari.hot! - 30);
  assert.equal(m.yose.hot, null);
  assert.ok(m.yose.heat < m.yuttari.heat && m.yuttari.heat < m.igeta.heat);
});
