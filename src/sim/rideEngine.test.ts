import { describe, expect, it } from 'vitest';
import { GradePolicy } from '../ride/gradePolicy';
import { buildRoute } from '../route/gpx';
import { DEFAULT_PHYSICS } from './physics';
import { RideEngine } from './rideEngine';

const M_PER_DEG = 111194.93;
const route = (lengthM: number, climb: number) =>
  buildRoute(
    'r',
    Array.from({ length: 101 }, (_, i) => ({
      lat: 51 + ((i / 100) * lengthM) / M_PER_DEG,
      lon: -1,
      ele: 100 + (i / 100) * climb,
    })),
  );

const mk = (difficulty = 100) =>
  new RideEngine(DEFAULT_PHYSICS, new GradePolicy({ minGrade: -10, maxGrade: 20, difficulty }));

function ride(e: RideEngine, seconds: number, power: number, t0 = 0) {
  let s = e.update(t0, power, true);
  for (let i = 1; i <= seconds; i++) s = e.update(t0 + i * 1000, power, true);
  return s;
}

describe('RideEngine', () => {
  it('moves along a flat route and reports remaining distance', () => {
    const e = mk();
    const r = route(5000, 0);
    e.setRoute(r);
    e.setMode('route');
    const s = ride(e, 60, 200);
    expect(s.distance).toBeGreaterThan(400);
    expect(s.speed * 3.6).toBeGreaterThan(25);
    expect(s.remainingDistance).toBeCloseTo(r.distance - s.distance, 6);
    expect(s.grade).toBeCloseTo(0, 1);
  });

  it('climbs slower than it rides flat and sends the true grade', () => {
    const flat = mk();
    flat.setRoute(route(3000, 0));
    flat.setMode('route');
    const hill = mk();
    hill.setRoute(route(3000, 240)); // 8 %
    hill.setMode('route');
    expect(ride(hill, 60, 250).distance).toBeLessThan(ride(flat, 60, 250).distance / 2);
    const first = mk();
    first.setRoute(route(3000, 240));
    first.setMode('route');
    expect(first.update(0, 200, true).sendGrade).toBeCloseTo(8, 0);
  });

  it('scales only the sent grade by difficulty', () => {
    const e = mk(50);
    e.setRoute(route(3000, 240));
    e.setMode('route');
    const s = e.update(0, 200, true);
    expect(s.grade).toBeCloseTo(8, 0);
    expect(s.sendGrade).toBeCloseTo(4, 0);
  });

  it('clamps dt to 2 s', () => {
    const e = mk();
    e.setRoute(route(3000, 0));
    e.setMode('route');
    e.update(0, 200, true);
    const s = e.update(60_000, 200, true);
    expect(s.distance).toBeLessThan(10); // two seconds from a standstill, not sixty
  });

  it('does not move when not advancing, but still produces the grade', () => {
    const e = mk();
    e.setRoute(route(3000, 240));
    e.setMode('route');
    const s = e.update(0, 300, false);
    expect(s.distance).toBe(0);
    expect(s.sendGrade).not.toBeNull();
  });

  it('switches to a 0 % free ride at the end of the route', () => {
    const e = mk();
    e.setRoute(route(200, 2));
    e.setMode('route');
    const s = ride(e, 60, 300);
    expect(s.finished).toBe(true);
    expect(e.mode).toBe('free');
    expect(s.grade).toBe(0);
    expect(s.distance).toBeGreaterThan(200);
  });

  it('tracks ascent and the upcoming grade', () => {
    const e = mk();
    e.setRoute(route(3000, 150)); // 5 %
    e.setMode('route');
    const s = e.update(0, 0, true);
    expect(s.remainingAscent).toBeCloseTo(150, -1);
    expect(s.upcomingGrade).toBeCloseTo(5, 0);
    expect(s.ele).toBeCloseTo(100, 0);
  });

  it('sends nothing in ERG mode and uses 0 % physics', () => {
    const e = mk();
    e.setMode('erg');
    const s = e.update(0, 200, true);
    expect(s.sendGrade).toBeNull();
    expect(s.grade).toBe(0);
  });

  it('workout mode lets the trainer hold power: no grade sent, 0 % physics', () => {
    const e = mk();
    e.setMode('workout');
    const s = e.update(0, 200, true);
    expect(s.mode).toBe('workout');
    expect(s.sendGrade).toBeNull();
    expect(s.grade).toBe(0);
    expect(ride(e, 30, 200).distance).toBeGreaterThan(100);
  });

  it('exposes Crr and Cw for the trainer', () => {
    expect(mk().simParams().cw).toBeCloseTo(0.196, 3);
  });
});
