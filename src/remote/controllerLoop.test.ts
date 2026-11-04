// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteController } from './controller';
import type { PadSnapshot } from './gamepad';

let pads: PadSnapshot[];
let frames: FrameRequestCallback[];
let c: RemoteController;
const nudges: number[] = [];

const pad = (down: number[] = []): PadSnapshot => ({
  index: 0,
  id: 'Wireless Controller',
  mapping: 'standard',
  connected: true,
  buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: down.includes(i) })),
});
/** Run the next scheduled animation frame, if any. */
const runFrame = () => frames.shift()?.(0);

beforeEach(() => {
  pads = [];
  frames = [];
  nudges.length = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => (frames.length = 0));
  c = new RemoteController({
    nudge: (d) => (nudges.push(d), true),
    canNudge: () => true,
    getPads: () => pads,
  });
});
afterEach(() => {
  c.stop();
  vi.unstubAllGlobals();
});

describe('RemoteController polling loop', () => {
  it('does no per-frame work while no controller is connected', () => {
    c.start();
    runFrame(); // the one initial check finds nothing...
    expect(frames).toHaveLength(0); // ...and does not schedule another frame
  });

  it('wakes on gamepadconnected, polls every frame, and sleeps again when the controller goes', () => {
    c.start();
    runFrame();
    expect(frames).toHaveLength(0);

    pads = [pad()];
    window.dispatchEvent(new Event('gamepadconnected'));
    expect(frames).toHaveLength(1);
    runFrame();
    expect(frames).toHaveLength(1); // still connected: keeps polling
    runFrame();
    expect(frames).toHaveLength(1);

    pads = [];
    runFrame(); // sees the controller has gone
    expect(frames).toHaveLength(0);
  });

  it('acts on a press that arrives through the loop', () => {
    c.start();
    pads = [pad()];
    window.dispatchEvent(new Event('gamepadconnected'));
    runFrame();
    pads = [pad([12])];
    runFrame();
    expect(nudges).toEqual([1]);
  });

  it('picks up a controller that was already connected when the app started', () => {
    pads = [pad()];
    c.start();
    expect(frames).toHaveLength(1);
  });

  it('does not start a second loop for repeated connect events', () => {
    c.start();
    pads = [pad()];
    window.dispatchEvent(new Event('gamepadconnected'));
    window.dispatchEvent(new Event('gamepadconnected'));
    expect(frames).toHaveLength(1);
  });

  it('stop() ends polling and ignores later events', () => {
    pads = [pad()];
    c.start();
    c.stop();
    expect(frames).toHaveLength(0);
    window.dispatchEvent(new Event('gamepadconnected'));
    expect(frames).toHaveLength(0);
  });
});
