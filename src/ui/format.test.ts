import { expect, it } from 'vitest';
import { formatDuration, formatKm } from './format';

it('formats durations', () => {
  expect(formatDuration(0)).toBe('00:00');
  expect(formatDuration(65.9)).toBe('01:05');
  expect(formatDuration(3725)).toBe('1:02:05');
});
it('formats distance in km', () => {
  expect(formatKm(12345)).toBe('12.35');
});
