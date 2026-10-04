/**
 * 発見・解放・記録（薪12種・発見24件・場所と焚き火台・装飾・記録の書き出しと読み込み）の確認。
 *   npx tsx --test tests/*.test.ts
 * 2026-10-04：キャラクターを企画から外し、発見課題を焚き火の発見に差し替えた。前の版の記録の引き継ぎも確かめる。
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BALANCE, WOODS, WoodId } from '../src/game/balance';
import { FireSim } from '../src/game/fire/sim';
import { FireSession } from '../src/game/session';
import { DECORS, LEGACY_TASK_IDS, PLACES, TASKS, TRAYS, WOOD_UNLOCKS } from '../src/data/discoveries';
import { achieve, emptyProgress, isProgress, migrateProgress, newUnlockLabels, nextUnlock, taskCount, tubeUnlocked, unlockCount, unlockedDecors, unlockedPlaces, unlockedTrays, unlockedWoods } from '../src/game/progress';
import { WOOD_NOTES } from '../src/data/texts';
import { runBot } from '../scripts/playbot';

// ───────────────────────────── 発見課題と解放

test('発見課題は24件（焚き火の発見だけ）。薪は2・4・6・8件で2種ずつ、場所は2・4・6・8件、焚き火台4種、装飾8種、火吹き筒は3件', () => {
  assert.equal(TASKS.length, 24);
  assert.equal(new Set(TASKS.map((t) => t.id)).size, 24);
  for (const t of TASKS) assert.ok(!/会う|おじ火|ギャル|火の精/.test(t.label + t.hint), `キャラクターの課題が残っている：${t.label}`);
  for (const id of LEGACY_TASK_IDS) assert.ok(!TASKS.some((t) => (t.id as string) === id), `前の版の課題の名前を使い回している：${id}`);
  assert.deepEqual(unlockedWoods(0), ['nara', 'kunugi', 'shirakaba', 'sakura']);
  assert.equal(unlockedWoods(1).length, 4);
  assert.equal(unlockedWoods(2).length, 6);
  assert.equal(unlockedWoods(8).length, 12);
  assert.equal(new Set(WOOD_UNLOCKS.flatMap((u) => u.woods)).size, 12);
  assert.deepEqual(unlockedPlaces(0), ['lakeside', 'forest']);
  assert.deepEqual(PLACES.map((p) => p.at), [0, 0, 2, 4, 6, 8]);
  assert.equal(unlockedPlaces(8).length, 6);
  assert.equal(TRAYS.filter((t) => t.at > 0).length, 4);
  assert.deepEqual(unlockedTrays(0), ['first']);
  assert.equal(DECORS.length, 8);
  assert.equal(unlockedDecors(9).length, 0);
  assert.equal(unlockedDecors(24).length, 8);
  assert.equal(tubeUnlocked(2), false);
  assert.equal(tubeUnlocked(3), true);
  assert.deepEqual(newUnlockLabels(1, 2), ['薪「りんご・かえで」', '場所「海辺」']);
  assert.deepEqual(nextUnlock(0), { at: 2, label: '薪「りんご・かえで」、場所「海辺」' });
  assert.equal(nextUnlock(24), null);
});

test('どの発見にも、達成のきっかけがゲームの中にある（進行役の中に課題の名前がある）', () => {
  const code = ['src/game/controller.ts', 'src/game/session.ts'].map((f) => readFileSync(join(process.cwd(), f), 'utf8')).join('\n');
  for (const t of TASKS) assert.ok(code.includes(`'${t.id}'`), `${t.id}（${t.label}）を達成する所がない`);
});

test('解放が循環しない：先に解放が要る発見（12種の薪・6か所・しめり木・火吹き筒）を除いても、8件に届く', () => {
  const needUnlock = new Set(['t16', 't24', 'f09', 'f03']);
  assert.ok(TASKS.filter((t) => !needUnlock.has(t.id)).length >= 8);
  // 火吹き筒（3件）・しめり木（8件）で解放されるものだけに頼る課題は、それぞれの件数より前に要らない
  assert.ok(BALANCE.tube.unlockAt <= 8);
});

test('これまでの発見の保存形式の検査：壊れた値は読まない。前の版の課題の名前は読める', () => {
  const p = emptyProgress();
  assert.ok(achieve(p, 't01'));
  assert.equal(achieve(p, 't01'), false);
  assert.equal(taskCount(p), 1);
  assert.ok(isProgress(p));
  assert.equal(isProgress({ ...p, tasks: { t99: 'x' } }), false);
  assert.equal(isProgress({ ...p, woodsUsed: ['oak'] }), false);
  assert.equal(isProgress({ ...p, memoryPlaces: ['moon'] }), false);
  assert.equal(isProgress({ ...p, schemaVersion: 2 }), false);
  assert.equal(isProgress({ ...p, unlockFloor: -1 }), false);
  assert.equal(isProgress(null), false);
  // 前の版（キャラクターがいた版）の課題
  assert.equal(isProgress({ ...p, tasks: { t01: 'a', t02: 'b', t22: 'c' } }), true);
});

test('前の版の記録から：キャラクターの課題は外し、解放されていたものはそのまま残す', () => {
  const old = { schemaVersion: 1 as const, tasks: { t01: 'a', t02: 'b', t03: 'c', t14: 'd', t11: 'e' } as Record<string, string>, met: {}, woodsUsed: [], memoryPlaces: [] };
  const m = migrateProgress(old as never);
  assert.deepEqual(Object.keys(m.tasks).sort(), ['t01', 't14']);
  assert.equal(taskCount(m), 2);
  assert.equal(m.unlockFloor, 5);
  assert.equal(unlockCount(m), 5);
  // 4件で解放されていた けやき・ぶな・雨音の東屋 は使えるまま
  assert.ok(unlockedWoods(unlockCount(m)).includes('keyaki'));
  assert.ok(unlockedPlaces(unlockCount(m)).includes('pavilion'));
  // 新しい発見が下限を超えるまでは、解放の知らせは出ない（もう解放されているため）
  assert.equal(migrateProgress(m).unlockFloor, 5, '二度読んで下限が変わった');
  const fresh = migrateProgress({ ...emptyProgress(), tasks: { t01: 'a' } });
  assert.equal(fresh.unlockFloor, undefined, '前の版でない記録に下限が付いた');
});

test('広葉樹は なら〜ぶな の8種（しめり木・針葉樹は数えない）', () => {
  const hard = (Object.keys(WOODS) as WoodId[]).filter((w) => WOODS[w].hardwood);
  assert.deepEqual(hard, ['nara', 'kunugi', 'shirakaba', 'sakura', 'ringo', 'kaede', 'keyaki', 'buna']);
});

// ───────────────────────────── 20分モード

test('20分モード：火を灯す前なら切り替えられ、灯した後は変わらない。続けて眺める発見の秒数は長さに合わせる', () => {
  const sim = new FireSim(5);
  sim.setMode('long');
  assert.equal(sim.session.durationSeconds, BALANCE.session.longSeconds);
  const c = new FireSession(5, sim.session.durationSeconds);
  assert.equal(c.modeScale, BALANCE.session.longSeconds / BALANCE.session.shortSeconds);
  sim.setMode('short');
  assert.equal(sim.session.durationSeconds, BALANCE.session.shortSeconds);
  const r = runBot({ policy: 'standard', layout: 'igeta', seed: 9, seconds: 20 });
  r.sim.setMode('long');
  assert.equal(r.sim.session.durationSeconds, BALANCE.session.shortSeconds, '灯した後に長さが変わった');
});

// ───────────────────────────── 記録の書き出し・読み込み

import { buildRecordFile, mergeAlbum, mergeProgress, parseRecordFile } from '../src/persistence/records';
import type { AlbumEntry } from '../src/persistence/storage';
import type { ProgressData } from '../src/game/progress';

const entry = (id: string, savedAt: string, fav = false): AlbumEntry => ({
  id,
  savedAt,
  dateLabel: '2026.10.01',
  fireName: 'こはく',
  characterId: 'komugi',
  characterLabel: 'まったりギャル・こむぎ',
  stageName: 'まったりギャル',
  woods: 'なら × しらかば',
  place: '森の湖畔',
  layout: 'ゆったり型',
  howRaised: 'そっと見守って、最後まで。',
  lastLine: '今日はここまで。また火、つけよ。',
  minutes: '10分',
  reason: 'natural',
  mood: 'まったり気分',
  favorite: fav,
  provisional: true,
});

const progA = (): ProgressData => ({
  schemaVersion: 1,
  tasks: { t01: '2026-09-01T10:00:00.000Z', t02: '2026-09-02T10:00:00.000Z' } as ProgressData['tasks'],
  met: { komugi: { firstAt: '2026-09-02T10:00:00.000Z', count: 3, reason: '穏やかな火を、安定して育てた' } },
  woodsUsed: ['nara', 'shirakaba'],
  memoryPlaces: ['lakeside'],
});
const progB = (): ProgressData => ({
  schemaVersion: 1,
  tasks: { t01: '2026-08-01T10:00:00.000Z', t11: '2026-09-05T10:00:00.000Z' } as ProgressData['tasks'],
  met: { komugi: { firstAt: '2026-09-03T10:00:00.000Z', count: 1, reason: 'x' }, ojibi: { firstAt: '2026-09-05T10:00:00.000Z', count: 2, reason: 'y' } },
  woodsUsed: ['kunugi', 'nara'],
  memoryPlaces: ['forest'],
});

test('記録ファイル：書き出したものをそのまま読み込める（画像は思い出のものだけ、画像の形式だけ）', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const f = buildRecordFile(progA(), [entry('a', '2026-09-02T10:00:00.000Z')], { a: png, ghost: png }, new Date('2026-10-01T00:00:00Z'));
  const r = parseRecordFile(JSON.stringify(f));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.file.progress, progA());
  assert.equal(r.file.album.length, 1);
  assert.deepEqual(Object.keys(r.file.thumbs), ['a'], '知らない思い出の画像を取り込んだ');
  const evil = parseRecordFile(JSON.stringify({ ...f, thumbs: { a: 'javascript:alert(1)' } }));
  assert.ok(evil.ok && Object.keys(evil.file.thumbs).length === 0, '画像でないものを取り込んだ');
});

test('記録ファイル：形式違い・壊れたものは、理由を返して何も取り込まない', () => {
  const good = buildRecordFile(progA(), [entry('a', '2026-09-02T10:00:00.000Z')], {});
  const bad: Array<[string, string]> = [
    ['not json', 'このゲームの記録ファイルではないようです。'],
    [JSON.stringify({ ...good, format: 'other' }), 'このゲームの記録ファイルではないようです。'],
    [JSON.stringify({ ...good, version: 2 }), '新しい版で書き出された記録のため、読み込めません。'],
    [JSON.stringify({ ...good, progress: { ...progA(), met: { stranger: { firstAt: '2026-09-01T00:00:00Z', count: 1, reason: 'x' } } } }), '発見の記録が壊れているため、読み込みませんでした。'],
    [JSON.stringify({ ...good, progress: { ...progA(), tasks: { t01: 'yesterday' } } }), '発見の記録が壊れているため、読み込みませんでした。'],
    [JSON.stringify({ ...good, album: { a: 1 } }), '思い出の記録が壊れているため、読み込みませんでした。'],
  ];
  for (const [text, reason] of bad) {
    const r = parseRecordFile(text);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, reason);
  }
});

test('記録ファイル：読めない思い出は一件ずつ外して数える。絵文字の名前（12文字）も読める', () => {
  const emoji = '🏳️‍🌈'.repeat(12);
  const ok = entry('ok', '2026-09-02T10:00:00.000Z');
  const named = { ...entry('emoji', '2026-09-03T10:00:00.000Z'), fireName: emoji };
  assert.ok(emoji.length > 64, 'テストの前提：UTF-16では64を超える');
  const f = buildRecordFile(progA(), [ok, named, { ...entry('bad', '2026-09-04T10:00:00.000Z'), reason: 'boom' } as unknown as AlbumEntry, { ...entry('ok', '2026-09-05T10:00:00.000Z') }, { ...entry('who', '2026-09-06T10:00:00.000Z'), characterId: 'stranger' } as unknown as AlbumEntry], {});
  const r = parseRecordFile(JSON.stringify(f));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.file.album.map((e) => e.id), ['ok', 'emoji']);
  assert.equal(r.dropped, 3);
  const long = parseRecordFile(JSON.stringify(buildRecordFile(progA(), [{ ...ok, fireName: 'あ'.repeat(13) }], {})));
  assert.ok(long.ok && long.file.album.length === 0 && long.dropped === 1, '13文字の名前を通した');
});

test('発見の足し合わせ：早い日時・多い回数・和集合。同じ記録を二度読んでも増えない。前の版の課題は外して、解放の数は残す', () => {
  const m = mergeProgress(progA(), progB());
  // t02（こむぎに会う）・t11（おじ火に会う）は前の版の課題：外して、解放の下限（それぞれ2件）を残す
  assert.deepEqual(Object.keys(m.tasks).sort(), ['t01']);
  assert.equal(m.unlockFloor, 2);
  assert.equal(m.tasks.t01, '2026-08-01T10:00:00.000Z');
  assert.equal(m.met.komugi.count, 3);
  assert.equal(m.met.komugi.firstAt, '2026-09-02T10:00:00.000Z');
  assert.equal(m.met.ojibi.count, 2);
  assert.deepEqual(m.woodsUsed, ['nara', 'kunugi', 'shirakaba']);
  assert.deepEqual(m.memoryPlaces, ['lakeside', 'forest']);
  assert.deepEqual(mergeProgress(m, m), m);
  assert.deepEqual(mergeProgress(m, progB()), m);
  assert.ok(isProgress(m));
});

test('アルバムの足し合わせ：今の思い出は消さない。お気に入りは残し、100件を超える分は取り込まずに数える', () => {
  const local = [entry('a', '2026-09-02T10:00:00.000Z'), entry('b', '2026-09-03T10:00:00.000Z')];
  const incoming = [entry('b', '2026-09-03T10:00:00.000Z', true), entry('c', '2026-09-04T10:00:00.000Z'), entry('d', '2026-09-01T10:00:00.000Z')];
  const r = mergeAlbum(local, incoming, 3);
  assert.deepEqual(r.entries.map((e) => e.id), ['c', 'b', 'a'], '新しい順・上限3');
  assert.equal(r.entries.find((e) => e.id === 'b')!.favorite, true);
  assert.deepEqual(r.added, ['c']);
  assert.equal(r.skipped, 1);
  assert.equal(r.same, 1);
  const again = mergeAlbum(r.entries, incoming, 3);
  assert.deepEqual(again.added, []);
  assert.deepEqual(again.entries.map((e) => e.id), ['c', 'b', 'a']);
});


test('薪のひとこと：12樹種すべてにあり、重ならず、避ける言葉を使わない。りんご・ひのきは香りにふれる', () => {
  const ids = Object.keys(WOODS) as WoodId[];
  assert.deepEqual(Object.keys(WOOD_NOTES).sort(), [...ids].sort());
  const texts = ids.map((w) => WOOD_NOTES[w]);
  assert.equal(new Set(texts).size, texts.length);
  for (const w of ids) assert.ok(WOOD_NOTES[w].startsWith(WOODS[w].label), `${w}：樹種の名前で始まらない`);
  for (const t of texts) assert.ok(!/(臭い|くさい|汚い|きたない)/.test(t), `避ける言葉：${t}`);
  assert.match(WOOD_NOTES.ringo, /香り/);
  assert.match(WOOD_NOTES.hinoki, /香り/);
});
