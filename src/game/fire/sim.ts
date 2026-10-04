/**
 * 燃焼シミュレーション（10Hz固定刻み・seed付き）。
 *
 * 旧版の「本数から火力を一括計算する式」は使わない。
 * 各薪を長さ方向の区間に分け、区間ごとに温まり・炎・焦げ・赤熱・灰・湿りを持つ。
 * 熱は「燃えている区間」から距離・接触・上昇気流（風で傾く）に応じて近くの区間へ伝わる。
 * 空気は、見えている隙間（混雑・床への接地・持ち上がり）と送風から局所的に決まる。
 */
import { BALANCE, PieceKind, WOODS, WoodId, clamp, isLog, smoothstep } from '../balance';
import { Rng } from '../rng';
import {
  BurnState,
  Piece,
  Vec3,
  computeSegPositions,
  createPiece,
  derivePieceState,
  pieceLabel,
} from './model';
import { PlacementResult, resettle } from './placement';
import { WindFrom, WindState, createWindState, requestGust, stepWind, windSnapshot } from './wind';

const B = BALANCE;

export type SimEventType =
  | 'lighterOn'
  | 'lighterOff'
  | 'ignite'
  | 'spread'
  | 'flameout'
  | 'emberOnly'
  | 'ashed'
  | 'tinderSpent'
  | 'pop'
  | 'placed'
  | 'placedOnFire'
  | 'moved'
  | 'removed'
  | 'gust'
  | 'gustIgnored'
  | 'blow'
  | 'blowIgnored'
  | 'overblow'
  | 'collapse'
  | 'stage0'
  | 'allOut'
  | 'emberNotice'
  | 'emberPhase'
  | 'sessionEnd';

export interface SimEvent {
  type: SimEventType;
  t: number;
  pieceId?: number;
  seg?: number;
  pos?: Vec3;
  power?: number;
  kind?: PieceKind;
}

export interface TimelineEntry {
  t: number;
  text: string;
}

export interface SimMetrics {
  /** 0..100 */
  heat: number;
  oxygen: number;
  smoke: number;
  /** 残り燃料の割合（配置済み全体） */
  fuelRatio: number;
  flamingSegs: number;
  emberSegs: number;
  /** 炎の総量（表示・音の強さ） */
  flamePower: number;
  emberPower: number;
  /** 炎の重心（ライト位置） */
  flameCenter: Vec3;
  /** くすぶり由来の煙（音と見た目） */
  smokeRaw: number;
  /** 状態ごとの薪の数 */
  counts: Record<BurnState, number>;
}

export type SimPhase = 'prepare' | 'burning' | 'out';

export interface SessionInfo {
  mode: 'short' | 'long';
  durationSeconds: number;
  /** 着火からの活動時間（停止・準備は含めない） */
  activeTime: number;
  emberNoticeSent: boolean;
  emberPhase: boolean;
  ended: boolean;
  /** 「今日はここまで」：消火を始めたゲーム時刻（15秒で火を落として終わる） */
  extinguishAt: number | null;
  /**
   * 自然な燃料切れ：薪が燃え尽き、熾も火を戻せないほど弱くなったら、その時点から熾火の時間へ入る。
   * endAt はそのときの終了時刻（活動時間）。通常は null（durationSeconds で終わる）。延長はしない。
   */
  endAt?: number | null;
  fuelSpent?: boolean;
  /** 燃料切れの状態が続いている秒数（確認用） */
  spentFor?: number;
}

const LIGHTER_TIP_OFFSET: Vec3 = [0.0, 0.0, 0.0];

export class FireSim {
  seed: number;
  rng: Rng;
  tick = 0;
  /** シミュレーション時刻（秒）。停止中・非表示中は進まない */
  time = 0;
  ignitedAt: number | null = null;
  phase: SimPhase = 'prepare';
  pieces: Piece[] = [];
  nextId = 1;
  ordinals: Record<PieceKind, number> = { tinder: 0, kindling: 0, medium: 0, large: 0 };
  wind: WindState;
  windFrom: WindFrom = 'front';
  lighter: { remaining: number; tip: Vec3 | null } = { remaining: 0, tip: null };
  /** 火吹き筒のひと吹き（t: 吹き始めからの秒。-1で無効） */
  tube: TubeState = { t: -1, x: 0, z: 0, level: 0, lastAt: -999 };
  metrics: SimMetrics;
  /** 台の底の熾（coal）と灰（ash）。bed.cells×bed.cells の格子 */
  bedCoal: number[];
  bedAsh: number[];
  events: SimEvent[] = [];
  timeline: TimelineEntry[] = [];
  session: SessionInfo;
  stage0Done = false;
  private stage0Timer = 0;
  private smokeSmoothed = 0;
  private heatSmoothed = 0;
  private layoutDirty = true;
  private tinderLitFor = 0;
  private overblowCooldown = 0;
  /** 案内用のフラグ（コントローラが読む） */
  hint = { kindlingCold: false, tinderSpentAlone: false, overblow: false };

  constructor(seed: number, mode: 'short' | 'long' = 'short') {
    this.seed = seed >>> 0;
    this.rng = new Rng(this.seed);
    this.wind = createWindState(this.rng);
    this.metrics = emptyMetrics();
    const nCells = B.bed.cells * B.bed.cells;
    this.bedCoal = new Array(nCells).fill(0);
    this.bedAsh = new Array(nCells).fill(0);
    this.session = {
      mode,
      durationSeconds: mode === 'short' ? B.session.shortSeconds : B.session.longSeconds,
      activeTime: 0,
      emberNoticeSent: false,
      emberPhase: false,
      ended: false,
      extinguishAt: null,
      endAt: null,
      fuelSpent: false,
      spentFor: 0,
    };
  }

  // ───────────────────────────── 配置

  countOf(kind: PieceKind, includeAsh = false): number {
    return this.pieces.filter((p) => p.kind === kind && (includeAsh || p.state !== 'ash')).length;
  }

  canAdd(kind: PieceKind): { ok: boolean; reason: string | null } {
    const spec = B.pieces[kind];
    if (this.session.emberPhase) return { ok: false, reason: 'いまは火を見守る時間です。' };
    if (this.session.extinguishAt !== null || this.session.ended) return { ok: false, reason: '今夜の火は、おやすみの時間です。' };
    if (kind === 'large' && B.logs.largeNeedsStage0 && !this.stage0Done) {
      return { ok: false, reason: '太薪は、中薪まで火が育ってから。' };
    }
    if (this.countOf(kind) >= spec.maxCount) {
      return { ok: false, reason: `${spec.label}はここまで（${spec.maxCount}${kind === 'tinder' ? '束' : '本'}）。` };
    }
    if (isLog(kind) && this.countOf('medium') + this.countOf('large') >= B.logs.maxTotal) {
      return { ok: false, reason: `中薪と太薪は、あわせて${B.logs.maxTotal}本まで。` };
    }
    return { ok: true, reason: null };
  }

