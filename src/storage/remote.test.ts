import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { DEFAULT_REMOTE } from '../remote/controller';
import { OxDb } from './db';
import { getRemoteSettings, saveRemoteSettings } from './remote';

it('defaults to D-pad up/down, enabled', async () => {
  expect(await getRemoteSettings(new OxDb('remote-defaults'))).toEqual(DEFAULT_REMOTE);
});

it('round-trips saved settings, including an unassigned slot', async () => {
  const db = new OxDb('remote-roundtrip');
  await saveRemoteSettings(db, { enabled: false, up: 5, down: null });
  expect(await getRemoteSettings(db)).toEqual({ enabled: false, up: 5, down: null });
});

it('falls back to defaults for anything malformed', async () => {
  const db = new OxDb('remote-malformed');
  await db.settings.put({ key: 'remote', value: { enabled: 'yes', up: -3, down: 1.5 } });
  expect(await getRemoteSettings(db)).toEqual(DEFAULT_REMOTE);
  await db.settings.put({ key: 'remote', value: 'garbage' });
  expect(await getRemoteSettings(db)).toEqual(DEFAULT_REMOTE);
});
