import type { RideRow, RouteRow, SampleRow, SettingRow, WorkoutRow } from './db';

export function escapeXml(s: string): string {
  return s.replace(
    /[<>&'"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!,
  );
}

/**
 * Garmin TCX for one ride: a single Biking activity with one lap. Watts go in the
 * ActivityExtension v2 `TPX` element; Position is written only for samples on a route.
 */
export function rideToTcx(ride: RideRow, samples: SampleRow[]): string {
  const start = ride.startedAt;
  const iso = (ms: number) => new Date(ms).toISOString();
  const last = samples[samples.length - 1];
  const totalS = last ? last.t / 1000 : (ride.summary?.elapsedS ?? 0);
  const distance = last?.distance ?? ride.summary?.distance ?? 0;
  const maxSpeed = samples.reduce(
    (m, s) => Math.max(m, (s.virtualSpeed ?? s.trainerSpeed) / 3.6),
    0,
  );
  const hrs = samples.map((s) => s.hr).filter((h): h is number => h !== undefined && h > 0);
  const avgW =
    ride.summary?.avg ??
    (samples.length ? samples.reduce((a, s) => a + s.power, 0) / samples.length : 0);
  const kcal = Math.round(ride.summary?.kj ?? 0); // ~25 % efficiency makes kcal ≈ kJ

  const points = samples
    .map((s) => {
      const parts = [`<Time>${iso(start + s.t)}</Time>`];
      if (s.lat !== undefined && s.lon !== undefined) {
        parts.push(
          `<Position><LatitudeDegrees>${s.lat.toFixed(6)}</LatitudeDegrees><LongitudeDegrees>${s.lon.toFixed(6)}</LongitudeDegrees></Position>`,
        );
      }
      if (s.ele !== undefined) parts.push(`<AltitudeMeters>${s.ele.toFixed(1)}</AltitudeMeters>`);
      parts.push(`<DistanceMeters>${s.distance.toFixed(1)}</DistanceMeters>`);
      if (s.hr) parts.push(`<HeartRateBpm><Value>${Math.round(s.hr)}</Value></HeartRateBpm>`);
      parts.push(`<Cadence>${Math.min(254, Math.max(0, Math.round(s.cadence)))}</Cadence>`);
      parts.push(
        `<Extensions><ns3:TPX><ns3:Watts>${Math.max(0, Math.round(s.power))}</ns3:Watts></ns3:TPX></Extensions>`,
      );
      return `<Trackpoint>${parts.join('')}</Trackpoint>`;
    })
    .join('\n          ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities>
    <Activity Sport="Biking">
      <Id>${iso(start)}</Id>
      <Lap StartTime="${iso(start)}">
        <TotalTimeSeconds>${totalS.toFixed(1)}</TotalTimeSeconds>
        <DistanceMeters>${distance.toFixed(1)}</DistanceMeters>
        <MaximumSpeed>${maxSpeed.toFixed(2)}</MaximumSpeed>
        <Calories>${kcal}</Calories>${
          hrs.length
            ? `
        <AverageHeartRateBpm><Value>${Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length)}</Value></AverageHeartRateBpm>
        <MaximumHeartRateBpm><Value>${Math.max(...hrs)}</Value></MaximumHeartRateBpm>`
            : ''
        }
        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
          ${points}
        </Track>
        <Extensions><ns3:LX><ns3:AvgWatts>${Math.round(avgW)}</ns3:AvgWatts></ns3:LX></Extensions>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>
`;
}

export function tcxFilename(ride: RideRow): string {
  const d = new Date(ride.startedAt);
  const p = (n: number) => String(n).padStart(2, '0');
  return `oxtri-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.tcx`;
}

export const BACKUP_VERSION = 1;

export interface Backup {
  app: 'oxtri-ner';
  version: number;
  exportedAt: string;
  tables: {
    settings: SettingRow[];
    routes: RouteRow[];
    rides: RideRow[];
    samples: SampleRow[];
    /** Absent in backups made before workouts existed. */
    workouts?: WorkoutRow[];
  };
}

export function makeBackup(tables: Backup['tables'], now = new Date()): Backup {
  return { app: 'oxtri-ner', version: BACKUP_VERSION, exportedAt: now.toISOString(), tables };
}

/** Check a parsed JSON value is a backup this version understands; throws a readable error if not. */
export function validateBackup(x: unknown): Backup {
  const b = x as Partial<Backup> | null;
  if (!b || typeof b !== 'object' || b.app !== 'oxtri-ner')
    throw new Error('Not an OxTri-ner backup file');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) {
    throw new Error(
      `Backup version ${String(b.version)} is not supported (this app supports up to ${BACKUP_VERSION})`,
    );
  }
  const t = b.tables;
  for (const k of ['settings', 'routes', 'rides', 'samples'] as const) {
    if (!t || !Array.isArray(t[k])) throw new Error(`Backup is missing the "${k}" table`);
  }
  if (t && t.workouts !== undefined && !Array.isArray(t.workouts)) {
    throw new Error('Backup has an invalid "workouts" table');
  }
  return b as Backup;
}
