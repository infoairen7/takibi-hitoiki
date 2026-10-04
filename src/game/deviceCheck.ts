/**
 * 動作チェック（実機の確認用）。遊んでいる画面のまま一定時間はかり、結果を文章にまとめる。
 *  - なめらかさ：フレームの間隔（平均・中央値・遅いほう1%）、長いフレーム（50ms超）の数、10秒ごとのFPS
 *  - 熱のめやす：はじめの20秒と最後の20秒のFPSの差（長い計測で、端末が熱で遅くなっていないか）
 *  - ゲームの進み：実時間に対して、ゲーム時間が正しく進んだか（停止中を除く）
 *  - 画質の自動調整：計測中に解像度・軽量へ切り替えたこと
 *  - 入力：画面に触れてから次の描画が始まるまで（目安）
 *  - 端末・ブラウザ・WebGL・メモリ（取れる範囲。取れないものは「取得できない」）
 * どこへも送信しない。結果は画面に出し、本人がコピー・保存する。
 */

export interface CheckFrameStats {
  fps: number;
  dpr: number;
  quality: string;
  drawCalls: number;
  triangles: number;
}

export interface CheckGameState {
  phase: string;
  burning: boolean;
  paused: boolean;
  pieces: number;
  place: string;
  mode: string;
}

export interface CheckEnv {
  qualitySetting: string;
  soundEnabled: boolean;
  audioState: string;
  audioLatencyMs: number | null;
  sceneInitMs: number;
  reducedMotion: boolean;
  textSize: string;
}

export interface CheckSample {
  /** 計測開始からの秒 */
  t: number;
  frameMs: number;
}

export class DeviceCheck {
  readonly duration: number;
  readonly startedAt: number;
  private frames: CheckSample[] = [];
  private lastNow: number | null = null;
  private latencies: number[] = [];
  private pendingInput: number | null = null;
  /** ゲーム時間・捨てた刻みは、フレームごとの増えた分を足していく（新しい火・もう一度で値が戻っても崩れない） */
  private lastGame: number;
  private gameAccum = 0;
  private lastDropped: number;
  private droppedAccum = 0;
  private pausedMs = 0;
  private hiddenAt: number | null = null;
  private startStats: CheckFrameStats;
  private endStats: CheckFrameStats | null = null;
  private stateStart: CheckGameState;
  private stateEnd: CheckGameState | null = null;
  private adaptEvents: Array<{ t: number; what: string; fps: number }> = [];
  private hidden = false;
  done = false;
  cancelled = false;
  device: Record<string, string> = {};

  constructor(opts: { seconds: number; now: number; gameSeconds: number; stats: CheckFrameStats; state: CheckGameState; droppedSteps: number }) {
    this.duration = opts.seconds;
    this.startedAt = opts.now;
    this.lastGame = opts.gameSeconds;
    this.lastDropped = opts.droppedSteps;
    this.startStats = opts.stats;
    this.stateStart = opts.state;
  }

  /** 残り秒 */
  remaining(now: number): number {
    return Math.max(0, this.duration - (now - this.startedAt) / 1000);
  }

  private addGame(gameSeconds: number, dropped: number): void {
    const dg = gameSeconds - this.lastGame;
    if (dg > 0) this.gameAccum += dg;
    this.lastGame = gameSeconds;
    const dd = dropped - this.lastDropped;
    if (dd > 0) this.droppedAccum += dd;
    this.lastDropped = dropped;
  }

  /** 毎フレーム。paused はゲーム時間が止まっている（メニュー・見送りの後など）か */
  frame(now: number, paused: boolean, gameSeconds: number, dropped: number): void {
    if (this.done) return;
    this.addGame(gameSeconds, dropped);
    if (this.lastNow !== null) {
      const ms = now - this.lastNow;
      // 画面を離れていた間（非表示）は数えない
      if (ms > 0 && ms < 5000 && !this.hidden) this.frames.push({ t: (now - this.startedAt) / 1000, frameMs: ms });
      if (paused) this.pausedMs += Math.min(ms, 5000);
    }
    this.lastNow = now;
    if (this.pendingInput !== null) {
      const lat = now - this.pendingInput;
      if (lat >= 0 && lat < 1000) this.latencies.push(lat);
      this.pendingInput = null;
    }
  }

  /** 画面に触れた（event.timeStamp は performance.now と同じ時間軸） */
  input(timeStamp: number): void {
    if (this.done || this.pendingInput !== null) return;
    this.pendingInput = timeStamp;
  }

