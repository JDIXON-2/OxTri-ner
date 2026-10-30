import type { WorkoutStep } from './csv';

export const totalSeconds = (steps: WorkoutStep[]): number =>
  steps.reduce((a, s) => a + s.seconds, 0);

export interface WorkoutPosition {
  /** Index of the current step; the last step's index once done. */
  index: number;
  step: WorkoutStep;
  next: WorkoutStep | null;
  intoStep: number;
  remainingInStep: number;
  remainingTotal: number;
  done: boolean;
}

/** Where `elapsedS` seconds of ride time falls in the workout. */
export function positionAt(steps: WorkoutStep[], elapsedS: number): WorkoutPosition {
  const total = totalSeconds(steps);
  const t = Math.max(0, elapsedS);
  let start = 0;
  for (let i = 0; i < steps.length; i++) {
    const end = start + steps[i].seconds;
    if (t < end) {
      return {
        index: i,
        step: steps[i],
        next: steps[i + 1] ?? null,
        intoStep: t - start,
        remainingInStep: end - t,
        remainingTotal: total - t,
        done: false,
      };
    }
    start = end;
  }
  const last = steps.length - 1;
  return {
    index: last,
    step: steps[last],
    next: null,
    intoStep: steps[last].seconds,
    remainingInStep: 0,
    remainingTotal: 0,
    done: true,
  };
}

export interface Bar {
  x: number;
  y: number;
  w: number;
  h: number;
  effort: number;
}

/** Bar-chart geometry for a workout: width proportional to time, height to effort. */
export function barLayout(steps: WorkoutStep[], width: number, height: number, minBarH = 3): Bar[] {
  const total = totalSeconds(steps);
  let t = 0;
  return steps.map((s) => {
    const x = (t / total) * width;
    t += s.seconds;
    const h = Math.max(minBarH, s.effort * height);
    return { x, y: height - h, w: (s.seconds / total) * width, h, effort: s.effort };
  });
}
