import { describe, expect, it } from 'vitest';
import {
  decodeControlPointResponse,
  decodeFeature,
  decodeIndoorBikeData,
  encodeSimParams,
  encodeStop,
  encodeTargetPower,
  encodeTargetResistance,
  mergeSample,
} from './codec';

const dv = (...b: number[]) => new DataView(Uint8Array.from(b).buffer);
const hex = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, '0')).join(' ');

describe('decodeIndoorBikeData', () => {
  it('decodes the spec test vector', () => {
    const d = decodeIndoorBikeData(dv(0x44, 0x00, 0xb8, 0x0b, 0xb4, 0x00, 0xfa, 0x00));
    expect(d.speed_kmh).toBeCloseTo(30.0);
    expect(d.cadence_rpm).toBe(90);
    expect(d.power_w).toBe(250);
  });

  it('omits speed when the More Data bit is set', () => {
    const d = decodeIndoorBikeData(dv(0x45, 0x00, 0xb4, 0x00, 0xfa, 0x00));
    expect(d.speed_kmh).toBeUndefined();
    expect(d.cadence_rpm).toBe(90);
    expect(d.power_w).toBe(250);
  });

  it('decodes negative power, distance, energy, hr and elapsed time', () => {
    // flags: bit0 set (no speed), bit4 distance, bit6 power, bit8 energy, bit9 hr, bit11 elapsed
    const flags = 1 | (1 << 4) | (1 << 6) | (1 << 8) | (1 << 9) | (1 << 11);
    const d = decodeIndoorBikeData(
      dv(flags & 0xff, flags >> 8, 0x10, 0x27, 0x01, 0x9c, 0xff, 5, 0, 60, 0, 1, 140, 0x2c, 0x01),
    );
    expect(d.distance_m).toBe(10000 + 0x10000);
    expect(d.power_w).toBe(-100);
    expect(d.totalEnergy_kcal).toBe(5);
    expect(d.energyPerHour_kcal).toBe(60);
    expect(d.energyPerMin_kcal).toBe(1);
    expect(d.hr_bpm).toBe(140);
    expect(d.elapsed_s).toBe(300);
  });

  it('does not throw on truncated packets', () => {
    expect(() => decodeIndoorBikeData(dv(0x44, 0x00, 0xb8))).not.toThrow();
  });
});

describe('mergeSample', () => {
  it('keeps earlier fields when a later packet lacks them', () => {
    const merged = mergeSample({ power_w: 200, cadence_rpm: 90 }, { power_w: 210 });
    expect(merged).toEqual({ power_w: 210, cadence_rpm: 90 });
  });
});

describe('Control Point encoders', () => {
  it('encodes the spec sim-params test vector', () => {
    const b = encodeSimParams({ windSpeed_ms: 0, grade_pct: 5.5, crr: 0.004, cw: 0.51 });
    expect(hex(b)).toBe('11 00 00 26 02 28 33');
  });

  it('encodes negative grade as sint16', () => {
    const b = encodeSimParams({ windSpeed_ms: 0, grade_pct: -3, crr: 0.004, cw: 0.51 });
    expect(hex(b)).toBe('11 00 00 d4 fe 28 33');
  });

  it('encodes target power and clamps', () => {
    expect(hex(encodeTargetPower(250))).toBe('05 fa 00');
    expect(hex(encodeTargetPower(99999))).toBe('05 ff 7f');
  });

  it('encodes resistance and stop', () => {
    expect(hex(encodeTargetResistance(5))).toBe('04 32');
    expect(hex(encodeStop(2))).toBe('08 02');
  });
});

describe('decoders', () => {
  it('parses control point responses', () => {
    expect(decodeControlPointResponse(dv(0x80, 0x05, 0x01))).toEqual({
      requestOpcode: 5,
      result: 1,
    });
    expect(decodeControlPointResponse(dv(0x01, 0x05, 0x01))).toBeNull();
  });

  it('parses feature flags', () => {
    const f = decodeFeature(dv(0, 0, 0, 0, 0x0c, 0x20, 0, 0));
    expect(f).toMatchObject({ resistanceTarget: true, powerTarget: true, simulation: true });
  });
});
