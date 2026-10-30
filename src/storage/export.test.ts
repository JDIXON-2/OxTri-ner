// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createBackup, deleteRide, exportRideTcx, restoreBackup } from './backup';
import { OxDb, type RideRow, type SampleRow } from './db';
import { escapeXml, rideToTcx, tcxFilename, validateBackup } from './export';

const ride: RideRow = {
  id: 1,
  startedAt: Date.UTC(2026, 9, 30, 12, 0, 0),
  status: 'finished',
  ftp: 250,
  summary: {
    power: 200,
    avg3: 200,
    avg30: 200,
    avg: 200,
    max: 300,
    np: 205,
    if: 0.82,
    tss: 1,
    kj: 12.4,
    avgCadence: 90,
    elapsedS: 3,
    movingS: 3,
    distance: 30,
  },
};
const samples: SampleRow[] = [0, 1000, 2000, 3000].map((t, i) => ({
  rideId: 1,
  t,
  power: 200 + i,
  cadence: 90,
  trainerSpeed: 36,
  virtualSpeed: 36,
  distance: i * 10,
  grade: 2,
  ele: 100 + i,
  lat: 51 + i * 1e-4,
  lon: -1,
}));

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
const tcxNs = 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2';
const extNs = 'http://www.garmin.com/xmlschemas/ActivityExtension/v2';

describe('rideToTcx', () => {
  const doc = parse(rideToTcx(ride, samples));

  it('is well-formed with a Biking activity and one lap', () => {
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(doc.documentElement.localName).toBe('TrainingCenterDatabase');
    expect(doc.getElementsByTagName('Activity')[0].getAttribute('Sport')).toBe('Biking');
    expect(doc.getElementsByTagName('Lap')).toHaveLength(1);
    expect(doc.getElementsByTagName('Id')[0].textContent).toBe('2026-10-30T12:00:00.000Z');
  });

  it('writes trackpoints with time, position, altitude, distance, cadence and watts', () => {
    const tps = doc.getElementsByTagName('Trackpoint');
    expect(tps).toHaveLength(4);
    const tp = tps[2];
    expect([...tp.children].map((c) => c.localName)).toEqual([
      'Time',
      'Position',
      'AltitudeMeters',
      'DistanceMeters',
      'Cadence',
      'Extensions',
    ]);
    expect(tp.getElementsByTagName('Time')[0].textContent).toBe('2026-10-30T12:00:02.000Z');
    expect(tp.getElementsByTagNameNS(extNs, 'Watts')[0].textContent).toBe('202');
    expect(doc.documentElement.namespaceURI).toBe(tcxNs);
  });

  it('omits Position for samples that are not on a route', () => {
    const free = parse(
      rideToTcx(
        ride,
        samples.map((s) => ({ ...s, lat: undefined, lon: undefined, ele: undefined })),
      ),
    );
    expect(free.getElementsByTagName('Position')).toHaveLength(0);
    expect(free.getElementsByTagName('AltitudeMeters')).toHaveLength(0);
    expect(free.getElementsByTagName('Trackpoint')).toHaveLength(4);
  });

  it('writes lap totals', () => {
    expect(doc.getElementsByTagName('TotalTimeSeconds')[0].textContent).toBe('3.0');
    expect(doc.getElementsByTagName('DistanceMeters')[0].textContent).toBe('30.0');
    expect(doc.getElementsByTagName('Calories')[0].textContent).toBe('12');
  });

  it('includes heart rate only when present', () => {
    expect(doc.getElementsByTagName('HeartRateBpm')).toHaveLength(0);
    const hr = parse(
      rideToTcx(
        ride,
        samples.map((s) => ({ ...s, hr: 140 })),
      ),
    );
    expect(hr.getElementsByTagName('AverageHeartRateBpm')).toHaveLength(1);
  });

  it('names files from the start time and escapes XML', () => {
    expect(tcxFilename(ride)).toMatch(/^oxtri-2026-10-30-\d{4}\.tcx$/);
    expect(escapeXml(`a<b>&"'`)).toBe('a&lt;b&gt;&amp;&quot;&apos;');
  });
});

let n = 0;
let db: OxDb;
beforeEach(() => {
  db = new OxDb(`export-test-${n++}`);
});

describe('backup and restore', () => {
  const route = {
    name: 'R',
    createdAt: 1,
    distance: 20,
    ascent: 1,
    dist: [0, 10, 20],
    ele: [1, 2, 3],
    grade: [1, 1, 1],
    lat: [0, 0, 0],
    lon: [0, 0, 0],
  };

  async function seed() {
    await db.settings.put({ key: 'ftp', value: 280 });
    await db.routes.add(route);
    await db.rides.add({ ...ride, id: undefined });
    await db.samples.bulkAdd(samples);
  }

  it('round-trips every table through JSON', async () => {
    await seed();
    const json = JSON.stringify(await createBackup(db));
    await Promise.all([
      db.settings.clear(),
      db.routes.clear(),
      db.rides.clear(),
      db.samples.clear(),
    ]);
    await restoreBackup(db, json);
    expect(await db.settings.get('ftp')).toEqual({ key: 'ftp', value: 280 });
    expect((await db.routes.toArray())[0].name).toBe('R');
    expect(await db.samples.count()).toBe(4);
    expect((await db.rides.toArray())[0].summary?.kj).toBe(12.4);
  });

  it('replaces existing data and rejects bad files without touching it', async () => {
    await seed();
    await expect(restoreBackup(db, 'nope')).rejects.toThrow(/JSON/);
    await expect(restoreBackup(db, '{"app":"other"}')).rejects.toThrow(/Not an OxTri-ner/);
    expect(await db.samples.count()).toBe(4);
    expect(() => validateBackup({ app: 'oxtri-ner', version: 99, tables: {} })).toThrow(
      /not supported/,
    );
    expect(() =>
      validateBackup({ app: 'oxtri-ner', version: 1, tables: { settings: [] } }),
    ).toThrow(/missing/);
  });
});

describe('ride helpers', () => {
  it('exports TCX from the database and deletes a ride with its samples', async () => {
    const id = await db.rides.add({ ...ride, id: undefined });
    await db.samples.bulkAdd(samples.map((s) => ({ ...s, rideId: id })));
    const out = await exportRideTcx(db, id);
    expect(out?.xml).toContain('<Trackpoint>');
    await deleteRide(db, id);
    expect(await db.rides.count()).toBe(0);
    expect(await db.samples.count()).toBe(0);
    expect(await exportRideTcx(db, id)).toBeNull();
  });
});
