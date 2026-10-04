/**
 * 記録の書き出し・読み込み（これまでの発見と思い出のアルバム）。
 * 別の端末やブラウザへ移すため、また、ブラウザのデータを消す前の控えとして使う。
 *  - 書き出すもの：発見（課題・出会い・使った薪・思い出を残した場所）、アルバム（最大100件）、アルバムの小さな画像。
 *    途中の焚き火（再開用）と設定は入れない（端末ごとのもの）。
 *  - 読み込みは「足し合わせ」：今の記録を消したり、黙って上書きしたりしない。
 *    同じ思い出は一件にまとめ、お気に入りはどちらかで付いていれば残す。100件を超える分は取り込まずに知らせる。
 *  - 形式が違う・発見の記録が壊れているファイルは、何も変えずに理由を返す。
 *    思い出は一件ずつ確かめ、読めないものだけを外して数える（一件のせいで全体を捨てない）。
 */
import { LEGACY_TASK_IDS, TASKS, TaskId, PLACES, PlaceId } from '../data/discoveries';
import { WOODS, WoodId } from '../game/balance';
import { ProgressData, emptyProgress, migrateProgress } from '../game/progress';

/** 前の版（キャラクターがいた版）の記録にある、出会いの名前。記録は消さずに引き継ぐ（画面には出さない） */
export const LEGACY_CHARACTER_IDS = ['komugi', 'ojibi', 'akane', 'hisui', 'sumire', 'momo', 'rikka', 'tsukika', 'hanabi', 'shiroha', 'buchou', 'master'] as const;
import { NAME_MAX, graphemeLength } from '../game/memory';
import { ALBUM_MAX, AlbumEntry } from './storage';

export const RECORD_FORMAT = 'gyarubi-record';
export const RECORD_VERSION = 1;
/** 読み込むファイルの上限（小さな画像100枚を含めても十分な大きさ） */
export const RECORD_MAX_BYTES = 40 * 1024 * 1024;
const THUMB_MAX_CHARS = 1_500_000;

export interface RecordFile {
  format: typeof RECORD_FORMAT;
  version: typeof RECORD_VERSION;
  exportedAt: string;
  progress: ProgressData;
  album: AlbumEntry[];
  /** アルバムの id → 小さな画像（data URL） */
  thumbs: Record<string, string>;
}

export function buildRecordFile(progress: ProgressData, album: AlbumEntry[], thumbs: Record<string, string>, now = new Date()): RecordFile {
  return {
    format: RECORD_FORMAT,
    version: RECORD_VERSION,
    exportedAt: now.toISOString(),
    progress: JSON.parse(JSON.stringify(progress)),
    album: JSON.parse(JSON.stringify(album)),
    thumbs: { ...thumbs },
  };
}

export type ParseResult = { ok: true; file: RecordFile; dropped: number } | { ok: false; reason: string };

const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const strOrNull = (v: unknown, max: number): boolean => v === null || str(v, max);
const isoLike = (v: unknown): v is string => str(v, 40) && !Number.isNaN(Date.parse(v));
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const plainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function validAlbumEntry(e: unknown): e is AlbumEntry {
  if (!plainObject(e)) return false;
  return (
    str(e.id, 64) &&
    e.id.length > 0 &&
    isoLike(e.savedAt) &&
    str(e.dateLabel, 20) &&
    str(e.fireName, 256) &&
    graphemeLength(e.fireName) <= NAME_MAX &&
    (e.characterId === null || (typeof e.characterId === 'string' && (LEGACY_CHARACTER_IDS as readonly string[]).includes(e.characterId))) &&
    strOrNull(e.characterLabel, 64) &&
    strOrNull(e.stageName, 40) &&
    str(e.woods, 200) &&
    str(e.place, 40) &&
    strOrNull(e.layout, 40) &&
    str(e.howRaised, 120) &&
    strOrNull(e.lastLine, 200) &&
    str(e.minutes, 20) &&
    (e.reason === 'natural' || e.reason === 'manual' || e.reason === 'early') &&
    str(e.mood, 40) &&
    typeof e.favorite === 'boolean' &&
    typeof e.provisional === 'boolean'
  );
}

/** 発見の記録の厳密な検査（読み込み用。キャラ・課題・薪・場所は知っているものだけ） */
export function validProgress(v: unknown): v is ProgressData {
  if (!plainObject(v) || v.schemaVersion !== 1) return false;
  // 前の版の課題も読める（読み込んだ後に migrateProgress で外し、解放の数だけ残す）
  const taskIds = new Set<string>([...TASKS.map((t) => t.id), ...LEGACY_TASK_IDS]);
  if (!plainObject(v.tasks)) return false;
  for (const [k, d] of Object.entries(v.tasks)) if (!taskIds.has(k) || !isoLike(d)) return false;
  if (v.unlockFloor !== undefined && (typeof v.unlockFloor !== 'number' || !Number.isInteger(v.unlockFloor) || v.unlockFloor < 0 || v.unlockFloor > 64)) return false;
  if (!plainObject(v.met)) return false;
  for (const [k, e] of Object.entries(v.met)) {
    if (!(LEGACY_CHARACTER_IDS as readonly string[]).includes(k)) return false;
    if (!plainObject(e) || !isoLike(e.firstAt) || typeof e.count !== 'number' || !Number.isInteger(e.count) || e.count < 1 || e.count > 1e6 || !str(e.reason, 120)) return false;
  }
  if (!Array.isArray(v.woodsUsed) || v.woodsUsed.length > 12 || !v.woodsUsed.every((w) => typeof w === 'string' && own(WOODS, w))) return false;
  const placeIds = new Set<string>(PLACES.map((p) => p.id));
  if (!Array.isArray(v.memoryPlaces) || v.memoryPlaces.length > PLACES.length || !v.memoryPlaces.every((p) => typeof p === 'string' && placeIds.has(p))) return false;
  return true;
}

