/**
 * balance.ts — ゲームの全パラメータをここへ集約する。
 *
 * 数値はゲーム用に圧縮した値で、実際の木材・燃焼の物理量を保証しない。
 * 詳細仕様v3.1と 05_data/game_seed.json の値を初期値として使い、
 * 第0段階で追加した燃焼モデルの係数もここに置く。
 * 実機プレイで調整する前提。調整したら tests/ のシナリオで因果を確認すること。
 */

export const BALANCE = {
  /** 固定刻みのシミュレーション（描画FPSから独立） */
  sim: {
    hz: 10,
    dt: 0.1,
    /**
     * 1フレームで受け付ける最大の経過時間。長い停止後の暴走を防ぐ。
     * 0.5秒＝2fpsまでは実時間どおりに進む（第3段階：とても重い端末でも育つ速さを変えないよう 0.25→0.5）
     */
    maxFrameDt: 0.5,
    /** 1フレームで進める最大ステップ数。超過分は捨てる（まとめて消費しない） */
    maxStepsPerFrame: 6,
  },

  /** 詳細仕様2章・game_seed.json */
  session: {
    shortSeconds: 600,
    longSeconds: 1200,
    emberStartRatio: 0.82,
    emberNoticeLeadSeconds: 15,
    /**
     * 自然な燃料切れ：炎も赤い薪もなく、熾の発熱（表示の火力の元）がこの値未満のまま spentConfirmSeconds 続いたら、
     * その時点から熾火の時間へ入る（風を送っても火を戻せない弱さ。詳細仕様：熾火は「終盤、または燃料が尽きる」）
     */
    spentEmberPower: 1.2,
    spentConfirmSeconds: 10,
    /** この温度以上で燃料の残る薪があれば「温まっている途中」として、燃料切れに数えない（薪を置く・動かす・風を送るでも数え直す） */
    spentWarmT: 0.45,
    /** 第0段階の目標：中薪が安定して燃え続けた秒数 */
    stage0StableSeconds: 10,
  },

  /**
   * 落ち着いた火（安定）の判定。続けて眺める発見課題・思い出の「火の様子」・案内に使う。
   * （以前は火の精の成長に使っていた範囲。キャラクターは 2026-10-04 に企画から外した）
   */
  stable: { heatMin: 35, heatMax: 80, oxygenMin: 45, oxygenMax: 85, smokeMax: 40, afterIgnitionSeconds: 30 },
  /** 火の世話の発見課題と案内（強すぎる火・こもった煙を落ち着かせる、熾から火を戻す、風で火を渡す） */
  fireCare: {
    /** 強すぎる火：この火力を超えた状態が hotHoldSeconds 続いたら「強すぎる」。案内も出す */
    hotAbove: 88,
    hotHoldSeconds: 10,
    /** 落ち着いた：火力がこの値以下（表示の「強すぎ」を抜けた）で calmHoldSeconds 続いた（以前の「おじ火の気配」からの回復と同じ値） */
    calmHeatAtMost: 85,
    calmHoldSeconds: 8,
    /** こもった煙：煙が hints.smokyAt を超えて smokyHoldSeconds 続いた後、smokeClearBelow 未満で smokeClearHoldSeconds 続けば「空気が通った」 */
    smokyHoldSeconds: 10,
    smokeClearBelow: 30,
    smokeClearHoldSeconds: 8,
    /** 熾から戻す：炎がなく熾だけの状態が emberOnlySeconds 続いた後、reviveFlamingSegs 区間以上がまた燃えた */
    emberOnlySeconds: 3,
    reviveFlamingSegs: 2,
    /** 戻る前のこの秒数のうちに火吹き筒を吹いていれば「火吹き筒で戻した」 */
    tubeCreditSeconds: 15,
    /** 風を送ってこの秒数のうちに細薪へ火が移れば「風で火を渡した」 */
    windSpreadSeconds: 6,
    /** 大きな火：表示の火力がこの値に届いた */
    bigFireHeat: 70,
    /** 組み替えとして数える、薪を動かした距離（m。見た目だけの往復は数えない） */
    rearrangeMinMove: 0.03,
  },
  /** 思い出の写真：火力がこの値を初めて超えたときに撮り直す（大きい値ほど優先）。熾火に入っても写真がなければ撮る */
  keepsake: { heatSteps: [45, 60, 75] as const, delayMs: 5500 },
  /** 発見課題（詳細仕様7章） */
  discovery: {
    /** 「60秒×modeScale 連続で落ち着いた火を眺める」 */
    stableWatchSeconds: 60,
    /** 「思い出をこの数だけ残す」 */
    albumCount: 5,
  },
  /** 見送り */
  farewell: {
    /** 自然な終わり：見送りを始めるのは終了の何秒前か */
    lastWordsBeforeEndSeconds: 10,
    /** 「今日はここまで」：消火の演出 */
    manualSeconds: 15,
  },

  /** 焚き火台（メートル）。無銘の低い金属トレイ */
  tray: {
    innerHalf: 0.29,
    floorY: 0.085,
    wallHeight: 0.078,
    wallThickness: 0.004,
    legHeight: 0.08,
    /** 積み上げの上限（床からの高さ） */
    maxStackHeight: 0.3,
  },

  /** 燃料片の形と量。fuelは燃料単位（詳細仕様：中薪12、しめり木14） */
  pieces: {
    tinder: {
      label: '火口',
      maxCount: 1,
      radius: 0.052,
      height: 0.034,
      segments: 1,
      fuel: 1.6,
      /** 熱の受けやすさ（1/熱容量） */
      gain: 2.6,
      /** 冷め方（/秒, T=1のとき） */
      cool: 0.55,
      /** 燃焼中の自己加熱の割合 */
      selfHeat: 1.1,
      /** 燃焼中1区間の発熱（I=1） */
      power: 1.9,
      /** I=1での燃料消費（単位/秒・区間） */
      burn: 0.068,
      /** 熾火化しにくい（ほぼ灰になる） */
      emberable: false,
    },
    kindling: {
      label: '細薪',
      maxCount: 6,
      length: 0.3,
      radius: 0.011,
      segments: 6,
      fuel: 3.0,
      gain: 0.9,
      cool: 0.34,
      selfHeat: 1.4,
      power: 0.3,
      burn: 0.0085,
      emberable: true,
    },
    medium: {
      label: '中薪',
      maxCount: 5,
      lengthMin: 0.34,
      lengthMax: 0.4,
      radius: 0.036,
      segments: 8,
      fuel: 12,
      gain: 0.11,
      cool: 0.04,
      selfHeat: 0.42,
      power: 0.36,
      burn: 0.0058,
      emberable: true,
    },
    /**
     * 太薪（詳細仕様：太薪は火が育った後で選べる。大きな火や熾火の時間を変える。初動から自動で燃えない）。
     * 太く、温まりにくく、燃料が多い（中薪の約2倍）。炎の強さあたりの発熱は少し大きく、熾が長く残る。
     */
    large: {
      label: '太薪',
      maxCount: 5,
      lengthMin: 0.36,
      lengthMax: 0.42,
      radius: 0.05,
      segments: 8,
      fuel: 24,
      gain: 0.07,
      cool: 0.032,
      selfHeat: 0.45,
      power: 0.4,
      burn: 0.0058,
      emberable: true,
    },
  },

  /** 中薪と太薪の共通の枠（詳細仕様：中薪・太薪は最大5本。火口・細薪は別枠） */
  logs: {
    maxTotal: 5,
    /** 太薪は火が育った後（第0段階：中薪が安定して燃えた後）で選べる */
    largeNeedsStage0: true,
  },

  /** 熱の伝わり方（距離・接触・上昇気流） */
  heat: {
    /** 放射：K / (1 + (gap/gapScale)^2) */
    radiative: 0.34,
    radiativeGapScale: 0.028,
    /** 対流（上昇する炎と熱気）：真上ほど強い */
    convective: 0.4,
    plumeBaseWidthByKind: { tinder: 0.032, kindling: 0.024, medium: 0.03, large: 0.034 },
    /**
     * 熱源の種類→受ける薪の種類ごとの効き。
     * 火口の小さく短い炎は細薪を温めるが、中薪の表面を着火点まで上げにくい。
     */
    coupling: {
      tinder: { tinder: 1, kindling: 1, medium: 0.3, large: 0.15 },
      kindling: { tinder: 1, kindling: 1, medium: 1, large: 0.6 },
      medium: { tinder: 1, kindling: 1, medium: 1, large: 1 },
      large: { tinder: 1, kindling: 1, medium: 1, large: 1 },
    },
    plumeSpread: 0.33,
    plumeDecayHeight: 0.2,
    /** 炎の高さの違い（熱が届く高さ） */
    plumeScaleByKind: { tinder: 0.75, kindling: 0.6, medium: 1.2, large: 1.3 },
    /** 真横より少し下にも弱く届く（接触側） */
    belowReach: 0.02,
    /** 同じ薪の隣の区間へ火が這う */
    creep: 0.075,
    /** 熾火（赤熱）の発熱 */
    emberPower: 0.13,
    /** 風による炎の傾きが熱の向きを変える量 */
    windPlumeTilt: 1.4,
    /** 風で炎が倒れると、横へ届く距離が伸びる */
    windPlumeLean: 0.04,
    /** 着火具：火口へ接したときの熱 */
    lighterPower: 0.5,
    lighterReach: 0.03,
    /** 火口以外（細薪・中薪）へのライターの効き。太い薪は実質着かない */
    lighterCouplingByKind: { tinder: 1, kindling: 0.07, medium: 0.012, large: 0.005 },
    lighterSeconds: 2.6,
    /** 湿りによる加熱の損失と乾燥速度 */
    moistureGainLoss: 1.15,
    dryRate: 0.02,
  },

  /** 着火と燃焼 */
  burn: {
    igniteT: 1.0,
    /** 燃焼に必要な最低の空気（局所） */
    igniteAirMin: 0.15,
    /** 炎の強さの追従速度（/秒） */
    flameGrow: 0.7,
    flameDecay: 1.3,
    /** 温度による炎の維持 smoothstep(lo, hi, T) */
    flameTempLo: 0.72,
    flameTempHi: 1.3,
    /** 空気による炎の強さ smoothstep(lo, hi, air) */
    flameAirLo: 0.18,
    flameAirHi: 0.72,
    /** 燃料が少なくなると炎が細る smoothstep(0, x, f/f0) */
    flameFuelKnee: 0.22,
    /** 焦げの進み方 */
    charRate: 0.22,
    charStartT: 0.55,
    /** 熾火（赤熱）の目標と消費 */
    emberCharMin: 0.45,
    emberTempLo: 0.45,
    emberTempHi: 1.1,
    emberGrow: 0.35,
    emberDecay: 0.25,
    emberBurn: 0.0016,
    emberSelfHeat: 0.55,
    /** 最大温度（表示・計算の上限） */
    maxT: 2.6,
    /** 燃料がこれ未満の区間は灰 */
    ashFuelRatio: 0.04,
  },

  /** 空気（見えている隙間・床・混雑・送風） */
  air: {
    base: 0.95,
    crowdReach: 0.034,
    /** 混雑の効き方（火口はふわっとして周りに左右されにくい） */
    crowdWeight: { tinder: 0.07, kindling: 0.14, medium: 0.18, large: 0.2 },
    floorContactPenalty: { tinder: 0.0, kindling: 0.1, medium: 0.12, large: 0.13 },
    floorContactTolerance: 0.006,
    liftedBonus: 0.06,
    liftedHeight: 0.015,
    /** 火口の上に重い薪が乗ると潰れて空気が減る */
    tinderCompressedPenalty: 0.26,
    /** 周りの炎が空気を奪い合う */
    competitionReach: 0.1,
    competitionMax: 0.32,
    competitionScale: 1.6,
    /** 送風で入る空気 */
    windAir: 0.55,
    max: 1.5,
  },

  /** 風：まず炎の向き（見た目）→遅れて火力（シミュレーション） */
  wind: {
    /** 送風の強さ3段階 */
    levels: [0.34, 0.6, 0.95] as const,
    levelLabels: ['弱', '中', '強'] as const,
    /** 一度送る：立ち上がり・保持・減衰（秒） */
    gustAttack: 0.35,
    gustHold: 1.4,
    gustRelease: 1.3,
    /** 連打は有利にしない：この間隔より短い送風は無視（強まらない） */
    minInterval: 0.9,
    /** 火力へ効き始めるまでの遅れ（秒） */
    physicalDelay: 1.0,
    physicalTau: 0.8,
    /** 見た目：炎の根元と先端の追従（先端は遅れる） */
    visualRootTau: 0.14,
    visualTipTau: 0.5,
    /** 周囲のそよ風（seed付き） */
    ambientMin: 0.03,
    ambientMax: 0.12,
    ambientChangeSeconds: 7,
    /** 送りすぎ：これを超えると小さな炎は吹き消されやすく、薄い薪は冷える */
    overBlowThreshold: 0.72,
    overBlowFlameMax: 0.45,
    overBlowRate: 2.6,
    /** 風で冷える：この強さを超えた分だけ（薄い薪ほど冷えやすい） */
    coolFrom: 0.3,
    coolBoostThin: 0.9,
    coolBoostThick: 0.2,
    burnBoost: 0.8,
    /** 太い薪は風で燃え盛る（熱の出方が増える）。細い炎は吹き消されやすい（overBlow） */
    heatBoostThick: 0.9,
  },

  /**
   * 火吹き筒（詳細仕様：道具は火ばさみ・うちわ・火吹き筒。火吹き筒は細かな送風向けの操作差で、上位互換にしない）。
   * うちわ：広い風。炎を風下へ傾けて燃え移りを助ける。外側の薪ほどよく効く。
   * 火吹き筒：狙った一点へ細い風。炎は傾けない（燃え移りは助けない）が、詰まった奥や底の熾まで届く。
   *   強く吹くと、その点の小さな炎は吹き消える（狙う場所が大事）。
   */
  tube: {
    /** 強さ2段階（狙った点での強さ。うちわの風と同じ単位） */
    levels: [0.6, 1.5] as const,
    levelLabels: ['そっと', 'しっかり'] as const,
    /** 横への広がり（m。ガウスのσ）。うちわは台全体 */
    sigma: 0.032,
    /** 狙う高さ（台の床から）と、上への届き方（m） */
    aimHeight: 0.012,
    reachUp: 0.05,
    /** ひと吹き：立ち上がり・保持・終わり（秒）。息なので遅れはほとんどない */
    attack: 0.2,
    hold: 1.6,
    release: 0.4,
    /** 息継ぎ：この間隔より短いひと吹きは受け付けない（連打は強くしない） */
    minInterval: 3,
    /** 空気の届き方：うちわは外側ほど効く（exposure）が、筒の風は詰まった所にも同じように届く */
    airGain: 1.0,
    /** 酸素表示への加算（ひと吹きの間・狙った所に火があるとき） */
    oxygenBonus: 8,
    /** 解放：発見の数（初期は火ばさみとうちわ） */
    unlockAt: 3,
  },

  /** 台の底にたまる熾（おき）と灰。燃えた燃料の一部が落ちて赤く熾り、近くの薪を下から温める */
  bed: {
    cells: 12,
    /** 燃えた燃料のうち熾として落ちる割合（木毛の火口はほとんど灰になる） */
    coalFromFuel: { tinder: 0.08, kindling: 0.3, medium: 0.42, large: 0.45 },
    /** 熾の燃え尽き（/秒）。薪が燃え尽きた後も数分は熾が残り、新しい薪を置いて風を送れば火が戻る */
    coalDecay: 0.006,
    coalMax: 1.6,
    /** 熾1単位の発熱（表示の火力へ入る分） */
    power: 0.4,
    reach: 0.11,
    /** 底の熾から、上や接している薪へ伝わる熱の倍率（表示の火力には入れない） */
    contact: 1.9,
    /** 送風で熾（底の熾・薪の赤熱）が明るくなる割合：発熱 ×(1 + windGlow × 風の強さ) */
    windGlow: 3.5,
    /** 灰の積もり方（見た目） */
    ashFromCoal: 0.6,
  },

  /**
   * 煙（湿り・空気不足・くすぶり）。
   * ふつうに燃えている乾いた薪の火を「煙たい」と扱わない。煙が増えるのは、温まっている途中の薪・
   * 空気が足りない熾やくすぶり・湿った薪のとき。
   */
  smoke: {
    warming: 0.55,
    /** 温まっている途中の煙：乾いた薪の分（湿りがあると増える） */
    warmingDry: 0.2,
    smolder: 1.4,
    /** くすぶりの煙は、局所の空気がこの範囲より少ないときに出る */
    smolderAirLo: 0.15,
    smolderAirHi: 0.55,
    moistFlame: 3.0,
    /** これ以下の湿りは乾いた薪として煙に数えない */
    moistDry: 0.08,
    poorAirFlame: 1.6,
    /** 空気不足の煙は、局所の空気がこの範囲より少ないときだけ（ふつうに燃える大きな火を煙たく扱わない） */
    poorAirLo: 0.14,
    poorAirHi: 0.46,
    flameout: 6,
    base: 0.05,
    displayScale: 13,
    smoothTau: 1.5,
  },

  /** 表示用の集計（通常画面には数値を出さない。手帳のみ） */
  display: {
    /** 火力0〜100への換算。中薪4本の井桁で「強め」の手前、5本＋強い送風で「強すぎ」に届く */
    heatScale: 12.5,
    /** 火力の表示はなめらかに（送風の一吹きごとに上下しない） */
    heatSmoothTau: 3,
    oxygenFromAir: 72,
    oxygenWindBonus: 18,
  },

  /** 案内の判定 */
  hints: {
    /** 火口が燃えているのに細薪が温まらないとき、何秒で案内するか */
    kindlingColdAfter: 7,
    kindlingWarmT: 0.35,
    /** 煙が多いときの案内 */
    smokyAt: 45,
    /** 湿った薪が多いときの一言（燃えている薪の湿りの平均と、煙） */
    dampAt: 0.4,
    dampSmokeAt: 25,
    /** 新しい薪が温まっている途中で、火が弱いときの案内（風を送ると早く移る） */
    weakHeatAt: 35,
    /** 熱を受け始めた薪（置いた直後でも、熾や炎の上ならすぐこの温度を超える。離れた冷たい薪は超えない） */
    receivingHeatT: 0.04,
    /** 空気が足りないときの案内・一言（燃えている間の酸素の表示値） */
    airLowAt: 40,
    /** 薪を足す案内・一言（残りの燃料の割合。第0段階の後だけ） */
    fuelLowRatio: 0.3,
    /** 第0段階の前の「小さな火が育っています」（火力がこれ未満） */
    smallFireHeat: 30,
  },

  /** 保存 */
  save: {
    /** 燃えている間の自動保存の間隔 */
    autosaveMs: 10000,
  },

  /** 描画・演出（見た目のみ。シミュレーションへは影響しない） */
  fx: {
    sparksMax: { high: 80, standard: 80, low: 30 },
    smokeMax: { high: 140, standard: 110, low: 50 },
    dprMax: { high: 2, standard: 1.75, low: 1.25 },
    dprMin: 0.85,
    /**
     * 自動の画質調整（設定「自動」のとき）。育つ速さ・燃え方は変えず、見た目だけを軽くする。
     * 重い順に：解像度を下げる（dprFloor まで）→ 軽量（ブルーム・影を止め、火の粉・煙・雨雪を減らす）
     * → さらに解像度（dprMin まで）。60fpsの目標なら slowMs（約49fps）を超えたら、軽量では lowSlowMs（約28fps）を超えたら下げる。
     */
    adapt: {
      windowFrames: 90,
      minFrames: 60,
      minWindowMs: 3000,
      intervalMs: 2500,
      /** 読み込み直後・場所の切り替え直後は、シェーダーの準備で一時的に重いので判定しない */
      warmupMs: 4000,
      slowMs: 20.5,
      lowSlowMs: 36,
      fastMs: 13,
      dprStep: 0.25,
      dprFloor: 1,
      /** 軽量にしたときの雨・雪の粒の割合 */
      weatherLowShare: 0.4,
      /** 画面の上限に揃って余裕がありそうな状態がこれだけ続いたら、一段戻してみる */
      upgradeAfterMs: 20000,
      /** 戻してからこの時間のうちに重くなったら、失敗として数える（2回でもう戻さない） */
      upgradeProbeMs: 15000,
      maxUpgradeFails: 2,
    },
  },
} as const;

