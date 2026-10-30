export type GuidanceStatus = 'more' | 'less' | 'on';

export interface Guidance {
  status: GuidanceStatus;
  /** Watts to add (`more`) or shed (`less`) to reach the target; 0 when on target. */
  deltaW: number;
  toleranceW: number;
}

/** How far off target still counts as "on target": 5 % of the target, but never under 5 W. */
export const toleranceFor = (targetW: number): number => Math.max(5, targetW * 0.05);

export function effortGuidance(currentW: number, targetW: number): Guidance {
  const toleranceW = toleranceFor(targetW);
  const diff = targetW - currentW;
  if (Math.abs(diff) <= toleranceW) return { status: 'on', deltaW: 0, toleranceW };
  return diff > 0
    ? { status: 'more', deltaW: Math.round(diff), toleranceW }
    : { status: 'less', deltaW: Math.round(-diff), toleranceW };
}

export interface MeterLayout {
  /** Full-scale watts of the gauge. */
  maxW: number;
  /** Positions as percentages (0–100) along the track. */
  currentPct: number;
  targetPct: number;
  bandLeftPct: number;
  bandWidthPct: number;
}

/** Gauge geometry: 0 W on the left, with room above both the target and the current power. */
export function meterLayout(currentW: number, targetW: number): MeterLayout {
  const maxW = Math.max(50, targetW * 1.6, Math.max(0, currentW) * 1.15);
  const pct = (w: number) => Math.min(100, Math.max(0, (w / maxW) * 100));
  const tol = toleranceFor(targetW);
  const left = pct(targetW - tol);
  const right = pct(targetW + tol);
  return {
    maxW,
    currentPct: pct(currentW),
    targetPct: pct(targetW),
    bandLeftPct: left,
    bandWidthPct: right - left,
  };
}
