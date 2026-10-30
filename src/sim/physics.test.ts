import { describe, expect, it } from 'vitest';
import { cw, DEFAULT_PHYSICS, stepPhysics } from './physics';

/** Run until speed settles; returns km/h. */
function steady(power: number, grade: number, v0 = 0): number {
  let v = v0;
  for (let i = 0; i < 600; i++) v = stepPhysics(v, power, grade, 1, DEFAULT_PHYSICS).speed;
  return v * 3.6;
}

describe('stepPhysics', () => {
  it('flat, 200 W settles at about 33–36 km/h', () => {
    const kmh = steady(200, 0);
    expect(kmh).toBeGreaterThan(33);
    expect(kmh).toBeLessThan(36);
  });

  it('8 % climb at 250 W settles at about 11–13.5 km/h', () => {
    const kmh = steady(250, 8);
    expect(kmh).toBeGreaterThan(11);
    expect(kmh).toBeLessThan(13.5);
  });

  it('coasting at 0 W on −5 % reaches a positive terminal velocity', () => {
    const kmh = steady(0, -5);
    expect(kmh).toBeGreaterThan(30);
    const again = steady(0, -5, kmh / 3.6);
    expect(again).toBeCloseTo(kmh, 1);
  });

  it('decays to exactly 0 (never negative) with no power on a climb', () => {
    let v = 8;
    for (let i = 0; i < 120; i++) {
      v = stepPhysics(v, 0, 8, 1, DEFAULT_PHYSICS).speed;
      expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(v).toBe(0);
  });

  it('starts from a standstill when power is applied', () => {
    expect(stepPhysics(0, 200, 0, 1, DEFAULT_PHYSICS).speed).toBeGreaterThan(0);
  });

  it('integrates distance over the step', () => {
    const r = stepPhysics(10, 200, 0, 1, DEFAULT_PHYSICS);
    expect(r.distance).toBeGreaterThan(9);
    expect(r.distance).toBeLessThan(11);
  });

  it('computes Cw from rho and CdA', () => {
    expect(cw(DEFAULT_PHYSICS)).toBeCloseTo(0.196, 3);
  });
});