export type PieceKind = 'tinder' | 'kindling' | 'medium' | 'large';
export const PIECE_KINDS: PieceKind[] = ['tinder', 'kindling', 'medium', 'large'];
/** 中薪と太薪は合わせて数える（詳細仕様：中薪・太薪は最大5本） */
export function isLog(kind: PieceKind): boolean {
  return kind === 'medium' || kind === 'large';
}

/** 樹種（詳細仕様6章。熱係数・燃焼速度係数・初期の湿り） */
export type WoodId =
  | 'nara'
  | 'kunugi'
  | 'shirakaba'
  | 'sakura'
  | 'ringo'
  | 'kaede'
  | 'keyaki'
  | 'buna'
  | 'sugi'
  | 'hinoki'
  | 'matsu'
  | 'shimerigi';

export interface WoodSpec {
  id: WoodId;
  label: string;
  heat: number;
  burnRate: number;
  moisture: number;
  hardwood: boolean;
  unlockedInitially: boolean;
  /** 爆ぜやすさ（音と火の粉の頻度） */
  crackle: number;
  bark: 'ridged' | 'white' | 'smooth' | 'plate';
  /** 中薪・太薪の燃料の倍率（しめり木は水を含んで重く、長く残る） */
  fuelScale?: number;
}

export const WOODS: Record<WoodId, WoodSpec> = {
  nara: { id: 'nara', label: 'なら', heat: 1.0, burnRate: 0.85, moisture: 0.1, hardwood: true, unlockedInitially: true, crackle: 0.8, bark: 'ridged' },
  kunugi: { id: 'kunugi', label: 'くぬぎ', heat: 1.1, burnRate: 0.8, moisture: 0.12, hardwood: true, unlockedInitially: true, crackle: 0.7, bark: 'ridged' },
  shirakaba: { id: 'shirakaba', label: 'しらかば', heat: 0.95, burnRate: 1.15, moisture: 0.08, hardwood: true, unlockedInitially: true, crackle: 1.1, bark: 'white' },
  sakura: { id: 'sakura', label: 'さくら', heat: 0.9, burnRate: 0.95, moisture: 0.1, hardwood: true, unlockedInitially: true, crackle: 0.9, bark: 'smooth' },
  ringo: { id: 'ringo', label: 'りんご', heat: 0.88, burnRate: 0.9, moisture: 0.12, hardwood: true, unlockedInitially: false, crackle: 0.8, bark: 'plate' },
  kaede: { id: 'kaede', label: 'かえで', heat: 1.0, burnRate: 0.9, moisture: 0.1, hardwood: true, unlockedInitially: false, crackle: 0.8, bark: 'plate' },
  keyaki: { id: 'keyaki', label: 'けやき', heat: 1.08, burnRate: 0.95, moisture: 0.12, hardwood: true, unlockedInitially: false, crackle: 1.0, bark: 'plate' },
  buna: { id: 'buna', label: 'ぶな', heat: 0.92, burnRate: 0.88, moisture: 0.12, hardwood: true, unlockedInitially: false, crackle: 0.7, bark: 'smooth' },
  sugi: { id: 'sugi', label: 'すぎ', heat: 1.12, burnRate: 1.3, moisture: 0.08, hardwood: false, unlockedInitially: false, crackle: 1.3, bark: 'ridged' },
  hinoki: { id: 'hinoki', label: 'ひのき', heat: 1.05, burnRate: 1.2, moisture: 0.08, hardwood: false, unlockedInitially: false, crackle: 1.1, bark: 'ridged' },
  matsu: { id: 'matsu', label: 'まつ', heat: 1.2, burnRate: 1.35, moisture: 0.1, hardwood: false, unlockedInitially: false, crackle: 1.4, bark: 'plate' },
  shimerigi: { id: 'shimerigi', label: 'しめり木', heat: 0.65, burnRate: 0.7, moisture: 0.7, hardwood: false, unlockedInitially: false, crackle: 0.5, bark: 'ridged', fuelScale: 7 / 6 },
};

/** 第0段階で選べる樹種（開始時解放の4種） */
export const INITIAL_WOODS: WoodId[] = ['nara', 'kunugi', 'shirakaba', 'sakura'];

/** 種類ごとの既定樹種。火口は細かな木毛（樹種を持たないが計算上はしらかば相当） */
export const DEFAULT_SPECIES: Record<PieceKind, WoodId> = {
  tinder: 'shirakaba',
  kindling: 'shirakaba',
  medium: 'nara',
  large: 'nara',
};

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
