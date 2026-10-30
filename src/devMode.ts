/**
 * Developer preferences. They live in localStorage (not the database) because they are needed
 * before the database opens and are a per-device switch, not rider data, so they are deliberately
 * left out of backups.
 *
 * Everything simulator-related is gated behind `debug`: with debug mode off there is no simulated
 * trainer, no Debug tab and no auto-connect, and `?sim=` in the URL does nothing.
 */
export interface DevPrefs {
  /** Master switch, set in Settings. Off by default. */
  debug: boolean;
  /** Use the simulated trainer instead of Bluetooth. Only ever true when `debug` is on. */
  useSim: boolean;
  /** Connect the simulated trainer as soon as the app loads. Only used when `useSim` is on. */
  autoConnectSim: boolean;
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const get = (s: StorageLike, key: string): string | null => {
  try {
    return s.getItem(key);
  } catch {
    return null;
  }
};

/** `search` is the URL query string; `?sim=0|1` overrides the saved choice, but only in debug mode. */
export function readDevPrefs(storage: StorageLike, search = ''): DevPrefs {
  if (get(storage, 'debugMode') !== '1')
    return { debug: false, useSim: false, autoConnectSim: false };
  const q = new URLSearchParams(search).get('sim');
  return {
    debug: true,
    useSim: q !== null ? q !== '0' : get(storage, 'useSim') !== '0',
    autoConnectSim: get(storage, 'autoConnectSim') !== '0',
  };
}

export function writeDevPrefs(storage: StorageLike, prefs: DevPrefs): void {
  try {
    storage.setItem('debugMode', prefs.debug ? '1' : '0');
    storage.setItem('useSim', prefs.useSim ? '1' : '0');
    storage.setItem('autoConnectSim', prefs.autoConnectSim ? '1' : '0');
  } catch {
    /* storage unavailable (private mode); the switch simply won't stick */
  }
}

/** localStorage, or an inert stand-in where even touching it throws. */
export function safeLocalStorage(): StorageLike {
  try {
    return window.localStorage;
  } catch {
    return { getItem: () => null, setItem: () => {} };
  }
}
