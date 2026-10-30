export interface CalibrationPoint {
  /** Effort level, 0.0–1.0, as the rider feels it. */
  effort: number;
  /** Average power the rider produced at that level. */
  watts: number;
}

/**
 * Levels the rider actually calibrates: an easy effort and an all-out one. Every other effort is
 * worked out from the line through these two points.
 */
export const CALIBRATION_LEVELS = [0.2, 1.0];

/** Levels shown in the calibration table; the ones not in CALIBRATION_LEVELS are inferred. */
export const CALIBRATION_PREVIEW_LEVELS = [0.2, 0.4, 0.6, 0.8, 1.0];

export const isCalibrationLevel = (effort: number): boolean =>
  CALIBRATION_LEVELS.some((l) => Math.abs(l - effort) < 1e-9);

const sorted = (points: CalibrationPoint[]) => [...points].sort((a, b) => a.effort - b.effort);

/** Add or replace the point for an effort level, keeping the list sorted. */
export function setPoint(points: CalibrationPoint[], p: CalibrationPoint): CalibrationPoint[] {
  return sorted([...points.filter((q) => Math.abs(q.effort - p.effort) > 1e-9), p]);
}

/** True if more effort never means less power. A rider can mis-pace a level; the UI warns. */
export function isMonotonic(points: CalibrationPoint[]): boolean {
  const s = sorted(points);
  return s.every((p, i) => i === 0 || p.watts >= s[i - 1].watts);
}

/**
 * Watts for an effort level. Straight lines between calibrated points. Beyond either end the
 * nearest segment's line carries on: upwards at its slope, and downwards at its slope but never
 * below 0 W (or above the first point's watts). With a single point the line goes through the
 * origin. Returns null if nothing is calibrated yet.
 */
export function effortToWatts(points: CalibrationPoint[], effort: number): number | null {
  if (points.length === 0) return null;
  const pts = sorted(points);
  const e = Math.max(0, effort);
  const first = pts[0];
  if (pts.length === 1) return first.effort > 0 ? (first.watts * e) / first.effort : first.watts;

  if (e <= first.effort) {
    const second = pts[1];
    const slope = Math.max(0, (second.watts - first.watts) / (second.effort - first.effort));
    return Math.max(0, first.watts - slope * (first.effort - e));
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (e <= b.effort)
      return a.watts + ((b.watts - a.watts) * (e - a.effort)) / (b.effort - a.effort);
  }
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const slope = Math.max(0, (last.watts - prev.watts) / (last.effort - prev.effort));
  return last.watts + slope * (e - last.effort);
}
