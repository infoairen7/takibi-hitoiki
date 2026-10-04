/**
 * BGM（任意・初期小音量。詳細仕様「BGMは任意で初期小音量。無音でも全情報が伝わる」）。
 * 録音素材や既存の曲は使わず、この端末でその場で合成する自作の小さな音楽。
 * - ゆっくり移り変わる和音（やわらかなパッド）と、ときどき鳴る小さな単音（オルゴール・カリンバのような音）
 * - 場所ごとに調と和音の並びを変える。熾火の時間は音を減らし、見送りで静かに終わる。思い出の画面では鳴らさない
 * - 突然の大きな音・警報のような音は出さない（すべての音はゆっくり立ち上がり、ゆっくり消える）
 * 時間はすべて AudioContext の時計（画面を離れて止まっている間は進まない）。
 */

export type MusicPhase = 'prepare' | 'burning' | 'ember' | 'farewell' | 'ended';

export interface MusicMood {
  place: string;
  phase: MusicPhase;
  /** メニューなどで止めている */
  paused: boolean;
}

// ハ長調での和音（MIDIの音の高さ。いちばん下がベース。開いた並べ方で濁らせない）
const C = {
  I: [48, 55, 59, 62, 64], // Cmaj9（ド・ソ・シ・レ・ミ）
  ii: [38, 45, 53, 60, 64], // Dm9（レ・ラ・ファ・ド・ミ）
  iii: [40, 47, 55, 62, 64], // Em7（ミ・シ・ソ・レ・ミ）
  IV: [41, 48, 52, 55, 57], // Fmaj9（ファ・ド・ミ・ソ・ラ）
  V: [43, 50, 57, 59, 64], // G6/9（ソ・レ・ラ・シ・ミ）
  vi: [45, 52, 55, 60, 64], // Am7（ラ・ミ・ソ・ド・ミ）
};

/** 長調の5音（ド・レ・ミ・ソ・ラ）。メロディはこの中から選ぶので、どの和音とも濁りにくい */
const PENTATONIC = [0, 2, 4, 7, 9];

export interface MusicKey {
  label: string;
  /** ハ長調からの移調（半音） */
  transpose: number;
  progression: number[][];
  /** 1つの和音の長さ（秒） */
  chordSeconds: number;
  /** 単音の平均の間隔（秒） */
  noteEvery: number;
  /** 単音の高さの範囲（MIDI。移調前） */
  melodyLow: number;
  melodyHigh: number;
  /** パッドの明るさ（ローパスの周波数） */
  brightness: number;
}

export const MUSIC_KEYS: Record<string, MusicKey> = {
  lakeside: { label: 'ニ長調・水面', transpose: 2, progression: [C.I, C.vi, C.IV, C.V], chordSeconds: 10, noteEvery: 3.6, melodyLow: 67, melodyHigh: 84, brightness: 950 },
  forest: { label: 'イ短調・夜の森', transpose: 0, progression: [C.vi, C.IV, C.I, C.V], chordSeconds: 11, noteEvery: 4.2, melodyLow: 64, melodyHigh: 81, brightness: 820 },
  beach: { label: 'ホ長調・波', transpose: 4, progression: [C.I, C.iii, C.IV, C.V], chordSeconds: 12, noteEvery: 4.5, melodyLow: 64, melodyHigh: 81, brightness: 900 },
  pavilion: { label: 'ヘ長調・雨', transpose: 5, progression: [C.IV, C.I, C.vi, C.V], chordSeconds: 12, noteEvery: 5, melodyLow: 62, melodyHigh: 79, brightness: 780 },
  cabin: { label: 'ハ長調・雪', transpose: 0, progression: [C.I, C.IV, C.vi, C.V], chordSeconds: 11, noteEvery: 3.4, melodyLow: 72, melodyHigh: 88, brightness: 1000 },
  rooftop: { label: '変ロ長調・街の夜', transpose: -2, progression: [C.ii, C.V, C.I, C.vi], chordSeconds: 10, noteEvery: 4, melodyLow: 67, melodyHigh: 84, brightness: 880 },
};

export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/** n 番目の和音の音（MIDI） */
export function chordNotes(place: string, index: number): number[] {
  const k = MUSIC_KEYS[place] ?? MUSIC_KEYS.lakeside;
  const ch = k.progression[((index % k.progression.length) + k.progression.length) % k.progression.length];
  const t = k.transpose;
  // 低すぎる音（スマホでは聞こえず、こもるだけ）は1オクターブ上げる
  return ch.map((n) => (n + t < 36 ? n + t + 12 : n + t));
}

