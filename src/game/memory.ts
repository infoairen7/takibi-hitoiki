/**
 * 思い出（詳細仕様12章）：一回の焚き火が終わったときに、火の名前・火の様子・育て方・結びの一文をまとめる。
 * 画像（カード）は ui/memoryCard.ts が、実際に描画した画面から作る。
 * 2026-10-04：キャラクターを外し、焚き火だけの記録にした。
 */
import { WOODS, WoodId } from './balance';
import type { EndReason, FireSession } from './session';
import type { FireSim } from './fire/sim';
import { LAYOUTS, LayoutId } from './fire/layouts';
import { CLOSING_LINES, FireMood, MOOD_LABEL } from '../data/texts';
import { hash32 } from './rng';

export const PLACE_LABEL = '森の湖畔';
export const NAME_MAX = 12;
/** 画面・カード・共有の文に出す題 */
export const GAME_TITLE = '焚き火と、ひと息。';

export interface MemoryData {
  id: string;
  dateLabel: string;
  fireName: string;
  woods: string;
  place: string;
  layout: string | null;
  howRaised: string;
  careLabel: string;
  /** 結びの一文（地の文） */
  closing: string;
  minutes: string;
  reason: EndReason;
  /** 火の様子（「おだやかな火」など） */
  mood: string;
  moodId: FireMood;
  /** 火の記録（落ち着いた火の割合・いちばん大きな火力・世話の回数）。以前の版から引き継いだ回は火力が null */
  record: { stableRate: number; maxHeat: number | null; care: number };
}

/** その回の火の様子 */
export function fireMood(sim: FireSim, s: FireSession): FireMood {
  const st = s.stats;
  if (s.endReason === 'manual') return 'early';
  if (st.revived) return 'revived';
  if (st.windowSeconds > 0 && st.dampSeconds / st.windowSeconds >= 0.4) return 'damp';
  if (sim.session.fuelSpent) return 'spent';
  // 以前の版から引き継いだ回は火力の記録がないので、火力では決めない
  const heatKnown = st.heatKnown !== false;
  if (heatKnown && st.maxHeat < 50) return 'small';
  if (heatKnown && (s.meanHeat >= 58 || st.maxHeat >= 80)) return 'lively';
  if (s.careCount >= 5) return 'tended';
  return 'calm';
}

export function buildMemory(sim: FireSim, s: FireSession, now = new Date(), place = PLACE_LABEL): MemoryData {
  const st = s.stats;
  const reason: EndReason = s.endReason ?? 'natural';
  let howRaised = 'ゆっくり火を育てて、最後まで。';
  let careLabel = '火のそばで、ゆっくり';
  if (reason === 'manual') {
    howRaised = '今日は少し早めに、おやすみ。';
    careLabel = '自分のペースで';
  } else if (sim.session.fuelSpent) {
    howRaised = '火が小さくなるまで、ゆっくり見守って。';
    careLabel = '火と一緒に、ひと息';
  } else if (s.watchRate >= 0.45) {
    howRaised = 'そっと眺めて、最後まで。';
    careLabel = '眺める時間を大切に';
  } else if (s.careCount >= 5) {
    howRaised = 'こまめに世話をして、火と一緒に。';
    careLabel = 'こまめな世話';
  } else if (st.logsAdded === 0) {
    howRaised = '組んだ薪だけで、最後まで。';
    careLabel = '組んだまま、見守って';
  }
  const mood = fireMood(sim, s);
  const lines = CLOSING_LINES[mood];
  const closing = lines[hash32(`closing:${s.seed}`) % lines.length];
  const species: WoodId[] = st.species.length ? st.species : ['shirakaba'];
  const woods = species.map((w) => WOODS[w].label).join(' × ');
  const secs = Math.round(sim.session.activeTime);
  const minutes = secs >= sim.session.durationSeconds - 5 ? `${Math.round(secs / 60)}分` : `${Math.floor(secs / 60)}分${String(secs % 60).padStart(2, '0')}秒`;
  const p = (n: number) => String(n).padStart(2, '0');
  const dateLabel = `${now.getFullYear()}.${p(now.getMonth() + 1)}.${p(now.getDate())}`;
  return {
    // 以前の版の思い出のID（seed-日付）と重ならないよう、先頭に t- を付ける（同じ回を引き継いで残しても、前の思い出を上書きしない）
    id: `t-${s.seed.toString(36)}-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`,
    dateLabel,
    fireName: s.fireName,
    woods,
    place,
    layout: st.layoutId && st.layoutId in LAYOUTS ? LAYOUTS[st.layoutId as LayoutId].label : null,
    howRaised,
    careLabel,
    closing,
    minutes,
    reason,
    mood: MOOD_LABEL[mood],
    moodId: mood,
    record: { stableRate: s.stableRate, maxHeat: st.heatKnown === false ? null : Math.round(st.maxHeat), care: s.careCount },
  };
}

/** 名前：最大12文字。絵文字などの合成文字を途中で切らない（HTMLとしては解釈しない：Reactの文字列・canvasの文字として扱う） */
export function clampName(input: string, max = NAME_MAX): string {
  const clean = input.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter;
  const parts = Seg ? Array.from(new Seg('ja', { granularity: 'grapheme' }).segment(clean), (x) => x.segment) : Array.from(clean);
  return parts.slice(0, max).join('');
}

export function graphemeLength(s: string): number {
  const Seg = (Intl as unknown as { Segmenter?: new (l: string, o: { granularity: string }) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter;
  return Seg ? Array.from(new Seg('ja', { granularity: 'grapheme' }).segment(s)).length : Array.from(s).length;
}

export function shareText(m: MemoryData): string {
  return `今夜の火：${m.fireName}｜${m.mood}｜${m.woods}／${m.place} #焚き火とひと息`;
}
