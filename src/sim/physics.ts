export interface PhysicsParams {
  /** Rider + bike mass, kg. */
  mass: number;
  /** Drivetrain efficiency, 0–1. */
  eta: number;
  crr: number;
  /** Drag area, m². */
  cdA: number;
  /** Air density, kg/m³. */
  rho: number;
}

export const DEFAULT_PHYSICS: PhysicsParams = {
  mass: 85,
  eta: 0.97,
  crr: 0.004,
  cdA: 0.32,
  rho: 1.225,
};
export const G = 9.81;
const SUBSTEP_S = 0.25;

/** Aerodynamic coefficient 0.5·ρ·CdA in kg/m (the trainer's "Cw"). */
export function cw(p: PhysicsParams): number {
  return 0.5 * p.rho * p.cdA;
}

/**
 * Advance virtual speed by `dt` seconds with semi-implicit Euler, sub-stepped at 0.25 s:
 *   m·dv/dt = η·P / max(v, 0.5) − m·g·(Crr·cosθ + sinθ) − Cw·v²
 * Speed never goes negative, so a stopped bike on a climb stays at 0.
 * Returns the new speed (m/s) and the distance covered (m).
 */
export function stepPhysics(
  v: number,
  powerW: number,
  gradePct: number,
  dt: number,
  p: PhysicsParams,
): { speed: number; distance: number } {
  if (dt <= 0) return { speed: v, distance: 0 };
  const theta = Math.atan(gradePct / 100);
  const gravity = p.mass * G * (p.crr * Math.cos(theta) + Math.sin(theta));
  const k = cw(p);
  const n = Math.ceil(dt / SUBSTEP_S - 1e-9);
  const h = dt / n;
  let distance = 0;
  for (let i = 0; i < n; i++) {
    const a = ((p.eta * Math.max(0, powerW)) / Math.max(v, 0.5) - gravity - k * v * v) / p.mass;
    v = Math.max(0, v + a * h);
    distance += v * h;
  }
  return { speed: v, distance };
}
