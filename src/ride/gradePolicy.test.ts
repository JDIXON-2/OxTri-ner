import { describe, expect, it } from 'vitest';
import { GradePolicy } from './gradePolicy';

const mk = (o = {}) => new GradePolicy({ minGrade: -10, maxGrade: 20, difficulty: 100, ...o });

describe('GradePolicy', () => {
  it('sends the first grade immediately', () => {
    expect(mk().update(5, 0)).toBe(5);
  });

  it('sends at most once per second', () => {
    const p = mk();
    p.update(0, 0);
    expect(p.update(0.5, 500)).toBeNull();
    expect(p.update(0.5, 1000)).toBe(0.5);
  });

  it('ignores changes under 0.1 %', () => {
    const p = mk();
    p.update(3, 0);
    expect(p.update(3.05, 2000)).toBeNull();
    expect(p.update(3.1, 2000)).toBe(3.1);
  });

  it('clamps to the configured range', () => {
    expect(mk().update(40, 0)).toBe(20);
    expect(mk().update(-25, 0)).toBe(-10);
  });

  it('applies difficulty to the sent grade only', () => {
    expect(mk({ difficulty: 50 }).update(8, 0)).toBe(4);
  });

  it('ramps in steps of at most 1 % per update', () => {
    const p = mk();
    p.update(0, 0);
    expect(p.update(8, 1000)).toBe(1);
    expect(p.update(8, 2000)).toBe(2);
    expect(p.update(-8, 3000)).toBe(1);
  });

  it('resends after reset', () => {
    const p = mk();
    p.update(4, 0);
    p.reset();
    expect(p.update(4, 100)).toBe(4);
  });
});
