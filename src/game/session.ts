/**
 * 一回の焚き火の進行役（燃焼シミュレーションと同じ10Hzの固定刻み）。
 *   - その回の記録（落ち着いた火の時間・眺めた時間・最高の火力・世話の回数・使った薪・組み方）
 *   - 火の世話の発見（強すぎる火を落ち着かせる・こもった煙に空気を通す・熾から火を戻す・風で火を渡す・大きな火・続けて眺める）
 *   - 思い出の写真を撮る時（火力が育った節目）
 *   - 見送り（熾火の終わり・「今日はここまで」）と終わり
 * 描画・音には関わらない。同じseed・同じ操作履歴なら同じ結果になる。
 *
 * 2026-10-04：キャラクター（火の精・おじ火・会話・性格）は企画から外し、この焚き火だけの進行役に置き換えた。
 */
import { BALANCE, PieceKind, WoodId, clamp, isLog } from './balance';
import { hash32 } from './rng';
import type { FireSim, SimEvent } from './fire/sim';
import type { TaskId } from '../data/discoveries';
import { FIRE_NAMES } from '../data/texts';

const S = BALANCE.stable;
const FC = BALANCE.fireCare;
const FW = BALANCE.farewell;

/** 終わり方。以前の版の 'early'（火の精が生まれた後に火が消えた）は、読み込むときに 'manual' として扱う */
export type EndReason = 'natural' | 'manual';
export type CareKind = 'log' | 'gust' | 'blow' | 'rearrange';

export type SessionEvent =
  | { type: 'farewell'; reason: EndReason; duration: number }
  | { type: 'keepsake'; rank: number }
  | { type: 'task'; id: TaskId }
  | { type: 'end'; reason: EndReason };

export interface SessionStats {
  /** 着火30秒後から熾火までの時間（落ち着いた火の割合の分母） */
  windowSeconds: number;
  stableSeconds: number;
  /** 「しばらく、火を眺める」の時間 */
  watchSeconds: number;
  /** 落ち着いた火を、続けて眺めている秒数（発見課題） */
  watchStreak: number;
  watchStreakMax: number;
  watchStreakDone: boolean;
  heatSum: number;
  maxHeat: number;
  /** 湿った薪（湿り hints.dampAt 以上）で燃えていた時間 */
  dampSeconds: number;
  /** 燃えている間に足した薪の数（細薪・火口も含む） */
  logsAdded: number;
  gusts: number;
  blows: number;
  rearranges: number;
  layoutId: string | null;
  /** 使った樹種（樹種を選べる中薪・太薪だけ） */
  species: WoodId[];
  kindlingUsed: boolean;
  revived: boolean;
  revivedByTube: boolean;
  calmedHot: boolean;
  clearedSmoke: boolean;
  windSpread: boolean;
  bigFire: boolean;
  /** false：以前の版の保存から引き継いだ回（火力の記録がない）。火の様子を火力で決めない */
  heatKnown?: boolean;
}

interface Watchers {
  hotFor: number;
  hotSeen: boolean;
  calmFor: number;
  smokyFor: number;
  smokySeen: boolean;
  clearFor: number;
  emberOnlyFor: number;
  emberOnlySeen: boolean;
  /** 思い出の写真を撮った節目（heatSteps の何番目まで） */
  keepsakeStep: number;
  keepsakeAny: boolean;
}

export interface SessionSnapshot {
  v: 2;
  seed: number;
  duration: number;
  farewell: { reason: EndReason; start: number; dur: number } | null;
  ended: boolean;
  endReason: EndReason | null;
  stats: SessionStats;
  watch: Watchers;
  fireName: string;
}

export class FireSession {
  readonly seed: number;
  readonly duration: number;
  /** ゆっくり20分なら2（発見の秒数を時間の長さで割る） */
  readonly modeScale: number;
  farewell: { reason: EndReason; start: number; dur: number } | null = null;
  ended = false;
  endReason: EndReason | null = null;
  watching = false;
  stats: SessionStats;
  fireName: string;
  private w: Watchers;

  constructor(seed: number, durationSeconds: number) {
    this.seed = seed >>> 0;
    this.duration = durationSeconds;
    this.modeScale = durationSeconds / BALANCE.session.shortSeconds;
    this.stats = {
      windowSeconds: 0,
      stableSeconds: 0,
      watchSeconds: 0,
      watchStreak: 0,
      watchStreakMax: 0,
      watchStreakDone: false,
      heatSum: 0,
      maxHeat: 0,
      dampSeconds: 0,
      logsAdded: 0,
      gusts: 0,
      blows: 0,
      rearranges: 0,
      layoutId: null,
      species: [],
      kindlingUsed: false,
      revived: false,
      revivedByTube: false,
      calmedHot: false,
      clearedSmoke: false,
      windSpread: false,
      bigFire: false,
    };
    this.w = { hotFor: 0, hotSeen: false, calmFor: 0, smokyFor: 0, smokySeen: false, clearFor: 0, emberOnlyFor: 0, emberOnlySeen: false, keepsakeStep: 0, keepsakeAny: false };
    this.fireName = FIRE_NAMES[hash32(`fire:${this.seed}`) % FIRE_NAMES.length];
  }

