// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { saveCalibration } from '../storage/calibration';
import { OxDb } from '../storage/db';
import { addWorkout } from '../storage/workouts';
import { createWorkoutPanel, type WorkoutPanel } from './workoutPanel';

let n = 0;
let panel: WorkoutPanel;

// One 60 s step at full effort; calibration says full effort = 200 W, so the target is 200 W.
beforeEach(async () => {
  const db = new OxDb(`panel-test-${n++}`);
  await addWorkout(db, 'All out', [{ seconds: 60, effort: 1 }]);
  await saveCalibration(db, [{ effort: 1, watts: 200 }]);
  panel = createWorkoutPanel({ db, onChange: () => {} });
  await panel.refresh();
});

const q = (sel: string) => panel.root.querySelector(sel) as HTMLElement;

describe('workout power meter', () => {
  it('shows current and target power', () => {
    panel.update(10, { currentW: 148.4, active: true });
    expect(q('.pmeter-readouts').textContent).toContain('148 W');
    expect(q('.pmeter-readouts').textContent).toContain('200 W');
  });

  it('tells the rider to push harder when under target, and by how much', () => {
    panel.update(10, { currentW: 150, active: true });
    expect(q('.pmeter-status').textContent).toBe('▲ More effort  +50 W');
    expect(q('.pmeter-status').classList.contains('more')).toBe(true);
    expect(q('.pmeter-needle').classList.contains('more')).toBe(true);
  });

  it('tells the rider to ease off when over target, and by how much', () => {
    panel.update(10, { currentW: 245, active: true });
    expect(q('.pmeter-status').textContent).toBe('▼ Ease off  −45 W');
    expect(q('.pmeter-status').classList.contains('less')).toBe(true);
  });

  it('says on target within the tolerance', () => {
    panel.update(10, { currentW: 205, active: true });
    expect(q('.pmeter-status').textContent).toBe('✓ On target');
    expect(q('.pmeter-status').classList.contains('on')).toBe(true);
  });

  it('gives no more/less guidance until the ride is recording', () => {
    panel.update(0, { currentW: 0, active: false });
    expect(q('.pmeter-status').textContent).toContain('Start the ride');
    expect(q('.pmeter-status').classList.contains('idle')).toBe(true);
    expect(q('.pmeter-status').classList.contains('more')).toBe(false);
  });

  it('positions the needle and target marker along the track', () => {
    panel.update(10, { currentW: 100, active: true });
    // Scale is 0–320 W for a 200 W target: target at 62.5 %, needle at 31.25 %.
    expect(q('.pmeter-tick').style.left).toBe('62.5%');
    expect(q('.pmeter-needle').style.left).toBe('31.25%');
  });

  it('hides the meter once the workout is complete', () => {
    expect(q('.pmeter').hidden).toBe(false);
    panel.update(61, { currentW: 100, active: true });
    expect(q('.pmeter').hidden).toBe(true);
  });

  it('describes the reading for screen readers', () => {
    panel.update(10, { currentW: 150, active: true });
    expect(q('.pmeter-track').getAttribute('aria-label')).toBe(
      'Your power 150 watts, target 200 watts',
    );
  });
});