  addPiece(kind: PieceKind, placement: PlacementResult, dims: { length: number; radius: number }, shapeSeed: number, species?: WoodId): Piece {
    // 新しい薪を置いた：火が戻るかもしれないので、燃料切れの確認はやり直す
    this.session.spentFor = 0;
    this.ordinals[kind] += 1;
    const piece = createPiece(this.nextId++, kind, this.ordinals[kind], placement.pose, dims, shapeSeed, species);
    piece.supports = placement.supports;
    this.pieces.push(piece);
    this.updateCompression();
    this.layoutDirty = true;
    const onFire = this.isNearFlame(piece);
    this.emit({ type: onFire ? 'placedOnFire' : 'placed', pieceId: piece.id, pos: [piece.pose.x, piece.pose.y, piece.pose.z], kind });
    if (this.phase === 'out' && kind === 'tinder') this.phase = 'prepare';
    return piece;
  }

  /** 火ばさみで持ち上げる（燃焼は続く。支えからは外れる） */
  holdPiece(id: number): Piece | null {
    const p = this.pieces.find((q) => q.id === id);
    if (!p) return null;
    p.held = true;
    this.layoutDirty = true;
    return p;
  }

  /** 持ち上げ中の位置を更新（炎も追従） */
  setHeldPose(id: number, pose: Piece['pose']): void {
    const p = this.pieces.find((q) => q.id === id);
    if (!p) return;
    p.pose = { ...pose };
    p.segPos = computeSegPositions(p);
    this.layoutDirty = true;
  }

  dropPiece(id: number, placement: PlacementResult): void {
    const p = this.pieces.find((q) => q.id === id);
    if (!p) return;
    this.session.spentFor = 0;
    p.held = false;
    p.pose = { ...placement.pose, roll: p.pose.roll };
    p.supports = placement.supports;
    p.segPos = computeSegPositions(p);
    this.updateCompression();
    this.layoutDirty = true;
    this.emit({ type: this.isNearFlame(p) ? 'placedOnFire' : 'moved', pieceId: id, pos: [p.pose.x, p.pose.y, p.pose.z], kind: p.kind });
  }

  removePiece(id: number): void {
    const p = this.pieces.find((q) => q.id === id);
    if (!p) return;
    this.pieces = this.pieces.filter((q) => q.id !== id);
    this.updateCompression();
    this.layoutDirty = true;
    this.emit({ type: 'removed', pieceId: id, kind: p.kind });
  }

  /** 置き直しの結果を反映（上に乗っていた薪が落ち着く） */
  applyResettle(results: Map<number, PlacementResult>): void {
    for (const p of this.pieces) {
      const r = results.get(p.id);
      if (!r) continue;
      p.pose = { ...r.pose, roll: p.pose.roll };
      p.supports = r.supports;
      p.segPos = computeSegPositions(p);
    }
    this.updateCompression();
    this.layoutDirty = true;
  }

  markLayoutDirty(): void {
    this.layoutDirty = true;
  }

  private updateCompression(): void {
    for (const p of this.pieces) {
      if (p.kind !== 'tinder') continue;
      p.compressed = this.pieces.some(
        (q) => isLog(q.kind) && !q.held && q.supports.some((s) => s.by === p.id),
      );
    }
  }

