/**
 * 発見課題24件（詳細仕様7章）と、発見の数で解放されるもの（薪・場所・焚き火台・装飾・火吹き筒）。
 * 期限なし。毎日のログインや連続プレイを条件にしない。
 *
 * 2026-10-04：キャラクターを企画から外したため、「◯◯に会う」の12件と「おじ火の気配から持ち直す」を、
 * 焚き火の発見（f01〜f13）に差し替えた。前の版で達成した課題の記録は、読み込むときに外す（解放されたものは残す：progress.ts の unlockFloor）。
 */
import type { WoodId } from '../game/balance';

export type TaskId =
  | 't01'
  | 'f01'
  | 'f02'
  | 'f03'
  | 'f04'
  | 'f05'
  | 'f06'
  | 'f07'
  | 'f08'
  | 'f09'
  | 'f10'
  | 'f11'
  | 'f12'
  | 'f13'
  | 't14'
  | 't15'
  | 't16'
  | 't17'
  | 't18'
  | 't19'
  | 't20'
  | 't21'
  | 't23'
  | 't24';

/** 前の版の課題（キャラクターに会う・おじ火の気配から持ち直す）。記録を読むときに外す */
export const LEGACY_TASK_IDS = ['t02', 't03', 't04', 't05', 't06', 't07', 't08', 't09', 't10', 't11', 't12', 't13', 't22'] as const;

export interface TaskDef {
  id: TaskId;
  label: string;
  /** 未達成のときのヒント（答えそのものは書きすぎない） */
  hint: string;
}

export const TASKS: TaskDef[] = [
  { id: 't01', label: 'はじめて火を灯す', hint: '火口を置いて、火を灯そう' },
  { id: 'f01', label: '中薪まで火をつなぐ', hint: '火口から細薪へ、細薪から中薪へ' },
  { id: 'f05', label: '風を送って、細薪へ火を渡す', hint: '細薪が火の風下になるように、うちわで風を一度' },
  { id: 'f02', label: '太薪に火を入れる', hint: '火が中薪まで育ったら、「太さ」で太薪を選べます' },
  { id: 'f11', label: '火を大きく育てる', hint: '薪を炎の上へ渡して、火力が「強め」に届くまで' },
  { id: 'f04', label: '赤い熾から、火を戻す', hint: '炎が消えても熾が赤いうちに、薪を置いて風を送ろう' },
  { id: 'f03', label: '火吹き筒で、熾から火を起こす', hint: '火吹き筒で、熾の上の薪の下を狙って「しっかり」' },
  { id: 'f07', label: '強すぎる火を、落ち着かせる', hint: '火が強すぎたら、送風を止めて薪を少し離そう' },
  { id: 'f08', label: 'こもった煙に、空気を通す', hint: '煙が多いときは、火ばさみで薪の間に隙間を' },
  { id: 'f10', label: '燃えている薪を、火ばさみで組み直す', hint: '火ばさみで燃えている薪を持ち、少し動かして置こう' },
  { id: 'f09', label: 'しめり木に火を入れる', hint: 'しめり木は、強い火の上でじっくり乾かして' },
  { id: 'f12', label: '組んだ薪だけで、最後まで見送る', hint: '火を灯した後は薪を足さずに、熾火の終わりまで' },
  { id: 'f06', label: 'ゆっくり20分で、最後まで見送る', hint: '火を灯す前に「ゆっくり 20分」を選べます' },
  { id: 't14', label: '一回の焚き火で3種の薪を使う', hint: '中薪・太薪の樹種を変えてみよう' },
  { id: 't15', label: '一回の焚き火で4種の薪を使う', hint: '中薪・太薪で、4種類' },
  { id: 't16', label: '累計で12種すべての薪を使う', hint: '解放された薪を、いろいろ試そう' },
  { id: 't17', label: 'ゆったり型で最後まで見送る', hint: '組み方の見本「ゆったり型」から' },
  { id: 't18', label: '井桁型で最後まで見送る', hint: '組み方の見本「井桁型」から' },
  { id: 't19', label: '立てかけ型で最後まで見送る', hint: '組み方の見本「立てかけ型」から' },
  { id: 't20', label: '寄せ薪型で最後まで見送る', hint: '組み方の見本「寄せ薪型」から' },
  { id: 't21', label: '落ち着いた火を、続けて眺める（60秒・20分モードは120秒）', hint: '「しばらく、火を眺める」で、ほどよい火を続けて眺めよう' },
  { id: 't23', label: '自分で名前をつけた火を記録する', hint: '思い出の画面で、名前を変えられます' },
  { id: 'f13', label: '思い出を5つ残す', hint: '見送った後の「思い出を残す」で、アルバムへ' },
  { id: 't24', label: '6種類の場所で思い出を残す', hint: '解放された場所で、思い出を残そう' },
];

