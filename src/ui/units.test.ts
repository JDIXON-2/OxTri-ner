import { expect, it } from 'vitest';
import { distanceText, distanceValue, elevationText, kmhToSpeed, speedUnit } from './units';

it('leaves metric values alone', () => {
  expect(distanceText(12345, 'metric')).toBe('12.35 km');
  expect(elevationText(340, 'metric')).toBe('340 m');
  expect(kmhToSpeed(36, 'metric')).toBe(36);
});

it('converts to imperial', () => {
  expect(distanceValue(1609.344, 'imperial')).toBe('1.00');
  expect(elevationText(100, 'imperial')).toBe('328 ft');
  expect(kmhToSpeed(16.09344, 'imperial')).toBeCloseTo(10);
  expect(speedUnit('imperial')).toBe('mph');
});