  // ───────────────────────────── 操作の記録

  notePlaced(sim: FireSim, kind: PieceKind, species?: WoodId): void {
    if (kind === 'kindling') this.stats.kindlingUsed = true;
    // 樹種の数（発見課題）は、樹種を選べる中薪・太薪だけで数える
    if (isLog(kind) && species && !this.stats.species.includes(species)) this.stats.species.push(species);
    void sim;
  }

  noteLayout(id: string): void {
    this.stats.layoutId = id;
  }

  /** 世話（燃えている間に薪を足す・送風・火吹き筒・組み替え）。組み替えは見た目だけの往復を数えない */
  noteCare(sim: FireSim, kind: CareKind, moved = 0): void {
    if (sim.ignitedAt === null || sim.phase !== 'burning' || sim.session.emberPhase || this.farewell) return;
    if (kind === 'log') this.stats.logsAdded += 1;
    if (kind === 'gust') this.stats.gusts += 1;
    if (kind === 'blow') this.stats.blows += 1;
    if (kind === 'rearrange' && moved >= BALANCE.fireCare.rearrangeMinMove) this.stats.rearranges += 1;
  }

  setWatching(on: boolean): void {
    this.watching = on;
  }

  /** 「今日はここまで」：15秒かけて火を落として見送る */
  beginManualFarewell(sim: FireSim): SessionEvent[] {
    const out: SessionEvent[] = [];
    if (this.farewell || this.ended) return out;
    this.beginFarewell(sim, 'manual', FW.manualSeconds, out);
    return out;
  }

  // ───────────────────────────── 毎ステップ

  step(sim: FireSim, simEvents: SimEvent[]): SessionEvent[] {
    const out: SessionEvent[] = [];
    if (this.ended) return out;
    const dt = BALANCE.sim.dt;
    const t = sim.time;
    const ignited = sim.ignitedAt !== null;
    const tIgn = ignited ? t - sim.ignitedAt! : -1;
    const m = sim.metrics;

    for (const e of simEvents) {
      if (e.type === 'emberPhase' && !this.w.keepsakeAny) {
        // 写真がまだなければ、熾火に入ったところで撮る
        this.w.keepsakeAny = true;
        out.push({ type: 'keepsake', rank: 0.5 });
      }
      // 風を送って少しのうちに、細薪へ火が移った
      if (e.type === 'spread' && e.kind === 'kindling' && !this.stats.windSpread && sim.wind.lastGustAt > -100 && t - sim.wind.lastGustAt <= FC.windSpreadSeconds) {
        this.stats.windSpread = true;
        out.push({ type: 'task', id: 'f05' });
      }
    }

    // 見送りの始まり
    if (ignited && !this.farewell) {
      if (sim.session.emberPhase && sim.phase === 'out') {
        // 熾火の時間に火が尽きた：自然な終わり
        this.beginFarewell(sim, 'natural', FW.lastWordsBeforeEndSeconds, out);
      } else if (sim.session.activeTime >= sim.endTime - FW.lastWordsBeforeEndSeconds) {
        this.beginFarewell(sim, 'natural', Math.max(0.1, sim.endTime - sim.session.activeTime), out);
      }
    }
    // 見送りの終わり
    if (this.farewell && (t - this.farewell.start >= this.farewell.dur || (sim.session.ended && this.farewell.reason === 'natural'))) {
      sim.session.ended = true;
      this.ended = true;
      this.endReason = this.farewell.reason;
      out.push({ type: 'end', reason: this.farewell.reason });
      return out;
    }

    const burning = ignited && sim.phase === 'burning' && !sim.session.emberPhase && !this.farewell;
    const inWindow = burning && tIgn >= S.afterIgnitionSeconds;
    const stable = inWindow && isStable(m.heat, m.oxygen, m.smoke);
    if (inWindow) {
      this.stats.windowSeconds += dt;
      this.stats.heatSum += m.heat * dt;
      if (moisture(sim) >= BALANCE.hints.dampAt) this.stats.dampSeconds += dt;
    }
    if (burning) this.stats.maxHeat = Math.max(this.stats.maxHeat, m.heat);
    if (stable) this.stats.stableSeconds += dt;
    if (this.watching && inWindow) this.stats.watchSeconds += dt;

    // 落ち着いた火を、続けて眺める（60秒×モードの長さ）
    this.stats.watchStreak = stable && this.watching ? this.stats.watchStreak + dt : 0;
    if (this.stats.watchStreak > this.stats.watchStreakMax) this.stats.watchStreakMax = this.stats.watchStreak;
    if (!this.stats.watchStreakDone && this.stats.watchStreak >= BALANCE.discovery.stableWatchSeconds * this.modeScale) {
      this.stats.watchStreakDone = true;
      out.push({ type: 'task', id: 't21' });
    }

    if (burning) this.watchFireCare(sim, out);

    // 思い出の写真：火が育った節目ごとに撮り直す（大きい火ほど優先）
    const steps = BALANCE.keepsake.heatSteps;
    while (burning && this.w.keepsakeStep < steps.length && m.heat >= steps[this.w.keepsakeStep]) {
      this.w.keepsakeStep += 1;
      this.w.keepsakeAny = true;
      out.push({ type: 'keepsake', rank: this.w.keepsakeStep });
    }
    return out;
  }