export const TASK_BY_ID: Record<TaskId, TaskDef> = Object.fromEntries(TASKS.map((t) => [t.id, t])) as Record<TaskId, TaskDef>;

/** 発見の数で解放される薪（最初の4種は開始時から）。詳細仕様6章：累計2・4・6・8件で各2種 */
export const WOOD_UNLOCKS: Array<{ at: number; woods: WoodId[] }> = [
  { at: 0, woods: ['nara', 'kunugi', 'shirakaba', 'sakura'] },
  { at: 2, woods: ['ringo', 'kaede'] },
  { at: 4, woods: ['keyaki', 'buna'] },
  { at: 6, woods: ['sugi', 'hinoki'] },
  { at: 8, woods: ['matsu', 'shimerigi'] },
];

export type PlaceId = 'lakeside' | 'forest' | 'beach' | 'pavilion' | 'cabin' | 'rooftop';

/** 場所（詳細仕様7章：初期は森・湖畔。発見2件で海辺、4件で東屋、6件で山小屋、8件で屋上） */
export const PLACES: Array<{ id: PlaceId; label: string; at: number }> = [
  { id: 'lakeside', label: '森の湖畔', at: 0 },
  { id: 'forest', label: '夜の森', at: 0 },
  { id: 'beach', label: '海辺', at: 2 },
  { id: 'pavilion', label: '雨音の東屋', at: 4 },
  { id: 'cabin', label: '雪の山小屋', at: 6 },
  { id: 'rooftop', label: '屋上テラス', at: 8 },
];

export type TrayId = 'first' | 'copper' | 'iron' | 'ceramic' | 'stone';

/** 焚き火台。性能差なし（見た目だけ）。はじめの台＋解放される4種 */
export const TRAYS: Array<{ id: TrayId; label: string; at: number; note: string }> = [
  { id: 'first', label: 'はじめの台', at: 0, note: '無銘の低い金属の台' },
  { id: 'iron', label: '黒鉄', at: 3, note: '使い込んだ黒い鉄' },
  { id: 'copper', label: '銅', at: 5, note: 'あたたかい色の銅。少し青錆' },
  { id: 'ceramic', label: '陶器', at: 7, note: '厚手の焼き物の器' },
  { id: 'stone', label: '石', at: 9, note: '平たい石を組んだ炉' },
];

export type DecorId = 'frameWood' | 'frameNight' | 'frameWashi' | 'frameEmber' | 'tongsWood' | 'tongsLeather' | 'bag' | 'lantern';

/** 道具の装飾8種。燃焼には影響しない（見た目と記録の飾りだけ） */
export const DECORS: Array<{ id: DecorId; label: string; group: 'frame' | 'tongs' | 'bag' | 'lantern'; at: number }> = [
  { id: 'frameWood', label: '記録フレーム：木目', group: 'frame', at: 10 },
  { id: 'tongsWood', label: '火ばさみ：木の持ち手', group: 'tongs', at: 11 },
  { id: 'bag', label: '帆布の薪袋', group: 'bag', at: 12 },
  { id: 'frameNight', label: '記録フレーム：夜空', group: 'frame', at: 13 },
  { id: 'lantern', label: '小さなランタン', group: 'lantern', at: 14 },
  { id: 'tongsLeather', label: '火ばさみ：革巻き', group: 'tongs', at: 16 },
  { id: 'frameWashi', label: '記録フレーム：和紙', group: 'frame', at: 18 },
  { id: 'frameEmber', label: '記録フレーム：熾火', group: 'frame', at: 20 },
];

export type FrameId = 'paper' | 'frameWood' | 'frameNight' | 'frameWashi' | 'frameEmber';
export type TongsId = 'steel' | 'tongsWood' | 'tongsLeather';