  /** 画面を離れていた時間は、止まっていた時間として数える */
  setHidden(h: boolean, now = performance.now()): void {
    if (h && !this.hidden) this.hiddenAt = now;
    if (!h && this.hidden && this.hiddenAt !== null) {
      this.pausedMs += now - this.hiddenAt;
      this.hiddenAt = null;
    }
    this.hidden = h;
    if (!h) this.lastNow = null;
  }

  noteAdapt(now: number, what: string, fps: number): void {
    if (now >= this.startedAt) this.adaptEvents.push({ t: (now - this.startedAt) / 1000, what, fps });
  }

  finish(opts: { now: number; gameSeconds: number; stats: CheckFrameStats; state: CheckGameState; droppedSteps: number }): void {
    this.addGame(opts.gameSeconds, opts.droppedSteps);
    if (this.hidden && this.hiddenAt !== null) this.pausedMs += opts.now - this.hiddenAt;
    this.done = true;
    this.endStats = opts.stats;
    this.stateEnd = opts.state;
    this.elapsedMs = opts.now - this.startedAt;
  }

  private elapsedMs = 0;

  /** 数値のまとめ（テスト用にも使う） */
  summary(): {
    frames: number;
    avgFps: number;
    medianMs: number;
    p99Ms: number;
    low1Fps: number;
    longFrames: number;
    series: number[];
    firstFps: number;
    lastFps: number;
    latencyMedianMs: number | null;
    latencyP90Ms: number | null;
    gameRate: number | null;
  } {
    const ms = this.frames.map((f) => f.frameMs).sort((a, b) => a - b);
    const n = ms.length;
    const sum = ms.reduce((a, b) => a + b, 0);
    const q = (p: number) => (n ? ms[Math.min(n - 1, Math.floor(p * (n - 1)))] : 0);
    const fpsOf = (from: number, to: number) => {
      const fr = this.frames.filter((f) => f.t >= from && f.t < to);
      const s = fr.reduce((a, b) => a + b.frameMs, 0);
      return fr.length && s > 0 ? (fr.length * 1000) / s : 0;
    };
    const total = this.elapsedMs / 1000 || this.duration;
    const series: number[] = [];
    for (let t = 0; t < total - 0.5; t += 10) series.push(Math.round(fpsOf(t, t + 10)));
    const lat = [...this.latencies].sort((a, b) => a - b);
    const lq = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(p * (lat.length - 1)))] : null);
    const runningSec = (this.elapsedMs - this.pausedMs) / 1000;
    const gameRate = runningSec > 5 ? this.gameAccum / runningSec : null;
    return {
      frames: n,
      avgFps: n && sum > 0 ? (n * 1000) / sum : 0,
      medianMs: q(0.5),
      p99Ms: q(0.99),
      low1Fps: q(0.99) > 0 ? 1000 / q(0.99) : 0,
      longFrames: ms.filter((x) => x > 50).length,
      series,
      firstFps: fpsOf(0, Math.min(20, total / 3)),
      lastFps: fpsOf(Math.max(total - 20, (total * 2) / 3), total + 1),
      latencyMedianMs: lq(0.5),
      latencyP90Ms: lq(0.9),
      gameRate,
    };
  }

  /** 送ってもらう文章 */
  report(env: CheckEnv, version: string, when = new Date()): string {
    const s = this.summary();
    const f1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
    const st0 = this.startStats;
    const st1 = this.endStats ?? st0;
    const g0 = this.stateStart;
    const g1 = this.stateEnd ?? g0;
    const heat = s.firstFps > 0 && s.lastFps > 0 ? s.lastFps / s.firstFps : 1;
    const lines: string[] = [];
    lines.push('【焚き火と、ひと息。 動作チェック】');
    lines.push(`日時：${when.toLocaleString('ja-JP')}　版：${version}`);
    lines.push(`計測：${Math.round((this.elapsedMs || this.duration * 1000) / 1000)}秒${this.cancelled ? '（途中で終了）' : ''}`);
    lines.push('');
    lines.push('■ 端末・ブラウザ');
    for (const [k, v] of Object.entries(this.device)) lines.push(`${k}：${v}`);
    lines.push('');
    lines.push('■ なめらかさ');
    lines.push(`平均 ${f1(s.avgFps)} fps（フレーム ${s.frames}）`);
    lines.push(`中央値 ${f1(s.medianMs)} ms／遅いほう1% ${f1(s.p99Ms)} ms（${f1(s.low1Fps)} fps）`);
    lines.push(`50ms を超えたフレーム：${s.longFrames}`);
    lines.push(`10秒ごとのfps：${s.series.join(' → ') || '—'}`);
    if (this.duration >= 120) {
      lines.push(`はじめと終わり：${f1(s.firstFps)} → ${f1(s.lastFps)} fps（${heat < 0.85 ? '後半に遅くなった：熱のおそれ' : '大きな変化なし'}）`);
    }
    lines.push('');
    lines.push('■ 画質');
    lines.push(`設定：${env.qualitySetting}／はじめ ${st0.quality}・解像度×${st0.dpr.toFixed(2)} → 終わり ${st1.quality}・解像度×${st1.dpr.toFixed(2)}`);
    lines.push(`描画：${st1.drawCalls}回・三角形 ${Math.round(st1.triangles / 1000)}千`);
    if (this.adaptEvents.length) for (const a of this.adaptEvents) lines.push(`  ${f1(a.t)}秒：${a.what}（その時 ${a.fps} fps）`);
    else lines.push('  計測中の自動調整：なし');
    lines.push(`動きを控えめ：${env.reducedMotion ? 'オン' : 'オフ'}／文字の大きさ：${env.textSize}`);
    lines.push('');
    lines.push('■ ゲームの進み');
    lines.push(s.gameRate === null ? 'ゲーム時間：計測中ほとんど止まっていた（メニューなど）' : `ゲーム時間の進み：実時間の ${f1(s.gameRate * 100)}%（100%が正常）`);
    lines.push(`追いつけずに捨てた刻み：${this.droppedAccum}（0.1秒ごと。1フレームが0.5秒を超えたぶん）`);
    lines.push(`状態：${g0.phase}${g0.burning ? '（燃焼中）' : ''} → ${g1.phase}${g1.burning ? '（燃焼中）' : ''}／薪 ${g1.pieces}本／${g1.place}・${g1.mode}`);
    lines.push('');
    lines.push('■ 入力と音');
    lines.push(
      s.latencyMedianMs === null
        ? '入力：計測中に画面へ触れなかったため、はかれていません'
        : `入力から次の描画まで：中央値 ${f1(s.latencyMedianMs)} ms／遅いほう10% ${f1(s.latencyP90Ms ?? 0)} ms（${this.latencies.length}回）`,
    );
    lines.push(`音：${env.soundEnabled ? 'オン' : 'オフ'}（${env.audioState}${env.audioLatencyMs !== null ? `・出力の遅れ ${f1(env.audioLatencyMs)} ms` : ''}）`);
    lines.push(`最初の画面の準備：${Math.round(env.sceneInitMs)} ms`);
    return lines.join('\n');
  }
}

