export const SERVICE_HEART_RATE = 0x180d;
export const CHAR_HEART_RATE_MEASUREMENT = 0x2a37;

export interface HeartRateReading {
  bpm: number;
  /** False when the sensor says it has no skin contact; undefined if it doesn't report contact. */
  contact?: boolean;
}

/** Decode a Heart Rate Measurement notification (flags bit 0: 16-bit value; bits 1-2: contact). */
export function decodeHeartRate(dv: DataView): HeartRateReading | null {
  if (dv.byteLength < 2) return null;
  const flags = dv.getUint8(0);
  const wide = (flags & 0x01) !== 0;
  if (wide && dv.byteLength < 3) return null;
  const bpm = wide ? dv.getUint16(1, true) : dv.getUint8(1);
  const contactSupported = (flags & 0x04) !== 0;
  return { bpm, contact: contactSupported ? (flags & 0x02) !== 0 : undefined };
}
