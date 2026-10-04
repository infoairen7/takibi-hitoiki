/**
 * 火吹き筒（詳細仕様6章：道具は火ばさみ・うちわ・火吹き筒の3系統。初期は火ばさみとうちわ。
 * 火吹き筒は細かな送風向けの操作差で、上位互換にしない）。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALANCE } from '../src/game/balance';
import { addLogNearFire } from '../src/game/fire/builder';
import { LayoutId } from '../src/game/fire/layouts';
import { FireSim } from '../src/game/fire/sim';
import { defaultTubeSpot, tubeSpots } from '../src/game/fire/tube';
import { newUnlockLabels, nextUnlock, tubeUnlocked } from '../src/game/progress';
import { runBot } from '../scripts/playbot';
import { runScenario, SCENARIOS } from '../scripts/scenarios';

const byName = (n: string) => SCENARIOS.find((s) => s.name === n)!;
const blowsAt = (x: number, z: number, level: number, n = 6, start = 2, every = 3.4) => Array.from({ length: n }, (_, i) => ({ at: start + i * every, level, x, z }));

test('火吹き筒：初期は火ばさみとうちわだけ。発見3件で解放され、手帳と通知に出る', () => {
  assert.equal(tubeUnlocked(0), false);
  assert.equal(tubeUnlocked(BALANCE.tube.unlockAt - 1), false);
  assert.equal(tubeUnlocked(BALANCE.tube.unlockAt), true);
  assert.ok(newUnlockLabels(BALANCE.tube.unlockAt - 1, BALANCE.tube.unlockAt).includes('道具「火吹き筒」'));
  assert.match(nextUnlock(BALANCE.tube.unlockAt - 1)?.label ?? '', /火吹き筒/);
});

test('火吹き筒：息継ぎの間（3秒）のひと吹きは受け付けない（連打は強くならない）', () => {
  const sim = new FireSim(5);
  assert.equal(sim.blow(0, 0, 1), true);
  for (let i = 0; i < 10; i++) sim.step();
  assert.equal(sim.blow(0, 0, 1), false);
  for (let i = 0; i < Math.ceil(BALANCE.tube.minInterval * BALANCE.sim.hz); i++) sim.step();
  assert.equal(sim.blow(0, 0, 1), true);
});

test('火吹き筒：風は狙った一点だけに届く（10cm離れるとほぼゼロ。うちわは台全体）', () => {
  const sim = new FireSim(6);
  sim.blow(0.05, -0.02, 1);
  for (let i = 0; i < 5; i++) sim.step();
  const y = BALANCE.tray.floorY + BALANCE.tube.aimHeight;
  const at = sim.tubeWindAt([0.05, y, -0.02]);
  const far = sim.tubeWindAt([0.15, y, -0.02]);
  assert.ok(at > 1, `狙った点が弱い ${at}`);
  assert.ok(far < at * 0.01, `離れた所にも届く ${far}`);
  // 炎の傾き（風下への燃え移り）に使う風には入らない
  assert.ok(Math.hypot(...sim.wind.phys) < 0.2);
});

test('火吹き筒は、うちわの上位互換ではない：風下の細薪への燃え移りは、うちわでは起き、火吹き筒ではどこを狙っても起きない', () => {
  const off = byName('offset-kindling-no-wind');
  const fan = runScenario(byName('offset-kindling-wind-left-mid'));
  assert.ok(fan.firstKindling !== null, 'うちわで風下へ燃え移らない');
  for (const [x, z] of [[-0.02, 0], [0.02, 0], [0.055, 0]]) {
    for (const level of [0, 1]) {
      const r = runScenario({ ...off, name: `tube-${x}-${level}`, blows: blowsAt(x, z, level) });
      assert.equal(r.firstKindling, null, `火吹き筒（${x},${z} / ${level}）で燃え移った`);
    }
  }
});

test('火吹き筒：着火直後の小さな火へ「しっかり」吹くと消える。「そっと」なら消えない（狙い方・吹き方が大事）', () => {
  const yu = byName('yuttari');
  const t = yu.steps.find((s) => s.kind === 'tinder')!;
  const hard = runScenario({ ...yu, name: 'tube-hard', blows: blowsAt(t.x, t.z, 1, 5, 1, 3.2) });
  const soft = runScenario({ ...yu, name: 'tube-soft', blows: blowsAt(t.x, t.z, 0, 5, 1, 3.2) });
  assert.ok(hard.outAt !== null && hard.firstKindling === null, '強く吹いても消えない');
  assert.equal(soft.outAt, null);
  assert.ok(soft.stage0 !== null, '「そっと」で育たない');
});

/** 井桁型を見守るだけで燃やし、at 秒に中薪を足して、60秒のあいだ道具を使う */
function late(at: number, tool: 'none' | 'fan' | 'tube' | 'tubeSoft' | 'tubeMiss', layout: LayoutId = 'igeta') {
  let added = -1;
  let last = -99;
  let litAfter: number | null = null;
  runBot({
    policy: 'watch',
    layout,
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
      const p = sim.pieces.find((q) => q.id === added);
      if (p && tool !== 'none' && t < at + 60 && litAfter === null) {
        if (tool === 'fan' && t - last > 4) {
          if (sim.gust(1, 'front')) sess.noteCare(sim, 'gust');
          last = t;
        }
        if (tool !== 'fan' && t - last > BALANCE.tube.minInterval + 0.05) {
          // 新しい薪の、いちばん熱い区間の下を狙う（tubeMiss は台の反対側）
          let bi = 0;
          p.segs.forEach((s, i) => {
            if (s.T > p.segs[bi].T) bi = i;
          });
          const x = tool === 'tubeMiss' ? -0.2 : p.segPos[bi][0];
          const z = tool === 'tubeMiss' ? 0.2 : p.segPos[bi][2];
          if (sim.blow(x, z, tool === 'tubeSoft' ? 0 : 1)) sess.noteCare(sim, 'blow');
          last = t;
        }
      }
      if (p && litAfter === null && p.firstLitAt !== null) litAfter = p.firstLitAt - sim.ignitedAt - at;
    },
  });
  return litAfter;
}

