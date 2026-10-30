import type { CalibrationPoint } from './effortCurve';

export type CalibrationPhase = 'idle' | 'ramp' | 'measure' | 'done' | 'cancelled';

export interface CalibrationState {
  phase: CalibrationPhase;
  levelIndex: number;
  level: number | null;
  phaseDurationS: number;
  phaseRemainingS: number;
  livePower: number;
  /** Running average over the measuring window so far; null outside it. */
  liveAverage: number | null;
  results: CalibrationPoint[];
}

export interface CalibrationOptions {
  /** Time to get up to the effort before measuring starts. */
  rampS?: number;
  /** Time over which the average power is taken. */
  measureS?: number;
  onLevelDone?: (p: CalibrationPoint) => void;
}

/**
 * Guides a rider through effort levels: for each, `rampS` seconds to reach the effort, then
 * `measureS` seconds averaged into a watts value. Advanced by trainer samples (never a timer), so a
 * throttled background tab can't corrupt it; time comes from the `dt` the caller measured.
 */
export class CalibrationRunner {
  private phase: CalibrationPhase = 'idle';
  private levelIndex = 0;
  private phaseElapsed = 0;
  private sumPdt = 0;
  private sumDt = 0;
  private livePower = 0;
  private results: CalibrationPoint[] = [];
  private rampS: number;
  private measureS: number;
  private onLevelDone?: (p: CalibrationPoint) => void;

  constructor(
    private levels: number[],
    opts: CalibrationOptions = {},
  ) {
    this.rampS = opts.rampS ?? 10;
    this.measureS = opts.measureS ?? 10;
    this.onLevelDone = opts.onLevelDone;
  }

  start(): void {
    if (this.levels.length === 0) return;
    this.results = [];
    this.levelIndex = 0;
    this.beginPhase('ramp');
  }

  cancel(): void {
    if (this.phase === 'ramp' || this.phase === 'measure') this.phase = 'cancelled';
  }

  get active(): boolean {
    return this.phase === 'ramp' || this.phase === 'measure';
  }

  /** `dtS` is seconds since the previous sample (0 for the first after `start`). */
  update(dtS: number, powerW: number): CalibrationState {
    this.livePower = powerW;
    let remaining = Math.max(0, dtS);
    // A long step can straddle a phase boundary, so split it and credit each part where it belongs.
    while (this.active && remaining > 1e-9) {
      const left = this.duration() - this.phaseElapsed;
      const take = Math.min(remaining, left);
      if (this.phase === 'measure') {
        this.sumPdt += powerW * take;
        this.sumDt += take;
      }
      this.phaseElapsed += take;
      remaining -= take;
      if (this.phaseElapsed >= this.duration() - 1e-9) this.finishPhase(powerW);
    }
    return this.state;
  }

  get state(): CalibrationState {
    const dur = this.active ? this.duration() : 0;
    return {
      phase: this.phase,
      levelIndex: this.levelIndex,
      level: this.levels[this.levelIndex] ?? null,
      phaseDurationS: dur,
      phaseRemainingS: this.active ? Math.max(0, dur - this.phaseElapsed) : 0,
      livePower: this.livePower,
      liveAverage: this.phase === 'measure' && this.sumDt > 0 ? this.sumPdt / this.sumDt : null,
      results: [...this.results],
    };
  }

  private duration(): number {
    return this.phase === 'ramp' ? this.rampS : this.measureS;
  }

  private beginPhase(phase: 'ramp' | 'measure'): void {
    this.phase = phase;
    this.phaseElapsed = 0;
    this.sumPdt = 0;
    this.sumDt = 0;
  }

  private finishPhase(lastPower: number): void {
    if (this.phase === 'ramp') return this.beginPhase('measure');
    const watts = Math.round(this.sumDt > 0 ? this.sumPdt / this.sumDt : lastPower);
    const point = { effort: this.levels[this.levelIndex], watts };
    this.results.push(point);
    this.onLevelDone?.(point);
    this.levelIndex++;
    if (this.levelIndex >= this.levels.length) {
      this.phase = 'done';
      this.levelIndex = this.levels.length - 1;
    } else {
      this.beginPhase('ramp');
    }
  }
}
