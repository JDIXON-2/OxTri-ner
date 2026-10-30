import { expect, it } from 'vitest';
import { backoffDelayMs } from './reconnect';

it('backs off 1,2,4,8,15,15 s', () => {
  expect([0, 1, 2, 3, 4, 5, 20].map(backoffDelayMs)).toEqual([
    1000, 2000, 4000, 8000, 15000, 15000, 15000,
  ]);
});
