import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseWorkoutCsv } from './csv';
import { totalSeconds } from './schedule';

const load = (file: string) => parseWorkoutCsv(readFileSync(`public/${file}`, 'utf8'));

describe('public/pyramids-30min.csv', () => {
  const steps = load('pyramids-30min.csv');

  it('is exactly 30 minutes', () => {
    expect(totalSeconds(steps)).toBe(30 * 60);
  });

  it('is two identical pyramids of 15 minutes', () => {
    const half = steps.length / 2;
    expect(steps).toHaveLength(18);
    expect(steps.slice(0, half)).toEqual(steps.slice(half));
    expect(totalSeconds(steps.slice(0, half))).toBe(15 * 60);
  });

  it('builds power up to a single peak and releases back down with matching step lengths', () => {
    const pyramid = steps.slice(0, steps.length / 2);
    const efforts = pyramid.map((s) => s.effort);
    const peak = efforts.indexOf(Math.max(...efforts));
    expect(efforts.filter((e) => e === Math.max(...efforts))).toHaveLength(1);
    // Strictly up to the peak, strictly down after it.
    for (let i = 1; i <= peak; i++) expect(efforts[i]).toBeGreaterThan(efforts[i - 1]);
    for (let i = peak + 1; i < efforts.length; i++) expect(efforts[i]).toBeLessThan(efforts[i - 1]);
    // The release mirrors the build: same efforts, same lengths, reversed.
    expect(efforts.slice(0, peak)).toEqual(efforts.slice(peak + 1).reverse());
    expect(pyramid.map((s) => s.seconds).every((sec) => sec === 100)).toBe(true);
  });

  it('stays within the 0.0–1.0 effort range', () => {
    expect(steps.every((s) => s.effort >= 0 && s.effort <= 1)).toBe(true);
  });
});

describe('public/example-workout.csv', () => {
  it('still parses', () => {
    expect(totalSeconds(load('example-workout.csv'))).toBe(480);
  });
});
