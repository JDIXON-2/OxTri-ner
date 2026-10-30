import { describe, expect, it } from 'vitest';
import { parseWorkoutCsv } from './csv';

describe('parseWorkoutCsv', () => {
  it('parses seconds and effort per line', () => {
    expect(parseWorkoutCsv('300,0.5\n60,0.9\n120,0.3')).toEqual([
      { seconds: 300, effort: 0.5 },
      { seconds: 60, effort: 0.9 },
      { seconds: 120, effort: 0.3 },
    ]);
  });

  it('accepts the extremes 0.0 and 1.0', () => {
    expect(parseWorkoutCsv('10,0.0\n10,1.0').map((s) => s.effort)).toEqual([0, 1]);
  });

  it('copes with Windows line endings, BOM, blanks, comments, spaces and a trailing newline', () => {
    const text = '﻿# warm up\r\n\r\n 300 , 0.4 \r\n600,0.7\r\n';
    expect(parseWorkoutCsv(text)).toEqual([
      { seconds: 300, effort: 0.4 },
      { seconds: 600, effort: 0.7 },
    ]);
  });

  it('accepts semicolon and tab separators and a trailing separator', () => {
    expect(parseWorkoutCsv('60;0.5\n60\t0.6\n60,0.7,')).toHaveLength(3);
  });

  it('skips a single header line', () => {
    expect(parseWorkoutCsv('seconds,effort\n60,0.5')).toEqual([{ seconds: 60, effort: 0.5 }]);
  });

  it('does not treat a later text line as a header', () => {
    expect(() => parseWorkoutCsv('60,0.5\nseconds,effort')).toThrow(/Line 2/);
  });

  it('reports the line number for bad input', () => {
    expect(() => parseWorkoutCsv('60,0.5\n60')).toThrow(/Line 2: expected 2 columns/);
    expect(() => parseWorkoutCsv('60,0.5\nabc,0.5')).toThrow(
      /Line 2: "abc" is not a number of seconds/,
    );
    expect(() => parseWorkoutCsv('60,high')).toThrow(/Line 1: "high" is not an effort/);
    expect(() => parseWorkoutCsv('0,0.5')).toThrow(/greater than 0/);
    expect(() => parseWorkoutCsv('-5,0.5')).toThrow(/greater than 0/);
  });

  it('rejects efforts outside 0..1 and hints when it looks like a percentage', () => {
    expect(() => parseWorkoutCsv('60,1.2')).toThrow(/between 0.0 and 1.0/);
    expect(() => parseWorkoutCsv('60,-0.1')).toThrow(/between 0.0 and 1.0/);
    expect(() => parseWorkoutCsv('60,75')).toThrow(/use a decimal such as 0.75/);
  });

  it('rejects empty files and absurd sizes', () => {
    expect(() => parseWorkoutCsv('')).toThrow(/no workout steps/);
    expect(() => parseWorkoutCsv('# only a comment')).toThrow(/no workout steps/);
    expect(() => parseWorkoutCsv(Array(2001).fill('1,0.5').join('\n'))).toThrow(/Too many steps/);
    expect(() => parseWorkoutCsv('50000,0.5')).toThrow(/longer than 12 hours/);
  });
});
