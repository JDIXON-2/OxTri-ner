import { describe, expect, it } from 'vitest';
import { PowerMetrics } from './power';

function ride(powers: number[], cadence = 90) {
  const m = new PowerMetrics();
  powers.forEach((p, i) => m.add(p, cadence, i === 0 ? 0 : 1));
  return m;
}

describe('PowerMetrics', () => {
  it('computes rolling averages, max and kJ', () => {
    const s = ride([100, 100, 100, 200, 300]).snapshot(250);
    expect(s.avg3).toBeCloseTo(200);
    expect(s.max).toBe(300);
    expect(s.kj).toBeCloseTo((100 + 100 + 200 + 300) / 1000);
    expect(s.power).toBe(300);
  });

  it('constant power gives NP = average', () => {
    const s = ride(Array(120).fill(200)).snapshot(250);
    expect(s.np).toBeCloseTo(200);
    expect(s.avg30).toBeCloseTo(200);
  });

  it('variable power gives NP above average', () => {
    const p = [
      ...Array(60).fill(100),
      ...Array(60).fill(300),
      ...Array(60).fill(100),
      ...Array(60).fill(300),
    ];
    const s = ride(p).snapshot(250);
    expect(s.avg).toBeCloseTo(200, 0);
    expect(s.np).toBeGreaterThan(s.avg + 5);
  });

  it('one hour at FTP is 100 TSS and IF 1', () => {
    const s = ride(Array(3601).fill(250)).snapshot(250);
    expect(s.if).toBeCloseTo(1);
    expect(s.tss).toBeCloseTo(100, 0);
  });

  it('counts moving time only while pedalling or producing power', () => {
    const m = new PowerMetrics();
    m.add(100, 90, 0);
    m.add(100, 90, 1);
    m.add(0, 0, 1);
    m.add(0, 0, 1);
    const s = m.snapshot(250);
    expect(s.elapsedS).toBe(3);
    expect(s.movingS).toBe(1);
    expect(s.avgCadence).toBe(90);
  });
});
