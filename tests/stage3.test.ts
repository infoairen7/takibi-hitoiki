/**
 * 第3段階：描画のFPSが違っても、ゲームの進み方（成長・燃料・終了時刻）は変わらないこと。
 *   npx tsx --test tests/*.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALANCE } from '../src/game/balance';
import { GameClock } from '../src/game/clock';
import { FireSession } from '../src/game/session';
import { FireSim } from '../src/game/fire/sim';
import { LAYOUTS } from '../src/game/fire/layouts';
import { addLogNearFire, placeStep } from '../src/game/fire/builder';
import { Rng } from '../src/game/rng';

/** 描画のフレームの長さの列を作る（秒）。jitter で揺らし、ときどき長いフレーム（カクつき）を混ぜる */
function frames(fps: number, seconds: number, jitter = 0, hitchEvery = 0, seed = 1): number[] {
  const r = new Rng(seed);
  const out: number[] = [];
  let t = 0;
  let i = 0;
  while (t < seconds) {
    let dt = 1 / fps;
    if (jitter) dt *= 1 + (r.next() * 2 - 1) * jitter;
    if (hitchEvery && ++i % hitchEvery === 0) dt = 0.2;
    out.push(dt);
    t += dt;
  }
  return out;
}

test('時計：30・60・144fps、揺らぎやカクつきがあっても、同じ実時間で同じ回数だけ進む', () => {
  const want = Math.round(600 / BALANCE.sim.dt);
  for (const [fps, jitter, hitch] of [
    [30, 0, 0],
    [60, 0, 0],
    [144, 0, 0],
    [60, 0.3, 0],
    [45, 0.2, 97],
  ] as const) {
    const c = new GameClock();
    let steps = 0;
    const fr = frames(fps, 600, jitter, hitch, 7);
    const real = fr.reduce((a, b) => a + b, 0);
    for (const dt of fr) steps += c.advance(dt);
    const expect = Math.round(real / BALANCE.sim.dt);
    assert.ok(Math.abs(steps - expect) <= 1, `${fps}fps jitter=${jitter}: ${steps} / ${expect}`);
    assert.ok(Math.abs(steps - want) <= 3, `${fps}fps：600秒で ${steps} 回`);
    assert.equal(c.droppedSteps, 0);
  }
});

test('時計：止めている間は進まず、長い停止のあとにまとめて進めない', () => {
  const c = new GameClock();
  c.pause('hidden');
  assert.equal(c.advance(30), 0);
  c.resume('hidden');
  // 戻った最初のフレームが長くても（30秒）、上限（0.5秒ぶん）までしか進まず、残りは捨てた刻みとして数える
  assert.ok(c.advance(30) <= Math.ceil(BALANCE.sim.maxFrameDt / BALANCE.sim.dt));
  assert.ok(c.droppedSteps >= Math.floor((30 - BALANCE.sim.maxFrameDt) / BALANCE.sim.dt) - 1);
});

/** 同じ操作（ゲーム時間で決める）を、違うFPSで遊んだときの結果 */
function playAt(fps: number, jitter: number): { fp: string; endAt: number | null; fuelAt300: number; stableAt300: number } {
  const sim = new FireSim(4242);
  const comp = new FireSession(sim.seed, sim.session.durationSeconds);
  for (const st of LAYOUTS.igeta.steps) {
    placeStep(sim, st);
    comp.notePlaced(sim, st.kind, sim.pieces[sim.pieces.length - 1]?.species);
  }
  sim.startLighter();
  const clock = new GameClock();
  let lastCare = -99;
  let endAt: number | null = null;
  let fuelAt300 = -1;
  let stableAt300 = -1;
  for (const dt of frames(fps, 700, jitter, 0, 3)) {
    const n = clock.advance(dt);
    for (let i = 0; i < n; i++) {
      // 操作はゲーム時間で決める（人の操作に相当）
      const t = sim.ignitedAt === null ? 0 : sim.time - sim.ignitedAt;
      if (sim.phase === 'burning' && !sim.session.emberPhase && t - lastCare > 20 && sim.metrics.fuelRatio < 0.35) {
        if (addLogNearFire(sim)) comp.noteCare(sim, 'log');
        lastCare = t;
      }
      sim.step();
      comp.step(sim, sim.drainEvents());
      if (fuelAt300 < 0 && sim.session.activeTime >= 300) {
        fuelAt300 = sim.metrics.fuelRatio;
        stableAt300 = comp.stats.stableSeconds;
      }
      if (comp.ended && endAt === null) endAt = sim.session.activeTime;
    }
    if (comp.ended) break;
  }
  return { fp: comp.fingerprint(), endAt, fuelAt300, stableAt300 };
}

