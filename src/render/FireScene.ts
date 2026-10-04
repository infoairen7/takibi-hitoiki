/**
 * 焚き火の3D描画（固定視点の小さなシーン）。
 * WebGLの描画だけを担当し、UIはDOM（React）側。ゲームの状態は FireSim から読む。
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BALANCE, PieceKind, WOODS, WoodId, isLog } from '../game/balance';
import { hashNoise } from '../game/rng';
import { Piece, Pose, Vec3, axisDir } from '../game/fire/model';
import { SimEvent, FireSim } from '../game/fire/sim';
import { windSnapshot } from '../game/fire/wind';
import { buildBackdrop, buildEnvironmentMap, buildGround, buildTray, groundTextures, sampleBottomColor, TrayBed } from './environment';
import { PLACE_LOOK, Weather, buildStructure, paintBackdrop } from './places';
import type { PlaceId, TrayId } from '../data/discoveries';
import { FLAME_KIND, FlameField, FlameInstance } from './flames';
import { LighterRig } from './lighter';
import { buildLogGeometry, buildTinderGeometry } from './logGeometry';
import { createLogMaterial, LogTextures, LogUniforms, MAX_SEGS } from './logMaterial';
import { SmokeSystem, SparkSystem } from './particles';
import { barkTexture, endGrainTexture, noiseTexture, smokePuffTexture, SPECIES_WOOD_COLOR, woodSplitTexture } from './textures';

export type Quality = 'low' | 'standard' | 'high';

interface PieceView {
  id: number;
  kind: PieceKind;
  mesh: THREE.Mesh;
  pick: THREE.Mesh;
  uniforms: LogUniforms;
  smoothI: Float32Array;
  fading: number;
  shownPose: Pose;
  dropAnim: number;
}

export interface GhostSpec {
  kind: PieceKind;
  species: WoodId;
  length: number;
  radius: number;
  shapeSeed: number;
  pose: Pose;
  valid: boolean;
  supports: Vec3[];
}

export interface SceneStats {
  fps: number;
  frameMs: number;
  dpr: number;
  drawCalls: number;
  triangles: number;
  flames: number;
  smoke: number;
  sparks: number;
  quality: Quality;
}

const ACCENT = new THREE.Color(0xeeb482);
const INVALID = new THREE.Color(0xe0664f);

export class FireScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.02, 40);
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private container: HTMLElement;
  private views = new Map<number, PieceView>();
  private texBySpecies = new Map<string, LogTextures>();
  private tinderTex: LogTextures | null = null;
  private flames = new FlameField(240);
  private smoke: SmokeSystem;
  private sparks: SparkSystem;
  private bed = new TrayBed();
  private lighter = new LighterRig();
  private fireLight = new THREE.PointLight(0xff8a3c, 0, 5, 1.2);
  private fireLight2 = new THREE.PointLight(0xff6a1c, 0, 4, 1.2);
  private emberLight = new THREE.PointLight(0xff3a10, 0, 2, 1.2);
  private skyLight = new THREE.DirectionalLight(0xa9bddc, 1.25);
  private hemi = new THREE.HemisphereLight(0x7c8db0, 0x2e2620, 1.25);
  private ghost: THREE.Group | null = null;
  private ghostKey = '';
  private ghostMat = new THREE.MeshStandardMaterial({ color: ACCENT, transparent: true, opacity: 0.42, emissive: ACCENT, emissiveIntensity: 0.18, roughness: 0.8, depthWrite: false });
  private ghostLine = new THREE.MeshBasicMaterial({ color: ACCENT, side: THREE.BackSide, transparent: true, opacity: 0.9, depthWrite: false });
  private markers: THREE.Mesh[] = [];
  private markerMat = new THREE.MeshBasicMaterial({ color: 0xffe2c4, transparent: true, opacity: 0.95, depthTest: false });
  private raycaster = new THREE.Raycaster();
  private floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BALANCE.tray.floorY);
  private windRoot = new THREE.Vector2();
  private windTip = new THREE.Vector2();
  private heatSmooth = 0;
  private emberSmooth = 0;
  private flameCenter = new THREE.Vector3(0, BALANCE.tray.floorY + 0.05, 0);
  private time = 0;
  private bedTimer = 0;
  private shadowDirty = true;
  private selectedId: number | null = null;
  private hoverId: number | null = null;
  private quality: Quality = 'standard';
  private autoQuality = true;
  private dpr = 1;
  private frameTimes: number[] = [];
  private lastAdapt = 0;
  /** 自動の画質調整の記録（動作チェックで表示する） */
  adaptLog: Array<{ at: number; what: string; fps: number }> = [];
  /** 起動からの経過（動作チェック用） */
  readonly bornAt = performance.now();
  private statsCache: SceneStats;
  reducedMotion = false;
  private backdrop: THREE.Mesh | null = null;
  private fogColor = new THREE.Color(0x2a2e31);
  private width = 1;
  private height = 1;
  private cameraBase = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  private noiseTex = noiseTexture(1);
  private groundGroup: THREE.Group;
  private trayGroup: THREE.Group;
  private structure: THREE.Group | null = null;
  private weather: Weather | null = null;
  private placeId: PlaceId = 'lakeside';
  /** 最初に作った地面と遠景は湖畔のもの */
  private placeApplied = true;
  private trayId: TrayId = 'first';
  private backdropUrl = '';
  private backdropToken = 0;
  private hemiBase = 1.25;
  private decor: { grips: THREE.Mesh[]; gripMats: Record<string, THREE.Material>; bag: THREE.Group; lantern: THREE.Group; lanternLight: THREE.PointLight } | null = null;

  static isSupported(): boolean {
    try {
      const c = document.createElement('canvas');
      return !!c.getContext('webgl2');
    } catch {
      return false;
    }
  }

  constructor(container: HTMLElement, opts: { quality: Quality | 'auto'; reducedMotion: boolean; backdropUrl: string }) {
    this.container = container;
    this.reducedMotion = opts.reducedMotion;
    this.autoQuality = opts.quality === 'auto';
    this.quality = opts.quality === 'auto' ? 'standard' : opts.quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: this.quality !== 'low', powerPreference: 'high-performance', alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.domElement.className = 'scene-canvas';
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x1a2029);
    this.scene.fog = new THREE.FogExp2(this.fogColor, 0.15);
    this.scene.environment = buildEnvironmentMap(this.renderer);
    this.scene.environmentIntensity = 0.9;

    // 光：夕暮れの弱い寒色（上から）＋焚き火の暖色
    this.skyLight.position.set(-1.2, 3.2, -1.6);
    this.skyLight.castShadow = this.quality !== 'low';
    this.skyLight.shadow.mapSize.set(1024, 1024);
    const sc = this.skyLight.shadow.camera;
    sc.left = -0.5;
    sc.right = 0.5;
    sc.top = 0.5;
    sc.bottom = -0.5;
    sc.near = 1;
    sc.far = 6;
    this.skyLight.shadow.bias = -0.0006;
    this.skyLight.shadow.normalBias = 0.01;
    this.skyLight.shadow.radius = 3;
    this.scene.add(this.skyLight, this.hemi, this.fireLight, this.fireLight2, this.emberLight);

    this.groundGroup = buildGround(this.quality);
    this.trayGroup = buildTray('first');
    this.scene.add(this.groundGroup, this.trayGroup);
    this.scene.add(this.bed.mesh);
    this.scene.add(this.flames.mesh);
    const puff = smokePuffTexture(8);
    this.smoke = new SmokeSystem(puff, BALANCE.fx.smokeMax[this.quality]);
    this.sparks = new SparkSystem(BALANCE.fx.sparksMax[this.quality]);
    this.scene.add(this.smoke.mesh, this.sparks.points, this.lighter.group);

    this.scene.add(this.buildProps());
    this.backdropUrl = opts.backdropUrl;
    this.loadBackdrop(opts.backdropUrl);
    this.setupComposer();
    this.statsCache = { fps: 0, frameMs: 0, dpr: 1, drawCalls: 0, triangles: 0, flames: 0, smoke: 0, sparks: 0, quality: this.quality };
    this.resize();
    this.precompile();
  }

  /** 初めて薪を持ったとき・着火したときに引っかからないよう、材質を先にコンパイルしておく */
  private precompile(): void {
    try {
      this.setGhost({ kind: 'kindling', species: 'shirakaba', length: 0.3, radius: 0.011, shapeSeed: 1, pose: { x: 0, y: -1, z: 0, yaw: 0, pitch: 0, roll: 0 }, valid: true, supports: [[0, -1, 0]] });
      this.lighter.group.visible = true;
      this.flames.setInstances([{ x: 0, y: -1, z: 0, width: 0.01, height: 0.01, seed: 0, intensity: 0, kind: 0, layer: 0 }]);
      this.renderer.compile(this.scene, this.camera);
    } catch {
      /* 省略可 */
    }
    this.setGhost(null);
    this.lighter.group.visible = false;
    this.flames.setInstances([]);
  }

  /** 遠景の差し替え口 */
  loadBackdrop(url: string): void {
    const loader = new THREE.TextureLoader();
    const token = ++this.backdropToken;
    loader.load(
      url,
      (tex) => {
        if (token !== this.backdropToken) return; // 読み込み中に場所が変わった
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        this.fogColor.copy(sampleBottomColor(tex.image as HTMLImageElement)).multiplyScalar(0.85);
        (this.scene.fog as THREE.FogExp2).color.copy(this.fogColor);
        if (this.backdrop) this.scene.remove(this.backdrop);
        this.backdrop = buildBackdrop(tex, this.fogColor);
        this.scene.add(this.backdrop);
      },
      undefined,
      () => {
        // 読めなくても描画は続ける（霧の色のまま）
      },
    );
  }

  // ───────────────────────────── 場所・焚き火台・装飾（見た目だけ）

  setPlace(id: PlaceId): void {
    if (id === this.placeId && this.placeApplied) return;
    this.placeId = id;
    this.placeApplied = true;
    this.holdAdapt();
    const look = PLACE_LOOK[id];
    // 地面
    this.scene.remove(this.groundGroup);
    this.groundGroup.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.groundGroup = buildGround(this.quality, { kind: look.ground, tint: look.groundTint, rough: look.groundRough, pebbles: look.pebbles, terrace: look.structure === 'railing', lowered: look.structure === 'pavilion' });
    this.scene.add(this.groundGroup);
    // 遠景
    if (look.backdrop === 'photo') {
      this.loadBackdrop(this.backdropUrl);
    } else {
      this.backdropToken++;
      const canvas = paintBackdrop(look);
      if (canvas) {
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        this.fogColor.copy(sampleBottomColor(canvas as unknown as HTMLImageElement)).multiplyScalar(0.85);
        (this.scene.fog as THREE.FogExp2).color.copy(this.fogColor);
        if (this.backdrop) {
          this.scene.remove(this.backdrop);
          this.backdrop.geometry.dispose();
          (this.backdrop.material as THREE.Material).dispose();
        }
        this.backdrop = buildBackdrop(tex, this.fogColor);
        this.scene.add(this.backdrop);
      }
    }
    // 光と霧
    this.skyLight.color.setHex(look.sky.color);
    this.skyLight.intensity = look.sky.intensity;
    this.hemi.color.setHex(look.hemi.sky);
    this.hemi.groundColor.setHex(look.hemi.ground);
    this.hemiBase = look.hemi.intensity;
    (this.scene.fog as THREE.FogExp2).density = look.fogDensity;
    (this.scene.background as THREE.Color).setHex(look.background);
    // 天気
    if (this.weather) {
      this.scene.remove(this.weather.points);
      this.weather.dispose();
      this.weather = null;
    }
    if (look.weather !== 'none') {
      // 粒は最大数で作り、軽量のときは描く数だけ減らす（標準へ戻したときに元の数へ戻せるように）
      const n = look.weather === 'rain' ? 700 : 450;
      const covered = look.structure === 'pavilion' ? (x: number, z: number) => Math.abs(x) < 1.45 && z > -1.5 && z < 1.4 : null;
      this.weather = new Weather(look.weather, n, covered);
      if (this.quality === 'low') this.weather.setShare(BALANCE.fx.adapt.weatherLowShare);
      this.scene.add(this.weather.points);
    }
    // 東屋・手すり
    if (this.structure) {
      this.scene.remove(this.structure);
      disposeGroup(this.structure);
      this.structure = null;
    }
    if (look.structure !== 'none') {
      this.structure = buildStructure(look.structure, look.structure === 'pavilion' ? groundTextures('deck') : null);
      this.scene.add(this.structure);
    }
    this.shadowDirty = true;
  }

  setTray(id: TrayId): void {
    if (id === this.trayId) return;
    this.trayId = id;
    this.scene.remove(this.trayGroup);
    disposeGroup(this.trayGroup);
    this.trayGroup = buildTray(id);
    this.scene.add(this.trayGroup);
    this.shadowDirty = true;
  }

  setDecor(d: { tongs: 'steel' | 'tongsWood' | 'tongsLeather'; bag: boolean; lantern: boolean }): void {
    if (!this.decor) return;
    for (const grip of this.decor.grips) {
      grip.visible = d.tongs !== 'steel';
      grip.material = this.decor.gripMats[d.tongs] ?? grip.material;
    }
    this.decor.bag.visible = d.bag;
    this.decor.lantern.visible = d.lantern;
    this.decor.lanternLight.visible = d.lantern;
    this.shadowDirty = true;
  }

  private setupComposer(): void {
    if (this.quality === 'low') {
      this.composer = null;
      this.bloom = null;
      return;
    }
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.42, 0.92);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  setQuality(q: Quality | 'auto'): void {
    this.autoQuality = q === 'auto';
    // 「自動」を選び直したら、標準からもう一度測り直す
    const next = q === 'auto' ? 'standard' : q;
    if (next !== this.quality || !this.composer === (next !== 'low')) {
      this.quality = next;
      this.composer?.dispose();
      this.setupComposer();
      this.smoke.max = BALANCE.fx.smokeMax[next];
      this.sparks.max = BALANCE.fx.sparksMax[next];
      this.skyLight.castShadow = next !== 'low';
      this.shadowDirty = true;
      this.weather?.setShare(next === 'low' ? BALANCE.fx.adapt.weatherLowShare : 1);
    }
    this.dpr = Math.min(window.devicePixelRatio || 1, BALANCE.fx.dprMax[this.quality]);
    this.resize();
    this.holdAdapt(1500);
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    if (!this.dpr || this.dpr <= 0) this.dpr = Math.min(window.devicePixelRatio || 1, BALANCE.fx.dprMax[this.quality]);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.composer?.setPixelRatio(this.dpr);
    this.composer?.setSize(w, h);
    this.bloom?.resolution.set(w * this.dpr * 0.5, h * this.dpr * 0.5);
    this.sparks.uniforms.uPixel.value = (h * this.dpr) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    this.layoutCamera();
  }

  /** 画面の縦横比に合わせた固定視点。縦長スマホは台を大きく、下の道具箱の上へ */
  private layoutCamera(): void {
    const aspect = this.width / this.height;
    const t = THREE.MathUtils.clamp((aspect - 0.46) / (1.6 - 0.46), 0, 1);
    const short = this.height < 700 && aspect < 1 ? 1 : 0;
    // 縦長：台を画面の上寄り（道具箱の上）に大きく。横長：奥の森と湖が見えるように
    const vfov = THREE.MathUtils.lerp(72, 62, t);
    const height = THREE.MathUtils.lerp(0.72 + short * 0.02, 0.6, t);
    const dist = THREE.MathUtils.lerp(0.98, 0.8, t);
    const pitch = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(-33 - short * 2, -25, t));
    this.camera.fov = vfov;
    this.camera.aspect = aspect;
    // 横向きの短い画面（スマホの横向き・PCの200%拡大）：道具箱が右側の縦の帯になるので、
    // 火を左の空いた所の真ん中へ寄せ、下の知らせにかからないよう少し上げる（CSS の --side-w と合わせる）
    if (this.height <= 520 && this.width > this.height) {
      const side = Math.min(300, this.width * 0.4) + 20;
      this.camera.setViewOffset(this.width, this.height, side / 2, this.height * 0.07, this.width, this.height);
    } else this.camera.clearViewOffset();
    this.camera.position.set(0, height, dist);
    const target = new THREE.Vector3(0, height + Math.tan(pitch) * dist, 0);
    this.camera.lookAt(target);
    this.cameraBase.pos.copy(this.camera.position);
    this.cameraBase.target.copy(target);
    this.camera.updateProjectionMatrix();
    this.sparks.uniforms.uPixel.value = (this.height * this.dpr) / (2 * Math.tan(THREE.MathUtils.degToRad(vfov) / 2));
  }

  // ───────────────────────────── 薪の見た目

  private texturesFor(species: WoodId): LogTextures {
    const key = species;
    let t = this.texBySpecies.get(key);
    if (!t) {
      const wood = WOODS[species];
      const base = SPECIES_WOOD_COLOR[species] ?? [0.78, 0.62, 0.44];
      t = {
        bark: barkTexture(31 + key.length * 7, wood.bark),
        wood: woodSplitTexture(11 + key.length, base),
        end: endGrainTexture(51 + key.length, base),
      };
      this.texBySpecies.set(key, t);
    }
    return t;
  }

  private tinderTextures(): LogTextures {
    if (!this.tinderTex) {
      const base: [number, number, number] = [0.95, 0.86, 0.68];
      const w = woodSplitTexture(91, base);
      this.tinderTex = { bark: w, wood: w, end: w };
    }
    return this.tinderTex;
  }

  /** 台の横に置いた薪の山・火口・火ばさみ（F01の構図を参照した飾り。燃焼には関わらない） */
  private buildProps(): THREE.Group {
    const g = new THREE.Group();
    g.name = 'props';
    const addLog = (species: WoodId, kind: 'kindling' | 'medium', x: number, y: number, z: number, yaw: number, seed: number, len = 0.37, r = 0.036, pitch = 0) => {
      const geo = buildLogGeometry(kind, len, r, seed).geometry;
      const { material } = createLogMaterial(this.texturesFor(species), { segCount: 1, radius: r, seed });
      const m = new THREE.Mesh(geo, material);
      this.applyPose(m, { x, y, z, yaw, pitch, roll: 0 });
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    };
    // 左：薪の山と焚き付け
    const lx = -0.63;
    addLog('nara', 'medium', lx, 0.036, -0.1, 0.12, 101);
    addLog('kunugi', 'medium', lx + 0.02, 0.036, -0.02, 0.05, 102, 0.39);
    addLog('nara', 'medium', lx - 0.01, 0.036, 0.06, -0.08, 103, 0.35);
    addLog('sakura', 'medium', lx + 0.01, 0.106, -0.06, 0.1, 104);
    addLog('shirakaba', 'medium', lx, 0.106, 0.02, -0.04, 105, 0.36);
    for (let i = 0; i < 5; i++) addLog('shirakaba', 'kindling', lx + 0.06 + i * 0.012, 0.011 + (i % 2) * 0.02, 0.2 + i * 0.012, 0.35 + i * 0.05, 200 + i, 0.3, 0.011);
    // 木毛の束
    const tinder = new THREE.Mesh(buildTinderGeometry(0.06, 0.04, 77), createLogMaterial(this.tinderTextures(), { tinder: true, segCount: 1, radius: 0.06, seed: 77 }).material);
    tinder.position.set(lx + 0.02, 0.02, 0.2);
    tinder.castShadow = true;
    g.add(tinder);
    // 右：薪の山
    const rx = 0.64;
    addLog('kunugi', 'medium', rx, 0.036, -0.14, Math.PI / 2 + 0.05, 111);
    addLog('nara', 'medium', rx + 0.08, 0.036, -0.13, Math.PI / 2 - 0.04, 112);
    addLog('sakura', 'medium', rx - 0.08, 0.036, -0.12, Math.PI / 2, 113, 0.35);
    addLog('nara', 'medium', rx, 0.106, -0.13, 0.04, 114, 0.39);
    // 火ばさみ
    const steel = new THREE.MeshStandardMaterial({ color: 0x2c2f33, roughness: 0.4, metalness: 0.85 });
    const tongs = new THREE.Group();
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.006, 0.012), steel);
      arm.position.set(0.19, 0.006, side * 0.012);
      arm.rotation.y = side * 0.035;
      arm.castShadow = true;
      tongs.add(arm);
    }
    // 持ち手（装飾：木・革巻き。はじめは金属のまま）
    const gripMats: Record<string, THREE.Material> = {
      tongsWood: new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.7 }),
      tongsLeather: new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: 0.55 }),
    };
    const grips: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.11, 10).rotateZ(Math.PI / 2), gripMats.tongsWood);
      grip.position.set(0.3, 0.008, side * 0.014);
      grip.rotation.y = side * 0.035;
      grip.castShadow = true;
      grip.visible = false;
      grips.push(grip);
      tongs.add(grip);
    }
    tongs.position.set(0.36, 0, 0.12);
    tongs.rotation.y = -0.5;
    g.add(tongs);

    // 帆布の薪袋（装飾）
    const bag = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({ color: 0xb8a684, roughness: 0.95 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.13, 20, 1, true), cloth);
    body.position.y = 0.065;
    body.castShadow = true;
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.085, 20).rotateX(-Math.PI / 2), cloth);
    bottom.position.y = 0.002;
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.006, 6, 20, Math.PI), new THREE.MeshStandardMaterial({ color: 0x5a3e2a, roughness: 0.7 }));
    strap.position.y = 0.13;
    bag.add(body, bottom, strap);
    for (let i = 0; i < 3; i++) {
      const geo = buildLogGeometry('medium', 0.2, 0.022, 300 + i).geometry;
      const { material } = createLogMaterial(this.texturesFor(i === 1 ? 'shirakaba' : 'nara'), { segCount: 1, radius: 0.022, seed: 300 + i });
      const log = new THREE.Mesh(geo, material);
      log.rotation.z = Math.PI / 2 - 0.12 + i * 0.1;
      log.position.set(-0.03 + i * 0.03, 0.12, (i - 1) * 0.03);
      log.castShadow = true;
      bag.add(log);
    }
    bag.position.set(-0.56, 0, -0.2);
    bag.rotation.y = 0.4;
    bag.scale.setScalar(0.8);
    bag.visible = false;
    g.add(bag);

    // 小さなランタン（装飾。燃焼には影響しない）
    const lantern = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x24211f, roughness: 0.5, metalness: 0.7 });
    const baseM = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.012, 16), dark);
    baseM.position.y = 0.006;
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.06, 16), new THREE.MeshStandardMaterial({ color: 0xffe0b0, emissive: 0xffa050, emissiveIntensity: 1.4, transparent: true, opacity: 0.75, roughness: 0.2 }));
    glass.position.y = 0.042;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.025, 16), dark);
    cap.position.y = 0.085;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.0025, 6, 16), dark);
    ring.position.y = 0.104;
    lantern.add(baseM, glass, cap, ring);
    lantern.position.set(0.47, 0, 0.12);
    lantern.visible = false;
    const lanternLight = new THREE.PointLight(0xffa860, 0.05, 1.2, 2);
    lanternLight.position.set(0.47, 0.07, 0.12);
    lanternLight.visible = false;
    g.add(lantern, lanternLight);
    this.decor = { grips, gripMats, bag, lantern, lanternLight };
    return g;
  }

  private createView(p: Piece): PieceView {
    let geo: THREE.BufferGeometry;
    let tex: LogTextures;
    if (p.kind === 'tinder') {
      geo = buildTinderGeometry(p.radius, BALANCE.pieces.tinder.height, p.shapeSeed);
      tex = this.tinderTextures();
    } else {
      geo = buildLogGeometry(p.kind, p.length, p.radius, p.shapeSeed).geometry;
      tex = this.texturesFor(p.species);
    }
    const { material, uniforms } = createLogMaterial(tex, { tinder: p.kind === 'tinder', segCount: p.segs.length, radius: p.radius, seed: p.shapeSeed });
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.pieceId = p.id;
    // 拾いやすい透明な当たり判定（細薪は細いので太めに）
    const pr = p.kind === 'tinder' ? p.radius : Math.max(p.radius * 1.6, 0.02);
    const pickGeo = p.kind === 'tinder' ? new THREE.CylinderGeometry(pr, pr, 0.05, 12) : new THREE.CylinderGeometry(pr, pr, p.length, 10).rotateZ(Math.PI / 2);
    const pick = new THREE.Mesh(pickGeo, new THREE.MeshBasicMaterial({ visible: false }));
    pick.userData.pieceId = p.id;
    this.scene.add(mesh, pick);
    return { id: p.id, kind: p.kind, mesh, pick, uniforms, smoothI: new Float32Array(p.segs.length), fading: -1, shownPose: { ...p.pose }, dropAnim: 1 };
  }

  private applyPose(obj: THREE.Object3D, pose: Pose, yOffset = 0): void {
    obj.position.set(pose.x, pose.y + yOffset, pose.z);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pose.yaw);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pose.pitch));
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pose.roll));
    obj.quaternion.copy(q);
  }

  /** 置いた直後のごく小さな着地（見た目のみ） */
  notifyPlaced(id: number): void {
    const v = this.views.get(id);
    if (v) v.dropAnim = 0;
    this.shadowDirty = true;
  }

  setSelected(id: number | null): void {
    this.selectedId = id;
  }

  setHover(id: number | null): void {
    this.hoverId = id;
  }

  // ───────────────────────────── ゴースト（置き位置の見本）

  setGhost(g: GhostSpec | null): void {
    if (!g) {
      if (this.ghost) this.ghost.visible = false;
      for (const m of this.markers) m.visible = false;
      return;
    }
    const key = `${g.kind}:${g.shapeSeed}:${g.length}:${g.radius}`;
    if (key !== this.ghostKey || !this.ghost) {
      if (this.ghost) {
        this.scene.remove(this.ghost);
        this.ghost.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      }
      const group = new THREE.Group();
      let geo: THREE.BufferGeometry;
      if (g.kind === 'tinder') {
        geo = new THREE.SphereGeometry(1, 20, 10);
        geo.scale(g.radius, BALANCE.pieces.tinder.height / 2, g.radius);
      } else {
        geo = buildLogGeometry(g.kind, g.length, g.radius, g.shapeSeed).geometry;
      }
      const body = new THREE.Mesh(geo, this.ghostMat);
      const line = new THREE.Mesh(geo, this.ghostLine);
      line.scale.setScalar(1.07);
      body.renderOrder = 20;
      line.renderOrder = 19;
      group.add(line, body);
      this.ghost = group;
      this.ghostKey = key;
      this.scene.add(group);
    }
    this.ghost.visible = true;
    this.applyPose(this.ghost, g.pose);
    const c = g.valid ? ACCENT : INVALID;
    this.ghostMat.color.copy(c);
    this.ghostMat.emissive.copy(c);
    this.ghostLine.color.copy(c);
    // 支持点
    while (this.markers.length < 6) {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.0045, 0.0085, 20), this.markerMat);
      m.renderOrder = 30;
      this.markers.push(m);
      this.scene.add(m);
    }
    const sup = g.supports.length > 2 && g.supports.every((s) => Math.abs(s[1] - g.supports[0][1]) < 0.002) ? [g.supports[0], g.supports[g.supports.length - 1]] : g.supports;
    this.markers.forEach((m, i) => {
      const s = sup[i];
      m.visible = !!s && g.valid;
      if (s) {
        m.position.set(s[0], s[1] + 0.002, s[2]);
        m.lookAt(this.camera.position);
      }
    });
  }

  // ───────────────────────────── 火吹き筒の狙い

  private tubeRing: THREE.Mesh | null = null;

  /** 火吹き筒で狙う場所（台の上の小さな輪）。null で隠す */
  setTubeAim(p: { x: number; z: number } | null): void {
    if (!p) {
      if (this.tubeRing) this.tubeRing.visible = false;
      return;
    }
    if (!this.tubeRing) {
      const sigma = BALANCE.tube.sigma;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(sigma * 0.85, sigma, 36).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xa9d8ee, transparent: true, opacity: 0.85, depthTest: false }),
      );
      ring.renderOrder = 31;
      this.tubeRing = ring;
      this.scene.add(ring);
    }
    this.tubeRing.visible = true;
    this.tubeRing.position.set(p.x, BALANCE.tray.floorY + 0.003, p.z);
  }

  private updateTubeFx(sim: FireSim, dt: number, paused: boolean, sparkScale: number): void {
    const env = sim.tubeEnvelope();
    if (this.tubeRing && this.tubeRing.visible) {
      // ひと吹きの間は少し大きく、明るく
      const s = 1 + 0.25 * env;
      this.tubeRing.scale.set(s, 1, s);
      (this.tubeRing.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.4 * (env > 0 ? env : 0.5 + 0.5 * Math.sin(this.time * 3));
    }
    if (paused || env <= 0.2) return;
    // 狙った所に熾や炎があれば、細かな火の粉と灰が舞う（炎は風下へ傾けない）
    const tx = sim.tube.x;
    const tz = sim.tube.z;
    let glow = 0;
    for (const p of sim.pieces) {
      p.segs.forEach((sg, i) => {
        const q = p.segPos[i];
        if (!q) return;
        const d2 = (q[0] - tx) ** 2 + (q[2] - tz) ** 2;
        glow += (sg.g + sg.I * 0.5) * Math.exp(-d2 / (2 * BALANCE.tube.sigma ** 2));
      });
    }
    const nb = BALANCE.bed.cells;
    const cell = (BALANCE.tray.innerHalf * 2) / nb;
    const ci = Math.floor((tx + BALANCE.tray.innerHalf) / cell) + nb * Math.floor((tz + BALANCE.tray.innerHalf) / cell);
    glow += sim.bedCoal[ci] ?? 0;
    if (glow > 0.05 && Math.random() < dt * 10 * env * Math.min(1.5, glow) * sparkScale) {
      this.sparks.burst(tx, BALANCE.tray.floorY + 0.02, tz, 2, 0.6);
    }
  }

  // ───────────────────────────── 当たり判定

  private ndc(clientX: number, clientY: number): THREE.Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  pickFloor(clientX: number, clientY: number): { x: number; z: number } | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.floorPlane, hit)) return null;
    return { x: hit.x, z: hit.z };
  }

  pickPiece(clientX: number, clientY: number): number | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const picks = [...this.views.values()].filter((v) => v.fading < 0).map((v) => v.pick);
    const hits = this.raycaster.intersectObjects(picks, false);
    return hits.length ? (hits[0].object.userData.pieceId as number) : null;
  }

  /** ワールド座標→画面座標（CSS px） */
  project(p: Vec3): { x: number; y: number } {
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  }

  // ───────────────────────────── 毎フレーム

  update(sim: FireSim, dt: number, events: SimEvent[], paused: boolean): void {
    this.time += paused ? dt * 0.35 : dt;
    const t = this.time;
    const ws = windSnapshot(sim.wind);

    // 風の見た目：根元は早く、先端は遅れて
    const kr = 1 - Math.exp(-dt / BALANCE.wind.visualRootTau);
    const kt = 1 - Math.exp(-dt / BALANCE.wind.visualTipTau);
    this.windRoot.x += (ws.target[0] - this.windRoot.x) * kr;
    this.windRoot.y += (ws.target[1] - this.windRoot.y) * kr;
    this.windTip.x += (ws.target[0] - this.windTip.x) * kt;
    this.windTip.y += (ws.target[1] - this.windTip.y) * kt;
    this.flames.uniforms.uTime.value = t;
    this.flames.uniforms.uWindRoot.value.copy(this.windRoot);
    this.flames.uniforms.uWindTip.value.copy(this.windTip);

    // 薪の追加・削除
    const seen = new Set<number>();
    for (const p of sim.pieces) {
      seen.add(p.id);
      if (!this.views.has(p.id)) {
        this.views.set(p.id, this.createView(p));
        this.shadowDirty = true;
      }
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id) && v.fading < 0) v.fading = 0;
    }

    const flames: FlameInstance[] = [];
    const cluster = new Map<string, { x: number; y: number; z: number; w: number }>();
    const up = new THREE.Vector3(0, 1, 0);
    const qInv = new THREE.Quaternion();
    const kI = 1 - Math.exp(-dt / 0.18);
    const sootSpots: Array<[number, number, number]> = [];

    for (const p of sim.pieces) {
      const v = this.views.get(p.id)!;
      // 位置（持ち上げ中は少し浮かせる、置いた直後は小さく着地）
      v.dropAnim = Math.min(1, v.dropAnim + dt * 5);
      const drop = v.dropAnim < 1 ? (1 - v.dropAnim) * (1 - v.dropAnim) * 0.02 : 0;
      const lift = p.held ? 0.03 + Math.sin(t * 3) * 0.002 : 0;
      // 崩れ・置き直しはなめらかに
      const sp = v.shownPose;
      const k = p.held ? 1 : 1 - Math.exp(-dt / 0.08);
      sp.x += (p.pose.x - sp.x) * k;
      sp.y += (p.pose.y - sp.y) * k;
      sp.z += (p.pose.z - sp.z) * k;
      sp.yaw = p.pose.yaw;
      sp.pitch += (p.pose.pitch - sp.pitch) * k;
      sp.roll = p.pose.roll;
      if (Math.abs(sp.y - p.pose.y) > 0.0005) this.shadowDirty = true;
      // 燃えて細くなる（見た目のみ。床との接地は保つ）
      let fuelNow = 0;
      let fuel0 = 0;
      for (const sg of p.segs) {
        fuelNow += sg.f;
        fuel0 += sg.f0;
      }
      const fr = fuel0 > 0 ? fuelNow / fuel0 : 1;
      const thin = p.kind === 'kindling' ? 0.45 + 0.55 * Math.pow(fr, 0.7) : isLog(p.kind) ? 0.78 + 0.22 * fr : 1;
      this.applyPose(v.mesh, sp, drop + lift - p.radius * (1 - thin) * (isLog(p.kind) ? 1 : 0.6));
      if (p.kind !== 'tinder') v.mesh.scale.set(1, thin, thin);
      this.applyPose(v.pick, sp, lift);
      const U = v.uniforms;
      U.uTime.value = t;
      const shownSegPos = segPositionsFor(p, sp, drop + lift);
      let moist = 0;
      for (let i = 0; i < p.segs.length && i < MAX_SEGS; i++) {
        const s = p.segs[i];
        v.smoothI[i] += (s.I - v.smoothI[i]) * kI;
        U.uChar.value[i] = s.c;
        U.uGlow.value[i] = Math.min(1, s.g * (1.05 - 0.45 * s.I) + s.I * 0.1);
        U.uAsh.value[i] = s.ash;
        U.uTemp.value[i] = Math.min(1, s.T);
        moist += s.m;
      }
      U.uMoist.value = moist / p.segs.length;
      U.uHeatDir.value.set(p.heatDir[0], p.heatDir[1], p.heatDir[2]);
      qInv.copy(v.mesh.quaternion).invert();
      U.uUpLocal.value.copy(up).applyQuaternion(qInv);
      const hl = this.selectedId === p.id ? 0.8 + 0.2 * Math.sin(t * 4) : this.hoverId === p.id ? 0.45 : 0;
      U.uHighlight.value += (hl - U.uHighlight.value) * Math.min(1, dt * 10);
      if (p.kind === 'tinder') {
        const s = p.segs[0];
        const burnt = 1 - s.f / s.f0;
        U.uBurnFront.value = s.lit ? 0.12 + burnt * 1.25 : Math.max(0, (s.T - 0.6) * 0.15);
        U.uShrink.value = burnt;
        U.uGlow.value[0] = Math.min(1, s.I * 1.2 + 0.1 * (s.lit ? 1 - burnt : 0));
        U.uAsh.value[0] = burnt;
        U.uChar.value[0] = s.lit ? 1 : 0;
      }

      // 炎の舌：燃えている区間の上面に結びつける
      const dir = axisDir(sp);
      const segLen = p.kind === 'tinder' ? 0 : p.length / p.segs.length;
      for (let i = 0; i < p.segs.length; i++) {
        const I = v.smoothI[i];
        const s = p.segs[i];
        const sp3 = shownSegPos[i];
        if (I > 0.03) sootSpots.push([sp3[0], sp3[2], I]);
        const baseSeed = hashNoise(p.id, i, 1);
        if (p.kind === 'tinder') {
          const burnt = 1 - s.f / s.f0;
          const offs = [
            [0, 0.45],
            [-0.5, 0.1],
            [0.5, 0.15],
            [-0.2, -0.45],
            [0.3, -0.4],
            [0, -0.05],
          ];
          offs.forEach(([ox, oz], k) => {
            // 手前（着火点）から奥へ燃え広がる
            const reach = 0.25 + burnt * 1.6 + I * 0.3;
            const vis = Math.max(0, Math.min(1, (reach - (0.45 - oz) * 0.7) * 2));
            const inten = I * vis * (0.75 + 0.25 * hashNoise(p.id, k, 7));
            if (inten < 0.04) return;
            flames.push({
              x: sp3[0] + ox * p.radius,
              y: BALANCE.tray.floorY + BALANCE.pieces.tinder.height * (0.75 - burnt * 0.4),
              z: sp3[2] + oz * p.radius,
              width: 0.06,
              height: (0.05 + 0.13 * inten) * (0.85 + 0.3 * hashNoise(p.id, k, 3)),
              seed: hashNoise(p.id, k, 2),
              intensity: inten,
              kind: FLAME_KIND.tinder,
              layer: k % 2,
            });
          });
          this.addCluster(cluster, sp3[0], BALANCE.tray.floorY + 0.03, sp3[2], I * 1.4);
          continue;
        }
        // 細薪は一つおきの区間に（カメラへ向いた細薪で炎が重なりすぎないように）
        if (I > 0.03 && (isLog(p.kind) || i % 2 === 0 || I < 0.3)) {
          const topY = sp3[1] + p.radius * 0.72;
          const tongues = isLog(p.kind) && I > 0.45 ? 2 : 1;
          for (let k = 0; k < tongues; k++) {
            const off = tongues === 1 ? 0 : (k - 0.5) * 0.55 * segLen;
            const sd = hashNoise(p.id, i * 4 + k, 5);
            const h = isLog(p.kind) ? (0.05 + 0.2 * I) * (0.8 + 0.4 * sd) : (0.035 + 0.12 * I) * (0.85 + 0.3 * sd);
            flames.push({
              x: sp3[0] + dir[0] * off,
              y: topY + dir[1] * off,
              z: sp3[2] + dir[2] * off,
              width: isLog(p.kind) ? 0.075 + 0.02 * sd : 0.04,
              height: h,
              seed: baseSeed + k * 0.37,
              intensity: isLog(p.kind) ? I : I * 0.8,
              kind: isLog(p.kind) ? FLAME_KIND.medium : FLAME_KIND.kindling,
              layer: 0,
            });
            if (I > 0.5 && isLog(p.kind)) {
              flames.push({
                x: sp3[0] + dir[0] * off,
                y: topY + dir[1] * off - 0.004,
                z: sp3[2] + dir[2] * off,
                width: (isLog(p.kind) ? 0.05 : 0.028) * (0.9 + 0.2 * sd),
                height: h * 0.7,
                seed: baseSeed + 0.5 + k,
                intensity: I,
                kind: isLog(p.kind) ? FLAME_KIND.medium : FLAME_KIND.kindling,
                layer: 1,
              });
            }
          }
          this.addCluster(cluster, sp3[0], topY, sp3[2], I * (isLog(p.kind) ? 1 : 0.45));
        } else if (s.g > 0.45 && !this.reducedMotion) {
          // 熾火の上にときどき出る小さな炎
          const on = Math.sin(t * (0.7 + baseSeed) + baseSeed * 20) > 0.55;
          if (on) {
            flames.push({
              x: sp3[0],
              y: sp3[1] + p.radius * 0.8,
              z: sp3[2],
              width: 0.025,
              height: 0.018 + 0.02 * s.g,
              seed: baseSeed,
              intensity: 0.35 * s.g,
              kind: FLAME_KIND.ember,
              layer: 1,
            });
          }
        }

        // 煙：湿り・空気不足・くすぶりの発生源から
        if (!paused && s.smoke > 0.06) {
          const rate = s.smoke * (isLog(p.kind) ? 2.2 : 1.2) * (this.quality === 'low' ? 0.5 : 1);
          if (Math.random() < rate * dt) {
            const y0 = sp3[1] + p.radius + (I > 0.1 ? 0.06 + 0.12 * I : 0.01);
            const steam = s.I < 0.05 && s.T < 1 ? 1.25 : 0.95;
            this.smoke.emit(sp3[0], y0, sp3[2], Math.min(1, s.smoke), steam);
          }
        }
      }
      if (p.kind === 'tinder' && !paused) {
        const s = p.segs[0];
        if (s.smoke > 0.05 && Math.random() < s.smoke * 1.4 * dt) this.smoke.emit(p.pose.x, BALANCE.tray.floorY + 0.05 + s.I * 0.1, p.pose.z, Math.min(1, s.smoke), 1.1);
      }
    }

    // 近くで一緒に燃える区間 → 大きな炎の胴
    for (const c of cluster.values()) {
      if (c.w < 1.8) continue;
      const x = c.x / c.w;
      const y = c.y / c.w;
      const z = c.z / c.w;
      const s = Math.sqrt(c.w);
      const sd = hashNoise(Math.round(x * 100), Math.round(z * 100), 9);
      flames.push({ x, y, z, width: 0.13 + 0.04 * s, height: 0.1 + 0.08 * s, seed: sd, intensity: Math.min(0.6, c.w / 4.5), kind: FLAME_KIND.body, layer: 0 });

    }

    // ライター
    if (sim.lighter.remaining > 0 && sim.lighter.tip) {
      this.lighter.show(new THREE.Vector3(...sim.lighter.tip));
    } else if (this.lighter.active) {
      this.lighter.hide();
    }
    this.lighter.update(dt, this.reducedMotion);
    if (this.lighter.flameOn) {
      const tp = this.lighter.tip;
      flames.push({ x: tp.x - 0.004, y: tp.y - 0.004, z: tp.z - 0.004, width: 0.02, height: 0.04, seed: 0.3, intensity: 0.85, kind: FLAME_KIND.lighter, layer: 0 });
      flames.push({ x: tp.x - 0.004, y: tp.y - 0.004, z: tp.z - 0.004, width: 0.012, height: 0.026, seed: 0.7, intensity: 0.9, kind: FLAME_KIND.lighter, layer: 1 });
    }
    this.flames.setInstances(flames);

    // 崩れた・灰になった薪をゆっくり消す
    for (const [id, v] of this.views) {
      if (v.fading < 0) continue;
      v.fading += dt;
      const f = Math.max(0, 1 - v.fading / 2.2);
      (v.mesh.material as THREE.Material).transparent = true;
      v.uniforms.uFade.value = f;
      v.uniforms.uAsh.value = v.uniforms.uAsh.value.map(() => 1);
      if (f <= 0) {
        this.scene.remove(v.mesh, v.pick);
        v.mesh.geometry.dispose();
        (v.mesh.material as THREE.Material).dispose();
        v.pick.geometry.dispose();
        this.views.delete(id);
        this.shadowDirty = true;
      }
    }

    // イベント → 火の粉
    const sparkScale = this.reducedMotion ? 0.3 : 1;
    for (const e of events) {
      const pos = e.pos;
      if (!pos) continue;
      if (e.type === 'pop') this.sparks.burst(pos[0], pos[1], pos[2], Math.round((4 + 8 * (e.power ?? 0.5)) * sparkScale), 0.8 + (e.power ?? 0.5) * 0.6);
      else if (e.type === 'placedOnFire') this.sparks.burst(pos[0], pos[1], pos[2], Math.round(14 * sparkScale), 1.1);
      else if (e.type === 'collapse') this.sparks.burst(pos[0], pos[1], pos[2], Math.round(22 * sparkScale), 1.2);
      else if (e.type === 'ignite') this.sparks.burst(pos[0], pos[1] + 0.02, pos[2], Math.round(3 * sparkScale), 0.5);
    }
    // 強い風のときは少し火の粉が舞う
    if (!paused && ws.physStrength > 0.5 && sim.metrics.flamingSegs > 3 && Math.random() < dt * 6 * sparkScale * ws.physStrength) {
      const c = sim.metrics.flameCenter;
      this.sparks.burst(c[0], c[1] + 0.05, c[2], 2, 0.8);
    }
    this.updateTubeFx(sim, dt, paused, sparkScale);
    const sparkWind: [number, number] = [this.windTip.x, this.windTip.y];
    this.sparks.update(paused ? dt * 0.3 : dt, sparkWind);
    this.smoke.update(paused ? dt * 0.3 : dt, sparkWind, this.flameCenter, sim.metrics.heat);

    // 照り返し：火の総量に合わせる（ランダムな高速点滅にしない）
    const m = sim.metrics;
    const fk = 1 - Math.exp(-dt / 0.35);
    this.heatSmooth += (m.flamePower - this.heatSmooth) * fk;
    this.emberSmooth += (m.emberPower - this.emberSmooth) * fk;
    this.flameCenter.lerp(new THREE.Vector3(m.flameCenter[0], m.flameCenter[1], m.flameCenter[2]), fk);
    const lighterGlow = this.lighter.flameOn ? 0.02 : 0;
    const flick = 1 + 0.07 * Math.sin(t * 2.3) * Math.sin(t * 1.37 + 1) + 0.04 * Math.sin(t * 6.1 + Math.sin(t * 2.9));
    const fp = Math.pow(this.heatSmooth, 0.7);
    // 光源は炎の少し上に置き、近くの面だけが白く飛ばないようにする
    this.fireLight.intensity = (fp * 0.2 + lighterGlow) * flick;
    this.fireLight.position.set(this.flameCenter.x, Math.max(0.34, this.flameCenter.y + 0.2), this.flameCenter.z + 0.03);
    this.fireLight2.intensity = fp * 0.08 * (2 - flick);
    this.fireLight2.position.set(this.flameCenter.x + 0.06, Math.max(0.42, this.flameCenter.y + 0.3), this.flameCenter.z - 0.05);
    this.emberLight.intensity = Math.pow(this.emberSmooth, 0.8) * 0.035;
    this.emberLight.position.set(this.flameCenter.x, BALANCE.tray.floorY + 0.16, this.flameCenter.z + 0.06);
    if (this.lighter.flameOn) {
      this.fireLight.position.copy(this.lighter.tip).add(new THREE.Vector3(0, 0.07, 0.02));
      this.fireLight.intensity = Math.max(this.fireLight.intensity, 0.05);
    }
    // 空が少し暗く見える（火が強いと目が慣れる）
    this.hemi.intensity = this.hemiBase - Math.min(0.35, fp * 0.05);
    // 天気（雨・雪）
    if (this.weather) {
      this.weather.uniforms.uPixel.value = this.sparks.uniforms.uPixel.value;
      this.weather.update(paused ? dt * 0.35 : dt, t, this.windTip, this.flameCenter);
    }
    if (this.decor?.lanternLight.visible) this.decor.lanternLight.intensity = 0.05 * (0.92 + 0.08 * Math.sin(t * 5.3) * Math.sin(t * 2.1));

    // 台の底（熾・灰・すす）は 1秒に2回
    this.bedTimer -= dt;
    if (this.bedTimer <= 0) {
      this.bedTimer = 0.5;
      this.bed.update(sim.bedCoal, sim.bedAsh, BALANCE.bed.cells, paused ? [] : sootSpots, t);
    }

    // カメラのごく小さな呼吸
    if (!this.reducedMotion) {
      const b = Math.sin(t * 0.35) * 0.0025;
      this.camera.position.set(this.cameraBase.pos.x + Math.sin(t * 0.21) * 0.002, this.cameraBase.pos.y + b, this.cameraBase.pos.z);
      this.camera.lookAt(this.cameraBase.target);
    }

    if (this.shadowDirty && this.skyLight.castShadow) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
    }
    if (sim.pieces.some((p) => p.held)) this.renderer.shadowMap.needsUpdate = true;

    this.statsCache.flames = flames.length;
    this.statsCache.smoke = this.smoke.count;
    this.statsCache.sparks = this.sparks.count;
  }

  private addCluster(map: Map<string, { x: number; y: number; z: number; w: number }>, x: number, y: number, z: number, w: number): void {
    const cell = 0.07;
    const key = `${Math.round(x / cell)}:${Math.round(z / cell)}`;
    const c = map.get(key) ?? { x: 0, y: 0, z: 0, w: 0 };
    c.x += x * w;
    c.y += y * w;
    c.z += z * w;
    c.w += w;
    map.set(key, c);
  }

  render(frameMs: number): void {
    this.renderer.info.reset();
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    const info = this.renderer.info;
    this.statsCache.drawCalls = info.render.calls;
    this.statsCache.triangles = info.render.triangles;
    this.trackPerformance(frameMs);
  }

  /** フレーム時間に合わせて解像度と品質を下げる（育成速度は変えない） */
  private trackPerformance(frameMs: number): void {
    // 画面から離れていた間の空白は、戻ったときに計り直すので、ここへは来ない（5秒超は念のため除く）
    if (frameMs <= 0 || frameMs > 5000) return;
    this.frameTimes.push(frameMs);
    if (this.frameTimes.length > BALANCE.fx.adapt.windowFrames) this.frameTimes.shift();
    const now = performance.now();
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.statsCache.fps = 1000 / avg;
    this.statsCache.frameMs = avg;
    this.statsCache.dpr = this.dpr;
    this.statsCache.quality = this.quality;
    const A = BALANCE.fx.adapt;
    // 判定には十分なフレーム数か、とても重い端末では十分な時間（数フレームでも3秒ぶん）を待つ
    const windowMs = this.frameTimes.reduce((a, b) => a + b, 0);
    const enough = this.frameTimes.length >= A.minFrames || (windowMs >= A.minWindowMs && this.frameTimes.length >= 4);
    if (!this.autoQuality || !enough || now - this.lastAdapt < A.intervalMs || now < this.warmUntil) return;
    const max = Math.min(window.devicePixelRatio || 1, BALANCE.fx.dprMax[this.quality]);
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
    const median = q(0.5);
    // 端末が30fpsに固定している（省電力など）：きっちり33msに揃っているなら、重いのではないので下げない
    const capped30 = Math.abs(median - 1000 / 30) < 2.5 && q(0.9) < 37 && q(0.1) > 29;
    // 画面の書き換えの上限（60Hzなら約16.7ms）にきっちり揃っている＝余裕があるかもしれない
    const atRefreshCap = q(0.9) <= q(0.1) * 1.25 && median < A.slowMs;
    const slow = avg > (this.quality === 'low' ? A.lowSlowMs : A.slowMs) && !capped30;
    if (slow) {
      this.goodSince = null;
      const what = this.degrade();
      if (what) {
        if (this.lastUpgradeAt !== null && now - this.lastUpgradeAt < A.upgradeProbeMs) {
          // 上げてすぐ重くなった：しばらく上げない（行ったり来たりしない）
          this.upgradeFails += 1;
          this.lastUpgradeAt = null;
        }
        this.lastAdapt = now;
        this.adaptLog.push({ at: now, what, fps: Math.round(1000 / avg) });
        this.frameTimes = [];
      }
      return;
    }
    if (avg < A.fastMs && this.dpr < max - 0.05) {
      // 120Hzなどの画面で余裕がある
      this.upgrade(now, avg, max);
      return;
    }
    // 上限に揃っている状態が続いたら、一段だけ戻してみる（重くなったらすぐ戻し、2回失敗したらもう上げない）
    if (atRefreshCap && (this.quality === 'low' || this.dpr < max - 0.05) && this.upgradeFails < A.maxUpgradeFails) {
      if (this.goodSince === null) this.goodSince = now;
      if (now - this.goodSince >= A.upgradeAfterMs) this.upgrade(now, avg, max);
    } else this.goodSince = null;
  }

  private goodSince: number | null = null;
  private lastUpgradeAt: number | null = null;
  private upgradeFails = 0;

  /** 一段よくする（軽量→標準、または解像度を上げる） */
  private upgrade(now: number, avg: number, max: number): void {
    const A = BALANCE.fx.adapt;
    let what: string;
    if (this.quality === 'low') {
      this.quality = 'standard';
      this.composer?.dispose();
      this.setupComposer();
      this.smoke.max = BALANCE.fx.smokeMax.standard;
      this.sparks.max = BALANCE.fx.sparksMax.standard;
      this.skyLight.castShadow = true;
      this.shadowDirty = true;
      this.weather?.setShare(1);
      this.dpr = Math.min(Math.max(this.dpr, A.dprFloor), Math.min(window.devicePixelRatio || 1, BALANCE.fx.dprMax.standard));
      this.resize();
      what = '標準へ戻す（余裕があるため）';
    } else {
      this.dpr = Math.min(max, this.dpr + A.dprStep);
      this.resize();
      what = `解像度を上げる（×${this.dpr.toFixed(2)}）`;
    }
    this.lastAdapt = now;
    this.lastUpgradeAt = now;
    this.goodSince = null;
    this.adaptLog.push({ at: now, what, fps: Math.round(1000 / avg) });
    this.frameTimes = [];
  }

  /** 一段軽くする。変えたことの説明を返す（もう下げられなければ null） */
  private degrade(): string | null {
    const A = BALANCE.fx.adapt;
    if (this.quality !== 'low' && this.dpr > A.dprFloor + 0.05) {
      this.dpr = Math.max(A.dprFloor, this.dpr - A.dprStep);
      this.resize();
      return `解像度を下げる（×${this.dpr.toFixed(2)}）`;
    }
    if (this.quality !== 'low') {
      this.applyLow();
      return '軽量へ（光のにじみ・影を止め、火の粉・煙・雨雪を減らす）';
    }
    if (this.dpr > BALANCE.fx.dprMin + 0.05) {
      this.dpr = Math.max(BALANCE.fx.dprMin, this.dpr - A.dprStep);
      this.resize();
      return `解像度をさらに下げる（×${this.dpr.toFixed(2)}）`;
    }
    return null;
  }

  /** 軽量の見た目にする（燃え方・育ち方は変えない） */
  private applyLow(): void {
    this.quality = 'low';
    this.composer?.dispose();
    this.setupComposer();
    this.smoke.max = BALANCE.fx.smokeMax.low;
    this.sparks.max = BALANCE.fx.sparksMax.low;
    this.skyLight.castShadow = false;
    this.shadowDirty = true;
    this.weather?.setShare(BALANCE.fx.adapt.weatherLowShare);
    this.dpr = Math.min(this.dpr, BALANCE.fx.dprMax.low);
    this.resize();
  }

  /** 重い処理の直後（読み込み・場所の切り替え）は判定を休む */
  private warmUntil = performance.now() + BALANCE.fx.adapt.warmupMs;
  holdAdapt(ms: number = BALANCE.fx.adapt.warmupMs): void {
    this.warmUntil = performance.now() + ms;
    this.frameTimes = [];
  }

  /** 動作チェック用：WebGLの情報を読むため */
  glContext(): WebGLRenderingContext | WebGL2RenderingContext | null {
    try {
      return this.renderer.getContext();
    } catch {
      return null;
    }
  }

  stats(): SceneStats {
    return { ...this.statsCache };
  }

  /** 今の3D状態をそのまま画像にする（固定画像への置き換えはしない） */
  capture(type: 'image/png' | 'image/jpeg' = 'image/png', quality = 0.92): Promise<Blob | null> {
    this.render(0);
    return new Promise((resolve) => {
      try {
        this.renderer.domElement.toBlob((b) => resolve(b), type, quality);
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * 思い出カード用：今の画面（少し高い解像度で描き直す）と、火の中心・焚き火台の幅（画面の割合 0..1）。
   * 固定の画像ではなく、この瞬間の薪と火をそのまま使う。
   */
  async captureFrame(): Promise<{ blob: Blob; face: null; focus: { x: number; y: number; span: number }; aspect: number } | null> {
    // 火の中心（炎の少し上）と、焚き火台の左右の端
    const c = this.flameCenter;
    const fp = this.project([c.x, Math.max(c.y, BALANCE.tray.floorY) + 0.05, c.z]);
    const h = BALANCE.tray.innerHalf;
    const l = this.project([-h, BALANCE.tray.floorY, 0]);
    const r = this.project([h, BALANCE.tray.floorY, 0]);
    const focus = { x: fp.x / this.width, y: fp.y / this.height, span: Math.abs(r.x - l.x) / this.width };
    const prev = this.dpr;
    const hi = Math.min(2, Math.max(prev, 1400 / Math.max(1, this.height)));
    let blob: Blob | null = null;
    try {
      if (hi > prev + 0.05) {
        this.dpr = hi;
        this.resize();
      }
      blob = await this.capture('image/jpeg', 0.9);
    } finally {
      if (this.dpr !== prev) {
        this.dpr = prev;
        this.resize();
      }
    }
    return blob ? { blob, face: null, focus, aspect: this.width / this.height } : null;
  }

  /** 置き位置の見本や選択の強調が画面にあるか（思い出の撮影を少し待つため） */
  get busyOverlay(): boolean {
    return (this.ghost?.visible ?? false) || this.selectedId !== null;
  }

  /** 新しい火：見た目の状態を初期化 */
  reset(): void {
    for (const v of this.views.values()) {
      this.scene.remove(v.mesh, v.pick);
      v.mesh.geometry.dispose();
      (v.mesh.material as THREE.Material).dispose();
    }
    this.views.clear();
    this.bed.reset();
    this.smoke.clear();
    this.sparks.clear();
    this.shadowDirty = true;
  }

  exportVisual(): { soot: number[] } {
    return { soot: this.bed.exportSoot() };
  }

  importVisual(v: { soot?: number[] } | undefined): void {
    this.bed.importSoot(v?.soot);
  }

  dispose(): void {
    this.renderer.dispose();
    this.composer?.dispose();
    this.renderer.domElement.remove();
  }

  get noise(): THREE.Texture {
    return this.noiseTex;
  }
}

function segPositionsFor(p: Piece, pose: Pose, yOff: number): Vec3[] {
  if (p.kind === 'tinder') return [[pose.x, pose.y + yOff, pose.z]];
  const d = axisDir(pose);
  const out: Vec3[] = [];
  const n = p.segs.length;
  for (let i = 0; i < n; i++) {
    const s = -p.length / 2 + ((i + 0.5) * p.length) / n;
    out.push([pose.x + d[0] * s, pose.y + yOff + d[1] * s, pose.z + d[2] * s]);
  }
  return out;
}

/** 取り外したメッシュの形と材質を解放する（テクスチャは共有のキャッシュなので残す） */
function disposeGroup(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh && !(o as THREE.Points).isPoints && !(o as THREE.LineSegments).isLineSegments) return;
    (m.geometry as THREE.BufferGeometry | undefined)?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}
