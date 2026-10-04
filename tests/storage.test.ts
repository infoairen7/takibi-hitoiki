/**
 * 必須12：アルバムの上限・保存エラー・壊れたデータで、今までの記録を失わない。
 * 端末の保存（localStorage）を、容量の上限を決められる偽物に差し替えて確かめる。
 *   npx tsx --test tests/*.test.ts
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

class FakeStorage {
  map = new Map<string, string>();
  /** これを超える書き込みは容量不足（QuotaExceededError） */
  quota = Infinity;
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    let used = 0;
    for (const [kk, vv] of this.map) if (kk !== k) used += kk.length + vv.length;
    if (used + k.length + v.length > this.quota) {
      const e = new Error('quota');
      e.name = 'QuotaExceededError';
      throw e;
    }
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

const fake = new FakeStorage();
const usedBytes = () => [...fake.map].reduce((a, [k, v]) => a + k.length + v.length, 0);
(globalThis as unknown as { window: unknown }).window = { localStorage: fake };

const S = await import('../src/persistence/storage');
const { emptyProgress } = await import('../src/game/progress');
type AlbumEntry = import('../src/persistence/storage').AlbumEntry;

const entry = (id: string, fav = false): AlbumEntry => ({
  id,
  savedAt: '2026-10-01T10:00:00.000Z',
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

beforeEach(() => {
  fake.clear();
  fake.quota = Infinity;
  S.takeAlbumBackupNotice();
  S.takeProgressBackupNotice();
});

test('アルバムが100件のとき：新しい思い出は「いっぱい」と返し、今の100件を書き換えない', () => {
  const list = Array.from({ length: S.ALBUM_MAX }, (_, i) => entry(`e${i}`, i === 3));
  assert.equal(S.replaceAlbum(list), true);
  const before = fake.getItem('gyarubi.album');
  assert.equal(S.addToAlbum(entry('new')), 'full');
  assert.equal(fake.getItem('gyarubi.album'), before);
  assert.equal(S.loadAlbum().length, S.ALBUM_MAX);
  // 同じ思い出をもう一度残すのは、上限でもできる（お気に入りは残す）
  assert.equal(S.addToAlbum({ ...entry('e3'), fireName: 'ほのか' }), 'exists');
  const e3 = S.loadAlbum().find((e) => e.id === 'e3')!;
  assert.equal(e3.fireName, 'ほのか');
  assert.equal(e3.favorite, true);
});

test('容量不足で保存できないとき：思い出・発見・続きの保存は「失敗」を返し、前の記録はそのまま', () => {
  assert.equal(S.addToAlbum(entry('a')), 'ok');
  const p = emptyProgress();
  p.tasks.t01 = '2026-10-01T10:00:00.000Z';
  assert.equal(S.saveProgress(p), true);
  const session = { schemaVersion: S.SCHEMA_VERSION, savedAt: '2026-10-01T10:00:00.000Z', sim: { pieces: [] } } as unknown as Parameters<typeof S.saveSession>[0];
  assert.equal(S.saveSession(session), true);
  const snap = JSON.stringify([...fake.map]);
  fake.quota = usedBytes() + 20; // 小さな書き込みはできるが、記録を書き足す空きはない
  assert.equal(S.addToAlbum(entry('b')), 'failed');
  const p2 = emptyProgress();
  for (const t of ['t01', 'f01', 'f02', 'f03'] as const) p2.tasks[t] = '2026-10-02T10:00:00.000Z';
  assert.equal(S.saveProgress(p2), false);
  assert.equal(S.saveSession({ ...session, savedAt: '2026-10-02T10:00:00.000Z', visual: { soot: Array(40).fill(0.5) } }), false);
  assert.equal(JSON.stringify([...fake.map]), snap, '前の記録が変わった');
  assert.deepEqual(S.loadAlbum().map((e) => e.id), ['a']);
  assert.ok(S.loadProgress().tasks.t01);
});

test('読めないアルバム：消さずに退避して新しく始め、一度だけ知らせる。退避した中身は元のまま', () => {
  fake.setItem('gyarubi.album', '{"entries": [ broken');
  assert.deepEqual(S.loadAlbum(), []);
  assert.equal(S.takeAlbumBackupNotice(), true);
  assert.equal(S.takeAlbumBackupNotice(), false);
  const backup = [...fake.map.keys()].find((k) => k.startsWith('gyarubi.album.broken.'));
  assert.ok(backup);
  assert.equal(fake.getItem(backup!), '{"entries": [ broken');
  assert.equal(S.addToAlbum(entry('a')), 'ok');
  assert.equal(fake.getItem(backup!), '{"entries": [ broken');
});

test('読めないアルバムを退避できない（容量不足）ときは、上書きもしない', () => {
  fake.setItem('gyarubi.album', '{"entries": [ broken');
  fake.quota = usedBytes() + 20; // 小さな書き込みはできるが、退避の分の空きはない
  assert.deepEqual(S.loadAlbum(), []);
  assert.equal(S.takeAlbumBackupNotice(), false);
  assert.equal(S.addToAlbum(entry('a')), 'failed');
  assert.equal(S.replaceAlbum([entry('a')]), false);
  assert.equal(fake.getItem('gyarubi.album'), '{"entries": [ broken');
});

test('読めない発見の記録も、退避できないときは上書きしない', () => {
  fake.setItem('gyarubi.progress', '{"schemaVersion":1,"tasks":');
  fake.quota = usedBytes() + 20;
  S.loadProgress();
  assert.equal(S.takeProgressBackupNotice(), false);
  fake.quota = Infinity;
  assert.equal(S.saveProgress(emptyProgress()), false);
  assert.equal(fake.getItem('gyarubi.progress'), '{"schemaVersion":1,"tasks":');
  // 退避できれば、新しく始めて保存できる
  S.loadProgress();
  assert.equal(S.takeProgressBackupNotice(), true);
  assert.equal(S.saveProgress(emptyProgress()), true);
  assert.ok([...fake.map.keys()].some((k) => k.startsWith('gyarubi.progress.broken.')));
});

test('読めない続きの保存：消さずに退避して、新しい火から始める', () => {
  fake.setItem('gyarubi.session', '{"schemaVersion":2,"sim":');
  const r = S.loadSession();
  assert.deepEqual(r, { ok: false, reason: 'corrupt' });
  const backup = [...fake.map.keys()].find((k) => k.startsWith('gyarubi.session.broken.'));
  assert.ok(backup);
  assert.equal(fake.getItem(backup!), '{"schemaVersion":2,"sim":');
  assert.equal(fake.getItem('gyarubi.session'), null);
});

test('お気に入りの思い出は、整理（削除）で消せない', () => {
  assert.equal(S.addToAlbum(entry('a', true)), 'ok');
  assert.equal(S.addToAlbum(entry('b')), 'ok');
  assert.equal(S.removeFromAlbum('a'), false);
  assert.equal(S.removeFromAlbum('b'), true);
  assert.deepEqual(S.loadAlbum().map((e) => e.id), ['a']);
});

test('第1段階（出会いの記録だけ）からの移行：火を灯して中薪までつないだ発見にし、解放の数は前の版の数を下回らない', () => {
  const met = (ids: string[]) => {
    fake.clear();
    fake.setItem('gyarubi.discoveries', JSON.stringify(Object.fromEntries(ids.map((id, i) => [id, { firstAt: `2026-09-1${i}T10:00:00.000Z`, count: 1, reason: 'x' }]))));
    return S.loadProgress();
  };
  const both = met(['komugi', 'ojibi']);
  assert.deepEqual(Object.keys(both.tasks).sort(), ['f01', 't01']);
  assert.equal(both.unlockFloor, 3, '前の版は3件（灯す・こむぎ・おじ火）');
  const ojibiOnly = met(['ojibi']);
  assert.deepEqual(Object.keys(ojibiOnly.tasks).sort(), ['f01', 't01']);
  assert.equal(ojibiOnly.unlockFloor, undefined, '前の版は2件なので、下限は要らない');
  assert.equal(met(['komugi']).unlockFloor, undefined);
  const none = met([]);
  assert.deepEqual(none.tasks, {});
});