export function parseRecordFile(text: string): ParseResult {
  if (text.length > RECORD_MAX_BYTES) return { ok: false, reason: 'ファイルが大きすぎます。' };
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'このゲームの記録ファイルではないようです。' };
  }
  if (!plainObject(v) || v.format !== RECORD_FORMAT) return { ok: false, reason: 'このゲームの記録ファイルではないようです。' };
  if (v.version !== RECORD_VERSION) return { ok: false, reason: '新しい版で書き出された記録のため、読み込めません。' };
  if (!validProgress(v.progress)) return { ok: false, reason: '発見の記録が壊れているため、読み込みませんでした。' };
  if (!Array.isArray(v.album) || v.album.length > ALBUM_MAX * 10) return { ok: false, reason: '思い出の記録が壊れているため、読み込みませんでした。' };
  // 思い出は一件ずつ：読めないもの・同じ id の二件目は外して数える
  const album: AlbumEntry[] = [];
  const ids = new Set<string>();
  let dropped = 0;
  for (const e of v.album as unknown[]) {
    if (validAlbumEntry(e) && !ids.has(e.id)) {
      ids.add(e.id);
      album.push(e);
    } else dropped++;
  }
  const thumbs: Record<string, string> = {};
  if (v.thumbs !== undefined) {
    if (!plainObject(v.thumbs)) return { ok: false, reason: '画像の記録が壊れているため、読み込みませんでした。' };
    for (const [k, d] of Object.entries(v.thumbs)) {
      // 知らない思い出の画像・画像でないものは黙って捨てる（本体の記録は読める）
      if (!ids.has(k) || typeof d !== 'string' || d.length > THUMB_MAX_CHARS || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(d)) continue;
      thumbs[k] = d;
    }
  }
  return {
    ok: true,
    file: {
      format: RECORD_FORMAT,
      version: RECORD_VERSION,
      exportedAt: isoLike(v.exportedAt) ? v.exportedAt : new Date(0).toISOString(),
      progress: v.progress as ProgressData,
      album,
      thumbs,
    },
    dropped,
  };
}

const earlier = (a: string | undefined, b: string | undefined): string | undefined => {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
};

/**
 * 発見の足し合わせ。達成日時・はじめて会った日時は早いほう、会った回数は多いほう
 * （同じファイルを二度読み込んでも回数が増えないように、足し算にはしない）。
 */
export function mergeProgress(a0: ProgressData, b0: ProgressData): ProgressData {
  const a = migrateProgress(a0);
  const b = migrateProgress(b0);
  const out = emptyProgress();
  for (const t of TASKS) {
    const d = earlier(a.tasks[t.id], b.tasks[t.id]);
    if (d) out.tasks[t.id as TaskId] = d;
  }
  for (const id of LEGACY_CHARACTER_IDS) {
    const x = a.met[id];
    const y = b.met[id];
    if (!x && !y) continue;
    out.met[id] = {
      firstAt: earlier(x?.firstAt, y?.firstAt)!,
      count: Math.max(x?.count ?? 0, y?.count ?? 0),
      reason: x?.reason ?? y!.reason,
    };
  }
  const woods = (Object.keys(WOODS) as WoodId[]).filter((w) => a.woodsUsed.includes(w) || b.woodsUsed.includes(w));
  out.woodsUsed = woods;
  out.memoryPlaces = PLACES.map((p) => p.id).filter((p: PlaceId) => a.memoryPlaces.includes(p) || b.memoryPlaces.includes(p));
  const floor = Math.max(a.unlockFloor ?? 0, b.unlockFloor ?? 0);
  if (floor > 0) out.unlockFloor = floor;
  return out;
}

export interface AlbumMerge {
  entries: AlbumEntry[];
  added: string[];
  /** 100件を超えるため取り込まなかった件数 */
  skipped: number;
  /** すでにあった（お気に入りだけ引き継いだ）件数 */
  same: number;
}

/** アルバムの足し合わせ。今ある思い出は消さない。新しい順に並べ、100件を超える分は取り込まない */
export function mergeAlbum(local: AlbumEntry[], incoming: AlbumEntry[], max = ALBUM_MAX): AlbumMerge {
  const entries = local.map((e) => ({ ...e }));
  const byId = new Map(entries.map((e) => [e.id, e]));
  const fresh: AlbumEntry[] = [];
  let same = 0;
  for (const e of incoming) {
    const have = byId.get(e.id);
    if (have) {
      same++;
      if (e.favorite && !have.favorite) have.favorite = true;
    } else fresh.push({ ...e });
  }
  // 新しいものから入れる
  fresh.sort((x, y) => Date.parse(y.savedAt) - Date.parse(x.savedAt));
  const room = Math.max(0, max - entries.length);
  const take = fresh.slice(0, room);
  const all = [...entries, ...take].sort((x, y) => Date.parse(y.savedAt) - Date.parse(x.savedAt));
  return { entries: all, added: take.map((e) => e.id), skipped: fresh.length - take.length, same };
}

export function blobToDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === 'string' ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    } catch {
      resolve(null);
    }
  });
}

export function dataUrlToBlob(d: string): Blob | null {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(d);
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: m[1] });
  } catch {
    return null;
  }
}
