/**
 * 保存：端末内（localStorage）。schemaVersion付き。
 * - 壊れたデータは退避して新規開始を案内し、勝手に全消去しない
 * - 保存できない環境でもプレイは続けられる
 * 別端末との同期は未実装。
 */
import { SerializedSim } from '../game/fire/sim';
import { PIECE_KINDS, WOODS, WoodId } from '../game/balance';
import type { LegacyCompanionSnapshot, SessionSnapshot } from '../game/session';
import { ProgressData, emptyProgress, isProgress, migrateProgress } from '../game/progress';
import { DECORS, FrameId, PLACES, PlaceId, TRAYS, TongsId, TrayId } from '../data/discoveries';

/**
 * 3：焚き火だけの版（2026-10-04。その回の記録 session を保存）。
 * 2：キャラクターがいた版（火の精 companion を保存）。1：第0段階。どちらも読み込み時に移行する。
 */
export const SCHEMA_VERSION = 3;
const KEY_SESSION = 'gyarubi.session';
const KEY_SETTINGS = 'gyarubi.settings';
const KEY_ALBUM = 'gyarubi.album';
const KEY_DISCOVERIES = 'gyarubi.discoveries';
const KEY_PROGRESS = 'gyarubi.progress';
export const ALBUM_MAX = 100;

export interface Settings {
  schemaVersion: number;
  soundEnabled: boolean | null;
  fireVolume: number;
  /** BGM（自作の小さな音楽）の大きさ 0..1。0で止める。初期は小さめ */
  bgmVolume: number;
  reducedMotion: boolean;
  quality: 'auto' | 'low' | 'standard' | 'high';
  mode: 'short' | 'long';
  /** 第2段階：場所・焚き火台・装飾の選択（見た目だけ。燃焼には影響しない） */
  place: PlaceId;
  tray: TrayId;
  frame: FrameId;
  tongs: TongsId;
  bag: boolean;
  lantern: boolean;
  /** 第3段階：文字の大きさ（画面のUIだけ。3Dの画面は変えない） */
  textSize: TextSize;
  /** 第3段階：振動（対応している端末だけ） */
  haptics: boolean;
  /** 薪支度で置く中薪の樹種（樹種と太さは別に選ぶ） */
  species: WoodId;
}

export type TextSize = 'normal' | 'large' | 'xlarge';
export const TEXT_SIZES: TextSize[] = ['normal', 'large', 'xlarge'];

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SCHEMA_VERSION,
  soundEnabled: null,
  fireVolume: 0.65,
  bgmVolume: 0.4,
  reducedMotion: false,
  quality: 'auto',
  mode: 'short',
  place: 'lakeside',
  tray: 'first',
  frame: 'paper',
  tongs: 'steel',
  bag: false,
  lantern: false,
  textSize: 'normal',
  haptics: true,
  species: 'nara',
};

export interface SavedSession {
  schemaVersion: number;
  savedAt: string;
  sim: SerializedSim;
  visual?: { soot?: number[] };
  line?: string | null;
  /** 3：その回の記録（落ち着いた火の時間・世話・発見・見送り） */
  session?: SessionSnapshot | null;
  /** 2：キャラクターがいた版の火の精。読むのは見送りとその回の記録だけ（FireSession.fromLegacy） */
  companion?: LegacyCompanionSnapshot | null;
  /** 思い出の名前（変更したとき） */
  memoryName?: string | null;
}

export type LoadResult<T> = { ok: true; value: T | null } | { ok: false; reason: 'corrupt' | 'unavailable' };

