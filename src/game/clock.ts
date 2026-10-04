/**
 * ゲーム時計：固定刻みの更新と、停止理由の集合。
 *
 * - 停止理由（画面非表示・設定・手帳・ユーザー停止・読み込み・確認中など）を複数同時に持ち、
 *   すべて解除されたときだけ時間が進む。
 * - 1フレームの経過時間は上限で切り、長い停止の後にまとめて消費しない。
 * - 描画FPSに関係なく、シミュレーションは sim.dt 刻みで進む。
 */
import { BALANCE } from './balance';

export type PauseReason = 'hidden' | 'settings' | 'journal' | 'user' | 'loading' | 'menu' | 'dialog' | 'resume';

export class GameClock {
  private reasons = new Set<PauseReason>();
  private acc = 0;
  /** 描画の補間係数 0..1 */
  alpha = 0;
  droppedSteps = 0;

  pause(r: PauseReason): void {
    this.reasons.add(r);
  }

  resume(r: PauseReason): void {
    this.reasons.delete(r);
    if (this.reasons.size === 0) this.acc = 0;
  }

  has(r: PauseReason): boolean {
    return this.reasons.has(r);
  }

  get paused(): boolean {
    return this.reasons.size > 0;
  }

  list(): PauseReason[] {
    return [...this.reasons];
  }

  /**
   * 1フレーム分進める。戻り値は実行すべきステップ数。
   * frameDt は秒。停止中は0。
   */
  advance(frameDt: number): number {
    if (this.paused) {
      this.alpha = 0;
      return 0;
    }
    const S = BALANCE.sim;
    const raw = Math.max(0, frameDt);
    const dt = Math.min(raw, S.maxFrameDt);
    // 上限を超えた分は進めない（捨てた刻みとして数える。動作チェックの結果に出す）
    if (raw > dt) this.droppedSteps += Math.floor((raw - dt) / S.dt);
    this.acc += dt;
    let steps = 0;
    while (this.acc >= S.dt - 1e-9) {
      this.acc -= S.dt;
      steps++;
      if (steps >= S.maxStepsPerFrame) {
        if (this.acc >= S.dt) this.droppedSteps += Math.floor(this.acc / S.dt);
        this.acc = Math.min(this.acc, S.dt * 0.999);
        break;
      }
    }
    this.alpha = this.acc / S.dt;
    return steps;
  }
}