/** メロディに使える音（MIDI。その調の5音で、範囲内） */
export function melodyNotes(place: string): number[] {
  const k = MUSIC_KEYS[place] ?? MUSIC_KEYS.lakeside;
  const t = k.transpose;
  const low = k.melodyLow;
  const high = k.melodyHigh;
  const out: number[] = [];
  for (let m = low; m <= high; m++) {
    const pc = (((m - t) % 12) + 12) % 12;
    if (PENTATONIC.includes(pc)) out.push(m);
  }
  return out;
}

/** 場面ごとの、和音の長さ・単音の間隔・明るさ・音量の倍率 */
export function phaseShape(phase: MusicPhase): { chord: number; note: number; bright: number; level: number; melody: boolean; pads: boolean } {
  const base = { chord: 1, note: 1, bright: 1, level: 1, melody: true, pads: true };
  if (phase === 'prepare') Object.assign(base, { note: 1.25, level: 0.85 });
  if (phase === 'ember') Object.assign(base, { chord: 1.3, note: 2, bright: 0.75, level: 0.75 });
  if (phase === 'farewell' || phase === 'ended') Object.assign(base, { melody: false, pads: false, level: 0.8 });
  return base;
}

/** 音量の基準（設定の BGM 1.0 のときの、BGM 全体の大きさ）。焚き火の音より小さく */
const BUS_LEVEL = 0.5;
const PAD_NOTE = 0.03;
const PAD_BASS = 0.045;
const PLUCK = 0.075;

export class AmbientMusic {
  private bus: GainNode;
  private echoSend: GainNode;
  private volume = 0;
  private mood: MusicMood = { place: 'lakeside', phase: 'prepare', paused: false };
  private chordIndex = 0;
  private nextChordAt = -1;
  private nextNoteAt = -1;
  private lastNote = -1;
  private finaleDone = false;
  /** 鳴っている和音（見送りのとき、今の和音をそっと消してから終わりの和音へ） */
  private pads: Array<{ env: GainNode; until: number }> = [];
  /** 検証用：鳴らした和音・単音の数 */
  stats = { chords: 0, notes: 0, finales: 0 };