function storage(): Storage | null {
  try {
    const s = window.localStorage;
    const k = '__gyarubi_probe__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

export function storageAvailable(): boolean {
  return storage() !== null;
}

export function loadSettings(): Settings {
  const s = storage();
  if (!s) return { ...DEFAULT_SETTINGS };
  try {
    const raw = s.getItem(KEY_SETTINGS);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const v = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      soundEnabled: typeof v.soundEnabled === 'boolean' ? v.soundEnabled : null,
      fireVolume: typeof v.fireVolume === 'number' ? Math.max(0, Math.min(1, v.fireVolume)) : DEFAULT_SETTINGS.fireVolume,
      bgmVolume: typeof v.bgmVolume === 'number' && isFinite(v.bgmVolume) ? Math.max(0, Math.min(1, v.bgmVolume)) : DEFAULT_SETTINGS.bgmVolume,
      reducedMotion: !!v.reducedMotion,
      quality: ['auto', 'low', 'standard', 'high'].includes(v.quality) ? v.quality : 'auto',
      mode: v.mode === 'long' ? 'long' : 'short',
      place: PLACES.some((p) => p.id === v.place) ? v.place : 'lakeside',
      tray: TRAYS.some((t) => t.id === v.tray) ? v.tray : 'first',
      frame: v.frame === 'paper' || DECORS.some((d) => d.group === 'frame' && d.id === v.frame) ? v.frame : 'paper',
      tongs: v.tongs === 'steel' || DECORS.some((d) => d.group === 'tongs' && d.id === v.tongs) ? v.tongs : 'steel',
      bag: !!v.bag,
      lantern: !!v.lantern,
      textSize: TEXT_SIZES.includes(v.textSize) ? v.textSize : 'normal',
      haptics: typeof v.haptics === 'boolean' ? v.haptics : true,
      species: typeof v.species === 'string' && v.species in WOODS ? (v.species as WoodId) : 'nara',
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(v: Settings): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(KEY_SETTINGS, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

/** 型・範囲・サイズを確認する（読み込み・移行） */
const finiteNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v);

export function validateSession(v: unknown): v is SavedSession {
  if (!v || typeof v !== 'object') return false;
  const o = v as SavedSession;
  if (typeof o.schemaVersion !== 'number' || o.schemaVersion > SCHEMA_VERSION) return false;
  const sim = o.sim;
  if (!sim || sim.v !== 1 || !Array.isArray(sim.pieces) || sim.pieces.length > 40) return false;
  if (!Array.isArray(sim.rng) || sim.rng.length !== 4) return false;
  if (typeof sim.time !== 'number' || !isFinite(sim.time) || sim.time < 0) return false;
  for (const p of sim.pieces) {
    if (!(PIECE_KINDS as string[]).includes(p.kind)) return false;
    if (!Array.isArray(p.segs) || p.segs.length < 1 || p.segs.length > 8) return false;
    for (const s of p.segs) {
      for (const k of ['T', 'm', 'f', 'f0', 'I', 'c', 'g', 'ash'] as const) {
        if (typeof s[k] !== 'number' || !isFinite(s[k])) return false;
      }
    }
    const pose = p.pose;
    if (!pose || ![pose.x, pose.y, pose.z, pose.yaw, pose.pitch].every((n) => typeof n === 'number' && isFinite(n))) return false;
    if (Math.abs(pose.x) > 1 || Math.abs(pose.z) > 1 || pose.y < 0 || pose.y > 1) return false;
  }
  const ss = o.session;
  if (ss !== undefined && ss !== null) {
    if (typeof ss !== 'object' || ss.v !== 2) return false;
    if (!finiteNum(ss.seed) || !finiteNum(ss.duration) || ss.duration <= 0) return false;
    if (!ss.stats || typeof ss.stats !== 'object' || !Array.isArray(ss.stats.species)) return false;
    for (const k of ['windowSeconds', 'stableSeconds', 'watchSeconds', 'maxHeat', 'heatSum'] as const) if (!finiteNum(ss.stats[k]) || ss.stats[k] < 0) return false;
    if (!ss.watch || typeof ss.watch !== 'object') return false;
    if (typeof ss.fireName !== 'string' || ss.fireName.length > 64) return false;
    if (ss.endReason !== null && ss.endReason !== 'natural' && ss.endReason !== 'manual') return false;
  }
  const c = o.companion;
  if (c !== undefined && c !== null) {
    // 前の版（キャラクターがいた版）：火の進みと見送りだけを引き継ぐ
    if (typeof c !== 'object' || c.v !== 1) return false;
    if (!finiteNum(c.seed) || !finiteNum(c.duration) || c.duration <= 0) return false;
    if (c.fireName !== undefined && (typeof c.fireName !== 'string' || c.fireName.length > 64)) return false;
  }
  return true;
}

export function loadSession(): LoadResult<SavedSession> {
  const s = storage();
  if (!s) return { ok: false, reason: 'unavailable' };
  const raw = s.getItem(KEY_SESSION);
  if (!raw) return { ok: true, value: null };
  try {
    if (raw.length > 2_000_000) throw new Error('too large');
    const v = JSON.parse(raw);
    if (!validateSession(v)) throw new Error('invalid');
    return { ok: true, value: v };
  } catch {
    // 壊れたデータは消さずに退避
    try {
      s.setItem(`${KEY_SESSION}.broken.${Date.now()}`, raw);
      s.removeItem(KEY_SESSION);
    } catch {
      /* 退避できなくても続行 */
    }
    return { ok: false, reason: 'corrupt' };
  }
}

export function saveSession(v: SavedSession): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(KEY_SESSION, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

export function clearSession(): void {
  const s = storage();
  try {
    s?.removeItem(KEY_SESSION);
  } catch {
    /* noop */
  }
}

// ───────────────────────────── 思い出のアルバム・図鑑

export interface AlbumEntry {
  id: string;
  savedAt: string;
  dateLabel: string;
  fireName: string;
  /** 前の版（キャラクターがいた版）の思い出だけ。今の版では null */
  characterId: string | null;
  characterLabel: string | null;
  stageName: string | null;
  woods: string;
  place: string;
  layout: string | null;
  howRaised: string;
  /** 結びの一文（前の版では、キャラクターの最後の一言） */
  lastLine: string | null;
  minutes: string;
  /** 'early' は前の版の思い出だけ */
  reason: 'natural' | 'manual' | 'early';
  mood: string;
  favorite: boolean;
  /** 前の版：キャラは仮表示（2D）で撮った。今の版では false */
  provisional: boolean;
}

export interface Discovery {
  firstAt: string;
  count: number;
  reason: string;
}

function readJson<T>(key: string, check: (v: unknown) => v is T): T | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return check(v) ? v : null;
  } catch {
    return null;
  }
}

function isAlbum(v: unknown): v is { schemaVersion: number; entries: AlbumEntry[] } {
  const o = v as { entries?: unknown };
  return !!o && Array.isArray(o.entries) && o.entries.length <= ALBUM_MAX && o.entries.every((e) => e && typeof (e as AlbumEntry).id === 'string' && typeof (e as AlbumEntry).fireName === 'string');
}

let albumBackedUp = false;

/** 読めないアルバムは消さずに退避してから、新しく始める（詳細仕様13章） */
export function loadAlbum(): AlbumEntry[] {
  const s = storage();
  if (!s) return [];
  let raw: string | null = null;
  try {
    raw = s.getItem(KEY_ALBUM);
    if (!raw) return [];
    const v = JSON.parse(raw);
    if (isAlbum(v)) return v.entries;
    throw new Error('invalid');
  } catch {
    try {
      if (raw) s.setItem(`${KEY_ALBUM}.broken.${Date.now()}`, raw);
      s.removeItem(KEY_ALBUM);
      albumBackedUp = true;
    } catch {
      /* 退避できないときは、上書きもしない */
      return [];
    }
    return [];
  }
}

/** 読めなかったアルバムを退避したか（一度だけ true を返す） */
export function takeAlbumBackupNotice(): boolean {
  const v = albumBackedUp;
  albumBackedUp = false;
  return v;
}

/** アルバムをまとめて書き換える（記録の読み込みで、足し合わせた結果を書くときだけ使う） */
export function replaceAlbum(entries: AlbumEntry[]): boolean {
  if (entries.length > ALBUM_MAX) return false;
  // 読めないデータが残っている（退避できなかった）ときは書き込まない
  if (storage()?.getItem(KEY_ALBUM) && !readJson(KEY_ALBUM, isAlbum)) return false;
  return writeAlbum(entries);
}

function writeAlbum(entries: AlbumEntry[]): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(KEY_ALBUM, JSON.stringify({ schemaVersion: 1, entries }));
    return true;
  } catch {
    return false;
  }
}

/** アルバムへ追加。100件に達していたら黙って上書きせず 'full' を返す（整理を促す） */
export function addToAlbum(e: AlbumEntry): 'ok' | 'full' | 'failed' | 'exists' {
  const list = loadAlbum();
  // 読めないデータが残っている（退避できなかった）ときは書き込まない
  if (storage()?.getItem(KEY_ALBUM) && !readJson(KEY_ALBUM, isAlbum)) return 'failed';
  if (list.some((x) => x.id === e.id)) {
    const i = list.findIndex((x) => x.id === e.id);
    list[i] = { ...e, favorite: list[i].favorite };
    return writeAlbum(list) ? 'exists' : 'failed';
  }
  if (list.length >= ALBUM_MAX) return 'full';
  return writeAlbum([e, ...list]) ? 'ok' : 'failed';
}

export function removeFromAlbum(id: string): boolean {
  const list = loadAlbum();
  const e = list.find((x) => x.id === id);
  if (!e || e.favorite) return false; // お気に入りは保護
  return writeAlbum(list.filter((x) => x.id !== id));
}

export function toggleFavorite(id: string): boolean {
  const list = loadAlbum();
  const e = list.find((x) => x.id === id);
  if (!e) return false;
  e.favorite = !e.favorite;
  return writeAlbum(list);
}

function isDiscoveries(v: unknown): v is Record<string, Discovery> {
  return !!v && typeof v === 'object' && Object.values(v as object).every((d) => d && typeof (d as Discovery).count === 'number');
}

export function loadDiscoveries(): Record<string, Discovery> {
  return readJson(KEY_DISCOVERIES, isDiscoveries) ?? {};
}

/** 出会いを記録。はじめての出会いなら true */
// ───────────────────────────── これまでの発見（課題・出会い・使った薪・場所）

let progressBackedUp = false;

/** 読めないデータは退避してから新しく始める。第1段階の図鑑（出会い）は移す */
export function loadProgress(): ProgressData {
  const s = storage();
  if (!s) return emptyProgress();
  let raw: string | null = null;
  try {
    raw = s.getItem(KEY_PROGRESS);
    if (raw) {
      const v = JSON.parse(raw);
      if (isProgress(v)) return migrateProgress(v);
      throw new Error('invalid');
    }
  } catch {
    try {
      if (raw) s.setItem(`${KEY_PROGRESS}.broken.${Date.now()}`, raw);
      s.removeItem(KEY_PROGRESS);
      progressBackedUp = true;
    } catch {
      /* noop */
    }
  }
  // 第1段階の出会いの記録から移行
  const p = emptyProgress();
  const old = loadDiscoveries();
  for (const [id, d] of Object.entries(old)) p.met[id] = { firstAt: d.firstAt, count: d.count, reason: d.reason };
  // 火の精に会えていれば、火を灯して中薪までつないでいる
  if (Object.keys(p.met).length) {
    const first = Object.values(p.met)[0].firstAt;
    p.tasks.t01 = first;
    p.tasks.f01 = p.met.komugi?.firstAt ?? first;
    // 前の版の発見の数（火を灯す＋こむぎに会う＋おじ火に会う）が今の数より多ければ、解放はその数のまま残す
    const oldCount = 1 + (p.met.komugi ? 1 : 0) + (p.met.ojibi ? 1 : 0);
    if (oldCount > Object.keys(p.tasks).length) p.unlockFloor = oldCount;
  }
  return p;
}

export function takeProgressBackupNotice(): boolean {
  const v = progressBackedUp;
  progressBackedUp = false;
  return v;
}

export function saveProgress(p: ProgressData): boolean {
  const s = storage();
  if (!s) return false;
  // 読めないデータが残っている（容量不足などで退避できなかった）ときは、上書きしない
  if (s.getItem(KEY_PROGRESS) && !readJson(KEY_PROGRESS, isProgress)) return false;
  try {
    s.setItem(KEY_PROGRESS, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

/** 書き出し（JSONファイル） */
export function exportSessionFile(v: SavedSession): Blob {
  return new Blob([JSON.stringify(v, null, 1)], { type: 'application/json' });
}
