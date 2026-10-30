import { OP } from './constants';

export interface IndoorBikeData {
  speed_kmh?: number;
  avgSpeed_kmh?: number;
  cadence_rpm?: number;
  avgCadence_rpm?: number;
  distance_m?: number;
  resistance?: number;
  power_w?: number;
  avgPower_w?: number;
  totalEnergy_kcal?: number;
  energyPerHour_kcal?: number;
  energyPerMin_kcal?: number;
  hr_bpm?: number;
  met?: number;
  elapsed_s?: number;
  remaining_s?: number;
}

/** Decode an Indoor Bike Data notification. Absent fields are left undefined. */
export function decodeIndoorBikeData(dv: DataView): IndoorBikeData {
  const out: IndoorBikeData = {};
  let o = 0;
  const flags = dv.getUint16(o, true);
  o += 2;
  const has = (bit: number) => (flags & (1 << bit)) !== 0;
  // Need `n` more bytes; stop decoding on truncated packets rather than throwing.
  const room = (n: number) => o + n <= dv.byteLength;

  if (!has(0) && room(2)) {
    out.speed_kmh = dv.getUint16(o, true) * 0.01;
    o += 2;
  }
  if (has(1) && room(2)) {
    out.avgSpeed_kmh = dv.getUint16(o, true) * 0.01;
    o += 2;
  }
  if (has(2) && room(2)) {
    out.cadence_rpm = dv.getUint16(o, true) * 0.5;
    o += 2;
  }
  if (has(3) && room(2)) {
    out.avgCadence_rpm = dv.getUint16(o, true) * 0.5;
    o += 2;
  }
  if (has(4) && room(3)) {
    out.distance_m = dv.getUint16(o, true) | (dv.getUint8(o + 2) << 16);
    o += 3;
  }
  if (has(5) && room(2)) {
    out.resistance = dv.getInt16(o, true);
    o += 2;
  }
  if (has(6) && room(2)) {
    out.power_w = dv.getInt16(o, true);
    o += 2;
  }
  if (has(7) && room(2)) {
    out.avgPower_w = dv.getInt16(o, true);
    o += 2;
  }
  if (has(8) && room(5)) {
    out.totalEnergy_kcal = dv.getUint16(o, true);
    out.energyPerHour_kcal = dv.getUint16(o + 2, true);
    out.energyPerMin_kcal = dv.getUint8(o + 4);
    o += 5;
  }
  if (has(9) && room(1)) {
    out.hr_bpm = dv.getUint8(o);
    o += 1;
  }
  if (has(10) && room(1)) {
    out.met = dv.getUint8(o) * 0.1;
    o += 1;
  }
  if (has(11) && room(2)) {
    out.elapsed_s = dv.getUint16(o, true);
    o += 2;
  }
  if (has(12) && room(2)) {
    out.remaining_s = dv.getUint16(o, true);
    o += 2;
  }
  return out;
}

/** Merge a partial packet into the latest sample without clobbering fields it lacks. */
export function mergeSample(prev: IndoorBikeData, next: IndoorBikeData): IndoorBikeData {
  const merged = { ...prev };
  for (const [k, v] of Object.entries(next)) {
    if (v !== undefined) (merged as Record<string, number>)[k] = v as number;
  }
  return merged;
}

export interface FitnessMachineFeature {
  machine: number;
  target: number;
  resistanceTarget: boolean;
  powerTarget: boolean;
  simulation: boolean;
}

export function decodeFeature(dv: DataView): FitnessMachineFeature {
  const machine = dv.getUint32(0, true);
  const target = dv.getUint32(4, true);
  return {
    machine,
    target,
    resistanceTarget: (target & (1 << 2)) !== 0,
    powerTarget: (target & (1 << 3)) !== 0,
    simulation: (target & (1 << 13)) !== 0,
  };
}

export interface Range {
  min: number;
  max: number;
  step: number;
}

/** Supported Power Range: sint16 min, sint16 max, uint16 step (W). */
export function decodePowerRange(dv: DataView): Range {
  return { min: dv.getInt16(0, true), max: dv.getInt16(2, true), step: dv.getUint16(4, true) };
}

/** Supported Resistance Level Range: sint16 min, sint16 max (0.1), uint16 step (0.1). */
export function decodeResistanceRange(dv: DataView): Range {
  return {
    min: dv.getInt16(0, true) * 0.1,
    max: dv.getInt16(2, true) * 0.1,
    step: dv.getUint16(4, true) * 0.1,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function encodeRequestControl(): Uint8Array {
  return Uint8Array.of(OP.REQUEST_CONTROL);
}

export function encodeReset(): Uint8Array {
  return Uint8Array.of(OP.RESET);
}

export function encodeStart(): Uint8Array {
  return Uint8Array.of(OP.START);
}

/** param: 1 = stop, 2 = pause */
export function encodeStop(param: 1 | 2 = 1): Uint8Array {
  return Uint8Array.of(OP.STOP, param);
}

/** Target resistance with 0.1 resolution, sent as uint8 (so 0–25.5). */
export function encodeTargetResistance(level: number): Uint8Array {
  return Uint8Array.of(OP.SET_TARGET_RESISTANCE, clamp(Math.round(level / 0.1), 0, 255));
}

export function encodeTargetPower(watts: number): Uint8Array {
  const buf = new Uint8Array(3);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, OP.SET_TARGET_POWER);
  dv.setInt16(1, clamp(Math.round(watts), -32768, 32767), true);
  return buf;
}

export interface SimParams {
  windSpeed_ms: number;
  grade_pct: number;
  crr: number;
  cw: number;
}

export function encodeSimParams(p: SimParams): Uint8Array {
  const buf = new Uint8Array(7);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, OP.SET_SIM_PARAMS);
  dv.setInt16(1, clamp(Math.round(p.windSpeed_ms / 0.001), -32768, 32767), true);
  dv.setInt16(3, clamp(Math.round(p.grade_pct / 0.01), -32768, 32767), true);
  dv.setUint8(5, clamp(Math.round(p.crr / 0.0001), 0, 255));
  dv.setUint8(6, clamp(Math.round(p.cw / 0.01), 0, 255));
  return buf;
}

export interface ControlPointResponse {
  requestOpcode: number;
  result: number;
}

/** Parse a Control Point indication `[0x80, requestOpcode, resultCode, ...]`. */
export function decodeControlPointResponse(dv: DataView): ControlPointResponse | null {
  if (dv.byteLength < 3 || dv.getUint8(0) !== OP.RESPONSE) return null;
  return { requestOpcode: dv.getUint8(1), result: dv.getUint8(2) };
}
