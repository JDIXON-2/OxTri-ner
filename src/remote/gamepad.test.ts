import { describe, expect, it } from 'vitest';
import {
  ButtonTracker,
  REPEAT_DELAY_MS,
  REPEAT_EVERY_MS,
  buttonLabel,
  padSummary,
  type PadSnapshot,
} from './gamepad';

const pad = (down: number[] = [], over: Partial<PadSnapshot> = {}): PadSnapshot => ({
  index: 0,
  id: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
  mapping: 'standard',
  connected: true,
  buttons: Array.from({ length: 18 }, (_, i) => ({
    pressed: down.includes(i),
    value: down.includes(i) ? 1 : 0,
  })),
  ...over,
});

describe('ButtonTracker', () => {
  it('reports a press once, on the frame the button goes down', () => {
    const t = new ButtonTracker();
    expect(t.update(0, [pad()])).toEqual([]);
    expect(t.update(16, [pad([12])])).toEqual([{ kind: 'press', padIndex: 0, button: 12 }]);
    expect(t.update(32, [pad([12])])).toEqual([]); // still held: no repeat yet
  });

  it('repeats a held button after the delay, then at a steady rate', () => {
    const t = new ButtonTracker();
    t.update(0, [pad([13])]);
    expect(t.update(REPEAT_DELAY_MS - 1, [pad([13])])).toEqual([]);
    expect(t.update(REPEAT_DELAY_MS, [pad([13])])).toEqual([
      { kind: 'repeat', padIndex: 0, button: 13 },
    ]);
    expect(t.update(REPEAT_DELAY_MS + REPEAT_EVERY_MS - 1, [pad([13])])).toEqual([]);
    expect(t.update(REPEAT_DELAY_MS + REPEAT_EVERY_MS, [pad([13])])).toHaveLength(1);
  });

  it('presses again after a release', () => {
    const t = new ButtonTracker();
    t.update(0, [pad([12])]);
    t.update(50, [pad()]);
    expect(t.update(100, [pad([12])])).toEqual([{ kind: 'press', padIndex: 0, button: 12 }]);
  });

  it('tracks several buttons and several controllers independently', () => {
    const t = new ButtonTracker();
    const events = t.update(0, [pad([12, 13]), pad([12], { index: 1 })]);
    expect(events.map((e) => `${e.padIndex}:${e.button}`).sort()).toEqual(['0:12', '0:13', '1:12']);
  });

  it('ignores disconnected controllers and forgets a held button when the controller goes away', () => {
    const t = new ButtonTracker();
    expect(t.update(0, [pad([12], { connected: false })])).toEqual([]);
    t.update(0, [pad([12])]);
    t.update(10, []); // unplugged
    expect(t.update(20, [pad([12])])).toHaveLength(1); // counts as a fresh press
  });
});

describe('labels', () => {
  it('names the D-pad and shoulder buttons of the standard layout', () => {
    expect(buttonLabel(12)).toBe('D-pad up · button 12');
    expect(buttonLabel(13)).toBe('D-pad down · button 13');
    expect(buttonLabel(5)).toBe('R1 · button 5');
  });

  it('does not guess names for non-standard layouts or unknown buttons', () => {
    expect(buttonLabel(12, '')).toBe('Button 12');
    expect(buttonLabel(40)).toBe('Button 40');
  });

  it('summarises connected controllers and tidies the id', () => {
    expect(padSummary([])).toBe('');
    expect(padSummary([pad()])).toBe('Wireless Controller');
    expect(padSummary([pad([], { connected: false })])).toBe('');
  });
});
