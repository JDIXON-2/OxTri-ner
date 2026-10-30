import { describe, expect, it } from 'vitest';
import { effortGuidance, meterLayout, toleranceFor } from './guidance';

describe('effortGuidance', () => {
  it('says more effort when below the target, with the shortfall', () => {
    expect(effortGuidance(150, 200)).toEqual({ status: 'more', deltaW: 50, toleranceW: 10 });
  });

  it('says ease off when above the target, with the excess', () => {
    expect(effortGuidance(240, 200)).toEqual({ status: 'less', deltaW: 40, toleranceW: 10 });
  });

  it('is on target inside the tolerance, edges included', () => {
    expect(effortGuidance(200, 200).status).toBe('on');
    expect(effortGuidance(190, 200).status).toBe('on'); // exactly 5 % under
    expect(effortGuidance(210, 200).status).toBe('on'); // exactly 5 % over
    expect(effortGuidance(189, 200).status).toBe('more');
    expect(effortGuidance(211, 200).status).toBe('less');
  });

  it('has a 5 W minimum tolerance so low targets are not impossibly tight', () => {
    expect(toleranceFor(40)).toBe(5);
    expect(effortGuidance(44, 40).status).toBe('on');
    expect(effortGuidance(46, 40).status).toBe('less');
    expect(effortGuidance(0, 0).status).toBe('on');
  });

  it('scales the tolerance with big targets', () => {
    expect(toleranceFor(400)).toBe(20);
  });

  it('treats a stopped rider as needing more effort', () => {
    expect(effortGuidance(0, 150)).toMatchObject({ status: 'more', deltaW: 150 });
  });
});

describe('meterLayout', () => {
  it('places the target and current power along the track', () => {
    const m = meterLayout(100, 200);
    expect(m.maxW).toBe(320);
    expect(m.targetPct).toBeCloseTo(62.5);
    expect(m.currentPct).toBeCloseTo(31.25);
  });

  it('centres the tolerance band on the target', () => {
    const m = meterLayout(100, 200);
    expect(m.bandLeftPct + m.bandWidthPct / 2).toBeCloseTo(m.targetPct);
  });

  it('makes room when the rider is far above the target, and clamps to the track', () => {
    const m = meterLayout(500, 100);
    expect(m.maxW).toBeCloseTo(575);
    expect(m.currentPct).toBeLessThanOrEqual(100);
    expect(meterLayout(-20, 100).currentPct).toBe(0);
  });

  it('has a usable scale for a zero-watt rest step', () => {
    const m = meterLayout(0, 0);
    expect(m.maxW).toBe(50);
    expect(m.targetPct).toBe(0);
  });
});
