import { ROUTE_SPACING_M, eleAt, gradeAt, type RouteData } from '../route/gpx';
import type { GradePolicy } from '../ride/gradePolicy';
import { cw, stepPhysics, type PhysicsParams } from './physics';

/**
 * `erg` lets the trainer hold a target power, so it sends no grade. `workout` shows target watts
 * to hit by any means; the rider sets resistance (grade, cadence), exactly as in a free ride.
 */
export type RideMode = 'route' | 'free' | 'erg' | 'workout';

export interface RideState {
  mode: RideMode;
  /** Virtual speed, m/s. */
  speed: number;
  /** Distance ridden, m. */
  distance: number;
  /** True road grade, %. The physics always uses this, never the difficulty-scaled grade. */
  grade: number;
  ele?: number;
  lat?: number;
  lon?: number;
  remainingDistance: number;
  remainingAscent: number;
  ascentGained: number;
  /** Average grade over the next 500 m of route, %. */
  upcomingGrade: number;
  finished: boolean;
  /** Grade to send to the trainer on this update, per the grade policy; null if none. */
  sendGrade: number | null;
}

const MAX_DT_S = 2;
const LOOKAHEAD_M = 500;

/** Ties trainer samples, route and physics together. No DOM or Bluetooth access. */
export class RideEngine {
  mode: RideMode = 'free';
  freeGrade = 0;
  private route: RouteData | null = null;
  private cumAscent: number[] = [];
  private speed = 0;
  private distance = 0;
  private lastT: number | null = null;
  private finished = false;

  constructor(
    public params: PhysicsParams,
    public policy: GradePolicy,
  ) {}

  setRoute(route: RouteData | null): void {
    this.route = route;
    this.cumAscent = [];
    if (route) {
      let a = 0;
      this.cumAscent = route.ele.map((e, i) => (a += i ? Math.max(0, e - route.ele[i - 1]) : 0));
    }
    this.reset();
  }

  setMode(mode: RideMode): void {
    this.mode = mode;
    this.policy.reset();
  }

  /** Start a fresh ride at the beginning of the route. */
  reset(): void {
    this.speed = 0;
    this.distance = 0;
    this.lastT = null;
    this.finished = false;
    this.policy.reset();
  }

  /** Continue from a stored position (resuming a ride after a reload). */
  setDistance(d: number): void {
    this.distance = d;
    this.speed = 0;
    this.lastT = null;
  }

  /** Crr and Cw to send alongside grade so the trainer's feel matches the virtual speed. */
  simParams(): { crr: number; cw: number } {
    return { crr: this.params.crr, cw: cw(this.params) };
  }

  /**
   * Process one trainer sample. Time advances only on samples (never a timer); `dt` comes from the
   * sample timestamps, clamped to 2 s. With `advance` false (not recording) nothing moves, but the
   * grade for the current position is still produced so the trainer feels right before the start.
   */
  update(t: number, powerW: number, advance: boolean): RideState {
    const dt =
      advance && this.lastT !== null ? Math.min(MAX_DT_S, Math.max(0, (t - this.lastT) / 1000)) : 0;
    this.lastT = advance ? t : null;

    const route = this.mode === 'route' ? this.route : null;
    if (route && this.distance >= route.distance && !this.finished) {
      // End of route: carry on as a free ride at 0 %.
      this.finished = true;
      this.mode = 'free';
      this.freeGrade = 0;
      this.policy.reset();
    }

    const activeRoute = this.mode === 'route' ? this.route : null;
    const grade = activeRoute
      ? gradeAt(activeRoute, this.distance)
      : this.mode === 'free' || this.mode === 'workout'
        ? this.freeGrade
        : 0;
    if (dt > 0) {
      const r = stepPhysics(this.speed, powerW, grade, dt, this.params);
      this.speed = r.speed;
      this.distance += r.distance;
    } else if (!advance) {
      this.speed = 0;
    }

    const sendGrade = this.mode === 'erg' ? null : this.policy.update(grade, t);
    return this.state(sendGrade);
  }

  private state(sendGrade: number | null): RideState {
    const route = this.route;
    const onRoute = this.mode === 'route' && route !== null;
    const state: RideState = {
      mode: this.mode,
      speed: this.speed,
      distance: this.distance,
      grade: onRoute ? gradeAt(route, this.distance) : this.mode === 'free' || this.mode === 'workout' ? this.freeGrade : 0,
      remainingDistance: 0,
      remainingAscent: 0,
      ascentGained: 0,
      upcomingGrade: 0,
      finished: this.finished,
      sendGrade,
    };
    if (route) {
      const d = Math.min(this.distance, route.distance);
      const i = Math.min(this.cumAscent.length - 1, Math.floor(d / ROUTE_SPACING_M));
      const end = Math.min(route.distance, d + LOOKAHEAD_M);
      state.remainingDistance = Math.max(0, route.distance - this.distance);
      state.ascentGained = this.cumAscent[i];
      state.remainingAscent = this.cumAscent[this.cumAscent.length - 1] - this.cumAscent[i];
      state.upcomingGrade = end > d ? ((eleAt(route, end) - eleAt(route, d)) / (end - d)) * 100 : 0;
      if (onRoute) {
        state.ele = eleAt(route, d);
        const j = Math.min(route.lat.length - 1, Math.round(d / ROUTE_SPACING_M));
        state.lat = route.lat[j];
        state.lon = route.lon[j];
      }
    }
    return state;
  }
}