  /** 火の世話の発見（強すぎる火・こもった煙・熾から戻す・大きな火） */
  private watchFireCare(sim: FireSim, out: SessionEvent[]): void {
    const dt = BALANCE.sim.dt;
    const m = sim.metrics;
    const w = this.w;
    const st = this.stats;
    // 強すぎる火を、落ち着かせた
    if (m.heat > FC.hotAbove) {
      w.hotFor += dt;
      w.calmFor = 0;
      if (w.hotFor >= FC.hotHoldSeconds) w.hotSeen = true;
    } else {
      w.hotFor = 0;
      if (w.hotSeen && m.heat <= FC.calmHeatAtMost) {
        w.calmFor += dt;
        if (w.calmFor >= FC.calmHoldSeconds) {
          w.hotSeen = false;
          w.calmFor = 0;
          if (!st.calmedHot) {
            st.calmedHot = true;
            out.push({ type: 'task', id: 'f07' });
          }
        }
      } else w.calmFor = 0;
    }
    // こもった煙に、空気を通した
    if (m.smoke > BALANCE.hints.smokyAt) {
      w.smokyFor += dt;
      w.clearFor = 0;
      if (w.smokyFor >= FC.smokyHoldSeconds) w.smokySeen = true;
    } else {
      w.smokyFor = 0;
      if (w.smokySeen && m.smoke < FC.smokeClearBelow && m.flamingSegs > 0) {
        w.clearFor += dt;
        if (w.clearFor >= FC.smokeClearHoldSeconds) {
          w.smokySeen = false;
          w.clearFor = 0;
          if (!st.clearedSmoke) {
            st.clearedSmoke = true;
            out.push({ type: 'task', id: 'f08' });
          }
        }
      } else w.clearFor = 0;
    }
    // 熾から火を戻した（炎がなく熾だけになった後、また燃えた）
    const emberOnly = sim.stage0Done && m.flamingSegs === 0 && (m.emberSegs > 0 || m.emberPower >= BALANCE.session.spentEmberPower);
    if (emberOnly) {
      w.emberOnlyFor += dt;
      if (w.emberOnlyFor >= FC.emberOnlySeconds) w.emberOnlySeen = true;
    } else {
      w.emberOnlyFor = 0;
      if (w.emberOnlySeen && m.flamingSegs >= FC.reviveFlamingSegs) {
        w.emberOnlySeen = false;
        const byTube = sim.tube.lastAt > -100 && sim.time - sim.tube.lastAt <= FC.tubeCreditSeconds;
        if (!st.revived) {
          st.revived = true;
          out.push({ type: 'task', id: 'f04' });
        }
        if (byTube && !st.revivedByTube) {
          st.revivedByTube = true;
          out.push({ type: 'task', id: 'f03' });
        }
      }
    }
    // 大きな火
    if (!st.bigFire && m.heat >= FC.bigFireHeat) {
      st.bigFire = true;
      out.push({ type: 'task', id: 'f11' });
    }
  }

  private beginFarewell(sim: FireSim, reason: EndReason, dur: number, out: SessionEvent[]): void {
    this.farewell = { reason, start: sim.time, dur };
    this.watching = false;
    out.push({ type: 'farewell', reason, duration: dur });
  }

  /** 落ち着いた火の割合（0..1） */
  get stableRate(): number {
    return this.stats.windowSeconds > 0 ? this.stats.stableSeconds / this.stats.windowSeconds : 0;
  }

  /** 眺めた時間の割合（0..1） */
  get watchRate(): number {
    return this.stats.windowSeconds > 0 ? this.stats.watchSeconds / this.stats.windowSeconds : 0;
  }

  get meanHeat(): number {
    return this.stats.windowSeconds > 0 ? this.stats.heatSum / this.stats.windowSeconds : this.stats.maxHeat;
  }

