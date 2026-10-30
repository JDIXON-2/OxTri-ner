import { PowerMetrics, type PowerSnapshot } from '../metrics/power';
import type { OxDb, RideRow, RideSummary, SampleRow } from '../storage/db';
import type { TrainerSample } from '../trainer/Trainer';

export type RecorderState = 'idle' | 'recording' | 'paused';

export interface SampleContext {
  grade?: number;
  ele?: number;
  lat?: number;
  lon?: number;
  /** Virtual speed in km/h. */
  virtualSpeed?: number;
  /** Authoritative distance in metres from the ride engine; otherwise speed is integrated here. */
  distance?: number;
}

const MAX_DT_S = 2;
const FLUSH_EVERY_MS = 5000;

/**
 * Ride lifecycle: advances metrics on each trainer sample (never on a timer, so background-tab
 * throttling can't stall it) and writes samples to IndexedDB in batches.
 */
export class Recorder {
  state: RecorderState = 'idle';
  ride: RideRow | null = null;

  private metrics = new PowerMetrics();
  private buffer: SampleRow[] = [];
  private lastT: number | null = null;
  /** Distance covered so far, in metres. */
  distance = 0;
  private lastFlush = 0;
  private flushing: Promise<void> = Promise.resolve();

  constructor(
    private db: OxDb,
    private ftp = 250,
    private now: () => number = Date.now,
  ) {}

  async start(opts: { routeId?: number; workoutId?: number } = {}): Promise<RideRow> {
    this.reset();
    const row: RideRow = {
      startedAt: this.now(),
      status: 'active',
      ftp: this.ftp,
      routeId: opts.routeId,
      workoutId: opts.workoutId,
    };
    row.id = await this.db.rides.add(row);
    this.ride = row;
    this.state = 'recording';
    this.lastFlush = this.now();
    return row;
  }

  /** The unfinished ride left by a closed tab or crash, if any. */
  async findActive(): Promise<RideRow | undefined> {
    return this.db.rides.where('status').equals('active').last();
  }

  /** Reload an active ride's samples into the metrics and carry on recording. */
  async resume(id: number): Promise<RideRow> {
    const ride = await this.db.rides.get(id);
    if (!ride || ride.status !== 'active') throw new Error(`Ride ${id} is not active`);
    this.reset();
    this.ftp = ride.ftp;
    const rows = await this.db.samples
      .where('[rideId+t]')
      .between([id, -Infinity], [id, Infinity])
      .toArray();
    let prevT = 0;
    for (const r of rows) {
      this.metrics.add(r.power, r.cadence, (r.t - prevT) / 1000);
      prevT = r.t;
      this.distance = r.distance;
    }
    this.ride = ride;
    this.state = 'recording';
    this.lastFlush = this.now();
    return ride;
  }

  pause(): void {
    if (this.state !== 'recording') return;
    this.state = 'paused';
    this.lastT = null;
  }

  unpause(): void {
    if (this.state === 'paused') this.state = 'recording';
  }

  /** Feed one trainer sample. Ignored unless recording (the ride clock is paused). */
  addSample(s: TrainerSample, ctx: SampleContext = {}): PowerSnapshot | null {
    if (this.state !== 'recording' || !this.ride?.id) return null;
    const dt = this.lastT === null ? 0 : Math.min(MAX_DT_S, Math.max(0, (s.t - this.lastT) / 1000));
    this.lastT = s.t;
    const power = s.power_w ?? 0;
    const cadence = s.cadence_rpm ?? 0;
    const trainerSpeed = s.speed_kmh ?? 0;
    this.metrics.add(power, cadence, dt);
    this.distance = ctx.distance ?? this.distance + ((ctx.virtualSpeed ?? trainerSpeed) / 3.6) * dt;
    this.buffer.push({
      rideId: this.ride.id,
      t: Math.round(this.metrics.elapsedS * 1000),
      power,
      cadence,
      trainerSpeed,
      virtualSpeed: ctx.virtualSpeed,
      distance: this.distance,
      grade: ctx.grade ?? 0,
      ele: ctx.ele,
      lat: ctx.lat,
      lon: ctx.lon,
      hr: s.hr_bpm,
    });
    if (this.now() - this.lastFlush >= FLUSH_EVERY_MS) void this.flush();
    return this.snapshot();
  }

  snapshot(): PowerSnapshot {
    return this.metrics.snapshot(this.ftp);
  }

  /** Write buffered samples and the running summary. Safe to call from pagehide. */
  flush(): Promise<void> {
    this.lastFlush = this.now();
    const batch = this.buffer;
    this.buffer = [];
    const id = this.ride?.id;
    this.flushing = this.flushing.then(async () => {
      if (id === undefined) return;
      await this.db.transaction('rw', this.db.samples, this.db.rides, async () => {
        if (batch.length) await this.db.samples.bulkPut(batch);
        await this.db.rides.update(id, { summary: this.summary() });
      });
    });
    return this.flushing;
  }

  async finish(): Promise<RideRow> {
    if (!this.ride?.id) throw new Error('No ride in progress');
    const id = this.ride.id;
    await this.flush();
    await this.db.rides.update(id, {
      status: 'finished',
      endedAt: this.now(),
      summary: this.summary(),
    });
    const done = (await this.db.rides.get(id))!;
    this.reset();
    return done;
  }

  private summary(): RideSummary {
    return { ...this.snapshot(), distance: this.distance };
  }

  private reset() {
    this.metrics = new PowerMetrics();
    this.buffer = [];
    this.lastT = null;
    this.distance = 0;
    this.ride = null;
    this.state = 'idle';
  }
}
