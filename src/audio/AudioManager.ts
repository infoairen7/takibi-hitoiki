/**
 * 音：すべてWeb Audioでその場で合成する自作音（外部音源なし・権利処理不要の仮素材）。
 * - 低い燃焼音（ブラウン系ノイズ）と、炎のゆらぎ（帯域ノイズ）を火の状態で連動
 * - 細かな爆ぜ（短いノイズ粒）の頻度・左右位置を燃えている場所へ結ぶ
 * - 薪を置く音（大きさで音程）・火ばさみ・ライター・送風・崩れ
 * - BGM（music.ts：ゆっくりした和音と小さな単音。設定で大きさを変え、0で止める）
 * ユーザー操作の後にだけ開始する（自動再生しない）。
 * 本番の録音素材が届いたら、各 play* の中身を差し替える。
 */
import { BALANCE, PieceKind } from '../game/balance';
import { AmbientMusic, MusicMood } from './music';

export interface FireAudioState {
  flamePower: number;
  emberPower: number;
  crackle: number;
  wind: number;
  /** 燃えている場所の左右 -1..1 */
  pan: number;
  paused: boolean;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private fireBus: GainNode | null = null;
  private rumble: GainNode | null = null;
  private roar: GainNode | null = null;
  private roarFilter: BiquadFilterNode | null = null;
  private windBed: GainNode | null = null;
  private ambience: GainNode | null = null;
  private placeBed: GainNode | null = null;
  private placeFilter: BiquadFilterNode | null = null;
  private place: PlaceSound = PLACE_SOUND.lakeside;
  private placeAcc = { drip: 0, chirp: 0 };
  private noiseBuf: AudioBuffer | null = null;
  private volume = 0.65;
  enabled = false;
  private crackleAcc = 0;
  /** BGM（自作・その場で合成。設定の BGM が 0 なら鳴らさない） */
  private music: AmbientMusic | null = null;
  private musicVolume = 0.4;
  private musicMood: MusicMood = { place: 'lakeside', phase: 'prepare', paused: false };
  private lastState: FireAudioState = { flamePower: 0, emberPower: 0, crackle: 0, wind: 0, pan: 0, paused: false };

