import { describe, expect, it } from 'vitest';
import {
  CALIBRATION_LEVELS,
  effortToWatts,
  isCalibrationLevel,
  isMonotonic,
  setPoint,
  type CalibrationPoint,
} from './effortCurve';

const curve: CalibrationPoint[] = [
  { effort: 0.5, watts: 150 },
  { effort: 1.0, watts: 300 },
];

describe('effortToWatts', () => {
  it('returns null with no calibration', () => {
    expect(effortToWatts([], 0.5)).toBeNull();
  });

  it('returns calibrated watts exactly at calibrated levels', () => {
    expect(effortToWatts(curve, 0.5)).toBe(150);
    expect(effortToWatts(curve, 1)).toBe(300);
  });

  it('interpolates between points', () => {
    expect(effortToWatts(curve, 0.75)).toBe(225);
  });

  it('runs from the origin up to the first point', () => {
    expect(effortToWatts(curve, 0.25)).toBe(75);
    expect(effortToWatts(curve, 0)).toBe(0);
  });

  it('extends past the last point along the last segment', () => {
    expect(
      effortToWatts(
        [
          { effort: 0.5, watts: 150 },
          { effort: 0.8, watts: 240 },
        ],
        1,
      ),
    ).toBeCloseTo(300);
  });

  it('with a single point is proportional through the origin', () => {
    const one = [{ effort: 0.5, watts: 150 }];
    expect(effortToWatts(one, 0.25)).toBe(75);
    expect(effortToWatts(one, 1)).toBe(300);
  });

  it('does not drop below the last point if the last segment slopes down', () => {
    const odd = [
      { effort: 0.5, watts: 200 },
      { effort: 0.8, watts: 180 },
    ];
    expect(effortToWatts(odd, 1)).toBe(180);
  });

  it('works whatever order the points are given in', () => {
    expect(effortToWatts([...curve].reverse(), 0.75)).toBe(225);
  });
});

describe('inferring from the 20 % and 100 % calibration', () => {
  const two: CalibrationPoint[] = [
    { effort: 0.2, watts: 100 },
    { effort: 1.0, watts: 300 },
  ];

  it('is exact at the two calibrated levels', () => {
    expect(effortToWatts(two, 0.2)).toBe(100);
    expect(effortToWatts(two, 1)).toBe(300);
  });

  it('draws a straight line between them for everything in the middle', () => {
    expect(effortToWatts(two, 0.4)).toBeCloseTo(150);
    expect(effortToWatts(two, 0.6)).toBeCloseTo(200);
    expect(effortToWatts(two, 0.8)).toBeCloseTo(250);
  });

  it('carries the same line below 20 %, so rest is not 0 W', () => {
    expect(effortToWatts(two, 0.1)).toBeCloseTo(75);
    expect(effortToWatts(two, 0)).toBeCloseTo(50);
  });

  it('never goes below 0 W when the line would cross zero', () => {
    const steep = [
      { effort: 0.2, watts: 10 },
      { effort: 1, watts: 300 },
    ];
    expect(effortToWatts(steep, 0)).toBe(0);
  });

  it('never makes an easier effort need more power than the 20 % point', () => {
    const odd = [
      { effort: 0.2, watts: 200 },
      { effort: 1, watts: 150 },
    ];
    expect(effortToWatts(odd, 0)).toBe(200);
  });

  it('knows which levels are calibrated and which are inferred', () => {
    expect(isCalibrationLevel(0.2)).toBe(true);
    expect(isCalibrationLevel(1)).toBe(true);
    expect(isCalibrationLevel(0.6)).toBe(false);
    expect(CALIBRATION_LEVELS).toEqual([0.2, 1]);
  });
});

describe('setPoint / isMonotonic', () => {
  it('replaces an existing level and keeps the list sorted', () => {
    const next = setPoint(curve, { effort: 0.5, watts: 170 });
    expect(next).toEqual([
      { effort: 0.5, watts: 170 },
      { effort: 1, watts: 300 },
    ]);
    expect(setPoint(curve, { effort: 0.2, watts: 80 })[0].effort).toBe(0.2);
  });

  it('flags power that goes down as effort goes up', () => {
    expect(isMonotonic(curve)).toBe(true);
    expect(
      isMonotonic([
        { effort: 0.4, watts: 200 },
        { effort: 0.6, watts: 180 },
      ]),
    ).toBe(false);
  });
});
