import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_REMOTE, RemoteController } from './controller';
import type { PadSnapshot } from './gamepad';

let down: number[];
let nudges: number[];
let canNudge: boolean;
let c: RemoteController;
let t: number;

const snapshot = (): PadSnapshot[] => [
  {
    index: 0,
    id: 'Wireless Controller',
    mapping: 'standard',
    connected: true,
    buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: down.includes(i), value: 0 })),
  },
];
const press = (...buttons: number[]) => {
  down = buttons;
  t += 16;
  c.poll(t);
};
const release = () => press();

beforeEach(() => {
  down = [];
  nudges = [];
  canNudge = true;
  t = 0;
  c = new RemoteController({
    nudge: (d) => (nudges.push(d), true),
    canNudge: () => canNudge,
    getPads: snapshot,
    learnTimeoutMs: 1000,
  });
});

describe('RemoteController: acting on buttons', () => {
  it('uses D-pad up to raise and D-pad down to lower by default', () => {
    expect(c.settings).toEqual(DEFAULT_REMOTE);
    press(12);
    release();
    press(13);
    expect(nudges).toEqual([1, -1]);
  });

  it('steps once per press, then repeats while held', () => {
    press(12);
    expect(nudges).toEqual([1]);
    c.poll(t + 100); // held, before the repeat delay
    expect(nudges).toEqual([1]);
    c.poll(t + 500); // held past the delay
    expect(nudges).toEqual([1, 1]);
  });

  it('ignores buttons that are not assigned', () => {
    press(0); // Cross
    press(7); // R2
    expect(nudges).toEqual([]);
  });

  it('follows reassigned buttons', () => {
    c.settings = { enabled: true, up: 5, down: 4 }; // R1 up, L1 down
    press(5);
    release();
    press(4);
    release();
    press(12); // the old default no longer does anything
    expect(nudges).toEqual([1, -1]);
  });

  it('does nothing when switched off', () => {
    c.settings = { ...DEFAULT_REMOTE, enabled: false };
    press(12);
    expect(nudges).toEqual([]);
  });

  it('does nothing when the Ride tab is not showing', () => {
    canNudge = false;
    press(12);
    expect(nudges).toEqual([]);
  });

  it('does nothing for an unassigned slot', () => {
    c.settings = { enabled: true, up: null, down: 13 };
    press(12);
    expect(nudges).toEqual([]);
  });
});

describe('RemoteController: learning a button', () => {
  it('captures the next press instead of acting on it', async () => {
    const learned = c.learn('up');
    expect(c.isLearning).toBe(true);
    press(12); // would normally raise the grade
    expect(await learned).toBe(12);
    expect(nudges).toEqual([]);
    expect(c.isLearning).toBe(false);
  });

  it('resolves null when cancelled, and when it times out', async () => {
    const a = c.learn('down');
    c.cancelLearn();
    expect(await a).toBeNull();

    vi.useFakeTimers();
    const b = c.learn('down');
    vi.advanceTimersByTime(1001);
    expect(await b).toBeNull();
    vi.useRealTimers();
  });

  it('a new learn request cancels the previous one', async () => {
    const first = c.learn('up');
    const second = c.learn('down');
    expect(await first).toBeNull();
    press(13);
    expect(await second).toBe(13);
  });

  it('returns to normal afterwards', async () => {
    const learned = c.learn('up');
    press(5);
    await learned;
    release();
    c.settings = { enabled: true, up: 5, down: 13 };
    press(5);
    expect(nudges).toEqual([1]);
  });
});

describe('RemoteController: reporting', () => {
  it('reports every button pressed with a friendly label, even ones that do nothing', () => {
    const seen: string[] = [];
    c.onButton((b) => seen.push(b.label));
    press(0);
    release();
    press(12);
    expect(seen).toEqual(['Cross (✕) · button 0', 'D-pad up · button 12']);
  });

  it('reports controllers connecting and disconnecting', () => {
    const seen: string[] = [];
    let pads: PadSnapshot[] = [];
    const c2 = new RemoteController({
      nudge: () => true,
      canNudge: () => true,
      getPads: () => pads,
    });
    c2.onPads((s) => seen.push(s));
    c2.poll(0); // nothing connected
    pads = snapshot();
    c2.poll(16);
    c2.poll(32); // no change: no repeat report
    pads = [];
    c2.poll(48);
    expect(seen).toEqual(['', 'Wireless Controller', '']);
  });

  it('copes with null entries from getGamepads', () => {
    const c2 = new RemoteController({
      nudge: () => true,
      canNudge: () => true,
      getPads: () => [null, null],
    });
    expect(() => c2.poll(0)).not.toThrow();
  });
});
