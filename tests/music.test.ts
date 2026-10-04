/**
 * BGM（自作・その場で合成）：和音とメロディの音の選び方。音の大きさ・つなぎ目は scripts/audio-check.mjs（ブラウザ）で確かめる。
 *   npx tsx --test tests/*.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MUSIC_KEYS, chordNotes, melodyNotes, midiToFreq, phaseShape } from '../src/audio/music';
import { PLACES } from '../src/data/discoveries';

test('BGM：6つの場所すべてに調と和音の並びがある', () => {
  for (const p of PLACES) assert.ok(MUSIC_KEYS[p.id], `${p.id} の調がない`);
});

test('BGM：和音は低すぎず高すぎない範囲で、音どうしが半音でぶつからない', () => {
  for (const place of Object.keys(MUSIC_KEYS)) {
    for (let i = 0; i < 8; i++) {
      const n = chordNotes(place, i);
      assert.ok(n.length >= 4);
      assert.ok(Math.min(...n) >= 33 && Math.max(...n) <= 72, `${place} ${n}`);
      const sorted = [...n].sort((a, b) => a - b);
      for (let k = 1; k < sorted.length; k++) assert.ok(sorted[k] - sorted[k - 1] >= 2, `${place}：半音のぶつかり ${sorted}`);
    }
  }
});

test('BGM：メロディはその調の5音だけ（どの和音とも濁りにくい）', () => {
  for (const place of Object.keys(MUSIC_KEYS)) {
    const k = MUSIC_KEYS[place];
    const notes = melodyNotes(place);
    assert.ok(notes.length >= 6);
    for (const m of notes) assert.ok([0, 2, 4, 7, 9].includes((((m - k.transpose) % 12) + 12) % 12), `${place} ${m}`);
    assert.ok(midiToFreq(Math.max(...notes)) < 1500, '高すぎる音（耳に刺さる）');
  }
  assert.ok(Math.abs(midiToFreq(69) - 440) < 1e-9);
});

test('BGM：熾火では音を減らし、見送りと思い出の画面では新しい音を鳴らさない', () => {
  const b = phaseShape('burning');
  const e = phaseShape('ember');
  assert.ok(e.note > b.note && e.level < b.level && e.chord > b.chord);
  for (const ph of ['farewell', 'ended'] as const) {
    const s = phaseShape(ph);
    assert.equal(s.melody, false);
    assert.equal(s.pads, false);
  }
});