  get supported(): boolean {
    return typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window);
  }

  /** ユーザー操作の中で呼ぶ */
  async enable(): Promise<boolean> {
    if (!this.supported) return false;
    // 直前の「音を消す」で予約した停止を取り消す（すばやく消して付け直したとき、無音にならないように）
    this.suspendToken++;
    try {
      if (!this.ctx) this.build();
      await this.ctx!.resume();
      this.enabled = true;
      this.setVolume(this.volume);
      return this.ctx!.state === 'running';
    } catch {
      return false;
    }
  }

  disable(): void {
    this.enabled = false;
    this.fadeOutThenSuspend();
  }

  /** 音を急に切らない：小さくしてから止める（プツッという音を避ける） */
  private fadeOutThenSuspend(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.master) this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
    const token = ++this.suspendToken;
    window.setTimeout(() => {
      if (token === this.suspendToken) void ctx.suspend().catch(() => undefined);
    }, 180);
  }

  private suspendToken = 0;

  /** 動作チェック用：音の状態と出力の遅れ */
  get stateLabel(): string {
    if (!this.supported) return 'この環境では出せない';
    if (!this.ctx) return 'まだ開始していない';
    return this.ctx.state;
  }

  get outputLatencyMs(): number | null {
    const c = this.ctx as (AudioContext & { outputLatency?: number }) | null;
    if (!c) return null;
    const v = (c.outputLatency ?? 0) + (c.baseLatency ?? 0);
    return v > 0 ? v * 1000 : null;
  }

  /** 復帰時に止まっていないか */
  get needsResume(): boolean {
    return this.enabled && !!this.ctx && this.ctx.state !== 'running';
  }

  async resume(): Promise<boolean> {
    if (!this.ctx) return false;
    this.suspendToken++;
    try {
      await this.ctx.resume();
      // 戻ったときは、ふわっと戻す
      if (this.master && this.enabled) {
        const t = this.ctx.currentTime;
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.setValueAtTime(0, t);
        this.master.gain.setTargetAtTime(this.volume * 0.9, t, 0.35);
      }
      return this.ctx.state === 'running';
    } catch {
      return false;
    }
  }

  suspend(): void {
    this.fadeOutThenSuspend();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.enabled ? this.volume * 0.9 : 0, this.ctx.currentTime, 0.1);
  }

  private build(): void {
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext) as typeof AudioContext;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;

    // ノイズ素材（8秒・ループ。同じ短い音の繰り返しにしない）
    const len = ctx.sampleRate * 8;
    const white = ctx.createBuffer(2, len, ctx.sampleRate);
    const brown = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const w = white.getChannelData(ch);
      const b = brown.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const r = Math.random() * 2 - 1;
        w[i] = r;
        last = (last + 0.02 * r) / 1.02;
        b[i] = last * 3.5;
      }
      // ループの継ぎ目をなめらかに
      const fade = 2048;
      for (let i = 0; i < fade; i++) {
        const t = i / fade;
        w[i] = w[i] * t + w[len - fade + i] * (1 - t);
        b[i] = b[i] * t + b[len - fade + i] * (1 - t);
      }
    }
    this.noiseBuf = white;

    const fireBus = ctx.createGain();
    fireBus.gain.value = 1;
    fireBus.connect(master);
    this.fireBus = fireBus;

    // 低い燃焼音
    const rumbleSrc = ctx.createBufferSource();
    rumbleSrc.buffer = brown;
    rumbleSrc.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const rumble = ctx.createGain();
    rumble.gain.value = 0;
    rumbleSrc.connect(lp).connect(rumble).connect(fireBus);
    rumbleSrc.start();
    this.rumble = rumble;

    // 炎のゆらぎ（ごうっという息）
    const roarSrc = ctx.createBufferSource();
    roarSrc.buffer = white;
    roarSrc.loop = true;
    roarSrc.loopStart = 2.3;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 0.6;
    const roar = ctx.createGain();
    roar.gain.value = 0;
    roarSrc.connect(bp).connect(roar).connect(fireBus);
    roarSrc.start(0, 2.3);
    this.roar = roar;
    this.roarFilter = bp;

    // 風の音
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = white;
    windSrc.loop = true;
    const wbp = ctx.createBiquadFilter();
    wbp.type = 'bandpass';
    wbp.frequency.value = 450;
    wbp.Q.value = 0.9;
    const windBed = ctx.createGain();
    windBed.gain.value = 0;
    windSrc.connect(wbp).connect(windBed).connect(master);
    windSrc.start(0, 5.1);
    this.windBed = windBed;

    // 夜の気配（とても小さい）
    const ambSrc = ctx.createBufferSource();
    ambSrc.buffer = brown;
    ambSrc.loop = true;
    const alp = ctx.createBiquadFilter();
    alp.type = 'lowpass';
    alp.frequency.value = 180;
    const amb = ctx.createGain();
    amb.gain.value = 0.05;
    ambSrc.connect(alp).connect(amb).connect(master);
    ambSrc.start(0, 3.7);
    this.ambience = amb;

    // 場所の音（波・雨・葉ずれ・街のざわめき）
    const plSrc = ctx.createBufferSource();
    plSrc.buffer = white;
    plSrc.loop = true;
    const pf = ctx.createBiquadFilter();
    const pg = ctx.createGain();
    pg.gain.value = 0;
    plSrc.connect(pf).connect(pg).connect(master);
    plSrc.start(0, 1.3);
    this.placeBed = pg;
    this.placeFilter = pf;
    this.applyPlace();

    this.music = new AmbientMusic(ctx, master);
    this.music.setMood(this.musicMood);
    this.music.setVolume(this.musicVolume);
  }

  /** BGMの大きさ（0..1。0で止める） */
  setMusicVolume(v: number): void {
    this.musicVolume = Math.max(0, Math.min(1, v));
    this.music?.setVolume(this.musicVolume);
  }

  /** BGMの場面（場所・支度／燃焼／熾火／見送り／思い出・一時停止） */
  setMusicMood(m: MusicMood): void {
    this.musicMood = m;
    this.music?.setMood(m);
  }

  /** 検証用：BGMで鳴らした和音・単音の数 */
  get musicStats(): { chords: number; notes: number; finales: number } | null {
    return this.music ? { ...this.music.stats } : null;
  }

  /** 場所の音を切り替える（見た目と同じく、燃焼には影響しない） */
  setPlace(id: string): void {
    const next = PLACE_SOUND[id] ?? PLACE_SOUND.lakeside;
    if (next === this.place) return;
    this.place = next;
    const ctx = this.ctx;
    if (!ctx || !this.placeBed) {
      this.applyPlace();
      return;
    }
    // 前の場所の音を小さくしてから、音色を切り替えて戻す（つなぎ目で音が跳ねないように）
    this.placeHoldUntil = ctx.currentTime + 0.45;
    this.placeBed.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    window.setTimeout(() => this.applyPlace(), 380);
  }

  private placeHoldUntil = 0;

  private applyPlace(): void {
    const f = this.placeFilter;
    const ctx = this.ctx;
    if (!f || !ctx) return;
    f.type = this.place.type;
    f.frequency.setTargetAtTime(this.place.freq, ctx.currentTime, 0.2);
    f.Q.value = this.place.q;
  }

  private ping(freq: number, amp: number, decay: number, pan: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t0);
    o.frequency.exponentialRampToValueAtTime(freq * 0.82, t0 + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(amp, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g).connect(p).connect(this.master!);
    o.start(t0);
    o.stop(t0 + decay + 0.05);
  }

  /** 毎フレーム：火の状態に合わせて音を動かす */
  update(s: FireAudioState, dt: number): void {
    this.lastState = s;
    const ctx = this.ctx;
    if (!ctx || !this.enabled || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const f = Math.min(1, Math.pow(s.flamePower / 8, 0.7));
    const e = Math.min(1, s.emberPower / 3);
    const breath = 0.85 + 0.15 * Math.sin(now * 1.6) * Math.sin(now * 0.63 + 1);
    const pause = s.paused ? 0.35 : 1;
    this.rumble!.gain.setTargetAtTime((0.1 * f + 0.05 * e) * pause, now, 0.4);
    this.roar!.gain.setTargetAtTime(0.06 * f * breath * (1 + s.wind * 0.8) * pause, now, 0.25);
    this.roarFilter!.frequency.setTargetAtTime(500 + 500 * f + 300 * s.wind, now, 0.3);
    this.windBed!.gain.setTargetAtTime(0.09 * Math.max(0, s.wind - 0.12), now, 0.2);
    this.ambience!.gain.setTargetAtTime(0.045, now, 1);
    // 場所の音：ゆっくり寄せては返す
    const P = this.place;
    const swell = 1 - P.swellDepth * 0.5 * (1 + Math.sin((now * Math.PI * 2) / P.swell + Math.sin(now * 0.13) * 1.5));
    if (now >= this.placeHoldUntil) this.placeBed?.gain.setTargetAtTime(P.gain * swell * (s.paused ? 0.5 : 1), now, 0.6);
    this.music?.update();
    if (s.paused) return;
    this.placeAcc.drip += P.drips * dt;
    while (this.placeAcc.drip > 0) {
      if (Math.random() < Math.min(1, this.placeAcc.drip)) this.ping(P.dripFreq * (0.8 + Math.random() * 0.5), P.dripAmp * (0.4 + Math.random() * 0.6), 0.08 + Math.random() * 0.08, Math.random() * 1.6 - 0.8);
      this.placeAcc.drip -= 1;
    }
    this.placeAcc.chirp += P.chirps * dt;
    while (this.placeAcc.chirp > 0) {
      if (Math.random() < Math.min(1, this.placeAcc.chirp)) {
        const pan = Math.random() * 1.6 - 0.8;
        const f = 3900 + Math.random() * 900;
        for (let k = 0; k < 3; k++) window.setTimeout(() => this.ping(f, 0.006, 0.05, pan), k * 70);
      }
      this.placeAcc.chirp -= 1;
    }
    // 爆ぜ：燃えている量に応じた頻度（ポアソン過程）
    const rate = s.crackle * (2 + 10 * f) + e * 1.2;
    this.crackleAcc += rate * dt;
    while (this.crackleAcc > 0) {
      if (Math.random() < Math.min(1, this.crackleAcc)) this.tick(s.pan + (Math.random() - 0.5) * 0.5, 0.2 + Math.random() * 0.8);
      this.crackleAcc -= 1;
    }
  }

  private noiseBurst(dur: number, freq: number, q: number, gain: number, pan: number, decay: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(bp).connect(g).connect(p).connect(this.fireBus ?? this.master!);
    src.start(t0, Math.random() * 7);
    src.stop(t0 + dur + 0.05);
  }

  /** 小さな爆ぜ */
  private tick(pan: number, size: number): void {
    this.noiseBurst(0.04, 1800 + Math.random() * 4200, 2 + Math.random() * 4, 0.06 + 0.12 * size, pan, 0.008 + 0.03 * size);
  }

  /** 大きめの爆ぜ（火の粉とそろえる） */
  pop(pan: number): void {
    if (!this.enabled) return;
    this.noiseBurst(0.12, 900 + Math.random() * 1200, 1.5, 0.28, pan, 0.07);
    this.noiseBurst(0.06, 3000 + Math.random() * 2000, 3, 0.12, pan, 0.03, 0.01);
  }

  /** 薪を置く：大きさで音程を変える木の音（3〜5種の揺らぎ） */
  woodKnock(kind: PieceKind, pan: number, onFire = false): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t0 = ctx.currentTime;
    if (kind === 'tinder') {
      this.noiseBurst(0.25, 2500, 0.7, 0.12, pan, 0.18);
      return;
    }
    // 太いほど低く、長く、重い音（太薪 < 中薪 < 細薪）
    const thick = kind !== 'kindling';
    const base = kind === 'large' ? 130 + Math.random() * 40 : kind === 'medium' ? 180 + Math.random() * 60 : 520 + Math.random() * 180;
    const partials = [1, 2.31, 3.9 + Math.random() * 0.4];
    partials.forEach((m, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = base * m;
      const g = ctx.createGain();
      const amp = (kind === 'large' ? 0.36 : thick ? 0.32 : 0.2) / (i + 1);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(amp, t0 + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + (kind === 'large' ? 0.28 : thick ? 0.22 : 0.12) / (1 + i * 0.6));
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      o.connect(g).connect(p).connect(this.master!);
      o.start(t0);
      o.stop(t0 + 0.4);
    });
    this.noiseBurst(0.05, kind === 'large' ? 700 : thick ? 900 : 2200, 1.2, 0.18, pan, 0.04);
    if (onFire) this.noiseBurst(0.5, 1400, 0.8, 0.12, pan, 0.4, 0.05);
  }

  tongs(pan: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t0 = ctx.currentTime;
    for (const [f, a] of [
      [1320, 0.05],
      [2870, 0.03],
      [4410, 0.02],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.value = f * (0.97 + Math.random() * 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(a, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      o.connect(g).connect(p).connect(this.master!);
      o.start(t0);
      o.stop(t0 + 0.2);
    }
  }

  lighter(): void {
    if (!this.enabled) return;
    this.noiseBurst(0.02, 5000, 4, 0.18, 0.3, 0.012);
    this.noiseBurst(1.8, 4200, 0.8, 0.035, 0.3, 1.6, 0.05);
    this.noiseBurst(0.6, 500, 0.7, 0.14, 0.2, 0.5, 0.35);
  }

  ignite(): void {
    if (!this.enabled) return;
    this.noiseBurst(0.9, 380, 0.6, 0.2, 0, 0.8);
  }

  gust(level: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || !this.noiseBuf) return;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(260, t0);
    bp.frequency.linearRampToValueAtTime(700 + level * 300, t0 + 0.5);
    bp.frequency.linearRampToValueAtTime(320, t0 + 2.6);
    const g = ctx.createGain();
    const amp = 0.05 + level * 0.05;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(amp, t0 + 0.35);
    g.gain.setValueAtTime(amp, t0 + 1.7);
    g.gain.linearRampToValueAtTime(0, t0 + 3);
    src.connect(bp).connect(g).connect(this.master!);
    src.start(t0, Math.random() * 4);
    src.stop(t0 + 3.1);
  }

  /** 火吹き筒：細く長い息（うちわより高く、狭い帯域）。しっかり吹くと少し強く、熾がぱちっと鳴る */
  blow(level: number, pan: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled || !this.noiseBuf) return;
    const T = BALANCE.tube;
    const t0 = ctx.currentTime;
    const dur = T.attack + T.hold + T.release;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.2;
    bp.frequency.setValueAtTime(900, t0);
    bp.frequency.linearRampToValueAtTime(1500 + level * 500, t0 + T.attack + 0.2);
    bp.frequency.linearRampToValueAtTime(1100, t0 + dur);
    const g = ctx.createGain();
    const amp = 0.045 + level * 0.035;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(amp, t0 + T.attack);
    g.gain.setValueAtTime(amp, t0 + T.attack + T.hold);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(bp).connect(g).connect(p).connect(this.master!);
    src.start(t0, Math.random() * 4);
    src.stop(t0 + dur + 0.05);
    // 熾に風が入る小さな音
    this.noiseBurst(0.2, 2400, 1.5, 0.05 + level * 0.04, pan, 0.12, T.attack + 0.3);
  }

  collapse(pan: number): void {
    if (!this.enabled) return;
    this.noiseBurst(0.4, 420, 0.9, 0.22, pan, 0.3);
    this.noiseBurst(0.3, 1800, 1.2, 0.1, pan, 0.2, 0.06);
  }

  /** やわらかな和音（誕生・成長・見送り）。突然の大音量にしない */
  private chime(freqs: number[], amp: number, attack: number, decay: number, spread = 0.08, detune = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t0 = ctx.currentTime;
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * (1 + detune * (i - 1));
      const g = ctx.createGain();
      const start = t0 + i * spread;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(amp / (1 + i * 0.35), start + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
      const p = ctx.createStereoPanner();
      p.pan.value = (i - (freqs.length - 1) / 2) * 0.25;
      o.connect(g).connect(p).connect(this.master!);
      o.start(start);
      o.stop(start + attack + decay + 0.05);
    });
  }

  /** 細薪から中薪へ、火がつながった：ふっと火が膨らむ音と、小さな和音 */
  stageUp(): void {
    if (!this.enabled) return;
    this.noiseBurst(0.9, 600, 0.6, 0.06, 0, 0.8, 0.2);
    this.chime([587.33, 739.99, 880], 0.035, 0.3, 1.8, 0.1);
  }

  /** 見送り：ゆっくり下がる和音 */
  farewell(): void {
    if (!this.enabled) return;
    this.chime([659.25, 523.25, 392], 0.035, 0.5, 3.2, 0.35);
  }

  /** 記録（写真・思い出の保存） */
  record(): void {
    if (!this.enabled) return;
    this.noiseBurst(0.03, 3200, 2.5, 0.08, 0, 0.02);
    this.noiseBurst(0.05, 1400, 2, 0.05, 0, 0.04, 0.08);
  }

  get state(): FireAudioState {
    return this.lastState;
  }
}

