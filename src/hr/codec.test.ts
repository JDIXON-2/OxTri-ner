import { describe, expect, it } from 'vitest';
import { decodeHeartRate } from './codec';

const dv = (...b: number[]) => new DataView(new Uint8Array(b).buffer);

describe('decodeHeartRate', () => {
  it('reads an 8-bit value', () => {
    expect(decodeHeartRate(dv(0x00, 142))).toEqual({ bpm: 142, contact: undefined });
  });
  it('reads a 16-bit little-endian value', () => {
    expect(decodeHeartRate(dv(0x01, 0x2c, 0x01))).toEqual({ bpm: 300, contact: undefined });
  });
  it('reports contact when supported', () => {
    expect(decodeHeartRate(dv(0x06, 80))?.contact).toBe(true);
    expect(decodeHeartRate(dv(0x04, 0))?.contact).toBe(false);
  });
  it('rejects truncated packets', () => {
    expect(decodeHeartRate(dv(0x00))).toBeNull();
    expect(decodeHeartRate(dv(0x01, 0x10))).toBeNull();
  });
});