/** 端末の情報（取れる範囲で。個人を特定する情報は集めない） */
export async function collectDevice(gl: WebGLRenderingContext | WebGL2RenderingContext | null): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const nav = navigator as Navigator & {
    userAgentData?: { mobile: boolean; platform: string; brands: Array<{ brand: string; version: string }>; getHighEntropyValues?: (h: string[]) => Promise<Record<string, unknown>> };
    deviceMemory?: number;
  };
  out['ブラウザ'] = nav.userAgent;
  try {
    if (nav.userAgentData?.getHighEntropyValues) {
      const h = await nav.userAgentData.getHighEntropyValues(['model', 'platformVersion', 'fullVersionList']);
      const brands = (h.fullVersionList as Array<{ brand: string; version: string }> | undefined)?.filter((b) => !/Not.?A.?Brand/i.test(b.brand)).map((b) => `${b.brand} ${b.version}`);
      out['機種'] = String(h.model || '（取得できない）');
      out['OS'] = `${nav.userAgentData.platform} ${String(h.platformVersion ?? '')}`.trim();
      if (brands?.length) out['ブラウザの版'] = brands.join(', ');
    }
  } catch {
    /* 取れなければ書かない */
  }
  out['画面'] = `${screen.width}×${screen.height}（表示 ${window.innerWidth}×${window.innerHeight}・倍率 ${window.devicePixelRatio}）`;
  out['CPUの数'] = String(nav.hardwareConcurrency ?? '（取得できない）');
  out['メモリ'] = nav.deviceMemory ? `${nav.deviceMemory} GB 以上` : '（取得できない）';
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  if (mem) out['使っているメモリ（JS）'] = `${Math.round(mem.usedJSHeapSize / 1048576)} MB／上限 ${Math.round(mem.jsHeapSizeLimit / 1048576)} MB`;
  if (gl) {
    try {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      out['GPU'] = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
      out['WebGL'] = String(gl.getParameter(gl.VERSION));
      out['テクスチャ上限'] = String(gl.getParameter(gl.MAX_TEXTURE_SIZE));
    } catch {
      out['GPU'] = '（取得できない）';
    }
  }
  return out;
}