  constructor(
    private ctx: BaseAudioContext,
    out: AudioNode,
    private rand: () => number = Math.random,
  ) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(out);
    // 小さな響き（左右に分かれたやまびこ。重いリバーブは使わない）
    this.echoSend = ctx.createGain();
    this.echoSend.gain.value = 0.35;
    for (const [time, pan] of [
      [0.43, -0.6],
      [0.61, 0.6],
    ] as const) {
      const d = ctx.createDelay(1.5);
      d.delayTime.value = time;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      const fb = ctx.createGain();
      fb.gain.value = 0.32;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      this.echoSend.connect(d);
      d.connect(lp);
      lp.connect(fb);
      fb.connect(d);
      lp.connect(p);
      p.connect(this.bus);
    }
  }

  /** 設定の BGM（0..1。0で止める） */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyLevel(2);
  }

  setMood(m: MusicMood): void {
    const prev = this.mood;
    if (prev.place === m.place && prev.phase === m.phase && prev.paused === m.paused) return;
    this.mood = { ...m };
    const now = this.ctx.currentTime;
    // 新しい火（支度）に戻ったら、はじめの和音から
    if ((prev.phase === 'ended' || prev.phase === 'farewell') && (m.phase === 'prepare' || m.phase === 'burning')) {
      this.chordIndex = 0;
      this.nextChordAt = -1;
      this.nextNoteAt = -1;
      this.finaleDone = false;
    }
    // 場所が変わったら、次の和音から新しい調へ（今の和音は自然に消える）
    if (prev.place !== m.place) this.chordIndex = 0;
    // 見送り：最後に一度だけ、主和音をゆっくり鳴らして終わる
    if (m.phase === 'farewell' && !this.finaleDone && this.volume > 0) {
      this.finaleDone = true;
      for (const p of this.pads) {
        if (p.until <= now) continue;
        const v = p.env.gain.value;
        p.env.gain.cancelScheduledValues(now);
        p.env.gain.setValueAtTime(v, now);
        p.env.gain.setTargetAtTime(0, now, 0.9);
      }
      this.pads = [];
      const k = MUSIC_KEYS[m.place] ?? MUSIC_KEYS.lakeside;
      const tonic = C.I.map((n) => n + k.transpose);
      this.pad(now + 0.4, tonic, 5, 7, k.brightness * 0.8);
      this.stats.finales += 1;
    }
    this.applyLevel(m.paused !== prev.paused ? 0.6 : 2.5);
  }

  private applyLevel(tau: number): void {
    const shape = phaseShape(this.mood.phase);
    const level = this.volume <= 0 ? 0 : BUS_LEVEL * this.volume * shape.level * (this.mood.paused ? 0.6 : 1);
    this.bus.gain.setTargetAtTime(level, this.ctx.currentTime, tau);
  }

  /** 毎フレーム（音が動いている間だけ呼ばれる）：少し先までの和音と単音を予約する */
  update(): void {
    if (this.volume <= 0) return;
    const now = this.ctx.currentTime;
    const ahead = 1.2;
    const m = this.mood;
    const shape = phaseShape(m.phase);
    const k = MUSIC_KEYS[m.place] ?? MUSIC_KEYS.lakeside;
    if (shape.pads) {
      // 止まっていた（画面を離れた・音を消していた）後は、今から始め直す
      if (this.nextChordAt < now) this.nextChordAt = now + 0.2;
      while (this.nextChordAt < now + ahead) {
        const dur = k.chordSeconds * shape.chord;
        this.pad(this.nextChordAt, chordNotes(m.place, this.chordIndex), dur, 4.5, k.brightness * shape.bright);
        this.chordIndex += 1;
        this.nextChordAt += dur;
      }
    }
    if (shape.melody && !m.paused) {
      if (this.nextNoteAt < now) this.nextNoteAt = now + 1.5 + this.rand() * k.noteEvery;
      while (this.nextNoteAt < now + ahead) {
        this.phrase(this.nextNoteAt, m.place);
        // 間隔はばらつかせる（同じリズムの繰り返しにしない）
        this.nextNoteAt += k.noteEvery * shape.note * (0.55 + this.rand() * 0.9);
      }
    }
  }

  /** やわらかな和音：ゆっくり立ち上がり、次の和音と重なりながら消える */
  private pad(t: number, notes: number[], dur: number, release: number, bright: number): void {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = bright;
    lp.Q.value = 0.4;
    const env = ctx.createGain();
    const attack = Math.min(3.2, dur * 0.35);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + attack);
    env.gain.setValueAtTime(1, t + dur);
    env.gain.setTargetAtTime(0, t + dur, release / 3);
    lp.connect(env);
    env.connect(this.bus);
    const send = ctx.createGain();
    send.gain.value = 0.25;
    env.connect(send);
    send.connect(this.echoSend);
    const end = t + dur + release + 0.5;
    const now = ctx.currentTime;
    this.pads = this.pads.filter((p) => p.until > now);
    this.pads.push({ env, until: end });
    notes.forEach((n, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = midiToFreq(n);
      o.detune.value = (this.rand() * 2 - 1) * 5;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? PAD_BASS : PAD_NOTE;
      const p = ctx.createStereoPanner();
      p.pan.value = i === 0 ? 0 : ((i % 2 ? -1 : 1) * (0.15 + 0.1 * i));
      o.connect(g);
      g.connect(p);
      p.connect(lp);
      o.start(t);
      o.stop(end);
    });
    this.stats.chords += 1;
  }

  /** 1〜3音の短いフレーズ（となりの音へ動くことが多い） */
  private phrase(t: number, place: string): void {
    const pool = melodyNotes(place);
    if (!pool.length) return;
    let i = this.lastNote >= 0 ? pool.indexOf(this.lastNote) : -1;
    if (i < 0) i = Math.floor(pool.length * (0.3 + this.rand() * 0.4));
    const count = this.rand() < 0.55 ? 1 : this.rand() < 0.7 ? 2 : 3;
    let at = t;
    for (let c = 0; c < count; c++) {
      const step = [-2, -1, -1, 1, 1, 2, 0][Math.floor(this.rand() * 7)];
      i = Math.max(0, Math.min(pool.length - 1, i + step));
      this.pluck(at, pool[i], c === count - 1 ? 1 : 0.8);
      this.lastNote = pool[i];
      at += 0.42 + this.rand() * 0.5;
    }
  }

  /** 小さな単音（オルゴール・カリンバのような、すぐ減衰する音） */
  private pluck(t: number, midi: number, amp: number): void {
    const ctx = this.ctx;
    const f = midiToFreq(midi);
    const g = ctx.createGain();
    const peak = PLUCK * amp;
    const decay = 2.1;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.008);
    g.gain.setTargetAtTime(0, t + 0.008, decay / 4);
    const p = ctx.createStereoPanner();
    p.pan.value = (this.rand() * 2 - 1) * 0.4;
    g.connect(p);
    p.connect(this.bus);
    g.connect(this.echoSend);
    const partials: Array<[number, number, OscillatorType]> = [
      [1, 1, 'sine'],
      [2.005, 0.22, 'sine'],
      [3.01, 0.07, 'sine'],
    ];
    for (const [mul, a, type] of partials) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mul;
      const pg = ctx.createGain();
      pg.gain.value = a;
      o.connect(pg);
      pg.connect(g);
      o.start(t);
      o.stop(t + decay + 0.3);
    }
    this.stats.notes += 1;
  }
}