test('30fpsと60fps（揺らぎあり）で、燃料・落ち着いた火の時間・記録・終了時刻が一致する', () => {
  const a = playAt(30, 0);
  const b = playAt(60, 0.25);
  const c = playAt(120, 0.1);
  assert.ok(a.endAt !== null && Math.abs(a.endAt - BALANCE.session.shortSeconds) < 1, `終了 ${a.endAt}`);
  assert.equal(b.endAt, a.endAt);
  assert.equal(c.endAt, a.endAt);
  assert.equal(b.fuelAt300, a.fuelAt300);
  assert.equal(b.stableAt300, a.stableAt300);
  assert.ok(a.stableAt300 > 0);
  assert.equal(b.fp, a.fp);
  assert.equal(c.fp, a.fp);
});

// ───────────────────────────── 動作チェック（数え方）

import { DeviceCheck } from '../src/game/deviceCheck';

const stats0 = { fps: 60, dpr: 1, quality: 'standard', drawCalls: 40, triangles: 30000 };
const state0 = { phase: 'burning', burning: true, paused: false, pieces: 7, place: '森の湖畔', mode: 'ひと息10分' };

test('動作チェック：画面を離れていた時間・止めていた時間・新しい火で、ゲームの進みの割合が崩れない', () => {
  const c = new DeviceCheck({ seconds: 60, now: 0, gameSeconds: 100, stats: stats0, state: state0, droppedSteps: 0 });
  let now = 0;
  let game = 100;
  // 20秒：60fpsで実時間どおりに進む
  for (let i = 0; i < 1200; i++) {
    now += 1000 / 60;
    game += 1 / 60;
    c.frame(now, false, game, 0);
  }
  // 15秒：画面を離れる（フレームなし・ゲームも止まる）
  c.setHidden(true, now);
  now += 15000;
  c.setHidden(false, now);
  // 10秒：メニューで止める（フレームはあるが、ゲームは進まない）
  for (let i = 0; i < 600; i++) {
    now += 1000 / 60;
    c.frame(now, true, game, 0);
  }
  // 新しい火：ゲーム時間が0から始まり直す。そこから15秒、実時間どおり
  game = 0;
  for (let i = 0; i < 900; i++) {
    now += 1000 / 60;
    game += 1 / 60;
    c.frame(now, false, game, i > 450 ? 3 : 0);
  }
  c.finish({ now, gameSeconds: game, stats: stats0, state: state0, droppedSteps: 3 });
  const s = c.summary();
  assert.ok(s.gameRate !== null && Math.abs(s.gameRate - 1) < 0.03, `進み ${s.gameRate}`);
  assert.ok(Math.abs(s.avgFps - 60) < 1, `fps ${s.avgFps}`);
  const text = c.report({ qualitySetting: '自動', soundEnabled: false, audioState: 'まだ開始していない', audioLatencyMs: null, sceneInitMs: 1200, reducedMotion: false, textSize: '標準' }, 'test');
  assert.match(text, /捨てた刻み：3/);
  assert.match(text, /入力：計測中に画面へ触れなかった/);
});
