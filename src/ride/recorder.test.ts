// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OxDb } from '../storage/db';
import type { TrainerSample } from '../trainer/Trainer';
import { rideToTcx } from '../storage/export';
import { Recorder } from './recorder';

let n = 0;
let db: OxDb;
let wall: number;
const now = () => wall;
const sample = (tMs: number, power = 200): TrainerSample => ({
  t: tMs,
  power_w: power,
  cadence_rpm: 90,
  speed_kmh: 36,
});

beforeEach(() => {
  db = new OxDb(`test-${n++}`);
  wall = 1_000_000;
});

describe('Recorder', () => {
  it('records samples, batches writes every 5 s and finishes', async () => {
    const r = new Recorder(db, 250, now);
    await r.start();
    for (let i = 0; i < 4; i++) r.addSample(sample(i * 1000));
    wall += 4000;
    await r.flush(); // nothing yet auto-flushed below 5 s
    expect(await db.samples.count()).toBe(4);

    for (let i = 4; i < 12; i++) {
      wall += 1000;
      r.addSample(sample(i * 1000));
    }
    const done = await r.finish();
    expect(await db.samples.count()).toBe(12);
    expect(done.status).toBe('finished');
    expect(done.summary?.avg).toBeCloseTo(200);
    expect(done.summary?.distance).toBeCloseTo(110, 0); // 11 s at 10 m/s
  });

  it('does not write before the 5 s batch interval', async () => {
    const r = new Recorder(db, 250, now);
    await r.start();
    r.addSample(sample(0));
    wall += 1000;
    r.addSample(sample(1000));
    expect(await db.samples.count()).toBe(0);
    wall += 4500;
    r.addSample(sample(2000));
    await r.flush();
    expect(await db.samples.count()).toBe(3);
  });

  it('clamps dt to 2 s and ignores samples while paused', async () => {
    const r = new Recorder(db, 250, now);
    await r.start();
    r.addSample(sample(0));
    r.addSample(sample(60_000)); // tab was throttled for a minute
    expect(r.snapshot().elapsedS).toBe(2);
    r.pause();
    expect(r.addSample(sample(61_000))).toBeNull();
    r.unpause();
    r.addSample(sample(300_000)); // first sample after pause has dt 0
    expect(r.snapshot().elapsedS).toBe(2);
  });

  it('resumes an active ride after a reload with metrics restored', async () => {
    const a = new Recorder(db, 250, now);
    const ride = await a.start();
    for (let i = 0; i < 10; i++) a.addSample(sample(i * 1000, 100 + i * 10));
    await a.flush();

    const b = new Recorder(db, 250, now); // "reloaded" page
    expect((await b.findActive())?.id).toBe(ride.id);
    await b.resume(ride.id!);
    expect(b.snapshot().elapsedS).toBe(9);
    expect(b.snapshot().kj).toBeCloseTo(a.snapshot().kj);
    b.addSample(sample(500_000, 200));
    b.addSample(sample(501_000, 200));
    expect(b.snapshot().elapsedS).toBe(10);
    await b.finish();
    expect(await b.findActive()).toBeUndefined();
  });

  it('refuses to resume a finished ride', async () => {
    const r = new Recorder(db, 250, now);
    const ride = await r.start();
    await r.finish();
    await expect(r.resume(ride.id!)).rejects.toThrow(/not active/);
  });

  it('keeps heart rate through to the TCX trackpoints and lap averages', async () => {
    const r = new Recorder(db, 250, now);
    await r.start();
    r.addSample({ ...sample(0), hr_bpm: 120 });
    r.addSample({ ...sample(1000), hr_bpm: 140 });
    r.addSample(sample(2000)); // sensor dropped out: no HR for this point
    const ride = await r.finish();
    const samples = await db.samples.toArray();
    expect(samples.map((x) => x.hr)).toEqual([120, 140, undefined]);

    const doc = new DOMParser().parseFromString(rideToTcx(ride, samples), 'application/xml');
    const values = [...doc.getElementsByTagName('HeartRateBpm')].map((e) => e.textContent);
    expect(values).toEqual(['120', '140']);
    expect(doc.getElementsByTagName('AverageHeartRateBpm')[0].textContent).toBe('130');
    expect(doc.getElementsByTagName('MaximumHeartRateBpm')[0].textContent).toBe('140');
  });
});
