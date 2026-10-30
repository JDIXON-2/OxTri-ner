import { describe, expect, it } from 'vitest';
import {
  buildRoute,
  eleAt,
  gradeAt,
  gradient,
  haversine,
  resample,
  smooth,
  type GpxPoint,
} from './gpx';

const M_PER_DEG_LAT = 111194.93;

/** Straight northbound line with `n` points over `lengthM`, elevation rising by `climb`. */
function line(lengthM: number, climb: number, n = 101): GpxPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    lat: 51 + ((i / (n - 1)) * lengthM) / M_PER_DEG_LAT,
    lon: -1,
    ele: 100 + (i / (n - 1)) * climb,
  }));
}

function lcg(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

describe('haversine', () => {
  it('matches known distances', () => {
    expect(haversine({ lat: 51.5074, lon: -0.1278 }, { lat: 48.8566, lon: 2.3522 })).toBeCloseTo(
      343_500,
      -3,
    );
    expect(haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(M_PER_DEG_LAT, -1);
    expect(haversine({ lat: 10, lon: 10 }, { lat: 10, lon: 10 })).toBe(0);
  });
});

describe('buildRoute', () => {
  it('gives ~5 % average grade for a 1 km, 50 m climb', () => {
    const r = buildRoute('climb', line(1000, 50));
    expect(r.distance).toBeGreaterThanOrEqual(990);
    const mean = r.grade.reduce((a, b) => a + b, 0) / r.grade.length;
    expect(mean).toBeCloseTo(5, 0);
    expect(r.ascent).toBeCloseTo(50, -1);
  });

  it('cuts severe elevation noise (±3 m white) from >20 % spikes to under 12 %', () => {
    const rnd = lcg(42);
    const noisy = line(5000, 150, 501).map((p) => ({ ...p, ele: p.ele + (rnd() - 0.5) * 6 }));
    const rawGrade = gradient(resample(noisy).ele);
    expect(Math.max(...rawGrade.map(Math.abs))).toBeGreaterThan(20);
    const r = buildRoute('noisy', noisy);
    expect(Math.max(...r.grade.map(Math.abs))).toBeLessThan(12);
  });

  it('clamps gradient to ±25 %', () => {
    const r = buildRoute('wall', line(200, 200, 21), 0);
    expect(Math.max(...r.grade)).toBe(25);
  });

  it('rejects routes that are too short', () => {
    expect(() => buildRoute('x', line(15, 1, 5))).toThrow(/too short/);
  });
});

describe('smooth', () => {
  it('leaves a linear ramp unchanged, ends included', () => {
    const ramp = Array.from({ length: 20 }, (_, i) => i * 0.5);
    smooth(ramp, 60).forEach((v, i) => expect(v).toBeCloseTo(ramp[i]));
  });
});

describe('lookups', () => {
  const r = buildRoute('climb', line(1000, 50));
  it('gradeAt and eleAt are indexed and clamped', () => {
    expect(gradeAt(r, 500)).toBeCloseTo(5, 0);
    expect(eleAt(r, 0)).toBeCloseTo(100, 0);
    expect(eleAt(r, 5)).toBeGreaterThan(eleAt(r, 0));
    expect(eleAt(r, 1e9)).toBe(r.ele[r.ele.length - 1]);
    expect(gradeAt(r, -50)).toBe(r.grade[0]);
  });
});