interface PlaceSound {
  type: BiquadFilterType;
  freq: number;
  q: number;
  gain: number;
  /** 寄せては返す周期（秒）と深さ */
  swell: number;
  swellDepth: number;
  /** しずく・水音（毎秒の回数） */
  drips: number;
  dripFreq: number;
  dripAmp: number;
  /** 虫の声（毎秒の回数） */
  chirps: number;
}

const PLACE_SOUND: Record<string, PlaceSound> = {
  lakeside: { type: 'lowpass', freq: 520, q: 0.7, gain: 0.018, swell: 5.5, swellDepth: 0.7, drips: 0.25, dripFreq: 900, dripAmp: 0.012, chirps: 0.06 },
  forest: { type: 'bandpass', freq: 1700, q: 0.45, gain: 0.011, swell: 9, swellDepth: 0.6, drips: 0, dripFreq: 0, dripAmp: 0, chirps: 0.3 },
  beach: { type: 'lowpass', freq: 850, q: 0.6, gain: 0.055, swell: 8.5, swellDepth: 0.9, drips: 0, dripFreq: 0, dripAmp: 0, chirps: 0 },
  pavilion: { type: 'highpass', freq: 1200, q: 0.4, gain: 0.05, swell: 13, swellDepth: 0.2, drips: 5, dripFreq: 2300, dripAmp: 0.01, chirps: 0 },
  cabin: { type: 'bandpass', freq: 320, q: 0.8, gain: 0.02, swell: 11, swellDepth: 0.7, drips: 0, dripFreq: 0, dripAmp: 0, chirps: 0 },
  rooftop: { type: 'lowpass', freq: 200, q: 0.7, gain: 0.035, swell: 17, swellDepth: 0.3, drips: 0, dripFreq: 0, dripAmp: 0, chirps: 0 },
};
