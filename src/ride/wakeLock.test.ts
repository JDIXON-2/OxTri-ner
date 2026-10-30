import { describe, expect, it } from 'vitest';
import { WakeLockManager, type WakeLockHost } from './wakeLock';

function fakes() {
  let requests = 0;
  const releaseCbs: (() => void)[] = [];
  const nav: WakeLockHost = {
    wakeLock: {
      request: async () => {
        requests++;
        let cb: () => void = () => {};
        return {
          release: async () => cb(),
          addEventListener: (_t: 'release', f: () => void) => {
            cb = f;
            releaseCbs.push(f);
          },
        };
      },
    },
  };
  const listeners: (() => void)[] = [];
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (_: string, f: () => void) => void listeners.push(f),
  };
  return { nav, doc, listeners, releaseCbs, requests: () => requests };
}

describe('WakeLockManager', () => {
  it('acquires and releases', async () => {
    const f = fakes();
    const m = new WakeLockManager(f.nav, f.doc as never);
    await m.acquire();
    expect(m.held).toBe(true);
    await m.release();
    expect(m.held).toBe(false);
  });

  it('re-acquires when the page becomes visible after the browser dropped the lock', async () => {
    const f = fakes();
    const m = new WakeLockManager(f.nav, f.doc as never);
    await m.acquire();
    f.releaseCbs[0](); // browser released it (tab hidden)
    expect(m.held).toBe(false);
    f.listeners.forEach((l) => l());
    await new Promise((r) => setTimeout(r));
    expect(m.held).toBe(true);
    expect(f.requests()).toBe(2);
  });

  it('does not re-acquire after an explicit release', async () => {
    const f = fakes();
    const m = new WakeLockManager(f.nav, f.doc as never);
    await m.acquire();
    await m.release();
    f.listeners.forEach((l) => l());
    await new Promise((r) => setTimeout(r));
    expect(f.requests()).toBe(1);
  });

  it('is a no-op where the API is missing', async () => {
    const m = new WakeLockManager({}, {
      addEventListener() {},
      visibilityState: 'visible',
    } as never);
    await m.acquire();
    expect(m.supported).toBe(false);
    expect(m.held).toBe(false);
  });
});
