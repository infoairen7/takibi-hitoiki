/**
 * これまでの発見（課題の達成・出会い・使った薪・思い出を残した場所）と、発見の数で解放されるもの。
 * 恒久的な能力上昇はない（初回の育成が無意味にならないように）。解放されるのは選べるもの・見た目だけ。
 */
import { BALANCE, WoodId } from './balance';
import { DECORS, DecorId, LEGACY_TASK_IDS, PLACES, PlaceId, TASKS, TaskId, TRAYS, TrayId, WOOD_UNLOCKS } from '../data/discoveries';

export interface Encounter {
  firstAt: string;
  count: number;
  reason: string;
}

export interface ProgressData {
  schemaVersion: 1;
  /** 達成した課題と日時 */
  tasks: Partial<Record<TaskId, string>>;
  /** 前の版（キャラクターがいた版）の出会いの記録。画面には出さず、記録として残すだけ */
  met: Record<string, Encounter>;
  /** 累計で使った薪 */
  woodsUsed: WoodId[];
  /** 思い出を残した場所 */
  memoryPlaces: PlaceId[];
  /**
   * 解放の下限：前の版で外れた課題（キャラクターに会う など）で解放されていたものを、そのまま残すため。
   * 解放は max(達成した課題の数, unlockFloor) で決める。
   */
  unlockFloor?: number;
}

export function emptyProgress(): ProgressData {
  return { schemaVersion: 1, tasks: {}, met: {}, woodsUsed: [], memoryPlaces: [] };
}

export function taskCount(p: ProgressData): number {
  return Object.keys(p.tasks).length;
}

/** 解放に使う数（前の版で解放されていたものは残す） */
export function unlockCount(p: ProgressData): number {
  return Math.max(taskCount(p), p.unlockFloor ?? 0);
}

/**
 * 前の版の記録を今の課題へ：外れた課題（LEGACY_TASK_IDS）は記録から外し、それまでの数を解放の下限に残す。
 * 知らない課題の名前は外す（壊れた記録としては扱わない）。
 */
export function migrateProgress(p: ProgressData): ProgressData {
  const known = new Set<string>(TASKS.map((t) => t.id));
  const before = Object.keys(p.tasks).length;
  const tasks: Partial<Record<TaskId, string>> = {};
  for (const [k, v] of Object.entries(p.tasks)) if (known.has(k)) tasks[k as TaskId] = v as string;
  const dropped = before - Object.keys(tasks).length;
  const floor = Math.max(p.unlockFloor ?? 0, dropped > 0 ? before : 0);
  const out: ProgressData = { ...p, tasks };
  if (floor > 0) out.unlockFloor = floor;
  else delete out.unlockFloor;
  return out;
}

/** 課題を達成済みにする。新しく達成したら true */
export function achieve(p: ProgressData, id: TaskId, now = new Date()): boolean {
  if (p.tasks[id]) return false;
  p.tasks[id] = now.toISOString();
  return true;
}

export function unlockedWoods(count: number): WoodId[] {
  return WOOD_UNLOCKS.filter((u) => count >= u.at).flatMap((u) => u.woods);
}

export function unlockedPlaces(count: number): PlaceId[] {
  return PLACES.filter((p) => count >= p.at).map((p) => p.id);
}

export function unlockedTrays(count: number): TrayId[] {
  return TRAYS.filter((t) => count >= t.at).map((t) => t.id);
}

export function unlockedDecors(count: number): DecorId[] {
  return DECORS.filter((d) => count >= d.at).map((d) => d.id);
}

/** 道具：初期は火ばさみとうちわ。火吹き筒は発見の数で（能力の上位互換ではなく、操作の違い） */
export function tubeUnlocked(count: number): boolean {
  return count >= BALANCE.tube.unlockAt;
}

/** 発見の数が before→after になったときに新しく解放されたもの（通知用の言葉） */
export function newUnlockLabels(before: number, after: number): string[] {
  const out: string[] = [];
  for (const u of WOOD_UNLOCKS) if (u.at > before && u.at <= after) out.push(`薪「${u.woods.map((w) => WOOD_LABEL[w]).join('・')}」`);
  for (const p of PLACES) if (p.at > before && p.at <= after) out.push(`場所「${p.label}」`);
  for (const t of TRAYS) if (t.at > before && t.at <= after) out.push(`焚き火台「${t.label}」`);
  for (const d of DECORS) if (d.at > before && d.at <= after) out.push(`装飾「${d.label}」`);
  if (BALANCE.tube.unlockAt > before && BALANCE.tube.unlockAt <= after) out.push('道具「火吹き筒」');
  return out;
}

const WOOD_LABEL: Record<WoodId, string> = {
  nara: 'なら',
  kunugi: 'くぬぎ',
  shirakaba: 'しらかば',
  sakura: 'さくら',
  ringo: 'りんご',
  kaede: 'かえで',
  keyaki: 'けやき',
  buna: 'ぶな',
  sugi: 'すぎ',
  hinoki: 'ひのき',
  matsu: 'まつ',
  shimerigi: 'しめり木',
};

/** 次に解放されるもの（手帳の案内用） */
export function nextUnlock(count: number): { at: number; label: string } | null {
  const all: Array<{ at: number; label: string }> = [
    ...WOOD_UNLOCKS.filter((u) => u.at > 0).map((u) => ({ at: u.at, label: `薪「${u.woods.map((w) => WOOD_LABEL[w]).join('・')}」` })),
    ...PLACES.filter((p) => p.at > 0).map((p) => ({ at: p.at, label: `場所「${p.label}」` })),
    ...TRAYS.filter((t) => t.at > 0).map((t) => ({ at: t.at, label: `焚き火台「${t.label}」` })),
    ...DECORS.map((d) => ({ at: d.at, label: `装飾「${d.label}」` })),
    { at: BALANCE.tube.unlockAt, label: '道具「火吹き筒」' },
  ]
    .filter((x) => x.at > count)
    .sort((a, b) => a.at - b.at);
  if (!all.length) return null;
  const at = all[0].at;
  return { at, label: all.filter((x) => x.at === at).map((x) => x.label).join('、') };
}

export function isProgress(v: unknown): v is ProgressData {
  const o = v as ProgressData;
  if (!o || typeof o !== 'object' || o.schemaVersion !== 1) return false;
  if (!o.tasks || typeof o.tasks !== 'object') return false;
  // 今の課題と、前の版の課題（読むときに migrateProgress で外す）
  const taskIds = new Set<string>([...TASKS.map((t) => t.id), ...LEGACY_TASK_IDS]);
  for (const [k, val] of Object.entries(o.tasks)) if (!taskIds.has(k) || typeof val !== 'string') return false;
  if (!o.met || typeof o.met !== 'object') return false;
  for (const e of Object.values(o.met)) if (!e || typeof e.count !== 'number' || typeof e.firstAt !== 'string') return false;
  if (!Array.isArray(o.woodsUsed) || o.woodsUsed.length > 12 || !o.woodsUsed.every((w) => w in WOOD_LABEL)) return false;
  const placeIds = new Set(PLACES.map((p) => p.id));
  if (!Array.isArray(o.memoryPlaces) || !o.memoryPlaces.every((p) => placeIds.has(p))) return false;
  if (o.unlockFloor !== undefined && (typeof o.unlockFloor !== 'number' || !Number.isInteger(o.unlockFloor) || o.unlockFloor < 0 || o.unlockFloor > 64)) return false;
  return true;
}
