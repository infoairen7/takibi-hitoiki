/**
 * ゲームの進行役：シミュレーション・時計・描画・音・保存・入力をつなぎ、
 * React（DOM UI）へ表示用の状態を渡す。
 */
import { AudioManager } from '../audio/AudioManager';
import { BALANCE, INITIAL_WOODS, PieceKind, WOODS, WoodId, clamp, isLog } from './balance';
import { GameClock, PauseReason } from './clock';
import { PendingPiece, addLogNearFire, nextPendingPiece, placeStep, previewPlacement } from './fire/builder';
import { LAYOUTS, LayoutId, candidateSpots, suggestedSpot } from './fire/layouts';
import { BURN_STATE_LABEL, BurnState, Piece, Pose, pieceLabel } from './fire/model';
import { PlacementResult, computePlacement, describeSupports, resettle } from './fire/placement';
import { FireSim, SimEvent, TimelineEntry } from './fire/sim';
import { WindFrom } from './fire/wind';
import { hash32 } from './rng';
import { FireSession, SessionEvent, moisture } from './session';
import { MemoryData, buildMemory, clampName, shareText } from './memory';
import { ProgressData, achieve, newUnlockLabels, taskCount, tubeUnlocked, unlockCount, unlockedDecors, unlockedPlaces, unlockedTrays, unlockedWoods } from './progress';
import { defaultTubeSpot, tubeSpots } from './fire/tube';
import { DecorId, PLACES, PlaceId, TASKS, TaskId, TrayId } from '../data/discoveries';
import type { SerializedSim } from './fire/sim';
import { WOOD_NOTES } from '../data/texts';
import { FireScene, Quality } from '../render/FireScene';
import { CardPhoto, makeThumb, renderMemoryCard } from '../ui/memoryCard';
import { deleteThumb, getThumb, putThumb } from '../persistence/thumbs';
import { DeviceCheck, collectDevice } from './deviceCheck';
import { blobToDataUrl, buildRecordFile, dataUrlToBlob, mergeAlbum, mergeProgress, parseRecordFile, RECORD_MAX_BYTES } from '../persistence/records';
import {
  AlbumEntry,
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  Settings,
  addToAlbum,
  clearSession,
  loadAlbum,
  loadProgress,
  loadSession,
  loadSettings,
  removeFromAlbum,
  replaceAlbum,
  saveProgress,
  saveSession,
  saveSettings,
  storageAvailable,
  takeAlbumBackupNotice,
  takeProgressBackupNotice,
  toggleFavorite,
  validateSession,
} from '../persistence/storage';

export type DockView = 'prepare' | 'place' | 'play' | 'woodPick' | 'tongs' | 'tongsHold' | 'wind' | 'ember' | 'ended' | 'layout' | 'farewell' | 'memory';
export type DialogId = null | 'pause' | 'endConfirm' | 'settings' | 'menu' | 'journal' | 'resume' | 'newConfirm' | 'layouts' | 'sound' | 'outfit' | 'deviceCheck' | 'about';

/** 版（動作チェックの結果と「このゲームについて」に出す） */
export const APP_VERSION = '1.0 2026.10.04';

export interface Toast {
  id: number;
  text: string;
}

export interface JournalPiece {
  id: number;
  label: string;
  state: BurnState;
  stateLabel: string;
  temp: number;
  char: number;
  fuel: number;
  air: number;
  moisture: number;
}

export interface UIState {
  ready: boolean;
  webglError: string | null;
  dock: DockView;
  dialog: DialogId;
  watching: boolean;
  phase: 'prepare' | 'burning' | 'out';
  counts: Record<PieceKind, number>;
  max: Record<PieceKind, number>;
  /** 中薪＋太薪の共通の枠 */
  logs: { used: number; max: number };
  /** 太薪を選べる（火が中薪まで育った後） */
  largeUnlocked: boolean;
  pending: { kind: PieceKind; species: WoodId } | null;
  placement: { valid: boolean; reason: string | null; supports: string; air: string; clamped: boolean; compress: boolean } | null;
  held: { id: number; label: string; burning: boolean; removable: boolean } | null;
  tongsTarget: { id: number; label: string } | null;
  canIgnite: { ok: boolean; reason: string | null };
  lighterActive: boolean;
  guide: { eyebrow: string; title: string; desc: string; step: number } | null;
  status: { tone: 'good' | 'warn' | 'moon' | 'idle'; text: string; hint: string | null; action?: 'tongs' | 'log' | 'wind' | null } | null;
  memory: { data: MemoryData; cardUrl: string | null; busy: boolean; cardFailed: boolean; saved: 'no' | 'yes' | 'full' | 'failed'; imageSaved: boolean; share: string; canShareFiles: boolean } | null;
  /** 今夜の火の記録（手帳の「今の火」） */
  record: { stableSeconds: number; windowSeconds: number; watchSeconds: number; maxHeat: number; care: number; species: number };
  /** これまでの発見と、解放されたもの */
  progress: {
    count: number;
    /** 解放に使う数（前の版で解放されていたものは残す） */
    unlock: number;
    tasks: Array<{ id: TaskId; label: string; hint: string; done: string | null }>;
    woods: WoodId[];
    places: PlaceId[];
    trays: TrayId[];
    decors: DecorId[];
    woodsUsed: number;
  };
  /** この回の場所・焚き火台（着火前だけ変えられる） */
  outfit: { place: PlaceId; placeLabel: string; tray: TrayId; mode: 'short' | 'long'; locked: boolean };
  canReplay: boolean;
  album: Array<AlbumEntry & { thumbUrl: string | null }>;
  toasts: Toast[];
  sound: { enabled: boolean; needsResume: boolean; supported: boolean };
  settings: Settings;
  /** 動きを控えめに（アプリの設定か端末の設定） */
  reduceMotion: boolean;
  /** 「今日はここまで」を選べる（火を灯した後、見送りの前） */
  canEnd: boolean;
  /** 薪支度で置く中薪の樹種 */
  prepSpecies: WoodId;
  wind: {
    level: number;
    from: WindFrom;
    active: boolean;
    tool: 'fan' | 'tube';
    tubeUnlocked: boolean;
    tubeLevel: number;
    tubeAim: string | null;
    /** 息継ぎが終わって、次のひと吹きができる */
    tubeReady: boolean;
    tubeActive: boolean;
  };
  session: { activeTime: number; duration: number; emberPhase: boolean; ended: boolean };
  stage0Done: boolean;
  metrics: { heat: number; oxygen: number; smoke: number; fuel: number; stableSeconds: number };
  words: { heat: string; oxygen: string; smoke: string; fuel: string };
  pieces: JournalPiece[];
  timeline: TimelineEntry[];
  layoutRunning: LayoutId | null;
  storageOk: boolean;
  /** 直近の保存に失敗している（容量不足など） */
  saveFailed: boolean;
  /** 記録の書き出し・読み込み */
  records: { busy: boolean; note: string | null };
  /** 動作チェック（実機の確認用） */
  check: { running: boolean; remaining: number; seconds: number; report: string | null };
  /** 振動に対応している端末か */
  hapticsSupported: boolean;
  debug: boolean;
  stats: ReturnType<FireScene['stats']> | null;
  paused: boolean;
}

type Listener = () => void;

interface HeldState {
  id: number;
  orig: Pose;
  pending: PendingPiece;
}

export class GameController {
  sim: FireSim;
  clock = new GameClock();
  scene: FireScene | null = null;
  audio = new AudioManager();
  settings: Settings;
  private listeners = new Set<Listener>();
  private snapshot: UIState;
  private dock: DockView = 'prepare';
  private dialog: DialogId = null;
  private dialogStack: DialogId[] = [];
  private watching = false;
  private pending: PendingPiece | null = null;
  private ghostPos = { x: 0, z: 0, yaw: 0 };
  private placement: PlacementResult | null = null;
  private held: HeldState | null = null;
  private tongsTarget: number | null = null;
  private toasts: Toast[] = [];
  private toastId = 1;
  /** その回の記録・見送り・発見（キャラクターは 2026-10-04 に外した） */
  sess: FireSession;
  private memory: { data: MemoryData; card: Blob | null; cardUrl: string | null; busy: boolean; cardFailed?: boolean; saved: 'no' | 'yes' | 'full' | 'failed'; imageSaved: boolean } | null = null;
  /** 思い出カードの絵：その回のいちばん育った火を、実際の画面から撮っておく */
  private keepsake: { rank: number; photo: CardPhoto } | null = null;
  private keepsakeDue: { rank: number; at: number; tries: number } | null = null;
  progress: ProgressData;
  private sessionPlace: PlaceId = 'lakeside';
  private sessionTray: TrayId = 'first';
  /** 「今回の組合せでもう一度」：着火の直前の状態（薪の初期構成・seed・モード・場所・組み方） */
  private replay: { sim: SerializedSim; place: PlaceId; tray: TrayId; layoutId: string | null; replays: number } | null = null;
  private replayCount = 0;
  private album: AlbumEntry[] = [];
  private thumbUrls = new Map<string, string>();
  private memoryName: string | null = null;
  private windLevel = 1;
  private windFrom: WindFrom = 'front';
  /** 送風の道具：うちわ（広い風）／火吹き筒（狙った一点） */
  private windTool: 'fan' | 'tube' = 'fan';
  private tubeLevel = 0;
  private tubeAim: { x: number; z: number; label: string } | null = null;
  private layoutQueue: { id: LayoutId; steps: typeof LAYOUTS.yuttari.steps; timer: number } | null = null;
  private lastFrame = 0;
  private raf = 0;
  private uiTimer = 0;
  private saveTimer = 0;
  private dirty = true;
  private webglError: string | null = null;
  private ready = false;
  private storageOk = storageAvailable();
  private debug = false;
  private debugPanel = true;
  private prevDockBeforePlace: DockView = 'prepare';
  private seenSpread = { kindling: false, medium: false, large: false };
  /** この回で、ひとことを出した樹種 */
  private woodNoted = new Set<WoodId>();
  private osReducedMotion = false;
  private motionQuery: MediaQueryList | null = null;
  private onMotionChange = (e: MediaQueryListEvent) => {
    this.osReducedMotion = e.matches;
    if (this.scene) this.scene.reducedMotion = this.reducedMotion;
    this.emit();
  };
  /** 動きを控えめに：アプリの設定か、端末の設定のどちらか */
  get reducedMotion(): boolean {
    return this.settings.reducedMotion || this.osReducedMotion;
  }
  private soundGesture: (() => void) | null = null;
  private armSoundOnFirstGesture(): void {
    if (this.soundGesture) return;
    const go = () => {
      this.disarmSoundGesture();
      if (this.settings.soundEnabled && !this.audio.enabled) void this.setSound(true);
    };
    this.soundGesture = go;
    window.addEventListener('pointerdown', go, { capture: true });
    window.addEventListener('keydown', go, { capture: true });
  }
  private disarmSoundGesture(): void {
    if (!this.soundGesture) return;
    window.removeEventListener('pointerdown', this.soundGesture, { capture: true });
    window.removeEventListener('keydown', this.soundGesture, { capture: true });
    this.soundGesture = null;
  }

