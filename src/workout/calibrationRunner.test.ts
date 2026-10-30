import { describe, expect, it } from 'vitest';
import { CalibrationRunner } from './calibrationRunner';

/** Feed 1 s samples whose power is given by `power(second)`. */
function run(r: CalibrationRunner, seconds: number, power: (s: number) => number) {
  let state = r.update(0, power(0));
  for (let s = 1; s <= seconds; s++) state = r.update(1, power(s));
  return state;
}

describe('CalibrationRunner', () => {
  it('gives 10 s to reach the effort, then measures the next 10 s', () => {
    const r = new CalibrationRunner([0.5]);
    r.start();
    expect(r.state.phase).toBe('ramp');
    expect(r.state.phaseRemainingS).toBe(10);
    r.update(0, 0);
    for (let s = 1; s <= 9; s++) r.update(1, 100);
    expect(r.state.phase).toBe('ramp');
    r.update(1, 100); // 10 s elapsed → measuring starts
    expect(r.state.phase).toBe('measure');
    expect(r.state.phaseRemainingS).toBe(10);
  });

  it('ignores the ramp-up and averages only the measuring window', () => {
    // 0 W while ramping (first 10 s), then 200 W for the 10 s measured.
    const r = new CalibrationRunner([0.6]);
    r.start();
    const end = run(r, 20, (s) => (s <= 10 ? 0 : 200));
    expect(end.phase).toBe('done');
    expect(end.results).toEqual([{ effort: 0.6, watts: 200 }]);
  });

  it('averages a varying measurement window', () => {
    const r = new CalibrationRunner([1]);
    r.start();
    // Measuring seconds 11..20: alternate 180 and 220 → mean 200.
    const end = run(r, 20, (s) => (s <= 10 ? 50 : s % 2 === 0 ? 220 : 180));
    expect(end.results[0].watts).toBe(200);
  });

  it('walks through every level in order and reports each one as it finishes', () => {
    const done: number[] = [];
    const r = new CalibrationRunner([0.25, 0.5, 1], { onLevelDone: (p) => done.push(p.effort) });
    r.start();
    const end = run(r, 60, (s) => 100 + Math.floor((s - 1) / 20) * 50);
    expect(end.phase).toBe('done');
    expect(done).toEqual([0.25, 0.5, 1]);
    expect(end.results.map((p) => p.watts)).toEqual([100, 150, 200]);
  });

  it('shows the live average while measuring', () => {
    const r = new CalibrationRunner([0.5]);
    r.start();
    run(r, 15, () => 180);
    const s = r.state;
    expect(s.phase).toBe('measure');
    expect(s.liveAverage).toBeCloseTo(180);
    expect(s.phaseRemainingS).toBe(5);
  });

  it('splits a long sample across a phase boundary', () => {
    const r = new CalibrationRunner([0.5]);
    r.start();
    r.update(0, 0);
    // One 12 s step at 300 W: 10 s ramp, then 2 s credited to the measuring window.
    const s = r.update(12, 300);
    expect(s.phase).toBe('measure');
    expect(s.phaseRemainingS).toBeCloseTo(8);
    expect(s.liveAverage).toBeCloseTo(300);
  });

  it('can be cancelled, keeping levels already measured', () => {
    const r = new CalibrationRunner([0.5, 1]);
    r.start();
    run(r, 25, () => 150); // first level done, second in its ramp
    r.cancel();
    expect(r.state.phase).toBe('cancelled');
    expect(r.state.results).toEqual([{ effort: 0.5, watts: 150 }]);
    expect(r.update(1, 999).phase).toBe('cancelled'); // further samples are ignored
  });

  it('does nothing when idle or given no levels', () => {
    const r = new CalibrationRunner([]);
    r.start();
    expect(r.state.phase).toBe('idle');
    expect(r.update(1, 100).results).toEqual([]);
  });
});
