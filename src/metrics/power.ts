export interface PowerSnapshot {
  power: number;
  avg3: number;
  avg30: number;
  avg: number;
  max: number;
  /** Normalized power; falls back to average power until 30 s of data exist. */
  np: number;
  if: number;
  tss: number;
  kj: number;
  avgCadence: number;
  elapsedS: number;
  movingS: number;
}

/** Live ride metrics. Pure: all time comes from the `dt` passed to `add`. */
export class PowerMetrics {
  private clock = 0;
  private win: { t: number; p: number }[] = [];
  private sumPdt = 0;
  private sumDt = 0;
  private maxP = 0;
  private joules = 0;
  private cadSum = 0;
  private cadT = 0;
  private moving = 0;
  private np4Sum = 0;
  private np4N = 0;
  private lastP = 0;

  /** `dt` is seconds since the previous sample (0 for the first). */
  add(power: number, cadence: number, dt: number): void {
    this.clock += dt;
    this.lastP = power;
    this.win.push({ t: this.clock, p: power });
    while (this.win.length && this.win[0].t <= this.clock - 30 + EPS) this.win.shift();
    this.sumPdt += power * dt;
    this.sumDt += dt;
    this.maxP = Math.max(this.maxP, power);
    this.joules += power * dt;
    if (cadence > 0) {
      this.cadSum += cadence * dt;
      this.cadT += dt;
    }
    if (cadence > 0 || power > 0) this.moving += dt;
    if (this.clock >= 30 - EPS) {
      this.np4Sum += this.windowAvg(30) ** 4;
      this.np4N++;
    }
  }

  get elapsedS(): number {
    return this.clock;
  }

  private windowAvg(sec: number): number {
    const from = this.clock - sec + EPS;
    let sum = 0;
    let n = 0;
    for (const s of this.win) {
      if (s.t > from) {
        sum += s.p;
        n++;
      }
    }
    return n ? sum / n : 0;
  }

  snapshot(ftp: number): PowerSnapshot {
    const avg = this.sumDt > 0 ? this.sumPdt / this.sumDt : this.lastP;
    const np = this.np4N ? (this.np4Sum / this.np4N) ** 0.25 : avg;
    const ifactor = ftp > 0 ? np / ftp : 0;
    return {
      power: this.lastP,
      avg3: this.windowAvg(3),
      avg30: this.windowAvg(30),
      avg,
      max: this.maxP,
      np,
      if: ifactor,
      tss: ftp > 0 ? ((this.clock * np * ifactor) / (ftp * 3600)) * 100 : 0,
      kj: this.joules / 1000,
      avgCadence: this.cadT > 0 ? this.cadSum / this.cadT : 0,
      elapsedS: this.clock,
      movingS: this.moving,
    };
  }
}

const EPS = 1e-6;