  private isNearFlame(piece: Piece): boolean {
    for (const q of this.pieces) {
      if (q.id === piece.id || q.state !== 'flaming') continue;
      for (const a of q.segPos) {
        for (const b of piece.segPos) {
          if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.12) return true;
        }
      }
    }
    return false;
  }

  // ───────────────────────────── 着火と送風

  canIgnite(): { ok: boolean; reason: string | null } {
    const tinder = this.pieces.find((p) => p.kind === 'tinder' && p.state !== 'ash');
    if (!tinder) {
      const onlyLogs = this.pieces.some((p) => isLog(p.kind));
      return {
        ok: false,
        reason: onlyLogs ? '太い薪だけでは火はつきません。まず火口を置こう。' : '火口を置くと、火を灯せます。',
      };
    }
    if (tinder.state === 'flaming') return { ok: false, reason: '火口はもう燃えています。' };
    if (this.lighter.remaining > 0) return { ok: false, reason: null };
    return { ok: true, reason: null };
  }

  /** ライターを火口へ当てる。先端の位置は火口の手前側の縁 */
  startLighter(): boolean {
    const chk = this.canIgnite();
    if (!chk.ok) return false;
    const tinder = this.pieces.find((p) => p.kind === 'tinder' && p.state !== 'ash')!;
    this.lighter.remaining = B.heat.lighterSeconds;
    this.lighter.tip = [
      tinder.pose.x + LIGHTER_TIP_OFFSET[0],
      B.tray.floorY + 0.014,
      tinder.pose.z + tinder.radius * 0.55,
    ];
    this.emit({ type: 'lighterOn', pieceId: tinder.id, pos: this.lighter.tip });
    return true;
  }

  gust(level: number, from: WindFrom): boolean {
    this.windFrom = from;
    const ok = requestGust(this.wind, this.time, level, from);
    if (ok) this.session.spentFor = 0;
    this.emit({ type: ok ? 'gust' : 'gustIgnored', power: level });
    return ok;
  }

  /** 火吹き筒：狙った一点（台の上のx,z）へ、ひと吹き。息継ぎの間は受け付けない */
  blow(x: number, z: number, level: number): boolean {
    const T = B.tube;
    const ok = this.time - this.tube.lastAt >= T.minInterval && !this.session.ended;
    const lv = Math.max(0, Math.min(T.levels.length - 1, Math.round(level)));
    const h = B.tray.innerHalf;
    if (ok) {
      this.tube = { t: 0, x: clamp(x, -h, h), z: clamp(z, -h, h), level: lv, lastAt: this.time };
      this.session.spentFor = 0;
    }
    this.emit({ type: ok ? 'blow' : 'blowIgnored', power: lv, pos: [this.tube.x, B.tray.floorY + T.aimHeight, this.tube.z] });
    return ok;
  }

  /** ひと吹きの強さ（0..1） */
  tubeEnvelope(): number {
    const T = B.tube;
    const t = this.tube.t;
    if (t < 0) return 0;
    if (t < T.attack) return t / T.attack;
    if (t < T.attack + T.hold) return 1;
    const r = t - T.attack - T.hold;
    return r < T.release ? 1 - r / T.release : 0;
  }

  /** 火吹き筒の風がその位置に届く強さ（うちわの風と同じ単位） */
  tubeWindAt(pos: Vec3, env = this.tubeEnvelope()): number {
    if (env <= 0) return 0;
    const T = B.tube;
    const dx = pos[0] - this.tube.x;
    const dz = pos[2] - this.tube.z;
    const up = Math.max(0, pos[1] - (B.tray.floorY + T.aimHeight));
    return T.levels[this.tube.level] * env * Math.exp(-(dx * dx + dz * dz) / (2 * T.sigma * T.sigma)) * Math.exp(-up / T.reachUp);
  }

  // ───────────────────────────── 更新

  step(): void {
    const dt = B.sim.dt;
    this.tick += 1;
    this.time += dt;
    stepWind(this.wind, dt, this.rng);
    const ws = windSnapshot(this.wind);
    const windS = ws.physStrength;
    // 火吹き筒：狙った一点だけの風（炎の傾き＝燃え移りの向きには入れない）
    if (this.tube.t >= 0) {
      this.tube.t += dt;
      if (this.tube.t > B.tube.attack + B.tube.hold + B.tube.release) this.tube.t = -1;
    }
    const tubeEnv = this.tubeEnvelope();
    const tubeAt = (pos: Vec3) => this.tubeWindAt(pos, tubeEnv);
    if (this.layoutDirty) this.recomputeGeometry();

    // ── 熱源を集める
    type Src = { pos: Vec3; top: Vec3; power: number; piece: number; flame: boolean; r: number; reach: number; kind: PieceKind };
    const srcs: Src[] = [];
    // ゆっくり20分：主な薪（中薪）と熾の燃え方を時間の長さに合わせて遅くする（同じ本数で最後まで。火口・細薪の着火は同じ）
    const slow = B.session.shortSeconds / this.session.durationSeconds;
    for (const p of this.pieces) {
      const spec = B.pieces[p.kind];
      const heat = WOODS[p.species].heat;
      for (let i = 0; i < p.segs.length; i++) {
        const s = p.segs[i];
        const pos = p.segPos[i];
        const rTop = p.kind === 'tinder' ? B.pieces.tinder.height * 0.5 : p.radius * 0.85;
        const wS = windS + tubeAt(pos);
        if (s.I > 0.001) {
          const roar = isLog(p.kind) ? 1 + B.wind.heatBoostThick * wS * smoothstep(B.burn.flameAirLo, B.burn.flameAirHi, s.air) : 1;
          const power = s.I * spec.power * heat * roar;
          const reach = B.heat.plumeDecayHeight * (0.4 + 0.6 * s.I) * B.heat.plumeScaleByKind[p.kind];
          if (p.kind === 'tinder') {
            // 火口は平たい束。束全体から炎が上がるので熱源を広げる
            const n = 5;
            for (let k = 0; k < n; k++) {
              const a = (k / (n - 1)) * Math.PI * 2;
              const rr = k === 0 ? 0 : p.radius * 0.55;
              const q: Vec3 = [pos[0] + Math.cos(a) * rr, pos[1], pos[2] + Math.sin(a) * rr];
              srcs.push({ pos: q, top: [q[0], q[1] + rTop, q[2]], power: power / n, piece: p.id, flame: true, r: p.radius * 0.3, reach, kind: p.kind });
            }
          } else {
            srcs.push({ pos, top: [pos[0], pos[1] + rTop, pos[2]], power, piece: p.id, flame: true, r: p.radius, reach, kind: p.kind });
          }
        }
        if (s.g > 0.01) {
          // 風を送ると中薪の熾が明るくなり、近くの薪をよく温める（熾から火を起こし直せる）。細い薪の小さな熾は強めない
          srcs.push({ pos, top: pos, power: s.g * B.heat.emberPower * heat * (isLog(p.kind) ? 1 + B.bed.windGlow * wS : 1), piece: p.id, flame: false, r: p.radius, reach: B.heat.plumeDecayHeight * 0.3, kind: p.kind });
        }
      }
    }

    // 台の底の熾
    const nb = B.bed.cells;
    const cell = (B.tray.innerHalf * 2) / nb;
    for (let ci = 0; ci < nb * nb; ci++) {
      const c = this.bedCoal[ci];
      if (c < 0.01) continue;
      const cx = -B.tray.innerHalf + ((ci % nb) + 0.5) * cell;
      const cz = -B.tray.innerHalf + (Math.floor(ci / nb) + 0.5) * cell;
      const pos: Vec3 = [cx, B.tray.floorY + 0.004, cz];
      const glow = 1 + B.bed.windGlow * (windS + tubeAt(pos));
      srcs.push({ pos, top: pos, power: c * B.bed.power * glow * B.bed.contact, piece: -1, flame: false, r: cell * 0.45, reach: B.bed.reach, kind: 'medium' });
    }

    const lighterOn = this.lighter.remaining > 0 && this.lighter.tip;
    // 「今日はここまで」の消火：炎を細らせ、熾も落としていく
    const ex = this.session.extinguishAt !== null ? clamp((this.time - this.session.extinguishAt) / B.farewell.manualSeconds, 0, 1) : 0;
    const exFlame = 1 - smoothstep(0.05, 0.75, ex);
    const exEmber = 1 - smoothstep(0.3, 1, ex);

    // ── 各区間へ
    let flamePower = 0;
    let emberPower = 0;
    let smokeSum = 0;
    let airWeighted = 0;
    let airWeight = 0;
    let airLayoutSum = 0;
    let airLayoutN = 0;
    let fx = 0;
    let fy = 0;
    let fz = 0;
    let fw = 0;
    let fuel = 0;
    let fuel0 = 0;
    let flamingSegs = 0;
    let emberSegs = 0;
    let kindlingWarm = false;

    const tilt = B.heat.windPlumeTilt;
    const K = B.heat;

    for (const p of this.pieces) {
      const spec = B.pieces[p.kind];
      const wood = WOODS[p.species];
      const thin = !isLog(p.kind);
      let hdx = 0;
      let hdy = 0;
      let hdz = 0;
      const prevState = p.state;

      for (let i = 0; i < p.segs.length; i++) {
        const s = p.segs[i];
        const pr = p.segPos[i];
        // その区間が受ける風：うちわ（台全体）＋火吹き筒（狙った一点）
        const tw = tubeAt(pr);
        const wS = windS + tw;
        const cool = spec.cool * (1 + (thin ? B.wind.coolBoostThin : B.wind.coolBoostThick) * Math.max(0, wS - B.wind.coolFrom));

        // ── 局所の空気
        let comp = 0;
        for (const src of srcs) {
          if (!src.flame || src.piece === p.id) continue;
          const d = Math.hypot(src.pos[0] - pr[0], src.pos[1] - pr[1], src.pos[2] - pr[2]);
          if (d < B.air.competitionReach) comp += src.power * (1 - d / B.air.competitionReach);
        }
        const competition = B.air.competitionMax * (1 - Math.exp(-comp / B.air.competitionScale));
        const exposure = clamp(1 - p.crowd[i] * 0.45, 0.25, 1);
        let air =
          B.air.base -
          B.air.crowdWeight[p.kind] * p.crowd[i] -
          p.floorPen[i] +
          (p.lifted[i] ? B.air.liftedBonus : 0) -
          (p.compressed ? B.air.tinderCompressedPenalty : 0) -
          competition +
          B.air.windAir * (windS * exposure + tw * B.tube.airGain);
        air = clamp(air, 0, B.air.max);
        s.air = air;
        airLayoutSum += air;
        airLayoutN++;

        // ── 受ける熱
        let Q = 0;
        for (const src of srcs) {
          if (src.piece === p.id) continue;
          const dx = pr[0] - src.pos[0];
          const dy0 = pr[1] - src.pos[1];
          const dz = pr[2] - src.pos[2];
          const dist = Math.sqrt(dx * dx + dy0 * dy0 + dz * dz);
          const gap = Math.max(0, dist - p.radius - src.r);
          const gs = gap / K.radiativeGapScale;
          let k = K.radiative / (1 + gs * gs);
          const dy = pr[1] - src.top[1];
          if (dy > -K.belowReach) {
            const up = Math.max(0, dy);
            const lean = src.flame ? up + K.windPlumeLean : up;
            const hx = dx - ws.phys[0] * tilt * lean;
            const hz = dz - ws.phys[1] * tilt * lean;
            const w = K.plumeBaseWidthByKind[src.kind] + K.plumeSpread * up + p.radius * 0.5;
            const h2 = hx * hx + hz * hz;
            const conv = K.convective * Math.exp(-h2 / (2 * w * w)) * Math.exp(-up / src.reach);
            k += src.flame ? conv : conv * 0.35;
          }
          const q = src.power * k * K.coupling[src.kind][p.kind];
          Q += q;
          hdx += (src.pos[0] - pr[0]) * q;
          hdy += (src.pos[1] - pr[1]) * q;
          hdz += (src.pos[2] - pr[2]) * q;
        }
        // 同じ薪の隣の区間から這う火
        for (const j of [i - 1, i + 1]) {
          if (j < 0 || j >= p.segs.length) continue;
          const nb = p.segs[j];
          Q += K.creep * wood.heat * (nb.I + nb.g * 0.45);
        }
        // 自分の炎・熾火による保温
        Q += spec.selfHeat * s.I * spec.power * wood.heat;
        Q += B.burn.emberSelfHeat * s.g * K.emberPower * wood.heat;
        // ライター
        if (lighterOn) {
          const t = this.lighter.tip!;
          const d = Math.hypot(t[0] - pr[0], t[1] - pr[1], t[2] - pr[2]);
          const reach = K.lighterReach + (p.kind === 'tinder' ? p.radius : p.radius);
          if (d < reach) Q += K.lighterPower * K.lighterCouplingByKind[p.kind];
        }

        // ── 温まりと乾燥
        let gain = spec.gain;
        if (s.m > 0.001 && Q > 0) {
          gain *= 1 - Math.min(0.85, s.m * K.moistureGainLoss);
          s.m = Math.max(0, s.m - K.dryRate * Q * spec.gain * dt);
        }
        s.T = clamp(s.T + (gain * Q - cool * s.T) * dt, 0, B.burn.maxT);

        const airF = smoothstep(B.burn.flameAirLo, B.burn.flameAirHi, air);
        const fuelF = smoothstep(0, B.burn.flameFuelKnee, s.f / s.f0);
        const hasFuel = s.f > s.f0 * B.burn.ashFuelRatio;

        // ── 着火
        if (s.I <= 0.001 && hasFuel && s.T >= B.burn.igniteT && air >= B.burn.igniteAirMin) {
          s.I = 0.12;
          if (!s.lit) {
            s.lit = true;
          }
        }

        // ── 炎
        if (s.I > 0.001) {
          let target = smoothstep(B.burn.flameTempLo, B.burn.flameTempHi, s.T) * airF * fuelF;
          if (!hasFuel) target = 0;
          target *= exFlame;
          if (wS > B.wind.overBlowThreshold && thin && s.I < B.wind.overBlowFlameMax) {
            const blow = (wS - B.wind.overBlowThreshold) * B.wind.overBlowRate;
            target *= Math.max(0, 1 - blow);
            if (this.overblowCooldown <= 0 && blow > 0.3) {
              this.overblowCooldown = 6;
              this.hint.overblow = true;
              this.emit({ type: 'overblow', pieceId: p.id });
            }
          }
          const rate = target > s.I ? B.burn.flameGrow : B.burn.flameDecay;
          s.I = clamp(s.I + (target - s.I) * rate * dt, 0, 1);
          if (s.I < 0.02 && target < 0.03) s.I = 0;
          const burn = s.I * spec.burn * wood.burnRate * (1 + B.wind.burnBoost * wS * airF) * (isLog(p.kind) ? slow : 1);
          const before = s.f;
          s.f = Math.max(0, s.f - burn * dt);
          this.depositCoal(pr, (before - s.f) * B.bed.coalFromFuel[p.kind]);
          // 燃えるときの爆ぜ（火の粉と音）
          if (p.kind !== 'tinder' && s.I > 0.25) {
            const lam = (isLog(p.kind) ? 0.028 : 0.018) * s.I * wood.crackle * (1 + wS);
            if (this.rng.next() < lam * dt) {
              this.emit({ type: 'pop', pieceId: p.id, seg: i, pos: [pr[0], pr[1] + p.radius, pr[2]], power: s.I });
            }
          }
        }

        // ── 焦げ・赤熱・灰
        if (s.T > B.burn.charStartT) s.c = clamp(s.c + B.burn.charRate * (s.T - B.burn.charStartT) * (1 - s.c) * dt * (p.kind === 'tinder' ? 4 : 1), 0, 1);
        if (spec.emberable && s.c > B.burn.emberCharMin && hasFuel) {
          const gt = smoothstep(B.burn.emberTempLo, B.burn.emberTempHi, s.T) * smoothstep(0.05, 0.35, air) * smoothstep(B.burn.emberCharMin, 0.9, s.c) * (1 - 0.35 * s.I) * exEmber;
          s.g = clamp(s.g + (gt - s.g) * (gt > s.g ? B.burn.emberGrow : B.burn.emberDecay) * dt, 0, 1);
          const before = s.f;
          s.f = Math.max(0, s.f - s.g * B.burn.emberBurn * wood.burnRate * (1 + wS) * (isLog(p.kind) ? slow : 1) * dt);
          this.depositCoal(pr, (before - s.f) * B.bed.coalFromFuel[p.kind]);
        } else {
          s.g = Math.max(0, s.g - B.burn.emberDecay * 2 * dt);
        }
        const burnt = 1 - s.f / s.f0;
        // 灰は燃え進んだ所から少しずつ（半分燃えても大半は黒い炭）
        s.ash = clamp((burnt - 0.3) * 1.45, 0, 1) * smoothstep(0.3, 0.8, s.c);
        if (!hasFuel) {
          s.I = 0;
          s.ash = 1;
        }

        // ── 煙
        const warmingSmoke = s.I < 0.01 && s.T > 0.3 && s.T < B.burn.igniteT * 1.05 && hasFuel ? B.smoke.warming * smoothstep(0.3, 0.95, s.T) * (B.smoke.warmingDry + s.m * 2.5) : 0;
        const smolder = B.smoke.smolder * s.g * (1 - smoothstep(B.smoke.smolderAirLo, B.smoke.smolderAirHi, air)) * 0.6;
        const moist = B.smoke.moistFlame * Math.max(0, s.m - B.smoke.moistDry) * 1.6 * s.I;
        const poor = B.smoke.poorAirFlame * s.I * (1 - smoothstep(B.smoke.poorAirLo, B.smoke.poorAirHi, air));
        s.smoke = warmingSmoke + smolder + moist + poor + (s.I > 0 ? B.smoke.base : 0);
        if (p.kind === 'tinder') s.smoke *= 0.6;
        smokeSum += s.smoke;

        // ── 集計
        const roar = isLog(p.kind) ? 1 + B.wind.heatBoostThick * wS * airF : 1;
        const fp = s.I * spec.power * wood.heat * roar;
        const ep = s.g * K.emberPower * wood.heat;
        flamePower += fp;
        emberPower += ep;
        if (fp > 0) {
          fx += pr[0] * fp;
          fy += pr[1] * fp;
          fz += pr[2] * fp;
          fw += fp;
        }
        if (s.I > 0.05) flamingSegs++;
        if (s.g > 0.12) emberSegs++;
        if (s.I > 0.01 || s.g > 0.05 || s.T > 0.3) {
          const w = s.I + s.g + 0.2;
          airWeighted += air * w;
          airWeight += w;
        }
        if (p.kind === 'kindling' && s.T > B.hints.kindlingWarmT) kindlingWarm = true;
        fuel += s.f;
        fuel0 += s.f0;
      }

      // 熱の来た方向（ローカル）
      const hl = Math.hypot(hdx, hdy, hdz);
      if (hl > 1e-6) {
        const local = worldToLocal(p, [hdx / hl, hdy / hl, hdz / hl]);
        const k = 0.08;
        p.heatDir = normalize([
          p.heatDir[0] + (local[0] - p.heatDir[0]) * k,
          p.heatDir[1] + (local[1] - p.heatDir[1]) * k,
          p.heatDir[2] + (local[2] - p.heatDir[2]) * k,
        ]);
      }

      // 状態の変化
      const next = derivePieceState(p);
      if (next !== prevState) this.onStateChange(p, prevState, next);
      p.state = next;
    }

    // 台の底の熾：燃え尽きながら灰になる。風で少し明るく、早く燃える
    let bedPower = 0;
    let bx = 0;
    let bz = 0;
    for (let ci = 0; ci < nb * nb; ci++) {
      const c = this.bedCoal[ci];
      if (c <= 0) continue;
      const cpos: Vec3 = [-B.tray.innerHalf + ((ci % nb) + 0.5) * cell, B.tray.floorY + 0.004, -B.tray.innerHalf + (Math.floor(ci / nb) + 0.5) * cell];
      const d = c * B.bed.coalDecay * slow * (1 + (windS + tubeAt(cpos)) * 0.8 + ex * 8) * dt;
      this.bedCoal[ci] = Math.max(0, c - d);
      this.bedAsh[ci] = Math.min(1.5, this.bedAsh[ci] + d * B.bed.ashFromCoal);
      const pw = this.bedCoal[ci] * B.bed.power;
      bedPower += pw;
      bx += (-B.tray.innerHalf + ((ci % nb) + 0.5) * cell) * pw;
      bz += (-B.tray.innerHalf + (Math.floor(ci / nb) + 0.5) * cell) * pw;
    }
    emberPower += bedPower;
    if (fw <= 0 && bedPower > 0) {
      fx = bx;
      fz = bz;
      fy = B.tray.floorY * bedPower;
      fw = bedPower;
    }

    // 支えが灰になったら、上の薪が崩れて落ち着く
    if (this.pieces.some((p) => p.state === 'ash' && p.kind !== 'tinder' && !p.held)) {
      this.collapseAsh();
    }

    // 火口が燃え尽きたときの煙のひと吹き
    if (this.lighter.remaining > 0) {
      this.lighter.remaining -= dt;
      if (this.lighter.remaining <= 0) {
        this.lighter.remaining = 0;
        this.lighter.tip = null;
        this.emit({ type: 'lighterOff' });
      }
    }
    if (this.overblowCooldown > 0) this.overblowCooldown -= dt;

    // ── 表示用の集計
    const totalPower = flamePower + emberPower;
    const heatNow = 100 * (1 - Math.exp(-totalPower / B.display.heatScale));
    this.heatSmoothed += (heatNow - this.heatSmoothed) * (1 - Math.exp(-dt / B.display.heatSmoothTau));
    const heat = this.heatSmoothed;
    const meanAir = airWeight > 0 ? airWeighted / airWeight : airLayoutN > 0 ? airLayoutSum / airLayoutN : 1;
    const oxygen = clamp(meanAir * B.display.oxygenFromAir + windS * B.display.oxygenWindBonus + (tubeEnv > 0 && fw > 0 ? tubeEnv * B.tube.oxygenBonus : 0), 0, 100);
    const smokeTarget = 100 * (1 - Math.exp(-smokeSum / B.smoke.displayScale));
    this.smokeSmoothed += (smokeTarget - this.smokeSmoothed) * (1 - Math.exp(-dt / B.smoke.smoothTau));
    const counts: Record<BurnState, number> = { raw: 0, warming: 0, flaming: 0, ember: 0, ash: 0 };
    for (const p of this.pieces) counts[p.state]++;
    this.metrics = {
      heat,
      oxygen,
      smoke: this.smokeSmoothed,
      fuelRatio: fuel0 > 0 ? fuel / fuel0 : 0,
      flamingSegs,
      emberSegs,
      flamePower,
      emberPower,
      flameCenter: fw > 0 ? [fx / fw, fy / fw, fz / fw] : [0, B.tray.floorY + 0.05, 0],
      smokeRaw: smokeSum,
      counts,
    };

    // ── 火の段階
    const anyHeat = flamingSegs > 0 || emberSegs > 0 || this.lighter.remaining > 0 || bedPower > 0.08;
    // 炎も赤い薪もなく、底の熾も（風を送っても）火を戻せないほど弱い状態が続いているか。
    // 温まっている途中の薪（燃料が残り、着火へ向かう温度）があるあいだは数えない
    const warming = this.pieces.some((p) => !p.held && p.state !== 'ash' && p.segs.some((sg) => sg.T >= B.session.spentWarmT && sg.f > sg.f0 * B.burn.ashFuelRatio));
    const dead = flamingSegs === 0 && emberSegs === 0 && this.lighter.remaining <= 0 && emberPower < B.session.spentEmberPower && !warming;
    this.session.spentFor = this.phase === 'burning' && dead ? (this.session.spentFor ?? 0) + dt : 0;
    const deadLong = this.session.spentFor >= B.session.spentConfirmSeconds;
    if (this.phase === 'burning') {
      this.session.activeTime += dt;
      // 中薪まで火がつながる前に消えた（熾も弱い）：消えたことにして、火口からやり直せるようにする
      if (!anyHeat || (deadLong && !this.stage0Done && !this.session.emberPhase && this.session.extinguishAt === null)) {
        this.phase = 'out';
        this.addTimeline('火が消えました');
        this.emit({ type: 'allOut' });
      }
    }

    // 案内：火口が燃えているのに細薪が温まらない
    const tinder = this.pieces.find((p) => p.kind === 'tinder');
    if (tinder && tinder.state === 'flaming') {
      this.tinderLitFor += dt;
      this.hint.kindlingCold = this.tinderLitFor > B.hints.kindlingColdAfter && !kindlingWarm;
    } else {
      this.tinderLitFor = 0;
      this.hint.kindlingCold = false;
    }

    // 第0段階の目標：中薪が安定して燃える
    if (!this.stage0Done) {
      const mediumBurning = this.pieces.some((p) => p.kind === 'medium' && p.segs.filter((s) => s.I > 0.3).length >= 2);
      this.stage0Timer = mediumBurning ? this.stage0Timer + dt : Math.max(0, this.stage0Timer - dt * 2);
      if (this.stage0Timer >= B.session.stage0StableSeconds) {
        this.stage0Done = true;
        this.addTimeline('中薪まで火がつながりました');
        this.emit({ type: 'stage0' });
      }
    }

    // 成長・性格・分岐は companion.ts（同じ刻みで、この後に進める）

    // セッション（ひと息10分）の熾火と終わり
    if (this.phase !== 'prepare' && this.ignitedAt !== null && !this.session.ended) {
      const dur = this.session.durationSeconds;
      const emberAt = dur * B.session.emberStartRatio;
      const at = this.session.activeTime;
      // 自然な燃料切れ：育った火の炎も赤い薪もなくなり、底の熾も火を戻せないほど弱いまま続いたら、
      // その時点から熾火の時間へ（責めない・延長しない）
      if (!this.session.emberPhase && this.stage0Done && this.session.extinguishAt === null && this.phase === 'burning' && deadLong) {
        this.session.fuelSpent = true;
        this.session.emberNoticeSent = true;
        this.session.emberPhase = true;
        this.session.endAt = Math.min(dur, at + dur * (1 - B.session.emberStartRatio));
        this.addTimeline('火が小さくなり、熾火の時間になりました');
        this.emit({ type: 'emberPhase' });
      }
      if (!this.session.emberNoticeSent && at >= emberAt - B.session.emberNoticeLeadSeconds) {
        this.session.emberNoticeSent = true;
        this.emit({ type: 'emberNotice' });
      }
      if (!this.session.emberPhase && at >= emberAt) {
        this.session.emberPhase = true;
        this.addTimeline('火を見守る時間になりました');
        this.emit({ type: 'emberPhase' });
      }
      if (at >= this.endTime) {
        this.session.ended = true;
        this.emit({ type: 'sessionEnd' });
      }
    }
    if (ex >= 1 && !this.session.ended) {
      this.session.ended = true;
      this.emit({ type: 'sessionEnd' });
    }
  }

  /** この回が終わる活動時間（ふつうはモードの長さ。燃料切れで熾火へ入ったときはその90秒（20分なら180秒）後） */
  get endTime(): number {
    return this.session.endAt ?? this.session.durationSeconds;
  }

  /** 着火前だけ：ひと息10分／ゆっくり20分 */
  setMode(mode: 'short' | 'long'): void {
    if (this.ignitedAt !== null) return;
    this.session.mode = mode;
    this.session.durationSeconds = mode === 'short' ? B.session.shortSeconds : B.session.longSeconds;
  }

  /** 「今日はここまで」：15秒かけて火を落とす */
  beginExtinguish(): void {
    if (this.session.extinguishAt === null && !this.session.ended) this.session.extinguishAt = this.time;
  }

  private onStateChange(p: Piece, prev: BurnState, next: BurnState): void {
    const label = pieceLabel(p);
    const pos: Vec3 = [p.pose.x, p.pose.y, p.pose.z];
    if (next === 'flaming' && prev !== 'flaming') {
      if (p.firstLitAt === null) {
        p.firstLitAt = this.time;
        if (p.kind === 'tinder' && this.ignitedAt === null) {
          this.ignitedAt = this.time;
          this.phase = 'burning';
          this.addTimeline('火口に火がつきました');
          this.emit({ type: 'ignite', pieceId: p.id, pos, kind: p.kind });
          return;
        }
        if (p.kind === 'tinder') {
          this.phase = 'burning';
          this.addTimeline('新しい火口に火がつきました');
          this.emit({ type: 'ignite', pieceId: p.id, pos, kind: p.kind });
          return;
        }
        this.addTimeline(`${label}へ燃え移りました`);
        this.emit({ type: 'spread', pieceId: p.id, pos, kind: p.kind });
      } else {
        this.addTimeline(`${label}の火が戻りました`);
        this.emit({ type: 'spread', pieceId: p.id, pos, kind: p.kind });
      }
      if (this.phase !== 'burning') this.phase = 'burning';
    } else if (prev === 'flaming' && next !== 'flaming') {
      if (p.kind === 'tinder') {
        this.addTimeline('火口が燃え尽きました');
        this.emit({ type: 'tinderSpent', pieceId: p.id, pos, kind: p.kind });
        const others = this.pieces.some((q) => q.id !== p.id && (q.state === 'flaming' || q.state === 'ember'));
        this.hint.tinderSpentAlone = !others;
      } else {
        this.addTimeline(next === 'ember' ? `${label}が熾火になりました` : `${label}の炎が消えました`);
        this.emit({ type: next === 'ember' ? 'emberOnly' : 'flameout', pieceId: p.id, pos, kind: p.kind });
      }
    } else if (next === 'ash' && prev !== 'ash' && p.kind !== 'tinder') {
      this.addTimeline(`${label}が灰になりました`);
      this.emit({ type: 'ashed', pieceId: p.id, pos, kind: p.kind });
    }
  }

  private depositCoal(pos: Vec3, fuelBurnt: number): void {
    if (fuelBurnt <= 0) return;
    const nb = B.bed.cells;
    const cell = (B.tray.innerHalf * 2) / nb;
    const ix = Math.min(nb - 1, Math.max(0, Math.floor((pos[0] + B.tray.innerHalf) / cell)));
    const iz = Math.min(nb - 1, Math.max(0, Math.floor((pos[2] + B.tray.innerHalf) / cell)));
    const ci = iz * nb + ix;
    this.bedCoal[ci] = Math.min(B.bed.coalMax, this.bedCoal[ci] + fuelBurnt);
  }

  /** 灰になった薪を取り除き、上に乗っていた薪を落ち着かせる（崩れ） */
  private collapseAsh(): void {
    const gone = this.pieces.filter((p) => p.state === 'ash' && p.kind !== 'tinder' && !p.held);
    if (!gone.length) return;
    const goneIds = new Set(gone.map((p) => p.id));
    const rest = this.pieces.filter((p) => !goneIds.has(p.id));
    const before = new Map(rest.map((p) => [p.id, p.pose.y]));
    const results = resettle(rest.filter((p) => p.state !== 'ash'));
    this.pieces = rest;
    this.applyResettle(results);
    for (const p of rest) {
      const y0 = before.get(p.id) ?? p.pose.y;
      if (y0 - p.pose.y > 0.008) {
        this.addTimeline(`${pieceLabel(p)}が崩れて落ち着きました`);
        this.emit({ type: 'collapse', pieceId: p.id, pos: [p.pose.x, p.pose.y, p.pose.z], kind: p.kind, power: y0 - p.pose.y });
      }
    }
    for (const g of gone) this.emit({ type: 'removed', pieceId: g.id, kind: g.kind });
  }

  private recomputeGeometry(): void {
    this.layoutDirty = false;
    const all = this.pieces;
    for (const p of all) p.segPos = computeSegPositions(p);
    const floor = B.tray.floorY;
    for (const p of all) {
      for (let i = 0; i < p.segs.length; i++) {
        const pr = p.segPos[i];
        // 混雑：周りの薪との表面のすき間
        // 周りの薪ごとに一番近い区間だけを数える（長い薪が区間数ぶん重く数えられないように）
        let crowd = 0;
        if (!p.held) {
          for (const q of all) {
            if (q.id === p.id || q.held) continue;
            let best = 0;
            for (let j = 0; j < q.segs.length; j++) {
              const qs = q.segPos[j];
              const d = Math.hypot(qs[0] - pr[0], qs[1] - pr[1], qs[2] - pr[2]);
              const segLen = q.kind === 'tinder' ? q.radius : q.length / q.segs.length;
              // 火口は平たい束なので、上下方向には薄い
              const vy = d > 1e-6 ? Math.abs(qs[1] - pr[1]) / d : 0;
              const rq = q.kind === 'tinder' ? q.radius + (B.pieces.tinder.height * 0.5 - q.radius) * vy : q.radius;
              const rp = p.kind === 'tinder' ? p.radius + (B.pieces.tinder.height * 0.5 - p.radius) * vy : p.radius;
              const gap = d - rp - rq - (q.kind === 'tinder' ? 0 : segLen * 0.25);
              if (gap < B.air.crowdReach) {
                const w = 1 - Math.max(0, gap) / B.air.crowdReach;
                if (w > best) best = w;
              }
            }
            crowd += best * best * Math.sqrt(q.radius / B.pieces.medium.radius) * (q.kind === 'tinder' ? 0.3 : 1);
          }
        }
        p.crowd[i] = crowd;
        const bottom = p.kind === 'tinder' ? floor : pr[1] - p.radius;
        const onFloor = !p.held && bottom - floor < B.air.floorContactTolerance;
        p.floorPen[i] = onFloor ? B.air.floorContactPenalty[p.kind] : 0;
        p.lifted[i] = p.held || bottom - floor > B.air.liftedHeight;
      }
    }
  }

  private emit(e: Omit<SimEvent, 't'>): void {
    this.events.push({ ...e, t: this.time });
  }

  addTimeline(text: string): void {
    const t = this.ignitedAt === null ? 0 : this.time - this.ignitedAt;
    this.timeline.push({ t, text });
    if (this.timeline.length > 200) this.timeline.shift();
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** 空気の見込み（置く前の案内用）：指定の薪の区間の平均空気 */
  previewAir(pieceId: number): number {
    this.recomputeGeometry();
    const p = this.pieces.find((q) => q.id === pieceId);
    if (!p) return 1;
    let sum = 0;
    for (let i = 0; i < p.segs.length; i++) {
      sum += clamp(
        B.air.base - B.air.crowdWeight[p.kind] * p.crowd[i] - p.floorPen[i] + (p.lifted[i] ? B.air.liftedBonus : 0) - (p.compressed ? B.air.tinderCompressedPenalty : 0),
        0,
        B.air.max,
      );
    }
    return sum / p.segs.length;
  }

  // ───────────────────────────── 保存

  serialize(): SerializedSim {
    return {
      v: 1,
      seed: this.seed,
      rng: this.rng.state(),
      tick: this.tick,
      time: this.time,
      ignitedAt: this.ignitedAt,
      phase: this.phase,
      nextId: this.nextId,
      ordinals: { ...this.ordinals },
      windFrom: this.windFrom,
      wind: JSON.parse(JSON.stringify(this.wind)),
      lighter: { remaining: this.lighter.remaining, tip: this.lighter.tip },
      tube: { ...this.tube },
      session: { ...this.session },
      stage0Done: this.stage0Done,
      stage0Timer: this.stage0Timer,
      smokeSmoothed: this.smokeSmoothed,
      heatSmoothed: this.heatSmoothed,
      bedCoal: this.bedCoal.slice(),
      bedAsh: this.bedAsh.slice(),
      timeline: this.timeline.slice(),
      pieces: this.pieces.map((p) => ({
        id: p.id,
        kind: p.kind,
        species: p.species,
        ordinal: p.ordinal,
        length: p.length,
        radius: p.radius,
        pose: { ...p.pose },
        segs: p.segs.map((s) => ({ ...s })),
        state: p.state,
        supports: p.supports,
        compressed: p.compressed,
        heatDir: p.heatDir,
        firstLitAt: p.firstLitAt,
        shapeSeed: p.shapeSeed,
      })),
    };
  }

  static deserialize(d: SerializedSim): FireSim {
    const sim = new FireSim(d.seed, d.session.mode);
    sim.rng = new Rng(d.rng);
    sim.tick = d.tick;
    sim.time = d.time;
    sim.ignitedAt = d.ignitedAt;
    sim.phase = d.phase;
    sim.nextId = d.nextId;
    // 太薪より前の保存データには large がない
    sim.ordinals = { ...sim.ordinals, ...(d.ordinals as Partial<Record<PieceKind, number>>) };
    sim.windFrom = d.windFrom;
    // 保存データの中身を共有しない（「もう一度」で同じ保存から何度も始めるため）
    sim.wind = JSON.parse(JSON.stringify(d.wind));
    sim.lighter = { remaining: d.lighter.remaining, tip: d.lighter.tip ? [...d.lighter.tip] as Vec3 : null };
    if (d.tube) sim.tube = { ...d.tube };
    sim.session = { ...d.session, extinguishAt: d.session.extinguishAt ?? null, endAt: d.session.endAt ?? null, fuelSpent: d.session.fuelSpent ?? false, spentFor: d.session.spentFor ?? 0 };
    sim.stage0Done = d.stage0Done;
    sim.stage0Timer = d.stage0Timer;
    sim.smokeSmoothed = d.smokeSmoothed;
    sim.heatSmoothed = d.heatSmoothed ?? 0;
    if (d.bedCoal) sim.bedCoal = d.bedCoal.slice();
    if (d.bedAsh) sim.bedAsh = d.bedAsh.slice();
    sim.timeline = d.timeline.slice();
    sim.pieces = d.pieces.map((sp) => {
      const p = createPiece(sp.id, sp.kind, sp.ordinal, sp.pose, { length: sp.length, radius: sp.radius }, sp.shapeSeed, sp.species);
      p.segs = sp.segs.map((s) => ({ ...s }));
      p.state = sp.state;
      p.supports = JSON.parse(JSON.stringify(sp.supports));
      p.compressed = sp.compressed;
      p.heatDir = [...sp.heatDir] as Vec3;
      p.firstLitAt = sp.firstLitAt;
      return p;
    });
    sim.layoutDirty = true;
    return sim;
  }

  /** 状態の指紋（決定性テスト用） */
  fingerprint(): string {
    const r = (x: number) => Math.round(x * 1e6) / 1e6;
    return JSON.stringify({
      t: this.tick,
      p: this.pieces.map((p) => [p.id, p.state, p.segs.map((s) => [r(s.T), r(s.I), r(s.f), r(s.c), r(s.g)])]),
      m: [r(this.metrics.heat), r(this.metrics.oxygen), r(this.metrics.smoke)],
      b: this.bedCoal.map(r),
    });
  }
}

