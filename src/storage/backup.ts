import type { OxDb } from './db';
import { makeBackup, rideToTcx, tcxFilename, validateBackup, type Backup } from './export';

export async function createBackup(db: OxDb): Promise<Backup> {
  const [settings, routes, rides, samples, workouts] = await Promise.all([
    db.settings.toArray(),
    db.routes.toArray(),
    db.rides.toArray(),
    db.samples.toArray(),
    db.workouts.toArray(),
  ]);
  return makeBackup({ settings, routes, rides, samples, workouts });
}

/** Replace everything in the database with the backup. The file is validated before anything is deleted. */
export async function restoreBackup(db: OxDb, json: string): Promise<Backup> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Backup file is not valid JSON');
  }
  const backup = validateBackup(parsed);
  await db.transaction(
    'rw',
    [db.settings, db.routes, db.rides, db.samples, db.workouts],
    async () => {
      await Promise.all([
        db.settings.clear(),
        db.routes.clear(),
        db.rides.clear(),
        db.samples.clear(),
        db.workouts.clear(),
      ]);
      await db.settings.bulkAdd(backup.tables.settings);
      await db.routes.bulkAdd(backup.tables.routes);
      await db.rides.bulkAdd(backup.tables.rides);
      await db.samples.bulkAdd(backup.tables.samples);
      await db.workouts.bulkAdd(backup.tables.workouts ?? []);
    },
  );
  return backup;
}

export async function listRides(db: OxDb) {
  return db.rides.orderBy('startedAt').reverse().toArray();
}

export async function getRideSamples(db: OxDb, rideId: number) {
  return db.samples.where('[rideId+t]').between([rideId, -Infinity], [rideId, Infinity]).toArray();
}

export async function deleteRide(db: OxDb, rideId: number): Promise<void> {
  await db.transaction('rw', db.rides, db.samples, async () => {
    await db.samples.where('[rideId+t]').between([rideId, -Infinity], [rideId, Infinity]).delete();
    await db.rides.delete(rideId);
  });
}

export async function exportRideTcx(
  db: OxDb,
  rideId: number,
): Promise<{ filename: string; xml: string } | null> {
  const ride = await db.rides.get(rideId);
  if (!ride) return null;
  return { filename: tcxFilename(ride), xml: rideToTcx(ride, await getRideSamples(db, rideId)) };
}
