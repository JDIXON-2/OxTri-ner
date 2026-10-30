import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { buildRoute } from '../route/gpx';
import { OxDb } from './db';
import { addRoute, deleteRoute, getRoute, listRoutes, renameRoute } from './routes';

const pts = Array.from({ length: 50 }, (_, i) => ({ lat: 51 + i * 0.0002, lon: -1, ele: 100 + i }));

it('stores, renames, lists and deletes routes', async () => {
  const db = new OxDb('routes-test');
  const id = await addRoute(db, buildRoute('Hill', pts));
  const stored = await getRoute(db, id);
  expect(stored?.name).toBe('Hill');
  expect(stored?.dist.length).toBe(stored?.grade.length);
  await renameRoute(db, id, 'Big hill');
  expect((await listRoutes(db))[0].name).toBe('Big hill');
  await deleteRoute(db, id);
  expect(await listRoutes(db)).toEqual([]);
});
