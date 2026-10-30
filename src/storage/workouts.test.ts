import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBackup, restoreBackup } from './backup';
import { OxDb } from './db';
import { validateBackup } from './export';
import { addWorkout, deleteWorkout, getWorkout, listWorkouts } from './workouts';

let n = 0;
let db: OxDb;
beforeEach(() => {
  db = new OxDb(`workouts-test-${n++}`);
});

const steps = [
  { seconds: 300, effort: 0.5 },
  { seconds: 60, effort: 0.9 },
];

describe('workout storage', () => {
  it('adds, lists newest first, gets and deletes', async () => {
    const a = await addWorkout(db, 'Easy', steps);
    await new Promise((r) => setTimeout(r, 5));
    const b = await addWorkout(db, 'Hard', steps);
    expect((await listWorkouts(db)).map((w) => w.name)).toEqual(['Hard', 'Easy']);
    expect((await getWorkout(db, a))?.steps).toEqual(steps);
    await deleteWorkout(db, b);
    expect((await listWorkouts(db)).map((w) => w.name)).toEqual(['Easy']);
  });
});

describe('workouts in backups', () => {
  it('round-trips workouts and the calibration setting', async () => {
    await addWorkout(db, 'Intervals', steps);
    await db.settings.put({ key: 'calibration', value: [{ effort: 0.5, watts: 150 }] });
    const json = JSON.stringify(await createBackup(db));
    await Promise.all([db.workouts.clear(), db.settings.clear()]);
    await restoreBackup(db, json);
    expect((await db.workouts.toArray())[0].steps).toEqual(steps);
    expect((await db.settings.get('calibration'))?.value).toEqual([{ effort: 0.5, watts: 150 }]);
  });

  it('still restores a backup made before workouts existed', async () => {
    await addWorkout(db, 'Will be replaced', steps);
    const old = {
      app: 'oxtri-ner',
      version: 1,
      exportedAt: 'x',
      tables: { settings: [], routes: [], rides: [], samples: [] },
    };
    await restoreBackup(db, JSON.stringify(old));
    expect(await db.workouts.count()).toBe(0); // restore replaces everything
  });

  it('rejects a malformed workouts table', () => {
    const bad = {
      app: 'oxtri-ner',
      version: 1,
      tables: { settings: [], routes: [], rides: [], samples: [], workouts: 'x' },
    };
    expect(() => validateBackup(bad)).toThrow(/workouts/);
  });
});

describe('database upgrade', () => {
  it('opens a version-1 database with its data intact and adds the workouts table', async () => {
    const name = `upgrade-test-${n++}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({
      settings: 'key',
      routes: '++id, name, createdAt',
      rides: '++id, startedAt, routeId, status',
      samples: '[rideId+t]',
    });
    await v1.table('settings').put({ key: 'ftp', value: 280 });
    await v1.table('rides').add({ startedAt: 1, status: 'finished', ftp: 280 });
    v1.close();

    const upgraded = new OxDb(name);
    expect((await upgraded.settings.get('ftp'))?.value).toBe(280);
    expect(await upgraded.rides.count()).toBe(1);
    await upgraded.workouts.add({ name: 'New', createdAt: 1, steps });
    expect(await upgraded.workouts.count()).toBe(1);
  });
});
