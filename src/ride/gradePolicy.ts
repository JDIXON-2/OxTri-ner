export interface GradePolicyOptions {
  minGrade: number;
  maxGrade: number;
  /** 0–100 %: scales the grade sent to the trainer only; physics keeps the true grade. */
  difficulty: number;
  minIntervalMs?: number;
  /** Smallest change worth sending, in % grade. */
  threshold?: number;
  /** Largest change per update, in % grade. */
  maxStep?: number;
}

/** Decides when and what grade to send: ≤1 send/s, ≥0.1 % change, clamped, scaled, ramped. */
export class GradePolicy {
  private lastSent: number | null = null;
  private lastAt = -Infinity;

  constructor(public opts: GradePolicyOptions) {}

  /** Returns the grade to send now, or null if nothing should be sent. */
  update(targetGrade: number, nowMs: number): number | null {
    const {
      minGrade,
      maxGrade,
      difficulty,
      minIntervalMs = 1000,
      threshold = 0.1,
      maxStep = 1,
    } = this.opts;
    const clamped = Math.min(maxGrade, Math.max(minGrade, targetGrade));
    const desired = clamped * (difficulty / 100);
    if (this.lastSent === null) return this.commit(desired, nowMs);
    if (nowMs - this.lastAt < minIntervalMs) return null;
    const delta = desired - this.lastSent;
    if (Math.abs(delta) < threshold - 1e-9) return null;
    return this.commit(this.lastSent + Math.min(maxStep, Math.max(-maxStep, delta)), nowMs);
  }

  /** Forget what the trainer has (new mode, or control lost) so the next update sends. */
  reset(): void {
    this.lastSent = null;
    this.lastAt = -Infinity;
  }

  private commit(grade: number, nowMs: number): number {
    this.lastSent = Math.round(grade * 100) / 100;
    this.lastAt = nowMs;
    return this.lastSent;
  }
}
