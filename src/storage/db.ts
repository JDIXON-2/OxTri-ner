import Dexie, { type Table } from 'dexie';
import type { PowerSnapshot } from '../metrics/power';
import type { WorkoutStep } from '../workout/csv';

export interface SettingRow {
  key: string;
  value: unknown;
}

export interface RouteRow {
  id?: number;
  name: string;
  createdAt: number;
  distance: number;
  ascent: number;
  dist: number[];
  ele: number[];
  grade: number[];
  lat: number[];
  lon: number[];
}

export interface WorkoutRow {
  id?: number;
  name: string;
  createdAt: number;
  steps: WorkoutStep[];
}

export interface RideSummary extends PowerSnapshot {
  distance: number;
}

export interface RideRow {
  id?: number;
  startedAt: number;
  endedAt?: number;
  routeId?: number;
  /** Set when the ride followed a workout, so resuming after a reload can pick it back up. */
  workoutId?: number;
  status: 'active' | 'finished';
  ftp: number;
  summary?: RideSummary;
}

export interface SampleRow {
  rideId: number;
  /** Ride-clock milliseconds (paused time excluded). */
  t: number;
  power: number;
  cadence: number;
  trainerSpeed: number;
  virtualSpeed?: number;
  distance: number;
  grade: number;
  ele?: number;
  lat?: number;
  lon?: number;
  hr?: number;
}

export class OxDb extends Dexie {
  settings!: Table<SettingRow, string>;
  routes!: Table<RouteRow, number>;
  rides!: Table<RideRow, number>;
  workouts!: Table<WorkoutRow, number>;
  samples!: Table<SampleRow, [number, number]>;

  constructor(name = 'oxtri') {
    super(name);
    this.version(1).stores({
      settings: 'key',
      routes: '++id, name, createdAt',
      rides: '++id, startedAt, routeId, status',
      samples: '[rideId+t]',
    });
    this.version(2).stores({ workouts: '++id, name, createdAt' });
  }
}

export const DEFAULT_SETTINGS = {
  ftp: 250,
  smoothingWindow: 60,
  mass: 85,
  eta: 0.97,
  crr: 0.004,
  cdA: 0.32,
  rho: 1.225,
  difficulty: 100,
  gradeMin: -10,
  gradeMax: 20,
} as const;

export interface CalibrationSetting {
  effort: number;
  watts: number;
}

export async function getSetting<T>(db: OxDb, key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setSetting(db: OxDb, key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}
