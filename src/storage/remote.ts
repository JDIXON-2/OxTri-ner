import { DEFAULT_REMOTE, type RemoteSettings } from '../remote/controller';
import { getSetting, setSetting, type OxDb } from './db';

const button = (v: unknown): number | null | undefined => {
  if (v === null) return null;
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 64 ? v : undefined;
};

/** Remote-control settings, with anything missing or malformed falling back to the defaults. */
export async function getRemoteSettings(db: OxDb): Promise<RemoteSettings> {
  const raw = await getSetting<Record<string, unknown> | null>(db, 'remote', null);
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_REMOTE };
  // `null` is a real choice ("no button assigned"); only `undefined` means missing or invalid.
  const orDefault = (v: number | null | undefined, fallback: number | null) =>
    v === undefined ? fallback : v;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_REMOTE.enabled,
    up: orDefault(button(raw.up), DEFAULT_REMOTE.up),
    down: orDefault(button(raw.down), DEFAULT_REMOTE.down),
  };
}

export function saveRemoteSettings(db: OxDb, settings: RemoteSettings): Promise<void> {
  return setSetting(db, 'remote', settings);
}