export interface TubeState {
  t: number;
  x: number;
  z: number;
  level: number;
  lastAt: number;
}

export interface SerializedSim {
  v: 1;
  seed: number;
  rng: [number, number, number, number];
  tick: number;
  time: number;
  ignitedAt: number | null;
  phase: SimPhase;
  nextId: number;
  ordinals: Record<PieceKind, number>;
  windFrom: WindFrom;
  wind: WindState;
  lighter: { remaining: number; tip: Vec3 | null };
  /** 火吹き筒（これより前の保存データにはない） */
  tube?: TubeState;
  session: SessionInfo;
  /** 第0段階の保存データにある値（第1段階では companion が持つ。読み込み時は無視） */
  growth?: number;
  stableSeconds?: number;
  stage0Done: boolean;
  stage0Timer: number;
  smokeSmoothed: number;
  heatSmoothed?: number;
  bedCoal?: number[];
  bedAsh?: number[];
  timeline: TimelineEntry[];
  pieces: Array<{
    id: number;
    kind: PieceKind;
    species: WoodId;
    ordinal: number;
    length: number;
    radius: number;
    pose: Piece['pose'];
    segs: Piece['segs'];
    state: BurnState;
    supports: Piece['supports'];
    compressed: boolean;
    heatDir: Vec3;
    firstLitAt: number | null;
    shapeSeed: number;
  }>;
}

