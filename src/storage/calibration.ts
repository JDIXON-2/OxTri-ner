import { isCalibrationLevel, type CalibrationPoint } from '../workout/effortCurve';
import { getSetting, setSetting, type OxDb } from './db';

const KEY = 'calibration';

const valid = (p: unknown): p is CalibrationPoint => {
  const q = p as CalibrationPoint | null;
  return (
    !!q &&
    Number.isFinite(q.effort) &&
    q.effort >= 0 &&
    q.effort <= 1 &&
    Number.isFinite(q.watts) &&
    q.watts >= 0
  );
};

/**
 * The rider's effort → watts calibration, sorted by effort. Malformed entries are dropped, and so are
 * points for levels that are no longer calibrated directly (older versions measured five levels),
 * so a stale point can never quietly bend the line.
 */
export async function getCalibration(db: OxDb): Promise<CalibrationPoint[]> {
  const raw = await getSetting<unknown>(db, KEY, []);
  return (
    Array.isArray(raw) ? raw.filter(valid).filter((p) => isCalibrationLevel(p.effort)) : []
  ).sort((a, b) => a.effort - b.effort);
}

export function saveCalibration(db: OxDb, points: CalibrationPoint[]): Promise<void> {
  return setSetting(db, KEY, points);
}
