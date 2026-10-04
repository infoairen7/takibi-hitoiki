/**
 * 推奨の組み方4種（詳細仕様6章）。
 * 座標は「置きたい位置と向き」だけ。高さ・傾き・支持点は placement.ts が
 * その時点の薪から計算するので、瞬間移動ではなく一本ずつ置く工程になる。
 */
import { PieceKind } from '../balance';

export type LayoutId = 'yuttari' | 'igeta' | 'tatekake' | 'yose';

export interface LayoutStep {
  kind: PieceKind;
  x: number;
  z: number;
  /** 度。0=左右方向、90=奥行き方向 */
  yawDeg: number;
}

export interface LayoutDef {
  id: LayoutId;
  label: string;
  /**
   * 詳細仕様6章の「基礎空気量」（設計値）。ゲームの空気はこの値を直接使わず、薪の配置（混雑・床との接触・浮き）から計算する。
   * 燃えている間の酸素がこの順（立てかけ＞井桁＞ゆったり＞寄せ）になることを tests/fire.test.ts で確かめている。
   */
  baseAir: number;
  summary: string;
  steps: LayoutStep[];
}

export const LAYOUTS: Record<LayoutId, LayoutDef> = {
  tatekake: {
    id: 'tatekake',
    label: '立てかけ型',
    baseAir: 85,
    summary: '奥の薪へ細薪を立てかける。高い炎になりやすい。',
    steps: [
      { kind: 'medium', x: 0, z: -0.1, yawDeg: 0 },
      { kind: 'tinder', x: 0, z: -0.02, yawDeg: 0 },
      { kind: 'kindling', x: -0.06, z: -0.01, yawDeg: 90 },
      { kind: 'kindling', x: -0.02, z: -0.01, yawDeg: 90 },
      { kind: 'kindling', x: 0.02, z: -0.01, yawDeg: 90 },
      { kind: 'kindling', x: 0.06, z: -0.01, yawDeg: 90 },
      { kind: 'medium', x: -0.125, z: 0.0, yawDeg: 90 },
      { kind: 'medium', x: 0.125, z: 0.0, yawDeg: 90 },
      { kind: 'medium', x: 0, z: 0.035, yawDeg: 0 },
    ],
  },
  yuttari: {
    id: 'yuttari',
    label: 'ゆったり型',
    baseAir: 65,
    summary: '2本の薪に細薪を渡す。状態が読みやすい。',
    steps: [
      { kind: 'medium', x: 0, z: -0.09, yawDeg: 0 },
      { kind: 'medium', x: 0, z: 0.09, yawDeg: 0 },
      { kind: 'tinder', x: 0, z: 0, yawDeg: 0 },
      { kind: 'kindling', x: -0.04, z: 0, yawDeg: 90 },
      { kind: 'kindling', x: 0, z: 0, yawDeg: 90 },
      { kind: 'kindling', x: 0.04, z: 0, yawDeg: 90 },
      { kind: 'medium', x: 0, z: 0, yawDeg: 0 },
    ],
  },
  igeta: {
    id: 'igeta',
    label: '井桁型',
    baseAir: 75,
    summary: '井の字に組む。空気が通り、育ちが速い。',
    steps: [
      { kind: 'medium', x: -0.1, z: 0, yawDeg: 90 },
      { kind: 'medium', x: 0.1, z: 0, yawDeg: 90 },
      { kind: 'tinder', x: 0, z: 0, yawDeg: 0 },
      { kind: 'kindling', x: 0, z: -0.057, yawDeg: 0 },
      { kind: 'kindling', x: 0, z: -0.019, yawDeg: 0 },
      { kind: 'kindling', x: 0, z: 0.019, yawDeg: 0 },
      { kind: 'kindling', x: 0, z: 0.057, yawDeg: 0 },
      { kind: 'medium', x: 0, z: -0.105, yawDeg: 0 },
      { kind: 'medium', x: 0, z: 0.105, yawDeg: 0 },
    ],
  },
  yose: {
    id: 'yose',
    label: '寄せ薪型',
    baseAir: 45,
    summary: '低く寄せて組む。小さく落ち着くが、詰めすぎに注意。',
    steps: [
      { kind: 'tinder', x: 0, z: 0, yawDeg: 0 },
      { kind: 'kindling', x: 0, z: 0, yawDeg: 30 },
      { kind: 'kindling', x: 0, z: 0, yawDeg: 150 },
      { kind: 'medium', x: 0, z: -0.092, yawDeg: 0 },
      { kind: 'medium', x: 0, z: 0.092, yawDeg: 0 },
      { kind: 'medium', x: 0, z: 0, yawDeg: 0 },
    ],
  },
};

export const LAYOUT_ORDER: LayoutId[] = ['yuttari', 'igeta', 'tatekake', 'yose'];

/**
 * 自由配置で最初に表示する置き位置の候補。
 * 既に置かれた数に応じて、立てかけ型の位置を順に提案する。
 */
export function suggestedSpot(kind: PieceKind, countOfKind: number): { x: number; z: number; yawDeg: number } {
  // 太薪は中薪と同じ位置の候補を使う（見本の組み方に太薪は無い）
  const k0 = kind === 'large' ? 'medium' : kind;
  const steps = LAYOUTS.tatekake.steps.filter((s) => s.kind === k0);
  const s = steps[countOfKind % Math.max(1, steps.length)];
  if (s && countOfKind < steps.length) return { x: s.x, z: s.z, yawDeg: s.yawDeg };
  // 候補を使い切ったら、手前側に少しずつずらす
  const k = countOfKind - steps.length;
  return { x: -0.12 + 0.08 * (k % 4), z: 0.12, yawDeg: kind === 'kindling' ? 90 : 0 };
}

/** キーボード・タップだけでも選べる置き位置の候補（4つの組み方から、その種類の位置を集める） */
export function candidateSpots(kind: PieceKind): Array<{ x: number; z: number; yawDeg: number }> {
  const seen = new Set<string>();
  const out: Array<{ x: number; z: number; yawDeg: number }> = [];
  for (const id of LAYOUT_ORDER) {
    for (const st of LAYOUTS[id].steps) {
      if (st.kind !== (kind === 'large' ? 'medium' : kind)) continue;
      const key = `${st.x.toFixed(3)}:${st.z.toFixed(3)}:${st.yawDeg}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x: st.x, z: st.z, yawDeg: st.yawDeg });
    }
  }
  return out;
}
