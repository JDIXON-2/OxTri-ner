import { describe, expect, it } from 'vitest';
import { barLayout, positionAt, totalSeconds } from './schedule';

const steps = [
  { seconds: 60, effort: 0.4 },
  { seconds: 120, effort: 0.8 },
  { seconds: 30, effort: 0.2 },
];

describe('positionAt', () => {
  it('finds the step and time left in it', () => {
    const p = positionAt(steps, 90);
    expect(p.index).toBe(1);
    expect(p.step.effort).toBe(0.8);
    expect(p.intoStep).toBe(30);
    expect(p.remainingInStep).toBe(90);
    expect(p.next).toEqual(steps[2]);
    expect(p.done).toBe(false);
  });

  it('moves to the next step exactly on the boundary', () => {
    expect(positionAt(steps, 59.999).index).toBe(0);
    expect(positionAt(steps, 60).index).toBe(1);
  });

  it('starts at step 0 and treats negative time as the start', () => {
    expect(positionAt(steps, 0).index).toBe(0);
    expect(positionAt(steps, -5).index).toBe(0);
  });

  it('is done at and after the total duration', () => {
    expect(totalSeconds(steps)).toBe(210);
    const end = positionAt(steps, 210);
    expect(end.done).toBe(true);
    expect(end.remainingTotal).toBe(0);
    expect(positionAt(steps, 999).done).toBe(true);
    expect(positionAt(steps, 209).done).toBe(false);
  });

  it('reports the total time remaining and no next step on the last step', () => {
    const p = positionAt(steps, 200);
    expect(p.remainingTotal).toBe(10);
    expect(p.next).toBeNull();
  });
});

describe('barLayout', () => {
  it('sizes bars by time and effort and tiles the full width', () => {
    const bars = barLayout(steps, 210, 100);
    expect(bars.map((b) => b.w)).toEqual([60, 120, 30]);
    expect(bars.map((b) => b.x)).toEqual([0, 60, 180]);
    expect(bars.map((b) => b.h)).toEqual([40, 80, 20]);
    expect(bars[1].y).toBe(20);
  });

  it('keeps zero-effort rests visible', () => {
    expect(barLayout([{ seconds: 10, effort: 0 }], 100, 100)[0].h).toBe(3);
  });
});