function emptyMetrics(): SimMetrics {
  return {
    heat: 0,
    oxygen: 70,
    smoke: 0,
    fuelRatio: 1,
    flamingSegs: 0,
    emberSegs: 0,
    flamePower: 0,
    emberPower: 0,
    flameCenter: [0, B.tray.floorY + 0.05, 0],
    smokeRaw: 0,
    counts: { raw: 0, warming: 0, flaming: 0, ember: 0, ash: 0 },
  };
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** ワールド方向を薪のローカル方向へ（yaw→pitch→rollの逆） */
export function worldToLocal(p: Piece, v: Vec3): Vec3 {
  const { yaw, pitch, roll } = p.pose;
  // yawの逆（Y軸回り -yaw）
  let x = Math.cos(-yaw) * v[0] + Math.sin(-yaw) * v[2];
  let z = -Math.sin(-yaw) * v[0] + Math.cos(-yaw) * v[2];
  let y = v[1];
  // pitchの逆（Z軸回り -pitch）
  const x2 = Math.cos(-pitch) * x - Math.sin(-pitch) * y;
  const y2 = Math.sin(-pitch) * x + Math.cos(-pitch) * y;
  x = x2;
  y = y2;
  // rollの逆（X軸回り -roll）
  const y3 = Math.cos(-roll) * y - Math.sin(-roll) * z;
  const z3 = Math.sin(-roll) * y + Math.cos(-roll) * z;
  return [x, y3, z3];
}