test('火吹き筒：消えかけの火に足した薪の下を狙って吹くと、熾が起きて燃え移る。狙いを外すと効かない', () => {
  const none = late(400, 'none');
  const tube = late(400, 'tube');
  const miss = late(400, 'tubeMiss');
  assert.ok(tube !== null && tube < 30, `狙って吹いても遅い（${tube}）`);
  assert.ok(none === null || none > tube! + 20, `吹かなくても同じ（${none} / ${tube}）`);
  assert.ok(miss === null || miss > tube! + 20, `狙いを外しても効く（${miss} / ${tube}）`);
});

test('うちわと火吹き筒は得意が違う：まだ火がある時はうちわが速く、熾だけの終わりぎわは一点に吹く火吹き筒が届く', () => {
  const fan300 = late(300, 'fan');
  const tubeSoft300 = late(300, 'tubeSoft');
  assert.ok(fan300 !== null && tubeSoft300 !== null && fan300 < tubeSoft300, `火がある時：うちわ${fan300} 火吹き筒${tubeSoft300}`);
  const fan480 = late(480, 'fan');
  const tube480 = late(480, 'tube');
  assert.equal(fan480, null, `終わりぎわにうちわで戻った（${fan480}）`);
  assert.ok(tube480 !== null && tube480 < 60, `終わりぎわに火吹き筒で戻らない（${tube480}）`);
});

test('火吹き筒：狙う場所の候補は、薪ごとの熱い区間と台の熾。既定はいちばん熱い所', () => {
  const r = runBot({ policy: 'watch', layout: 'igeta', seed: 31, seconds: 200 });
  const spots = tubeSpots(r.sim);
  assert.ok(spots.length >= 3);
  assert.ok(spots.some((s) => s.label === '台の底の熾'));
  for (let i = 1; i < spots.length; i++) assert.ok(spots[i - 1].x <= spots[i].x, '左から右へ並ばない');
  const d = defaultTubeSpot(r.sim)!;
  assert.equal(d.score, Math.max(...spots.map((s) => s.score)));
});

test('火吹き筒：ひと吹きの途中で保存・復元しても、同じ結果になる', () => {
  const sim = runScenario({ ...byName('yuttari'), seconds: 40 }, 77).sim;
  assert.equal(sim.blow(0, 0, 1), true);
  for (let i = 0; i < 8; i++) sim.step();
  const b = FireSim.deserialize(JSON.parse(JSON.stringify(sim.serialize())));
  for (let i = 0; i < 300; i++) {
    sim.step();
    b.step();
  }
  assert.equal(b.fingerprint(), sim.fingerprint());
});
