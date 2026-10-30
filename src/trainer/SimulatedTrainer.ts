import {
  DEFAULT_CRR,
  DEFAULT_CW,
  Emitter,
  type LogEntry,
  type SimParamsOpts,
  type Trainer,
  type TrainerInfo,
  type TrainerSample,
  type TrainerStatus,
} from './Trainer';

export type SimCommand =
  | { type: 'grade'; gradePct: number; crr: number; cw: number }
  | { type: 'power'; watts: number }
  | { type: 'resistance'; level: number };

export interface SimulatedTrainerOptions {
  /** Rider power in watts when not in ERG mode. Called on each tick. */
  power?: () => number;
  /** Tick period; 1000 ms matches a real trainer. 0 disables the timer (call `tick()` manually). */
  intervalMs?: number;
  reconnectDelayMs?: number;
  random?: () => number;
}

export class SimulatedTrainer implements Trainer {
  status: TrainerStatus = 'disconnected';
  readonly info: TrainerInfo = {
    deviceName: 'Simulated trainer',
    feature: {
      machine: 0,
      target: (1 << 2) | (1 << 3) | (1 << 13),
      resistanceTarget: true,
      powerTarget: true,
      simulation: true,
    },
    powerRange: { min: 0, max: 2000, step: 1 },
    resistanceRange: { min: 0, max: 100, step: 1 },
  };
  /** Every command received, for assertions in tests and the debug panel. */
  readonly commands: SimCommand[] = [];
  riderPower: () => number;
  ergTarget: number | null = null;

  private samples = new Emitter<TrainerSample>();
  private statuses = new Emitter<TrainerStatus>();
  private logs = new Emitter<LogEntry>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private distance = 0;
  private elapsed = 0;
  private opts: Required<Omit<SimulatedTrainerOptions, 'power'>>;

  constructor(opts: SimulatedTrainerOptions = {}) {
    this.riderPower = opts.power ?? (() => 150);
    this.opts = {
      intervalMs: opts.intervalMs ?? 1000,
      reconnectDelayMs: opts.reconnectDelayMs ?? 2000,
      random: opts.random ?? Math.random,
    };
  }

  async connect() {
    this.setStatus('connecting');
    this.setStatus('connected');
    this.setStatus('controlling');
    this.startTimer();
  }

  async disconnect() {
    this.stopTimer();
    this.setStatus('disconnected');
  }

  /** Dev-panel button: drop the link, then come back after `reconnectDelayMs`. */
  simulateDisconnect() {
    if (this.status === 'disconnected') return;
    this.stopTimer();
    this.setStatus('reconnecting');
    setTimeout(() => {
      if (this.status !== 'reconnecting') return;
      this.setStatus('controlling');
      this.startTimer();
    }, this.opts.reconnectDelayMs);
  }

  async setGrade(gradePct: number, o: SimParamsOpts = {}) {
    this.ergTarget = null;
    this.record({ type: 'grade', gradePct, crr: o.crr ?? DEFAULT_CRR, cw: o.cw ?? DEFAULT_CW });
  }

  async setTargetPower(watts: number) {
    this.ergTarget = watts;
    this.record({ type: 'power', watts });
  }

  async setResistance(level: number) {
    this.ergTarget = null;
    this.record({ type: 'resistance', level });
  }

  onSample(cb: (s: TrainerSample) => void) {
    return this.samples.on(cb);
  }
  onStatus(cb: (s: TrainerStatus) => void) {
    return this.statuses.on(cb);
  }
  onLog(cb: (e: LogEntry) => void) {
    return this.logs.on(cb);
  }

  /** Emit one 1 s sample. Public so tests can drive time deterministically. */
  tick(now: number = performance.now()) {
    const noise = (amp: number) => (this.opts.random() - 0.5) * 2 * amp;
    const base = this.ergTarget ?? this.riderPower();
    const power = Math.max(0, Math.round(base + noise(this.ergTarget !== null ? 3 : 0)));
    const cadence = power > 0 ? Math.round((90 + noise(5)) * 2) / 2 : 0;
    // Rough flywheel speed: not road speed, which the physics model computes.
    const speed = power > 0 ? 33 * Math.cbrt(power / 200) : 0;
    this.elapsed += this.opts.intervalMs / 1000 || 1;
    this.distance += speed / 3.6;
    this.samples.emit({
      t: now,
      speed_kmh: speed,
      cadence_rpm: cadence,
      power_w: power,
      distance_m: Math.round(this.distance),
      elapsed_s: Math.round(this.elapsed),
    });
  }

  private record(c: SimCommand) {
    this.commands.push(c);
    this.logs.emit({ dir: 'tx', text: `sim ${JSON.stringify(c)}` });
  }

  private setStatus(s: TrainerStatus) {
    this.status = s;
    this.statuses.emit(s);
  }

  private startTimer() {
    this.stopTimer();
    if (this.opts.intervalMs > 0) this.timer = setInterval(() => this.tick(), this.opts.intervalMs);
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
