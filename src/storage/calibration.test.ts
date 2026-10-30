import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { getCalibration, saveCalibration } from './calibration';
import { OxDb } from './db';

it('saves and loads calibration sorted by effort, dropping malformed entries', async () => {
  const db = new OxDb('calibration-test');
  expect(await getCalibration(db)).toEqual([]);
  await saveCalibration(db, [
    { effort: 1, watts: 300 },
    { effort: 0.2, watts: 100 },
  ]);
  expect((await getCalibration(db)).map((p) => p.effort)).toEqual([0.2, 1]);

  await db.settings.put({
    key: 'calibration',
    value: [{ effort: 2, watts: 100 }, { effort: 0.5 }, 'x', { effort: 0.2, watts: 120 }],
  });
  expect(await getCalibration(db)).toEqual([{ effort: 0.2, watts: 120 }]);

  await db.settings.put({ key: 'calibration', value: 'garbage' });
  expect(await getCalibration(db)).toEqual([]);
});

it('ignores points from the old five-level calibration that are no longer measured', async () => {
  const db = new OxDb('calibration-legacy-test');
  await saveCalibration(db, [
    { effort: 0.2, watts: 100 },
    { effort: 0.4, watts: 160 },
    { effort: 0.6, watts: 210 },
    { effort: 0.8, watts: 250 },
    { effort: 1, watts: 300 },
  ]);
  expect(await getCalibration(db)).toEqual([
    { effort: 0.2, watts: 100 },
    { effort: 1, watts: 300 },
  ]);
});