  /** 世話の回数（足した薪・送風・火吹き筒・組み替え） */
  get careCount(): number {
    const s = this.stats;
    return s.logsAdded + s.gusts + s.blows + s.rearranges;
  }

  // ───────────────────────────── 保存

  serialize(): SessionSnapshot {
    return {
      v: 2,
      seed: this.seed,
      duration: this.duration,
      farewell: this.farewell ? { ...this.farewell } : null,
      ended: this.ended,
      endReason: this.endReason,
      stats: JSON.parse(JSON.stringify(this.stats)),
      watch: { ...this.w },
      fireName: this.fireName,
    };
  }

  static deserialize(d: SessionSnapshot): FireSession {
    const s = new FireSession(d.seed, d.duration);
    s.farewell = d.farewell ? { ...d.farewell } : null;
    s.ended = d.ended;
    s.endReason = d.endReason;
    s.stats = { ...s.stats, ...JSON.parse(JSON.stringify(d.stats)) };
    s.w = { ...s.w, ...d.watch };
    s.fireName = d.fireName;
    return s;
  }

  /**
   * 以前の版（キャラクターがいた版）の保存データから：火の進み・見送り・その回の記録だけを引き継ぐ。
   * 火の精の成長・性格・会話は使わない。
   */
  static fromLegacy(c: LegacyCompanionSnapshot): FireSession {
    const s = new FireSession(c.seed, c.duration);
    // 以前の版の 'early'（生まれた後に火が消えた）は、最後まで見送った回ではないので 'manual'（早めに休ませた）にする
    const end = (r: string | null | undefined): EndReason | null => (r === 'manual' || r === 'early' ? 'manual' : r ? 'natural' : null);
    s.farewell = c.farewell ? { reason: end(c.farewell.reason) ?? 'natural', start: c.farewell.start, dur: c.farewell.dur } : null;
    s.ended = !!c.ended;
    s.endReason = end(c.endReason);
    const st = c.stats ?? {};
    s.stats.windowSeconds = num(st.windowSeconds);
    s.stats.stableSeconds = num(st.stableSeconds);
    s.stats.watchSeconds = num(st.watchSeconds);
    s.stats.watchStreakDone = !!st.watchStreakDone;
    s.stats.watchStreakMax = num(st.watchStreakMax);
    s.stats.gusts = num(st.gusts);
    s.stats.rearranges = num(st.rearranges);
    s.stats.logsAdded = num(st.logs);
    s.stats.layoutId = typeof st.layoutId === 'string' ? st.layoutId : null;
    s.stats.species = Array.isArray(st.species) ? (st.species.filter((x: unknown) => typeof x === 'string') as WoodId[]) : [];
    s.stats.kindlingUsed = !!st.kindlingUsed;
    // 以前の版は火力を記録していない（0のままにすると「小さく静かな火」になってしまう）
    s.stats.heatKnown = false;
    if (typeof c.fireName === 'string') s.fireName = c.fireName;
    return s;
  }

  /** 決定性テスト用 */
  fingerprint(): string {
    const r = (x: number) => Math.round(x * 1e6) / 1e6;
    const st = this.stats;
    return JSON.stringify({ e: this.ended, r: this.endReason, w: r(st.windowSeconds), s: r(st.stableSeconds), h: r(st.maxHeat), c: this.careCount, k: this.w.keepsakeStep });
  }
}

/** 以前の版の保存データ（火の精）。読むのは、ここで使う項目だけ */
export interface LegacyCompanionSnapshot {
  v: 1;
  seed: number;
  duration: number;
  farewell?: { reason: string; start: number; dur: number } | null;
  ended?: boolean;
  endReason?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stats?: Record<string, any>;
  fireName?: string;
}

function num(v: unknown): number {
  return typeof v === 'number' && isFinite(v) && v >= 0 ? v : 0;
}

/** 落ち着いた火か（火力・空気・煙がほどよい範囲） */
export function isStable(heat: number, oxygen: number, smoke: number): boolean {
  return heat >= S.heatMin && heat <= S.heatMax && oxygen >= S.oxygenMin && oxygen <= S.oxygenMax && smoke < S.smokeMax;
}

/** 湿り：主な薪（中薪・太薪）の平均。なければ細薪も含める（火口は数えない） */
export function moisture(sim: FireSim): number {
  let sum = 0;
  let n = 0;
  let sumAll = 0;
  let nAll = 0;
  for (const p of sim.pieces) {
    if (p.state === 'ash' || p.kind === 'tinder') continue;
    for (const s of p.segs) {
      sumAll += s.m;
      nAll++;
      if (isLog(p.kind)) {
        sum += s.m;
        n++;
      }
    }
  }
  if (n) return clamp(sum / n, 0, 1);
  return nAll ? clamp(sumAll / nAll, 0, 1) : 0;
}
