import { describe, expect, it } from 'vitest';
import { readDevPrefs, writeDevPrefs, type StorageLike } from './devMode';

const store = (
  init: Record<string, string> = {},
): StorageLike & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
};

describe('readDevPrefs', () => {
  it('is all off by default', () => {
    expect(readDevPrefs(store())).toEqual({ debug: false, useSim: false, autoConnectSim: false });
  });

  it('keeps the simulator off when debug mode is off, even if it was saved on before', () => {
    const s = store({ useSim: '1', autoConnectSim: '1' });
    expect(readDevPrefs(s)).toEqual({ debug: false, useSim: false, autoConnectSim: false });
  });

  it('ignores ?sim=1 in the URL unless debug mode is on', () => {
    expect(readDevPrefs(store(), '?sim=1').useSim).toBe(false);
    expect(readDevPrefs(store({ debugMode: '0' }), '?sim=1').debug).toBe(false);
  });

  it('with debug mode on, the simulator and auto-connect default to on', () => {
    expect(readDevPrefs(store({ debugMode: '1' }))).toEqual({
      debug: true,
      useSim: true,
      autoConnectSim: true,
    });
  });

  it('honours the saved choices once debug mode is on', () => {
    const s = store({ debugMode: '1', useSim: '0', autoConnectSim: '0' });
    expect(readDevPrefs(s)).toEqual({ debug: true, useSim: false, autoConnectSim: false });
  });

  it('lets ?sim= override the saved choice, in debug mode only', () => {
    const s = store({ debugMode: '1', useSim: '0' });
    expect(readDevPrefs(s, '?sim=1').useSim).toBe(true);
    expect(readDevPrefs(store({ debugMode: '1', useSim: '1' }), '?sim=0').useSim).toBe(false);
  });

  it('copes with storage that throws', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readDevPrefs(broken).debug).toBe(false);
    expect(() =>
      writeDevPrefs(broken, { debug: true, useSim: true, autoConnectSim: true }),
    ).not.toThrow();
  });
});

describe('writeDevPrefs', () => {
  it('round-trips through readDevPrefs', () => {
    const s = store();
    writeDevPrefs(s, { debug: true, useSim: false, autoConnectSim: true });
    expect(readDevPrefs(s)).toEqual({ debug: true, useSim: false, autoConnectSim: true });
    writeDevPrefs(s, { debug: false, useSim: true, autoConnectSim: true });
    expect(readDevPrefs(s).debug).toBe(false);
  });
});