  constructor() {
    this.settings = loadSettings();
    applyTextSize(this.settings.textSize);
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches && !localStorageHas('gyarubi.settings')) {
      this.settings.reducedMotion = true;
    }
    this.debug = typeof location !== 'undefined' && /[?&]debug=1/.test(location.search);
    this.debugPanel = typeof location !== 'undefined' && !/[?&]panel=0/.test(location.search);
    this.sim = new FireSim(newSeed(), this.settings.mode);
    this.sess = new FireSession(this.sim.seed, this.sim.session.durationSeconds);
    this.clock.pause('loading');
    this.progress = loadProgress();
    this.sessionPlace = this.allowedPlace(this.settings.place);
    this.sessionTray = this.allowedTray(this.settings.tray);
    this.album = loadAlbum();
    this.albumBackedUp = takeAlbumBackupNotice();
    this.snapshot = this.buildSnapshot();
  }

  private albumBackedUp = false;

  // ───────────────────────────── React連携

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): UIState => this.snapshot;

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const l of this.listeners) l();
  }

  // ───────────────────────────── 起動

  mount(container: HTMLElement, backdropUrl: string): void {
    if (!FireScene.isSupported()) {
      this.webglError = 'この環境では3D表示を開始できません。';
      this.emit();
      return;
    }
    const t0 = performance.now();
    try {
      this.scene = new FireScene(container, { quality: this.settings.quality, reducedMotion: this.reducedMotion, backdropUrl });
      this.sceneInitMs = performance.now() - t0;
      // 重い準備のあとから、画質の自動調整の待ち時間を数える
      this.scene.holdAdapt();
    } catch (e) {
      this.webglError = 'この環境では3D表示を開始できません。';
      console.error(e);
      this.emit();
      return;
    }
    const canvas = this.scene.renderer.domElement;
    canvas.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault();
      this.webglError = '3D表示が一時的に止まりました。再読み込みすると続きから戻れます。';
      this.persist();
      this.emit();
    });
    this.attachPointer(container);
    this.applyOutfit();
    this.canShareFilesCached = this.canShareFiles;
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    // 端末が画面を凍結するとき（Chrome のページの一時停止）と、戻るボタンのキャッシュから戻ったとき
    document.addEventListener('freeze', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
    // 前回の火が残っていれば「続きから」を提案
    const saved = loadSession();
    if (this.hotRestore && this.hotRestore.sim.pieces.length > 0) {
      // ページの更新で開き直したとき：確認なしで今の火へ戻る
      this.pendingResume = this.hotRestore;
      this.hotRestore = null;
      this.ready = true;
      this.clock.resume('loading');
      this.lastFrame = performance.now();
      this.raf = requestAnimationFrame(this.frame);
      this.exposeDebug();
      this.acceptResume();
      if (this.settings.soundEnabled) void this.setSound(true);
      return;
    }
    if (saved.ok && saved.value && saved.value.sim.pieces.length > 0 && !(saved.value.sim.session.ended && !saved.value.companion && !saved.value.session)) {
      this.pendingResume = saved.value;
      this.openDialog('resume');
      this.clock.pause('resume');
    } else if (!saved.ok && saved.reason === 'corrupt') {
      this.startupNotices.push('前回の記録を読み込めませんでした。新しい火から始めます（元の記録は退避しました）。');
    }
    if (this.albumBackedUp) this.startupNotices.push('思い出のアルバムを読み込めませんでした。元のデータは退避して、新しいアルバムを始めます。');
    if (takeProgressBackupNotice()) this.startupNotices.push('これまでの発見を読み込めませんでした。元のデータは退避しました。');
    this.applyOutfit();
    if (this.settings.soundEnabled === null && this.audio.supported && !this.pendingResume) this.openDialog('sound');
    // 前に「音あり」を選んだ人は、最初に画面へ触れたとき（キー操作を含む）に音を始める（ブラウザは操作の前に音を出せない）
    else if (this.settings.soundEnabled && this.audio.supported && !this.pendingResume) this.armSoundOnFirstGesture();
    if (!this.storageOk) this.startupNotices.push('この環境では記録を保存できません。遊ぶことはできます（閉じると、この火と記録は残りません）。');
    // 端末の「視差効果を減らす」の変更にも合わせる
    this.osReducedMotion = !!(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    this.motionQuery = typeof window !== 'undefined' ? (window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null) : null;
    this.motionQuery?.addEventListener?.('change', this.onMotionChange);
    this.ready = true;
    this.clock.resume('loading');
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    this.exposeDebug();
    this.emit();
  }

  private pendingResume: import('../persistence/storage').SavedSession | null = null;
  private hotRestore: import('../persistence/storage').SavedSession | null = null;

  /** 公開ページの更新時に状態を引き継ぐ（claude.ai の viewer の hot フック） */
  setHotRestore(v: unknown): void {
    if (validateSession(v)) this.hotRestore = v;
  }

  hotSnapshot(): unknown {
    if (this.sim.pieces.length === 0) return null;
    return this.sessionData();
  }

  private sessionData() {
    return {
      schemaVersion: SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      sim: this.sim.serialize(),
      visual: this.scene?.exportVisual(),
      session: this.sess.serialize(),
      memoryName: this.memoryName,
      outfit: { place: this.sessionPlace, tray: this.sessionTray },
      replay: this.replay,
    };
  }
  /** 3Dの準備にかかった時間（テクスチャ生成・材質のコンパイルを含む） */
  sceneInitMs = 0;

  private exposeDebug(): void {
    (window as unknown as { __gyarubi: unknown }).__gyarubi = {
      controller: this,
      get sim() {
        return (window as unknown as { __gyarubi: { controller: GameController } }).__gyarubi.controller.sim;
      },
      /** 検証用：シミュレーションを早送り（時計の規則は迂回する。本番UIからは呼ばない） */
      advance: (seconds: number) => {
        const n = Math.round(seconds * BALANCE.sim.hz);
        for (let i = 0; i < n; i++) {
          this.sim.step();
          const ev = this.sim.drainEvents();
          this.handleEvents(ev);
          this.handleSession(this.sess.step(this.sim, ev));
          if (this.sess.ended) break;
        }
        this.emit();
      },
      /** 検証用：燃えている場所の上へ中薪を一本足す（at を渡すと、その位置へ。置けなければ向きを変えて試す） */
      addLog: (at?: { x: number; z: number }) => {
        let ok = false;
        if (at) {
          for (const yawDeg of [0, 90, 45, 135]) {
            if (placeStep(this.sim, { kind: 'medium', x: at.x, z: at.z, yawDeg }).piece) {
              ok = true;
              break;
            }
          }
        } else ok = addLogNearFire(this.sim);
        if (ok) {
          const p = this.sim.pieces[this.sim.pieces.length - 1];
          this.sess.notePlaced(this.sim, p.kind, p.species);
          this.sess.noteCare(this.sim, 'log');
          this.drainAndHandle();
          this.emit();
        }
        return ok;
      },
    };
  }

  private onResize = () => this.scene?.resize();

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const frameMs = now - this.lastFrame;
    const dt = Math.min(frameMs / 1000, BALANCE.sim.maxFrameDt);
    this.lastFrame = now;
    // 時計には実際の経過を渡す（上限を超えた分は、時計が「追いつけずに捨てた刻み」として数える）
    const steps = this.sess.ended ? 0 : this.clock.advance(frameMs / 1000);
    const events: SimEvent[] = [];
    const sessEvents: SessionEvent[] = [];
    for (let i = 0; i < steps; i++) {
      this.sim.step();
      const ev = this.sim.drainEvents();
      events.push(...ev);
      sessEvents.push(...this.sess.step(this.sim, ev));
      if (this.sess.ended) break;
    }
    // 推奨の組み方：一本ずつ置く
    if (this.layoutQueue && !this.clock.paused) this.stepLayout(dt);
    if (events.length) this.handleEvents(events);
    if (sessEvents.length) this.handleSession(sessEvents);
    if (this.scene) {
      this.scene.update(this.sim, dt, events, this.clock.paused);
      this.scene.render(frameMs);
      this.tickCheck(now);
      // 起動時のお知らせは、最初の画面を描いてから出す（初回の描画の準備に時間がかかる端末で、見る前に消えないように）
      if (this.startupNotices.length) {
        for (const t of this.startupNotices) this.pushToast(t, 7000);
        this.startupNotices = [];
      }
      this.tickKeepsake(now);
    }
    // 音
    const m = this.sim.metrics;
    const flameX = m.flameCenter[0];
    this.audio.setMusicMood({
      place: this.sessionPlace,
      phase: this.sess.ended || this.sim.session.ended ? 'ended' : this.sess.farewell ? 'farewell' : this.sim.session.emberPhase ? 'ember' : this.sim.phase === 'burning' ? 'burning' : 'prepare',
      paused: this.clock.paused,
    });
    this.audio.update(
      {
        flamePower: m.flamePower,
        emberPower: m.emberPower,
        crackle: Math.min(1.5, m.flamingSegs / 12),
        wind: Math.hypot(...this.sim.wind.phys),
        pan: clamp(flameX / 0.3, -1, 1) * 0.6,
        paused: this.clock.paused,
      },
      dt,
    );
    // 定期保存（燃えている間、10秒おき。急にブラウザが閉じられても、少し前から続けられるように）
    this.saveTimer += dt;
    if (this.saveTimer > BALANCE.save.autosaveMs / 1000 && this.sim.phase === 'burning' && !this.clock.paused && !this.sim.session.ended) {
      this.saveTimer = 0;
      this.persist();
    }
    this.uiTimer += dt;
    if (this.dirty || this.uiTimer > 0.25) {
      this.uiTimer = 0;
      this.dirty = false;
      this.emit();
    }
  };

  // ───────────────────────────── イベント

  private handleEvents(events: SimEvent[]): void {
    const pan = (e: SimEvent) => clamp((e.pos?.[0] ?? 0) / 0.3, -1, 1) * 0.7;
    // 消えた後に、熾の上の薪や火口へ火が戻った（火を灯すボタンを押さずに燃え始めた）：支度の道具箱のままにしない
    if (events.length && this.sim.phase === 'burning' && this.dock === 'prepare') this.setDock(this.baseDock());
    for (const e of events) {
      switch (e.type) {
        case 'ignite':
          this.achieveTask('t01');
          this.audio.ignite();
          this.buzz('ignite');
          if (this.dock === 'prepare') this.setDock('play');
          this.dirty = true;
          break;
        case 'spread':
          if (e.kind === 'kindling' && !this.seenSpread.kindling) {
            this.seenSpread.kindling = true;
            this.pushToast('細薪へ、火が移りました。');
          }
          if (e.kind === 'medium' && !this.seenSpread.medium) {
            this.seenSpread.medium = true;
            this.pushToast('中薪に、火が入りました。');
          }
          if (e.kind === 'large' && !this.seenSpread.large) {
            this.seenSpread.large = true;
            this.pushToast('太薪に、ゆっくり火が入りました。');
            this.achieveTask('f02');
          }
          // 樹種ごとのひとこと（その回で初めて、その樹種の薪に火が入ったとき）
          if (e.kind && isLog(e.kind)) {
            const sp = this.sim.pieces.find((p) => p.id === e.pieceId)?.species;
            if (sp && !this.woodNoted.has(sp)) {
              this.woodNoted.add(sp);
              this.pushToast(WOOD_NOTES[sp], 4200);
            }
            if (sp === 'shimerigi') this.achieveTask('f09');
          }
          break;
        case 'stage0':
          // 細薪から中薪へ、火がつながった
          this.audio.stageUp();
          this.achieveTask('f01');
          this.persist();
          break;
        case 'pop':
          this.audio.pop(pan(e));
          break;
        case 'placedOnFire':
          this.audio.woodKnock(e.kind ?? 'medium', pan(e), true);
          if (!this.layoutQueue) this.buzz('place');
          break;
        case 'placed':
        case 'moved':
          this.audio.woodKnock(e.kind ?? 'medium', pan(e));
          if (!this.layoutQueue) this.buzz(e.type === 'moved' ? 'soft' : 'place');
          break;
        case 'collapse':
          this.audio.collapse(pan(e));
          this.scene?.notifyPlaced(e.pieceId ?? -1);
          break;
        case 'gustIgnored':
          this.pushToast('少し間をあけて、もう一度。');
          break;
        case 'emberNotice':
          this.pushToast('もうすぐ、火を見守る時間です。');
          break;
        case 'emberPhase':
          this.cancelTransient();
          if (this.sim.session.fuelSpent) this.urgentToast('火が小さくなりました。ここからは、熾火を見守る時間です。', 5000);
          if (!this.sess.farewell) this.setDock('ember');
          this.persist();
          break;
        case 'sessionEnd':
          this.cancelTransient();
          this.persist();
          break;
        case 'allOut':
          // 熾火の前に消えたら、火口を置き直してやり直せる（中薪まで育った後は、燃料切れとして熾火の時間へ入る）
          if (!this.sim.session.emberPhase && !this.sim.session.ended && !this.sess.farewell) {
            this.cancelTransient();
            this.setDock('prepare');
          }
          this.persist();
          break;
        case 'tinderSpent':
          this.dirty = true;
          break;
      }
    }
  }

  // ───────────────────────────── その回の進行（見送り・写真・発見）

  private handleSession(events: SessionEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'farewell':
          this.cancelTransient();
          this.watching = false;
          if (e.reason !== 'natural' || !this.sim.session.emberPhase) this.setDock('farewell');
          this.audio.farewell();
          this.persist();
          break;
        case 'keepsake':
          if (!this.keepsake || e.rank >= this.keepsake.rank) this.keepsakeDue = { rank: e.rank, at: performance.now() + BALANCE.keepsake.delayMs, tries: 0 };
          break;
        case 'task':
          this.achieveTask(e.id);
          break;
        case 'end':
          if (e.reason === 'natural') {
            const lay = this.sess.stats.layoutId;
            const map: Record<string, TaskId> = { yuttari: 't17', igeta: 't18', tatekake: 't19', yose: 't20' };
            if (lay && map[lay]) this.achieveTask(map[lay]);
            if (this.sim.session.mode === 'long') this.achieveTask('f06');
            if (this.sess.stats.logsAdded === 0) this.achieveTask('f12');
          }
          this.onSessionEnd();
          break;
        default:
          break;
      }
    }
    this.dirty = true;
  }

  // ───────────────────────────── 発見（課題）・解放

  /** 課題を達成。新しい発見と、それで解放されたものを知らせる */
  achieveTask(id: TaskId): void {
    const before = unlockCount(this.progress);
    if (!achieve(this.progress, id)) return;
    const after = unlockCount(this.progress);
    const t = TASKS.find((x) => x.id === id)!;
    this.pushToast(`新しい発見：${t.label}（${taskCount(this.progress)}/${TASKS.length}）`);
    const unlocked = newUnlockLabels(before, after);
    if (unlocked.length) this.pushToast(`解放：${unlocked.join('、')}`);
    this.saveProgressNow();
    this.dirty = true;
  }

  private saveProgressNow(): void {
    if (this.storageOk) this.noteSaveResult(saveProgress(this.progress), 'progress');
  }

  /** 置いた薪の樹種を記録（1回で3種・4種、累計12種） */
  /** 薪支度・組み方の見本で置く中薪の樹種（解放されているものだけ） */
  get prepSpecies(): WoodId {
    return unlockedWoods(unlockCount(this.progress)).includes(this.settings.species) ? this.settings.species : 'nara';
  }

  setPrepSpecies(w: WoodId): void {
    if (!unlockedWoods(unlockCount(this.progress)).includes(w)) return;
    this.updateSettings({ species: w });
    // 置こうとしている中薪の樹種も変える（太さはそのまま）
    if (this.pending && isLog(this.pending.kind) && !this.held) {
      this.pending = { ...this.pending, species: w };
      this.updateGhost();
      this.emit();
    }
  }

  private noteWoodForTasks(kind: PieceKind, species: WoodId): void {
    // 樹種を選べるのは中薪・太薪だけ（火口・細薪の樹種は決まっている）なので、使った樹種にはそれだけを数える
    if (!isLog(kind)) return;
    if (!this.progress.woodsUsed.includes(species)) {
      this.progress.woodsUsed.push(species);
      this.saveProgressNow();
    }
    const n = this.sess.stats.species.length;
    if (n >= 3) this.achieveTask('t14');
    if (n >= 4) this.achieveTask('t15');
    if (this.progress.woodsUsed.length >= 12) this.achieveTask('t16');
  }

  private allowedPlace(p: PlaceId): PlaceId {
    return unlockedPlaces(unlockCount(this.progress)).includes(p) ? p : 'lakeside';
  }

  private allowedTray(t: TrayId): TrayId {
    return unlockedTrays(unlockCount(this.progress)).includes(t) ? t : 'first';
  }

  /** 着火前だけ：場所・焚き火台・時間を選ぶ */
  /** 火を灯したら、新しい火を始めるまで場所・焚き火台・時間は変えない（見送った後の思い出も、その回の場所のまま） */
  get outfitLocked(): boolean {
    return this.sim.ignitedAt !== null;
  }

  setPlace(p: PlaceId): void {
    if (this.outfitLocked || !unlockedPlaces(unlockCount(this.progress)).includes(p)) return;
    this.sessionPlace = p;
    this.updateSettings({ place: p });
    this.applyOutfit();
  }

  setTray(t: TrayId): void {
    if (this.outfitLocked || !unlockedTrays(unlockCount(this.progress)).includes(t)) return;
    this.sessionTray = t;
    this.updateSettings({ tray: t });
    this.applyOutfit();
  }

  setMode(mode: 'short' | 'long'): void {
    if (this.sim.ignitedAt !== null) return;
    this.updateSettings({ mode });
    this.sim.setMode(mode);
    const layoutId = this.sess.stats.layoutId;
    this.sess = new FireSession(this.sess.seed, this.sim.session.durationSeconds);
    if (layoutId) this.sess.noteLayout(layoutId);
    for (const p of this.sim.pieces) this.sess.notePlaced(this.sim, p.kind, p.species);
    this.emit();
  }

  setDecor(patch: Partial<Pick<Settings, 'frame' | 'tongs' | 'bag' | 'lantern'>>): void {
    const ok = unlockedDecors(unlockCount(this.progress));
    if (patch.frame && patch.frame !== 'paper' && !ok.includes(patch.frame)) return;
    if (patch.tongs && patch.tongs !== 'steel' && !ok.includes(patch.tongs)) return;
    if (patch.bag && !ok.includes('bag')) return;
    if (patch.lantern && !ok.includes('lantern')) return;
    this.updateSettings(patch);
    this.applyOutfit();
    if (patch.frame && this.memory) void this.buildCard();
  }

  private applyOutfit(): void {
    const s = this.settings;
    const ok = unlockedDecors(unlockCount(this.progress));
    this.scene?.setPlace(this.sessionPlace);
    this.scene?.setTray(this.sessionTray);
    this.scene?.setDecor({
      tongs: s.tongs !== 'steel' && ok.includes(s.tongs) ? s.tongs : 'steel',
      bag: s.bag && ok.includes('bag'),
      lantern: s.lantern && ok.includes('lantern'),
    });
    this.audio.setPlace(this.sessionPlace);
    this.dirty = true;
  }

  get placeLabel(): string {
    return PLACES.find((p) => p.id === this.sessionPlace)?.label ?? '森の湖畔';
  }

  /** 思い出の絵：火が育った節目から少し後に、実際の画面を撮っておく */
  private tickKeepsake(now: number): void {
    const due = this.keepsakeDue;
    if (!due || now < due.at || !this.scene) return;
    // 置き位置の見本が出ている・止まっている・火がほとんど消えているときは、少し待ってから撮る
    const weak = this.sim.metrics.heat < 30 && !this.sim.session.emberPhase;
    if (((this.scene.busyOverlay || this.clock.paused) && due.tries < 8) || (weak && due.tries < 12)) {
      due.at = now + (weak ? 4000 : 1500);
      due.tries += 1;
      return;
    }
    this.keepsakeDue = null;
    void this.scene.captureFrame().then((photo) => {
      if (photo && (!this.keepsake || due.rank >= this.keepsake.rank)) {
        this.keepsake = { rank: due.rank, photo };
        // その回の乱数（sess.seed）で分ける：「もう一度」は同じ sim.seed を使うため
        void putThumb(`keepsake:${this.sess.seed}`, photo.blob);
      }
    });
  }

  // ───────────────────────────── 通知

  /**
   * 知らせ（画面を遮らない短い文）。同時に出す数は画面の大きさで決め（スマホ縦は1つ、横向きの短い画面は2つ、PCは3つ）、
   * あふれた分は順番に出す。同じ文が出ている・待っているときは重ねない。
   */
  pushToast(text: string, ms = 3600): void {
    if (this.toasts.some((t) => t.text === text) || this.toastQueue.some((t) => t.text === text)) return;
    const id = this.toastId++;
    this.toastQueue.push({ id, text, ms });
    if (this.toastQueue.length > 6) this.toastQueue.shift();
    this.pumpToasts();
  }

  /**
   * 押した操作への答え（できない理由など）・保存できなかったときの知らせ・熾火の時間へ入った知らせ。順番待ちにせず、すぐに出す。
   * 画面に出せる数がいっぱいなら、いちばん古いお知らせを少し後ろへ回す（消さない）。
   */
  private urgentToast(text: string, ms = 3000): void {
    if (!text) return;
    if (this.toasts.some((t) => t.text === text)) return;
    this.toastQueue = this.toastQueue.filter((t) => t.text !== text);
    if (this.toasts.length >= this.maxToasts()) {
      const old = this.toasts[0];
      this.toasts = this.toasts.slice(1);
      this.toastQueue.unshift({ id: this.toastId++, text: old.text, ms: 2500 });
    }
    const id = this.toastId++;
    this.toasts = [...this.toasts, { id, text }];
    window.setTimeout(() => {
      this.toasts = this.toasts.filter((x) => x.id !== id);
      this.pumpToasts();
      this.emit();
    }, ms);
    this.dirty = true;
    this.emit();
  }

  private toastQueue: Array<{ id: number; text: string; ms: number }> = [];

  private maxToasts(): number {
    const mq = (q: string) => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches;
    if (mq('(orientation: landscape) and (max-height: 520px)')) return 2;
    if (mq('(max-width: 760px)')) return 1;
    return 3;
  }

  private pumpToasts(): void {
    const max = this.maxToasts();
    while (this.toasts.length < max && this.toastQueue.length) {
      const t = this.toastQueue.shift()!;
      this.toasts = [...this.toasts, { id: t.id, text: t.text }];
      window.setTimeout(() => {
        this.toasts = this.toasts.filter((x) => x.id !== t.id);
        this.pumpToasts();
        this.emit();
      }, t.ms);
    }
    this.dirty = true;
  }

  private startupNotices: string[] = [];

  // ───────────────────────────── ダイアログ・停止

  openDialog(d: Exclude<DialogId, null>): void {
    if (this.dialog && this.dialog !== d) this.dialogStack.push(this.dialog);
    this.dialog = d;
    const reason = dialogPauseReason(d);
    if (reason) this.clock.pause(reason);
    this.emit();
  }

  closeDialog(): void {
    const d = this.dialog;
    if (!d) return;
    const reason = dialogPauseReason(d);
    this.dialog = this.dialogStack.pop() ?? null;
    // 同じ理由の別のダイアログが残っていなければ解除
    if (reason && (!this.dialog || dialogPauseReason(this.dialog) !== reason)) this.clock.resume(reason);
    this.emit();
  }

  closeAllDialogs(): void {
    while (this.dialog) this.closeDialog();
  }

  pauseByUser(): void {
    this.openDialog('pause');
  }

  resumeFromPause(): void {
    this.closeAllDialogs();
    this.clock.resume('user');
    if (this.audio.needsResume) void this.audio.resume().then(() => this.emit());
    this.emit();
  }

  saveAndLeave(): void {
    const ok = this.persist();
    this.pushToast(ok ? '今の火を保存しました。次に開いたとき、続きから再開できます。' : 'この環境では記録を保存できません。');
  }

  private onPageHide = () => {
    this.persist();
  };

  private onPageShow = (e: PageTransitionEvent) => {
    if (!e.persisted) return;
    this.lastFrame = performance.now();
    if (this.audio.needsResume && !this.clock.has('user')) void this.audio.resume();
    this.emit();
  };

  private onVisibility = () => {
    this.check?.setHidden(document.hidden);
    if (document.hidden) {
      this.clock.pause('hidden');
      // 燃えている途中で離れたら、戻ったときに「続きから」を選べるようにする
      if (this.sim.phase === 'burning' && !this.sim.session.ended) {
        this.clock.pause('user');
        if (this.dialog !== 'pause') this.openDialog('pause');
      }
      this.persist();
      this.audio.suspend();
    } else {
      this.clock.resume('hidden');
      this.lastFrame = performance.now();
      if (!this.clock.has('user') && this.audio.enabled) void this.audio.resume();
      this.emit();
    }
  };

  // ───────────────────────────── 音

  async setSound(on: boolean): Promise<void> {
    this.disarmSoundGesture();
    if (on) {
      this.audio.setMusicVolume(this.settings.bgmVolume);
      const ok = await this.audio.enable();
      this.audio.setVolume(this.settings.fireVolume);
      this.settings.soundEnabled = ok;
      if (!ok) this.pushToast('音を開始できませんでした。もう一度押してください。');
    } else {
      this.audio.disable();
      this.settings.soundEnabled = false;
    }
    saveSettings(this.settings);
    if (this.dialog === 'sound') this.closeDialog();
    this.emit();
  }

  toggleSound(): void {
    void this.setSound(!this.audio.enabled);
  }

  async resumeAudio(): Promise<void> {
    await this.audio.resume();
    this.emit();
  }

  updateSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    if (patch.fireVolume !== undefined) this.audio.setVolume(patch.fireVolume);
    if (patch.bgmVolume !== undefined) this.audio.setMusicVolume(patch.bgmVolume);
    if (patch.reducedMotion !== undefined && this.scene) this.scene.reducedMotion = this.reducedMotion;
    if (patch.quality !== undefined) this.scene?.setQuality(patch.quality as Quality | 'auto');
    if (patch.textSize !== undefined) applyTextSize(patch.textSize);
    saveSettings(this.settings);
    this.emit();
  }

  /** 振動（対応している端末で、設定がオンのときだけ。動きを控えめにしていても、触った手応えなので残す） */
  buzz(kind: 'place' | 'ignite' | 'soft'): void {
    if (!this.settings.haptics || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    const pattern: Record<typeof kind, number | number[]> = { place: 12, soft: 8, ignite: [18, 60, 26] };
    try {
      navigator.vibrate(pattern[kind]);
    } catch {
      /* 使えない環境では何もしない */
    }
  }

  // ───────────────────────────── 薪を置く

  private setDock(d: DockView): void {
    this.dock = d;
    this.dirty = true;
    this.updateTouchMode();
  }

  private baseDock(): DockView {
    if (this.sess.ended) return 'memory';
    if (this.sess.farewell) return 'farewell';
    if (this.sim.session.ended) return 'ended';
    if (this.sim.session.emberPhase) return 'ember';
    return this.sim.phase === 'burning' ? 'play' : 'prepare';
  }

  selectKind(kind: PieceKind, species?: WoodId): void {
    if (this.layoutQueue) return;
    this.cancelTransient();
    const can = this.sim.canAdd(kind);
    if (!can.ok) {
      this.urgentToast(can.reason ?? '');
      return;
    }
    this.prevDockBeforePlace = this.baseDock();
    this.pending = nextPendingPiece(this.sim, kind, species);
    const spot = suggestedSpot(kind, isLog(kind) ? this.sim.countOf('medium', true) + this.sim.countOf('large', true) : this.sim.countOf(kind, true));
    this.ghostPos = { x: spot.x, z: spot.z, yaw: (spot.yawDeg * Math.PI) / 180 };
    this.spotIndex = -1;
    this.setDock('place');
    this.updateGhost();
    // 最初の提案が置けない場所なら、置ける候補へ
    if (this.placement && !this.placement.valid) this.cycleSpot(1);
    this.emit();
  }

  private updateGhost(): void {
    if (!this.pending) {
      this.placement = null;
      this.scene?.setGhost(null);
      return;
    }
    const exclude = this.held?.id;
    const res = previewPlacement(this.sim, this.pending, this.ghostPos.x, this.ghostPos.z, this.ghostPos.yaw, exclude);
    this.placement = res;
    if (this.held) {
      // 持っている薪は置き位置の少し上に。炎も一緒に移動する
      this.sim.setHeldPose(this.held.id, { ...res.pose, y: res.pose.y });
    }
    this.scene?.setGhost({
      kind: this.pending.kind,
      species: this.pending.species,
      length: this.pending.length,
      radius: this.pending.radius,
      shapeSeed: this.pending.shapeSeed,
      pose: res.pose,
      valid: res.valid,
      supports: res.supports.map((s) => s.point),
    });
    this.dirty = true;
  }

  moveGhostTo(x: number, z: number): void {
    if (!this.pending) return;
    // 台の外をタップしても、台の縁へ寄せて見せる
    const lim = BALANCE.tray.innerHalf + 0.1;
    this.ghostPos.x = clamp(x, -lim, lim);
    this.ghostPos.z = clamp(z, -lim, lim);
    this.updateGhost();
  }

  nudge(dx: number, dz: number): void {
    this.moveGhostTo(this.ghostPos.x + dx, this.ghostPos.z + dz);
  }

  private spotIndex = -1;

  /** 置き位置の候補を順に選ぶ（キーボード・タップだけの操作用） */
  cycleSpot(dir: 1 | -1): void {
    if (!this.pending) return;
    const list = candidateSpots(this.pending.kind);
    if (!list.length) return;
    // 今の薪と重ならない候補を優先
    for (let k = 0; k < list.length; k++) {
      this.spotIndex = (this.spotIndex + dir + list.length) % list.length;
      const c = list[this.spotIndex];
      const res = previewPlacement(this.sim, this.pending, c.x, c.z, (c.yawDeg * Math.PI) / 180, this.held?.id);
      if (res.valid) break;
    }
    const c = list[this.spotIndex];
    this.ghostPos = { x: c.x, z: c.z, yaw: (c.yawDeg * Math.PI) / 180 };
    this.updateGhost();
    this.emit();
  }

  rotate(deltaDeg: number): void {
    if (!this.pending) return;
    this.ghostPos.yaw += (deltaDeg * Math.PI) / 180;
    this.updateGhost();
    this.emit();
  }

  confirmPlace(): boolean {
    if (this.held) return this.dropHeld();
    if (!this.pending || !this.placement) return false;
    if (!this.placement.valid) {
      this.urgentToast(this.placement.reason ?? 'ここには置けません。');
      return false;
    }
    if (this.pending.kind === 'tinder') this.clearAshTinder();
    const can = this.sim.canAdd(this.pending.kind);
    if (!can.ok) {
      this.urgentToast(can.reason ?? '');
      return false;
    }
    const burningBefore = this.sim.phase === 'burning';
    const piece = this.sim.addPiece(this.pending.kind, this.placement, { length: this.pending.length, radius: this.pending.radius }, this.pending.shapeSeed, this.pending.species);
    this.sess.notePlaced(this.sim, piece.kind, piece.species);
    this.noteWoodForTasks(piece.kind, piece.species);
    if (burningBefore) {
      this.sess.noteCare(this.sim, 'log');
    }
    this.drainAndHandle();
    this.scene?.notifyPlaced(piece.id);
    this.pending = null;
    this.placement = null;
    this.scene?.setGhost(null);
    this.setDock(this.dockAfterPlace());
    if (this.dock !== 'prepare' && this.dock !== 'play') this.setDock(this.baseDock());
    this.persist();
    this.emit();
    return true;
  }

  private clearAshTinder(): void {
    for (const p of [...this.sim.pieces]) if (p.kind === 'tinder' && p.state === 'ash') this.sim.removePiece(p.id);
    this.sim.drainEvents();
  }

  private drainAndHandle(): void {
    const ev = this.sim.drainEvents();
    if (ev.length) {
      this.handleEvents(ev);
      this.scene?.update(this.sim, 0, ev, this.clock.paused);
    }
  }

  cancelPlace(): void {
    if (this.held) {
      this.returnHeld();
      return;
    }
    this.pending = null;
    this.placement = null;
    this.scene?.setGhost(null);
    this.setDock(this.dockAfterPlace());
    this.emit();
  }

  /** 置き終えた（やめた）後の道具箱。置いている間に火がついた・消えたときは、今の状態に合わせる */
  private dockAfterPlace(): DockView {
    const prev = this.prevDockBeforePlace;
    return prev === 'place' || prev === 'prepare' || prev === 'play' ? this.baseDock() : prev;
  }

  /** 途中の操作（置く・火ばさみ）を取り消す */
  cancelTransient(): void {
    this.scene?.setTubeAim(null);
    if (this.held) this.returnHeld();
    if (this.pending) {
      this.pending = null;
      this.placement = null;
      this.scene?.setGhost(null);
    }
    this.tongsTarget = null;
    this.scene?.setSelected(null);
  }

  // ───────────────────────────── 火ばさみ

  openTongs(): void {
    this.cancelTransient();
    this.prevDockBeforePlace = this.baseDock();
    this.setDock('tongs');
    const movable = this.movablePieces();
    this.tongsTarget = movable[0]?.id ?? null;
    this.scene?.setSelected(this.tongsTarget);
    this.audio.tongs(0.3);
    this.emit();
  }

  private movablePieces(): Piece[] {
    return this.sim.pieces.filter((p) => p.state !== 'ash').sort((a, b) => a.pose.x - b.pose.x || a.pose.z - b.pose.z);
  }

  cycleTongs(dir: 1 | -1): void {
    const list = this.movablePieces();
    if (!list.length) return;
    const i = list.findIndex((p) => p.id === this.tongsTarget);
    const next = list[(i + dir + list.length) % list.length];
    this.tongsTarget = next.id;
    this.scene?.setSelected(next.id);
    this.emit();
  }

  grabPiece(id: number | null = this.tongsTarget): void {
    if (id === null) return;
    const p = this.sim.pieces.find((q) => q.id === id);
    if (!p || p.state === 'ash') return;
    this.held = {
      id,
      orig: { ...p.pose },
      pending: { kind: p.kind, species: p.species, shapeSeed: p.shapeSeed, length: p.length, radius: p.radius },
    };
    this.sim.holdPiece(id);
    // 支えを失った薪は落ち着く
    this.sim.applyResettle(resettle(this.sim.pieces.filter((q) => q.id !== id && q.state !== 'ash')));
    this.pending = this.held.pending;
    this.ghostPos = { x: p.pose.x, z: p.pose.z, yaw: p.pose.yaw };
    this.scene?.setSelected(id);
    this.audio.tongs(clamp(p.pose.x / 0.3, -1, 1) * 0.6);
    this.setDock('tongsHold');
    this.updateGhost();
  }

  private dropHeld(): boolean {
    if (!this.held || !this.placement) return false;
    if (!this.placement.valid) {
      this.urgentToast(this.placement.reason ?? 'ここには置けません。');
      return false;
    }
    const id = this.held.id;
    const moved = Math.hypot(this.placement.pose.x - this.held.orig.x, this.placement.pose.z - this.held.orig.z);
    const wasBurning = this.sim.pieces.find((q) => q.id === id)?.state;
    this.sim.dropPiece(id, this.placement);
    this.sess.noteCare(this.sim, 'rearrange', moved);
    // 燃えている薪を、火ばさみで組み直した（見た目だけの往復は数えない）
    if ((wasBurning === 'flaming' || wasBurning === 'ember') && moved >= BALANCE.fireCare.rearrangeMinMove && this.sim.phase === 'burning') this.achieveTask('f10');
    this.sim.applyResettle(resettle(this.sim.pieces.filter((q) => q.state !== 'ash')));
    this.drainAndHandle();
    this.audio.tongs(clamp(this.placement.pose.x / 0.3, -1, 1) * 0.6);
    this.scene?.notifyPlaced(id);
    this.held = null;
    this.pending = null;
    this.placement = null;
    this.scene?.setGhost(null);
    this.tongsTarget = id;
    this.setDock('tongs');
    this.persist();
    this.emit();
    return true;
  }

  returnHeld(): void {
    if (!this.held) return;
    const h = this.held;
    const others = this.sim.pieces.filter((p) => p.id !== h.id);
    const res = computePlacement({ kind: h.pending.kind, length: h.pending.length, radius: h.pending.radius, x: h.orig.x, z: h.orig.z, yaw: h.orig.yaw }, others);
    this.sim.dropPiece(h.id, res);
    this.sim.applyResettle(resettle(this.sim.pieces.filter((q) => q.state !== 'ash')));
    this.sim.drainEvents();
    this.held = null;
    this.pending = null;
    this.placement = null;
    this.scene?.setGhost(null);
    this.setDock('tongs');
    this.emit();
  }

  removeHeld(): void {
    if (!this.held) return;
    const p = this.sim.pieces.find((q) => q.id === this.held!.id);
    if (!p || p.state === 'flaming' || p.state === 'ember') {
      this.pushToast('燃えている薪は、台の外へ出せません。');
      return;
    }
    this.sim.removePiece(p.id);
    this.sim.applyResettle(resettle(this.sim.pieces.filter((q) => q.state !== 'ash')));
    this.sim.drainEvents();
    this.held = null;
    this.pending = null;
    this.placement = null;
    this.scene?.setGhost(null);
    this.tongsTarget = null;
    this.scene?.setSelected(null);
    this.setDock('tongs');
    this.persist();
    this.emit();
  }

  closeTools(): void {
    this.cancelTransient();
    this.setDock(this.baseDock());
    this.emit();
  }

  // ───────────────────────────── 着火・送風・見守り

  ignite(): void {
    const chk = this.sim.canIgnite();
    if (!chk.ok) {
      if (chk.reason) this.urgentToast(chk.reason);
      return;
    }
    this.cancelTransient();
    if (this.sim.ignitedAt === null && this.sim.lighter.remaining <= 0) {
      this.replay = { sim: this.sim.serialize(), place: this.sessionPlace, tray: this.sessionTray, layoutId: this.sess.stats.layoutId, replays: this.replayCount };
    }
    if (this.sim.startLighter()) {
      this.audio.lighter();
      this.drainAndHandle();
      this.persist();
    }
    this.emit();
  }

  openWood(): void {
    this.cancelTransient();
    this.prevDockBeforePlace = this.baseDock();
    this.setDock('woodPick');
    this.emit();
  }

  openWind(): void {
    this.cancelTransient();
    if (!tubeUnlocked(unlockCount(this.progress))) this.windTool = 'fan';
    this.setDock('wind');
    if (this.windTool === 'tube') this.aimDefault();
    this.updateTubeMarker();
    this.emit();
  }

  /** うちわ／火吹き筒を切り替える（火吹き筒は発見の数で解放） */
  setWindTool(t: 'fan' | 'tube'): void {
    if (t === 'tube' && !tubeUnlocked(unlockCount(this.progress))) {
      this.urgentToast(`火吹き筒は、発見${BALANCE.tube.unlockAt}件で使えるようになります。`);
      return;
    }
    this.windTool = t;
    if (t === 'tube' && !this.tubeAim) this.aimDefault();
    this.updateTouchMode();
    this.updateTubeMarker();
    this.emit();
  }

  setTubeLevel(l: number): void {
    this.tubeLevel = clamp(Math.round(l), 0, BALANCE.tube.levels.length - 1);
    this.emit();
  }

  private aimDefault(): void {
    const d = defaultTubeSpot(this.sim);
    this.tubeAim = d ? { x: d.x, z: d.z, label: d.label } : null;
  }

  /** 狙う場所を順に選ぶ（左から右へ） */
  cycleTubeAim(dir: 1 | -1): void {
    const spots = tubeSpots(this.sim);
    if (!spots.length) {
      this.tubeAim = null;
    } else {
      const cur = this.tubeAim;
      let i = cur ? spots.findIndex((sp) => Math.hypot(sp.x - cur.x, sp.z - cur.z) < 0.005) : -1;
      if (i < 0 && cur) {
        // 自由に選んだ場所からは、いちばん近い候補の隣へ
        i = spots.reduce((bi, sp, k) => (Math.hypot(sp.x - cur.x, sp.z - cur.z) < Math.hypot(spots[bi].x - cur.x, spots[bi].z - cur.z) ? k : bi), 0);
      }
      const n = (i + dir + spots.length) % spots.length;
      this.tubeAim = { x: spots[n].x, z: spots[n].z, label: spots[n].label };
    }
    this.updateTubeMarker();
    this.emit();
  }

  /** 画面をタップした場所を狙う */
  aimTubeAt(x: number, z: number): void {
    const h = BALANCE.tray.innerHalf;
    if (Math.abs(x) > h || Math.abs(z) > h) return;
    const near = tubeSpots(this.sim).find((sp) => Math.hypot(sp.x - x, sp.z - z) < 0.03);
    this.tubeAim = near ? { x: near.x, z: near.z, label: near.label } : { x, z, label: '選んだ場所' };
    this.updateTubeMarker();
    this.emit();
  }

  private updateTubeMarker(): void {
    const on = this.dock === 'wind' && this.windTool === 'tube' && this.tubeAim;
    this.scene?.setTubeAim(on ? { x: this.tubeAim!.x, z: this.tubeAim!.z } : null);
  }

  blowTube(): void {
    if (!this.tubeAim) this.aimDefault();
    if (!this.tubeAim) {
      this.urgentToast('狙う場所がありません。');
      return;
    }
    const ok = this.sim.blow(this.tubeAim.x, this.tubeAim.z, this.tubeLevel);
    if (ok) {
      this.audio.blow(this.tubeLevel, clamp(this.tubeAim.x / BALANCE.tray.innerHalf, -1, 1) * 0.6);
      this.sess.noteCare(this.sim, 'blow');
    } else {
      this.urgentToast('ひと息ついてから、もう一度。');
    }
    this.updateTubeMarker();
    this.drainAndHandle();
    this.emit();
  }

  setWindLevel(l: number): void {
    this.windLevel = clamp(Math.round(l), 0, 2);
    this.emit();
  }

  setWindFrom(f: WindFrom): void {
    this.windFrom = f;
    this.emit();
  }

  gust(): void {
    const ok = this.sim.gust(this.windLevel, this.windFrom);
    if (ok) {
      this.audio.gust(this.windLevel);
      this.sess.noteCare(this.sim, 'gust');
    }
    this.drainAndHandle();
    this.emit();
  }

  /** 「しばらく、火を眺める」：道具箱を隠して火だけを見る */
  setWatch(on: boolean): void {
    this.watching = on;
    if (on) this.cancelTransient();
    this.sess.setWatching(on);
    this.emit();
  }

  // ───────────────────────────── 推奨の組み方

  runLayout(id: LayoutId): void {
    this.closeAllDialogs();
    if (this.sim.pieces.some((p) => p.state !== 'ash')) {
      this.urgentToast('組み方の見本は、台が空のときに使えます。');
      return;
    }
    this.cancelTransient();
    this.layoutQueue = { id, steps: [...LAYOUTS[id].steps], timer: 0.2 };
    this.sess.noteLayout(id);
    this.setDock('layout');
    this.emit();
  }

  private stepLayout(dt: number): void {
    const q = this.layoutQueue!;
    q.timer -= dt;
    if (q.timer > 0) return;
    const step = q.steps.shift();
    if (!step) {
      this.layoutQueue = null;
      this.setDock('prepare');
      this.pushToast(`${LAYOUTS[q.id].label}に組みました。火を灯せます。`);
      this.persist();
      return;
    }
    const r = placeStep(this.sim, step, step.kind === 'medium' ? this.prepSpecies : undefined);
    if (r.piece) {
      this.scene?.notifyPlaced(r.piece.id);
      this.sess.notePlaced(this.sim, r.piece.kind, r.piece.species);
      this.noteWoodForTasks(r.piece.kind, r.piece.species);
    }
    this.drainAndHandle();
    q.timer = step.kind === 'tinder' ? 0.55 : 0.7;
  }

  // ───────────────────────────── 新しい火・終わり

  newFire(): void {
    this.closeAllDialogs();
    this.cancelTransient();
    this.layoutQueue = null;
    this.sim = new FireSim(newSeed(), this.settings.mode);
    this.sess = new FireSession(this.sim.seed, this.sim.session.durationSeconds);
    this.scene?.reset();
    this.replay = null;
    this.replayCount = 0;
    this.sessionPlace = this.allowedPlace(this.settings.place);
    this.sessionTray = this.allowedTray(this.settings.tray);
    this.applyOutfit();
    this.seenSpread = { kindling: false, medium: false, large: false };
    this.woodNoted = new Set();
    this.watching = false;
    this.keepsake = null;
    this.keepsakeDue = null;
    this.memoryName = null;
    if (this.memory?.cardUrl) URL.revokeObjectURL(this.memory.cardUrl);
    this.memory = null;
    this.clock = new GameClock();
    clearSession();
    this.setDock('prepare');
    this.emit();
  }

  /**
   * 「今回の組合せでもう一度」：薪の初期構成・場所・焚き火台・組み方・モード・乱数seedを再利用して、着火の直前から。
   * 思い出の名前と結びの一文の乱数は変える。プレイヤーの選択が変われば結果も変わる。
   */
  replaySame(): void {
    const r = this.replay;
    if (!r) return;
    this.newFire();
    try {
      this.sim = FireSim.deserialize(r.sim);
      this.replayCount = r.replays + 1;
      this.sess = new FireSession(hash32(`${this.sim.seed}:replay:${this.replayCount}`), this.sim.session.durationSeconds);
      if (r.layoutId) this.sess.noteLayout(r.layoutId);
      for (const p of this.sim.pieces) this.sess.notePlaced(this.sim, p.kind, p.species);
      this.sessionPlace = this.allowedPlace(r.place);
      this.sessionTray = this.allowedTray(r.tray);
      this.replay = { ...r, replays: this.replayCount };
      this.applyOutfit();
      this.setDock('prepare');
      this.pushToast('同じ組合せで、もう一度。準備ができたら火を灯そう。');
      this.persist();
    } catch {
      this.pushToast('前回の組合せを再現できませんでした。新しい火から始めます。');
    }
    this.emit();
  }

  /** 「今日はここまで」：15秒の消火・別れ演出のあと思い出へ（引き止めない） */
  endTonight(): void {
    this.closeAllDialogs();
    this.clock.resume('user');
    this.cancelTransient();
    this.watching = false;
    if (this.sim.ignitedAt === null) {
      // まだ火をつけていない：台を片付けるだけ
      this.newFire();
      this.pushToast('今夜の火は、またいつでも。');
      return;
    }
    if (this.sess.ended) {
      this.onSessionEnd();
      return;
    }
    // すでに見送りが始まっている（最後の10秒）：そのまま見送る
    if (this.sess.farewell) {
      this.setDock('farewell');
      this.emit();
      return;
    }
    this.sim.addTimeline('今日はここまで（途中で見送りました）');
    this.handleSession(this.sess.beginManualFarewell(this.sim));
    this.sim.beginExtinguish();
    this.setDock('farewell');
    this.persist();
    this.emit();
  }

  // ───────────────────────────── 思い出

  private onSessionEnd(): void {
    this.cancelTransient();
    this.watching = false;
    const data = buildMemory(this.sim, this.sess, new Date(), this.placeLabel);
    if (this.memoryName) data.fireName = this.memoryName;
    this.memory = { data, card: null, cardUrl: null, busy: true, saved: 'no', imageSaved: false };
    this.setDock('memory');
    this.persist();
    this.emit();
    void this.buildCard();
  }

  private async buildCard(): Promise<void> {
    const m = this.memory;
    if (!m) return;
    m.busy = true;
    this.emit();
    let card: Blob | null = null;
    try {
      let photo = this.keepsake?.photo ?? null;
      if (!photo) {
        // 再開した場合など：保存しておいた絵、なければ今の画面
        const stored = await getThumb(`keepsake:${this.sess.seed}`).catch(() => null);
        if (stored) photo = { blob: stored, focus: null, aspect: 1 };
        else photo = (await this.scene?.captureFrame().catch(() => null)) ?? null;
      }
      const frame = this.settings.frame !== 'paper' && unlockedDecors(unlockCount(this.progress)).includes(this.settings.frame) ? this.settings.frame : 'paper';
      card = await renderMemoryCard(m.data, photo, frame);
    } catch {
      card = null;
    }
    if (this.memory !== m) return;
    if (m.cardUrl) URL.revokeObjectURL(m.cardUrl);
    m.card = card;
    m.cardUrl = card ? URL.createObjectURL(card) : null;
    // 画像を作れなくても、記録と文章は残せる（ボタンを止めたままにしない）
    m.cardFailed = !card;
    m.busy = false;
    this.emit();
  }

  private renameTimer = 0;

  renameMemory(name: string): void {
    const m = this.memory;
    if (!m) return;
    const v = clampName(name);
    m.data = { ...m.data, fireName: v || this.sess.fireName };
    this.memoryName = v || null;
    m.saved = m.saved === 'yes' ? 'no' : m.saved;
    window.clearTimeout(this.renameTimer);
    this.renameTimer = window.setTimeout(() => void this.buildCard(), 350);
    this.emit();
  }

  /** 思い出を残す：アルバムへ記録し、画像を保存する */
  async saveMemory(): Promise<void> {
    const m = this.memory;
    if (!m || m.busy || (!m.card && !m.cardFailed)) return;
    const entry: AlbumEntry = {
      id: m.data.id,
      savedAt: new Date().toISOString(),
      dateLabel: m.data.dateLabel,
      fireName: m.data.fireName,
      characterId: null,
      characterLabel: null,
      stageName: null,
      woods: m.data.woods,
      place: m.data.place,
      layout: m.data.layout,
      howRaised: m.data.howRaised,
      lastLine: m.data.closing,
      minutes: m.data.minutes,
      reason: m.data.reason,
      mood: m.data.mood,
      favorite: false,
      provisional: false,
    };
    const r = this.storageOk ? addToAlbum(entry) : 'failed';
    if (r === 'full') {
      m.saved = 'full';
      this.pushToast('アルバムがいっぱいです（100件）。手帳の「思い出」で整理してください。');
    } else if (r === 'failed') {
      m.saved = 'failed';
      this.urgentToast('保存できませんでした。もう一度試してください。');
    } else {
      m.saved = 'yes';
      this.audio.record();
      if (this.memoryName) this.achieveTask('t23');
      if (!this.progress.memoryPlaces.includes(this.sessionPlace)) {
        this.progress.memoryPlaces.push(this.sessionPlace);
        this.saveProgressNow();
      }
      if (this.progress.memoryPlaces.length >= 6) this.achieveTask('t24');
      if (loadAlbum().length >= BALANCE.discovery.albumCount) this.achieveTask('f13');
      const thumb = m.card ? await makeThumb(m.card).catch(() => null) : null;
      if (thumb) await putThumb(entry.id, thumb);
      this.album = loadAlbum();
      this.pushToast(m.card ? '思い出を保存しました。' : '思い出を保存しました（画像は作れなかったため、記録だけ）。');
    }
    // 画像はいつでも端末へ保存できる（アルバムが保存できなくても）
    if (m.card) m.imageSaved = (await this.deliverImage(m.card, `takibi-memory-${m.data.id}.png`, false)) || m.imageSaved;
    this.emit();
  }

  /** シェア：ファイル共有に対応していれば端末の共有メニュー。なければ画像保存と文章コピー */
  async shareMemory(): Promise<void> {
    const m = this.memory;
    if (!m || m.busy) return;
    const text = shareText(m.data);
    if (!m.card) {
      // 画像を作れなかったときは、文章だけコピーできる
      if (m.cardFailed) await this.copyText(text);
      return;
    }
    const file = new File([m.card], `takibi-memory-${m.data.id}.png`, { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    try {
      if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], text });
        return;
      }
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return; // キャンセルは失敗にしない
    }
    this.pushToast('思い出の画像を保存できます。');
    await this.deliverImage(m.card, file.name, true);
    await this.copyText(text);
  }

  async copyText(text?: string): Promise<boolean> {
    const t = text ?? (this.memory ? shareText(this.memory.data) : '');
    try {
      await navigator.clipboard.writeText(t);
      this.pushToast('文章をコピーしました。');
      return true;
    } catch {
      this.pushToast('この画面ではコピーできませんでした。文章を選んでコピーしてください。');
      return false;
    }
  }

  get canShareFiles(): boolean {
    try {
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      return !!nav.canShare && nav.canShare({ files: [new File([new Blob(['x'])], 'x.png', { type: 'image/png' })] });
    } catch {
      return false;
    }
  }

  removeAlbumEntry(id: string): void {
    if (removeFromAlbum(id)) {
      void deleteThumb(id);
      const u = this.thumbUrls.get(id);
      if (u) URL.revokeObjectURL(u);
      this.thumbUrls.delete(id);
    } else this.pushToast('お気に入りの記録は消せません。先にお気に入りを外してください。');
    this.album = loadAlbum();
    this.emit();
  }

  toggleAlbumFavorite(id: string): void {
    toggleFavorite(id);
    this.album = loadAlbum();
    this.emit();
  }

  /** 手帳を開いたときに、アルバムの小さな画像を読み込む */
  loadAlbumThumbs(): void {
    for (const e of this.album) {
      if (this.thumbUrls.has(e.id)) continue;
      this.thumbUrls.set(e.id, '');
      void getThumb(e.id).then((b) => {
        if (b) {
          this.thumbUrls.set(e.id, URL.createObjectURL(b));
          this.emit();
        }
      });
    }
  }

  async takePhoto(): Promise<void> {
    if (!this.scene) return;
    // 写真には置き位置の見本や選んだ薪の輪郭を入れない
    if (this.pending || this.held || this.scene.busyOverlay) {
      this.cancelTransient();
      this.scene.setGhost(null);
      this.scene.setSelected(null);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    const blob = await this.scene.capture();
    if (!blob) {
      this.pushToast('画像を作れませんでした。');
      return;
    }
    this.audio.record();
    await this.deliverImage(blob, `takibi-${stamp()}.png`, true);
  }

  // ───────────────────────────── 記録の書き出し・読み込み

  /** これまでの発見と思い出のアルバム（小さな画像つき）を、JSONファイルとして端末へ保存する */
  async exportRecords(): Promise<void> {
    if (this.recordBusy) return;
    this.recordBusy = true;
    this.dirty = true;
    try {
      const album = loadAlbum();
      const thumbs: Record<string, string> = {};
      for (const e of album) {
        const b = await getThumb(e.id);
        const d = b ? await blobToDataUrl(b) : null;
        if (d) thumbs[e.id] = d;
      }
      const file = buildRecordFile(this.progress, album, thumbs);
      const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
      const ok = await this.deliverFile(blob, `takibi-record-${stamp()}.json`, '記録を書き出しました。');
      if (ok) this.recordNote = `書き出し：発見${taskCount(this.progress)}件・思い出${album.length}件`;
    } finally {
      this.recordBusy = false;
      this.dirty = true;
      this.emit();
    }
  }

  /**
   * 記録ファイルを読み込み、今の記録へ足し合わせる（消さない・黙って上書きしない）。
   * 壊れたファイルなら何も変えない。
   */
  async importRecords(file: File): Promise<void> {
    if (this.recordBusy) return;
    if (!this.storageOk) {
      this.pushToast('この環境では記録を保存できないため、読み込めません。');
      return;
    }
    if (file.size > RECORD_MAX_BYTES) {
      this.recordNote = 'ファイルが大きすぎます。';
      this.pushToast(this.recordNote);
      this.emit();
      return;
    }
    this.recordBusy = true;
    this.dirty = true;
    this.emit();
    try {
      const text = await file.text();
      const r = parseRecordFile(text);
      if (!r.ok) {
        this.recordNote = r.reason;
        this.pushToast(r.reason);
        return;
      }
      // 画像を先に入れる（まだない思い出の分だけ）。待つのはここまで
      const have = new Set(loadAlbum().map((e) => e.id));
      const wrote: string[] = [];
      for (const e of r.file.album) {
        if (have.has(e.id)) continue;
        const d = r.file.thumbs[e.id];
        const b = d ? dataUrlToBlob(d) : null;
        if (b && (await putThumb(e.id, b))) wrote.push(e.id);
      }
      // ここから先は待たずに：直前の記録へ足し合わせ、アルバム→発見の順に書く（途中で失敗しても、今の記録は壊さない）
      const before = taskCount(this.progress);
      const unlockBefore = unlockCount(this.progress);
      const merged = mergeProgress(this.progress, r.file.progress);
      const am = mergeAlbum(loadAlbum(), r.file.album);
      for (const id of wrote) if (!am.added.includes(id)) void deleteThumb(id);
      if (!replaceAlbum(am.entries)) {
        for (const id of wrote) void deleteThumb(id);
        this.recordNote = '思い出を保存できませんでした。今の記録はそのままです。';
        this.pushToast(this.recordNote);
        return;
      }
      const progressSaved = saveProgress(merged);
      this.progress = merged;
      this.album = loadAlbum();
      for (const u of this.thumbUrls.values()) URL.revokeObjectURL(u);
      this.thumbUrls.clear();
      const after = taskCount(merged);
      const parts = [`発見 +${after - before}件`, `思い出 +${am.added.length}件`];
      const extra = [am.same ? `同じ思い出${am.same}件はまとめました` : '', r.dropped ? `読めない思い出${r.dropped}件は外しました` : ''].filter(Boolean).join('・');
      this.recordNote = `読み込み：${parts.join('・')}${extra ? `（${extra}）` : ''}${progressSaved ? '' : '。発見は保存できませんでした（この画面の間だけ有効）'}`;
      this.pushToast(`記録を読み込みました：${parts.join('・')}`);
      if (!progressSaved) this.urgentToast('発見を保存できませんでした。');
      if (am.skipped) this.pushToast(`アルバムが100件に達したため、${am.skipped}件は取り込みませんでした。`);
      // 解放は、以前の版の記録の数（unlockFloor）も含めた数で知らせる
      const unlocked = newUnlockLabels(unlockBefore, unlockCount(merged));
      if (unlocked.length) this.pushToast(`解放：${unlocked.join('、')}`);
      this.applyOutfit();
    } catch {
      this.recordNote = '読み込めませんでした。今の記録はそのままです。';
      this.pushToast(this.recordNote);
    } finally {
      this.recordBusy = false;
      this.dirty = true;
      this.emit();
    }
  }

  /** ファイルを端末へ（画像以外）。claude.ai の公開ページでは downloads 機能 */
  private async deliverFile(blob: Blob, name: string, done: string): Promise<boolean> {
    const rt = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
    if (rt?.use) {
      type Downloads = { save: (r: { filename: string; data: Blob }) => Promise<unknown> };
      let dl: Downloads | null = null;
      try {
        dl = (await rt.use('downloads')) as Downloads | null;
      } catch {
        dl = null;
      }
      if (dl) {
        try {
          await dl.save({ filename: name, data: blob });
          this.pushToast(done);
          return true;
        } catch (e) {
          const code = (e as { code?: string })?.code;
          if (code === 'declined') return false;
          this.pushToast(code === 'rate_limited' ? '少し待ってから、もう一度。' : 'この画面ではファイルを保存できませんでした。');
          return false;
        }
      }
    }
    downloadBlob(blob, name);
    this.pushToast(done);
    return true;
  }

  // ───────────────────────────── 動作チェック（実機の確認用）

  private check: DeviceCheck | null = null;
  private checkDevice: Promise<void> = Promise.resolve();
  private checkReport: string | null = null;
  private checkAdaptSeen = 0;
  private checkShownSec = -1;

  private checkStats() {
    const st = this.scene?.stats();
    return { fps: st?.fps ?? 0, dpr: st?.dpr ?? 1, quality: st?.quality ?? '—', drawCalls: st?.drawCalls ?? 0, triangles: st?.triangles ?? 0 };
  }

  private checkState() {
    return {
      phase: this.sim.phase,
      burning: this.sim.phase === 'burning' && !this.sim.session.ended,
      paused: this.clock.paused,
      pieces: this.sim.pieces.filter((p) => p.state !== 'ash').length,
      place: this.placeLabel,
      mode: this.sim.session.mode === 'long' ? 'ゆっくり20分' : 'ひと息10分',
    };
  }

  /** 遊んでいる画面のまま、seconds 秒はかる。どこへも送らない */
  startDeviceCheck(seconds: number): void {
    if (!this.scene) return;
    this.closeAllDialogs();
    this.checkReport = null;
    const now = performance.now();
    this.check = new DeviceCheck({ seconds, now, gameSeconds: this.sim.time, stats: this.checkStats(), state: this.checkState(), droppedSteps: this.clock.droppedSteps });
    this.checkAdaptSeen = this.scene.adaptLog.length;
    const chk = this.check;
    this.checkDevice = collectDevice(this.scene.glContext())
      .then((d) => {
        chk.device = d;
      })
      .catch(() => undefined);
    window.addEventListener('pointerdown', this.onCheckInput, { capture: true, passive: true });
    this.pushToast(`動作チェックを始めました（${seconds >= 120 ? `${Math.round(seconds / 60)}分` : `${seconds}秒`}）。いつもどおり遊んでください。`);
    this.emit();
  }

  cancelDeviceCheck(): void {
    if (!this.check || this.check.done) return;
    this.check.cancelled = true;
    this.finishCheck(performance.now());
  }

  private onCheckInput = (e: PointerEvent) => {
    this.check?.input(e.timeStamp);
  };

  private tickCheck(now: number): void {
    const chk = this.check;
    if (!chk || chk.done || !this.scene) return;
    chk.frame(now, this.clock.paused || this.sess.ended, this.sim.time, this.clock.droppedSteps);
    const log = this.scene.adaptLog;
    for (; this.checkAdaptSeen < log.length; this.checkAdaptSeen++) chk.noteAdapt(log[this.checkAdaptSeen].at, log[this.checkAdaptSeen].what, log[this.checkAdaptSeen].fps);
    const left = Math.ceil(chk.remaining(now));
    if (left !== this.checkShownSec) {
      this.checkShownSec = left;
      this.dirty = true;
    }
    if (left <= 0) this.finishCheck(now);
  }

  private finishCheck(now: number): void {
    const chk = this.check;
    if (!chk || chk.done) return;
    window.removeEventListener('pointerdown', this.onCheckInput, { capture: true });
    chk.finish({ now, gameSeconds: this.sim.time, stats: this.checkStats(), state: this.checkState(), droppedSteps: this.clock.droppedSteps });
    // 端末の情報がまだ届いていなければ、少しだけ待ってからまとめる（取れなければ、その項目なしで出す）
    void Promise.race([this.checkDevice, new Promise((r) => setTimeout(r, 1500))]).then(() => this.showCheckReport(chk));
  }

  private showCheckReport(chk: DeviceCheck): void {
    if (this.check !== chk) return;
    const qLabel: Record<string, string> = { auto: '自動', low: '軽量', standard: '標準', high: '高品質' };
    const tLabel: Record<string, string> = { normal: '標準', large: '大きめ', xlarge: 'とても大きい' };
    this.checkReport = chk.report(
      {
        qualitySetting: qLabel[this.settings.quality] ?? this.settings.quality,
        soundEnabled: this.audio.enabled,
        audioState: this.audio.stateLabel,
        audioLatencyMs: this.audio.outputLatencyMs,
        sceneInitMs: this.sceneInitMs,
        reducedMotion: this.settings.reducedMotion,
        textSize: tLabel[this.settings.textSize] ?? this.settings.textSize,
      },
      APP_VERSION,
    );
    this.openDialog('deviceCheck');
    this.emit();
  }

  /** 結果をクリップボードへ。できなければ false（画面で選んでコピーしてもらう） */
  async copyCheckReport(): Promise<boolean> {
    const text = this.checkReport;
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      this.pushToast('結果をコピーしました。');
      this.emit();
      return true;
    } catch {
      this.pushToast('コピーできませんでした。結果の文章を長押し（選択）してコピーしてください。');
      this.emit();
      return false;
    }
  }

  async saveCheckReport(): Promise<void> {
    if (!this.checkReport) return;
    await this.deliverFile(new Blob([this.checkReport], { type: 'text/plain;charset=utf-8' }), `takibi-check-${stamp()}.txt`, '結果を保存しました。');
    this.emit();
  }

  private recordBusy = false;
  private recordNote: string | null = null;

  /** 画像を端末へ：claude.ai の公開ページでは downloads 機能、それ以外は共有メニューかダウンロード。保存・共有できたら true */
  private async deliverImage(blob: Blob, name: string, tryShare: boolean): Promise<boolean> {
    const file = new File([blob], name, { type: blob.type || 'image/png' });
    // claude.ai の公開ページ内では、ページから直接ダウンロードできないため downloads 機能を使う
    const rt = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
    if (rt?.use) {
      type Downloads = { save: (r: { filename: string; data: Blob }) => Promise<unknown> };
      let dl: Downloads | null = null;
      try {
        dl = (await rt.use('downloads')) as Downloads | null;
      } catch {
        dl = null;
      }
      if (dl) {
        try {
          await dl.save({ filename: file.name, data: blob });
          this.pushToast('画像を保存しました。');
          return true;
        } catch (e) {
          const code = (e as { code?: string })?.code;
          if (code === 'declined') return false;
          this.pushToast(code === 'rate_limited' ? '少し待ってから、もう一度。' : 'この画面では画像を保存できませんでした。');
        }
        return false;
      }
    }
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    try {
      if (tryShare && nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], text: '今夜の焚き火。 #焚き火とひと息' });
        return true;
      }
    } catch (e) {
      // 共有のキャンセルはエラー扱いにしない
      if ((e as DOMException)?.name === 'AbortError') return false;
    }
    downloadBlob(file, file.name);
    this.pushToast('画像を保存しました。');
    return true;
  }

  // ───────────────────────────── 保存・再開

  persist(): boolean {
    if (!this.storageOk) return false;
    if (this.sim.pieces.length === 0) {
      clearSession();
      return true;
    }
    const ok = saveSession(this.sessionData());
    this.noteSaveResult(ok);
    return ok;
  }

  private saveFails = { session: false, progress: false };
  private saveFailNotified = false;

  private get saveFailed(): boolean {
    return this.saveFails.session || this.saveFails.progress;
  }

  /** 保存に失敗したら一度だけ知らせる（遊び続けられる。今までの記録は消さない）。途中の火と発見は別々に見る */
  private noteSaveResult(ok: boolean, what: 'session' | 'progress' = 'session'): void {
    if (ok) {
      if (this.saveFails[what]) {
        this.saveFails[what] = false;
        this.dirty = true;
      }
      return;
    }
    this.saveFails[what] = true;
    this.dirty = true;
    if (!this.saveFailNotified) {
      this.saveFailNotified = true;
      this.urgentToast('保存できませんでした（端末の保存容量がいっぱいかもしれません）。遊ぶことはできます。今までの記録は消えていません。', 8000);
    }
  }



  acceptResume(): void {
    const saved = this.pendingResume;
    this.pendingResume = null;
    this.closeAllDialogs();
    if (saved) {
      try {
        this.sim = FireSim.deserialize(saved.sim);
        if (saved.session) this.sess = FireSession.deserialize(saved.session);
        // 前の版（キャラクターがいた版）：見送りとその回の記録だけを引き継ぐ
        else if (saved.companion) this.sess = FireSession.fromLegacy(saved.companion);
        else {
          // 第0段階の保存データ：置いた薪から、薪の種類と細薪の使用を組み立て直す（組み方は不明）
          this.sess = new FireSession(this.sim.seed, this.sim.session.durationSeconds);
          for (const p of this.sim.pieces) this.sess.notePlaced(this.sim, p.kind, p.species);
        }
        this.memoryName = saved.memoryName ?? null;
        const o = (saved as { outfit?: { place?: PlaceId; tray?: TrayId } }).outfit;
        this.sessionPlace = this.allowedPlace(o?.place ?? this.settings.place);
        this.sessionTray = this.allowedTray(o?.tray ?? this.settings.tray);
        this.replay = (saved as { replay?: GameController['replay'] }).replay ?? null;
        this.replayCount = this.replay?.replays ?? 0;
        this.applyOutfit();
        this.scene?.reset();
        this.scene?.importVisual(saved.visual);
        this.seenSpread = {
          kindling: this.sim.pieces.some((p) => p.kind === 'kindling' && p.firstLitAt !== null),
          medium: this.sim.pieces.some((p) => p.kind === 'medium' && p.firstLitAt !== null),
          large: this.sim.pieces.some((p) => p.kind === 'large' && p.firstLitAt !== null),
        };
        this.woodNoted = new Set(this.sim.pieces.filter((p) => isLog(p.kind) && p.firstLitAt !== null).map((p) => p.species));
        this.setDock(this.baseDock());
        if (this.sess.ended) this.onSessionEnd();
        else if (this.sess.farewell) this.setDock('farewell');
        else if (this.sim.phase === 'burning') this.pushToast('おかえりなさい。火は、続きから。');
      } catch {
        this.pushToast('前回の火を復元できませんでした。新しい火から始めます。');
        this.newFire();
      }
    }
    this.clock.resume('resume');
    if (this.settings.soundEnabled === null && this.audio.supported) this.openDialog('sound');
    else if (this.settings.soundEnabled) void this.setSound(true);
    this.emit();
  }

  declineResume(): void {
    this.pendingResume = null;
    this.closeAllDialogs();
    this.clock.resume('resume');
    this.newFire();
    if (this.settings.soundEnabled === null && this.audio.supported) this.openDialog('sound');
  }

  // ───────────────────────────── 入力（ポインタ・キーボード）

  private pointer: { id: number; x: number; y: number; moved: boolean; onScene: boolean } | null = null;
  private cardDrag: { kind: PieceKind; species?: WoodId; started: boolean } | null = null;
  private sceneEl: HTMLElement | null = null;

  private updateTouchMode(): void {
    if (!this.sceneEl) return;
    const interactive = this.dock === 'place' || this.dock === 'tongs' || this.dock === 'tongsHold' || (this.dock === 'wind' && this.windTool === 'tube');
    this.sceneEl.classList.toggle('interactive', interactive);
  }

  private attachPointer(el: HTMLElement): void {
    this.sceneEl = el;
    el.addEventListener('pointerdown', (e) => {
      if (!this.scene || this.dialog) return;
      if (this.dock !== 'place' && this.dock !== 'tongs' && this.dock !== 'tongsHold' && !(this.dock === 'wind' && this.windTool === 'tube')) return;
      this.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, onScene: true };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      if (this.dock === 'place' || this.dock === 'tongsHold') {
        const hit = this.scene.pickFloor(e.clientX, e.clientY);
        if (hit) this.moveGhostTo(hit.x, hit.z);
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.scene) return;
      if (this.pointer && this.pointer.id === e.pointerId) {
        if (Math.hypot(e.clientX - this.pointer.x, e.clientY - this.pointer.y) > 8) this.pointer.moved = true;
        if (this.dock === 'place' || this.dock === 'tongsHold') {
          const hit = this.scene.pickFloor(e.clientX, e.clientY);
          if (hit) this.moveGhostTo(hit.x, hit.z);
        }
      } else if (this.dock === 'tongs' && e.pointerType === 'mouse') {
        this.scene.setHover(this.scene.pickPiece(e.clientX, e.clientY));
      }
    });
    const end = (e: PointerEvent) => {
      if (!this.scene || !this.pointer || this.pointer.id !== e.pointerId) return;
      const p = this.pointer;
      this.pointer = null;
      if (this.dock === 'wind') {
        // 火吹き筒：タップした場所を狙う（吹くのはボタンで）
        if (!p.moved) {
          const hit = this.scene.pickFloor(e.clientX, e.clientY);
          if (hit) this.aimTubeAt(hit.x, hit.z);
        }
        return;
      }
      if (this.dock === 'tongs') {
        const id = this.scene.pickPiece(e.clientX, e.clientY);
        if (id !== null) {
          this.tongsTarget = id;
          this.grabPiece(id);
        }
        return;
      }
      // ドラッグして指を離したら、そこへ置く（タップは位置の指定だけ）
      if (p.moved && (this.dock === 'place' || this.dock === 'tongsHold') && e.type === 'pointerup') this.confirmPlace();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    // 道具箱のカードからドラッグ
    window.addEventListener('pointermove', (e) => {
      if (!this.cardDrag || !this.scene) return;
      const hit = this.scene.pickFloor(e.clientX, e.clientY);
      const r = el.getBoundingClientRect();
      const inside = e.clientY < r.bottom && e.clientY > r.top;
      if (!this.cardDrag.started && hit && inside) {
        this.cardDrag.started = true;
        this.selectKind(this.cardDrag.kind, this.cardDrag.species);
      }
      if (this.cardDrag.started && hit) this.moveGhostTo(hit.x, hit.z);
    });
    window.addEventListener('pointerup', (e) => {
      if (!this.cardDrag) return;
      const d = this.cardDrag;
      this.cardDrag = null;
      if (!d.started) return;
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (target && el.contains(target)) this.confirmPlace();
    });
  }

  /** 道具箱のカードを押したまま動かし始めたとき */
  beginCardDrag(kind: PieceKind, species?: WoodId): void {
    this.cardDrag = { kind, species, started: false };
  }

  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (this.dialog) return;
    if (this.watching && (e.key === 'Escape' || e.key === 'Enter')) {
      this.setWatch(false);
      e.preventDefault();
      return;
    }
    const step = e.shiftKey ? 0.03 : 0.01;
    if (this.dock === 'place' || this.dock === 'tongsHold') {
      const map: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (map[e.key]) {
        this.nudge(...map[e.key]);
        e.preventDefault();
      } else if (e.key === '[') this.cycleSpot(-1);
      else if (e.key === ']') this.cycleSpot(1);
      else if (e.key === 'q' || e.key === 'Q') this.rotate(15);
      else if (e.key === 'e' || e.key === 'E' || e.key === 'r' || e.key === 'R') this.rotate(-15);
      else if (e.key === 'Enter' && !(t && t.tagName === 'BUTTON')) {
        this.confirmPlace();
        e.preventDefault();
      } else if (e.key === 'Escape') this.cancelPlace();
    } else if (this.dock === 'tongs') {
      if (e.key === 'ArrowRight' || e.key === ']') this.cycleTongs(1);
      else if (e.key === 'ArrowLeft' || e.key === '[') this.cycleTongs(-1);
      else if (e.key === 'Enter' && !(t && t.tagName === 'BUTTON')) this.grabPiece();
      else if (e.key === 'Escape') this.closeTools();
    } else if (this.dock === 'wind' && this.windTool === 'tube') {
      if (e.key === 'ArrowRight' || e.key === ']') this.cycleTubeAim(1);
      else if (e.key === 'ArrowLeft' || e.key === '[') this.cycleTubeAim(-1);
      else if (e.key === 'w' || e.key === 'W' || e.key === 'b' || e.key === 'B') this.blowTube();
      else if (e.key === 'Escape') this.closeTools();
    } else if (this.dock === 'wind') {
      if (e.key === 'w' || e.key === 'W') this.gust();
      else if (e.key === 'Escape') this.closeTools();
    } else if (e.key === 'Escape' && (this.dock === 'woodPick' || this.dock === 'layout')) this.closeTools();
  };

  // ───────────────────────────── 表示用の状態

  private buildSnapshot(): UIState {
    const sim = this.sim;
    const m = sim.metrics;
    const counts = { tinder: sim.countOf('tinder'), kindling: sim.countOf('kindling'), medium: sim.countOf('medium'), large: sim.countOf('large') };
    const pend = this.pending;
    const heldPiece = this.held ? sim.pieces.find((p) => p.id === this.held!.id) : null;
    const target = this.tongsTarget !== null ? sim.pieces.find((p) => p.id === this.tongsTarget) : null;
    let placementUI: UIState['placement'] = null;
    if (this.placement && pend) {
      const air = this.estimateAir();
      placementUI = {
        valid: this.placement.valid,
        reason: this.placement.reason,
        supports: describeSupports(this.placement),
        air: air >= 0.8 ? 'すっきり' : air >= 0.55 ? 'ほどよい' : '詰まりぎみ',
        clamped: this.placement.clamped,
        compress: this.placement.compressesTinder !== null,
      };
    }
    return {
      ready: this.ready,
      webglError: this.webglError,
      dock: this.dock,
      dialog: this.dialog,
      watching: this.watching,
      phase: sim.phase,
      counts,
      max: { tinder: BALANCE.pieces.tinder.maxCount, kindling: BALANCE.pieces.kindling.maxCount, medium: BALANCE.pieces.medium.maxCount, large: BALANCE.pieces.large.maxCount },
      logs: { used: counts.medium + counts.large, max: BALANCE.logs.maxTotal },
      largeUnlocked: !BALANCE.logs.largeNeedsStage0 || sim.stage0Done,
      pending: pend ? { kind: pend.kind, species: pend.species } : null,
      placement: placementUI,
      held: heldPiece
        ? { id: heldPiece.id, label: pieceLabel(heldPiece), burning: heldPiece.state === 'flaming' || heldPiece.state === 'ember', removable: heldPiece.state === 'raw' || heldPiece.state === 'warming' }
        : null,
      tongsTarget: target ? { id: target.id, label: pieceLabel(target) } : null,
      canIgnite: sim.canIgnite(),
      lighterActive: sim.lighter.remaining > 0,
      guide: this.guide(),
      status: this.status(),
      memory: this.memory
        ? { data: this.memory.data, cardUrl: this.memory.cardUrl, busy: this.memory.busy, cardFailed: !!this.memory.cardFailed, saved: this.memory.saved, imageSaved: this.memory.imageSaved, share: shareText(this.memory.data), canShareFiles: this.canShareFilesCached }
        : null,
      record: {
        stableSeconds: this.sess.stats.stableSeconds,
        windowSeconds: this.sess.stats.windowSeconds,
        watchSeconds: this.sess.stats.watchSeconds,
        maxHeat: this.sess.stats.maxHeat,
        care: this.sess.careCount,
        species: this.sess.stats.species.length,
      },
      progress: (() => {
        const count = taskCount(this.progress);
        const unlock = unlockCount(this.progress);
        return {
          count,
          unlock,
          tasks: TASKS.map((t) => ({ id: t.id, label: t.label, hint: t.hint, done: this.progress.tasks[t.id] ?? null })),
          woods: unlockedWoods(unlock),
          places: unlockedPlaces(unlock),
          trays: unlockedTrays(unlock),
          decors: unlockedDecors(unlock),
          woodsUsed: this.progress.woodsUsed.length,
        };
      })(),
      outfit: { place: this.sessionPlace, placeLabel: this.placeLabel, tray: this.sessionTray, mode: this.sim.session.mode, locked: this.outfitLocked },
      canReplay: !!this.replay && !!this.memory,
      album: this.album.map((e) => ({ ...e, thumbUrl: this.thumbUrls.get(e.id) || null })),
      toasts: this.toasts,
      sound: { enabled: this.audio.enabled, needsResume: this.audio.needsResume, supported: this.audio.supported },
      settings: this.settings,
      reduceMotion: this.reducedMotion,
      prepSpecies: this.prepSpecies,
      canEnd: sim.ignitedAt !== null && sim.phase === 'burning' && !sim.session.ended && !this.sess.farewell && !this.sess.ended,
      wind: {
        level: this.windLevel,
        from: this.windFrom,
        active: sim.wind.gustT >= 0,
        tool: this.windTool,
        tubeUnlocked: tubeUnlocked(unlockCount(this.progress)),
        tubeLevel: this.tubeLevel,
        tubeAim: this.tubeAim?.label ?? null,
        tubeReady: sim.time - sim.tube.lastAt >= BALANCE.tube.minInterval,
        tubeActive: sim.tube.t >= 0,
      },
      session: { activeTime: sim.session.activeTime, duration: sim.endTime, emberPhase: sim.session.emberPhase, ended: sim.session.ended },
      stage0Done: sim.stage0Done,
      metrics: { heat: m.heat, oxygen: m.oxygen, smoke: m.smoke, fuel: m.fuelRatio, stableSeconds: this.sess.stats.stableSeconds },
      words: {
        heat: m.heat < 1 ? 'まだ火はない' : m.heat < 30 ? '小さめ' : m.heat < 60 ? 'ほどよい' : m.heat < 85 ? '強め' : '強すぎ',
        oxygen: m.oxygen < BALANCE.stable.oxygenMin ? '少なめ' : m.oxygen <= BALANCE.stable.oxygenMax ? 'すっきり' : '送りすぎ',
        smoke: m.smoke < 25 ? '薄い' : m.smoke < 50 ? 'ふつう' : 'もくもく',
        fuel: m.fuelRatio < 0.2 ? '心細い' : m.oxygen < BALANCE.stable.oxygenMin && m.fuelRatio > 0.85 ? '詰まりぎみ' : 'じゅうぶん',
      },
      pieces: sim.pieces
        .filter((p) => p.state !== 'ash' || p.kind === 'tinder')
        .map((p) => ({
          id: p.id,
          label: pieceLabel(p),
          state: p.state,
          stateLabel: BURN_STATE_LABEL[p.state],
          temp: Math.max(...p.segs.map((s) => s.T)),
          char: p.segs.reduce((a, s) => a + s.c, 0) / p.segs.length,
          fuel: p.segs.reduce((a, s) => a + s.f, 0) / p.segs.reduce((a, s) => a + s.f0, 0),
          air: p.segs.reduce((a, s) => a + s.air, 0) / p.segs.length,
          moisture: p.segs.reduce((a, s) => a + s.m, 0) / p.segs.length,
        })),
      timeline: sim.timeline.slice(-40),
      layoutRunning: this.layoutQueue?.id ?? null,
      storageOk: this.storageOk,
      saveFailed: this.saveFailed,
      records: { busy: this.recordBusy, note: this.recordNote },
      check: { running: !!this.check && !this.check.done, remaining: this.check && !this.check.done ? Math.ceil(this.check.remaining(performance.now())) : 0, seconds: this.check?.duration ?? 0, report: this.checkReport },
      // 振動は、指で触る端末で使えるときだけ（PCのブラウザにも関数はあるが、震えない）
      hapticsSupported: typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' && (navigator.maxTouchPoints ?? 0) > 0,
      debug: this.debug,
      stats: this.debug && this.debugPanel && this.scene ? this.scene.stats() : null,
      paused: this.clock.paused,
    };
  }

  private canShareFilesCached = false;

  /** 置き位置の空気の見込み（見えている隙間から） */
  private estimateAir(): number {
    if (!this.placement || !this.pending) return 1;
    const pl = this.placement;
    const pend = this.pending;
    const others = this.sim.pieces.filter((p) => p.id !== this.held?.id && p.state !== 'ash');
    const tmp = new FireSim(1);
    tmp.pieces = others.map((p) => ({ ...p, held: false, crowd: [...p.crowd], floorPen: [...p.floorPen], lifted: [...p.lifted] }));
    const ghost = tmp.addPiece(pend.kind, pl, { length: pend.length, radius: pend.radius }, pend.shapeSeed, pend.species);
    return tmp.previewAir(ghost.id);
  }

  private guide(): UIState['guide'] {
    const sim = this.sim;
    if (sim.session.ended || sim.session.emberPhase) return null;
    const c = { tinder: sim.countOf('tinder'), kindling: sim.countOf('kindling'), medium: sim.countOf('medium'), large: sim.countOf('large') };
    const total = c.tinder + c.kindling + c.medium + c.large;
    if (sim.phase === 'burning') {
      if (sim.stage0Done) return null;
      return { eyebrow: 'THE FIRST SPARK / 03', title: '小さな火から、\n細薪へ。', desc: '風を少し送ったり、\n細い薪を寄せてみよう。', step: 2 };
    }
    if (sim.phase === 'out') {
      return { eyebrow: 'THE FIRST SPARK', title: 'もう一度、\n火口から。', desc: '火口を置き直して、\n細い薪を近くへ。', step: 1 };
    }
    if (total === 0) return { eyebrow: 'THE FIRST SPARK / 01', title: '薪を一本、\n置いてみよう。', desc: '木の感触を想像しながら。\n今夜の火は、ここから始まります。', step: 0 };
    if (sim.canIgnite().ok && c.kindling > 0) return { eyebrow: 'THE FIRST SPARK / 03', title: '最初の火を、\nそっと灯す。', desc: '小さな火が細薪へ移るまで、\n少しだけ待ってみよう。', step: 2 };
    return { eyebrow: 'THE FIRST SPARK / 02', title: '小さな隙間が、\n火の通り道。', desc: '火口の上に細薪を。\n中薪は少し離して置きます。', step: 1 };
  }

  private status(): UIState['status'] {
    const sim = this.sim;
    const m = sim.metrics;
    if (this.sess.farewell) return { tone: 'moon', text: 'おやすみの時間', hint: null };
    if (sim.session.emberPhase) return { tone: 'moon', text: 'もうすぐ、おやすみ', hint: '薪は足さずに、火を見守ろう。' };
    if (sim.phase === 'out') {
      return { tone: 'warn', text: '火が消えました', hint: sim.hint.tinderSpentAlone ? '細い薪を、もう少し近くへ。火口を置き直せば、すぐやり直せます。' : '火口を置いて、もう一度灯せます。' };
    }
    if (sim.phase !== 'burning') return null;
    if (sim.hint.kindlingCold) return { tone: 'warn', text: '細い薪を、もう少し近くへ', hint: '火口の炎が届く真上へ、細薪を寄せよう。' };
    const recentOverblow = sim.hint.overblow && Math.hypot(...sim.wind.phys) > 0.5;
    if (recentOverblow) return { tone: 'warn', text: '風、ひと休みでよさそう。', hint: '強い風は小さな炎を消してしまいます。' };
    if (m.heat > BALANCE.fireCare.hotAbove) return { tone: 'warn', text: '火が強すぎるかも', hint: '送風はひと休み。火ばさみで燃えている薪を一本、外側へ離そう。', action: 'tongs' };
    if (m.smoke > BALANCE.hints.smokyAt) {
      if (moisture(sim) >= BALANCE.hints.dampAt) return { tone: 'warn', text: '湿った薪で、煙が多め', hint: '乾いた薪（しめり木以外）を炎の上へ一本足して、風を少し送ろう。', action: 'log' };
      return { tone: 'warn', text: '煙が少し増えてきたね。', hint: '火ばさみで、薪の間に隙間をつくろう。', action: 'tongs' };
    }
    if (m.oxygen < BALANCE.hints.airLowAt && m.flamingSegs > 0) return { tone: 'warn', text: 'ちょっと詰まってるかも。', hint: '薪をずらすか、風を少し送ってみよう。' };
    // 燃料切れ（または消えたこと）の確認中：もう火は戻らないので、操作は勧めない
    if ((sim.session.spentFor ?? 0) > 0) return { tone: 'idle', text: '火が、静かに小さくなっています', hint: null };
    // まだ火のついていない薪（熾の上・炎のそばで温まっている途中）
    // （離れた所に置いたままの冷たい薪は数えない）
    const unlit = sim.pieces.some((p) => p.kind !== 'tinder' && !p.held && (p.state === 'raw' || p.state === 'warming') && p.segs.some((sg) => sg.T > BALANCE.hints.receivingHeatT));
    if (m.flamingSegs === 0 && (m.emberSegs > 0 || m.emberPower >= BALANCE.session.spentEmberPower)) {
      return unlit
        ? { tone: 'warn', text: '赤い熾が残っています', hint: '熾の上の薪へ、風を少し送ろう。また燃えはじめます。', action: 'wind' }
        : { tone: 'warn', text: '赤い熾が残っています', hint: '薪を一本、熾の上へ置いて、風を少し送ろう。', action: 'log' };
    }
    if (sim.stage0Done && unlit && m.heat < BALANCE.hints.weakHeatAt) return { tone: 'idle', text: '新しい薪が温まっています', hint: '風を少し送ると、早く火が移ります。', action: 'wind' };
    if (m.fuelRatio < BALANCE.hints.fuelLowRatio && sim.stage0Done) return { tone: 'warn', text: 'そろそろ、薪を一本足そう', hint: '炎の上へ渡すように置くと、火が移りやすい。' };
    if (m.heat > BALANCE.stable.heatMax + 2) return { tone: 'idle', text: '火は、少し強め', hint: 'いまは薪を足さずに、少し待ってみよう。' };
    if (m.heat < BALANCE.hints.smallFireHeat && !sim.stage0Done) return { tone: 'good', text: '小さな火が育っています', hint: null };
    return { tone: 'good', text: '火は、ほどよい感じ', hint: null };
  }

  /** テスト・検証用：UIからは使わない */
  get debugState(): { clock: string[]; dock: DockView } {
    return { clock: this.clock.list(), dock: this.dock };
  }

  get initialWoods(): WoodId[] {
    return INITIAL_WOODS;
  }

  woodLabel(id: WoodId): string {
    return WOODS[id].label;
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
    document.removeEventListener('freeze', this.onPageHide);
    window.removeEventListener('pageshow', this.onPageShow);
    window.removeEventListener('pointerdown', this.onCheckInput, { capture: true });
    this.disarmSoundGesture();
    this.motionQuery?.removeEventListener?.('change', this.onMotionChange);
    this.scene?.dispose();
  }
}

function dialogPauseReason(d: Exclude<DialogId, null>): PauseReason | null {
  switch (d) {
    case 'pause':
    case 'endConfirm':
      return 'user';
    case 'settings':
      return 'settings';
    case 'journal':
      return 'journal';
    case 'menu':
    case 'layouts':
    case 'newConfirm':
    case 'outfit':
      return 'menu';
    case 'resume':
      return 'resume';
    case 'sound':
    case 'deviceCheck':
    case 'about':
      return 'dialog';
  }
}

/** 文字の大きさ：画面のUIの文字だけを大きくする（CSSの --fs） */
function applyTextSize(t: Settings['textSize']): void {
  if (typeof document === 'undefined') return;
  const scale = t === 'xlarge' ? 1.36 : t === 'large' ? 1.18 : 1;
  document.documentElement.style.setProperty('--fs', String(scale));
  // 大きな見出しは控えめに（画面を覆わないよう、増える分を4割に）
  document.documentElement.style.setProperty('--fs-lg', String(1 + (scale - 1) * 0.4));
  document.documentElement.dataset.textSize = t;
}

function newSeed(): number {
  return hash32(`${Date.now()}:${Math.random()}`);
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function downloadBlob(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function localStorageHas(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

export { DEFAULT_SETTINGS };
