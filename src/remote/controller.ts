import { ButtonTracker, buttonLabel, padSummary, type PadSnapshot } from './gamepad';

export interface RemoteSettings {
  enabled: boolean;
  /** Gamepad button index that raises the grade / target power, or null if unassigned. */
  up: number | null;
  /** Gamepad button index that lowers it. */
  down: number | null;
}

/** D-pad up and down on the standard layout (a DualShock 4 reports this layout in Chrome). */
export const DEFAULT_REMOTE: RemoteSettings = { enabled: true, up: 12, down: 13 };

export type Slot = 'up' | 'down';

export interface ControllerOptions {
  /** Apply one step up (+1) or down (-1); returns whether anything changed. */
  nudge: (direction: 1 | -1) => boolean;
  /** Only act when this is true (e.g. the Ride tab is showing). */
  canNudge: () => boolean;
  getPads?: () => readonly (PadSnapshot | null)[];
  now?: () => number;
  learnTimeoutMs?: number;
}

export interface LastButton {
  button: number;
  label: string;
}

/**
 * Polls connected gamepads (there are no button events in the Gamepad API) and turns the
 * buttons the rider chose into grade / power steps. It can also "learn" a button: the next
 * press from any controller is captured instead of acted on.
 */
export class RemoteController {
  settings: RemoteSettings = { ...DEFAULT_REMOTE };

  private tracker = new ButtonTracker();
  private listening = false;
  private running = false;
  private hasPads = false;
  private frame = 0;
  private learning: {
    slot: Slot;
    resolve: (button: number | null) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private buttonListeners = new Set<(b: LastButton) => void>();
  private padListeners = new Set<(summary: string) => void>();
  private lastSummary: string | null = null;

  constructor(private opts: ControllerOptions) {}

  /**
   * Begin watching for controllers. Polling only runs while one is connected: it wakes on the
   * browser's `gamepadconnected` event and stops again once none are left, so an idle page (the
   * usual case) does no per-frame work.
   */
  start(): void {
    if (this.listening) return;
    this.listening = true;
    addEventListener('gamepadconnected', this.wake);
    addEventListener('gamepaddisconnected', this.wake);
    this.wake(); // a controller may already be connected
  }

  stop(): void {
    this.listening = false;
    this.running = false;
    removeEventListener('gamepadconnected', this.wake);
    removeEventListener('gamepaddisconnected', this.wake);
    cancelAnimationFrame(this.frame);
    this.tracker.reset();
  }

  private wake = (): void => {
    if (!this.listening || this.running) return;
    this.running = true;
    this.frame = requestAnimationFrame(this.tick);
  };

  private tick = (): void => {
    if (!this.running) return;
    this.poll();
    if (this.hasPads) {
      this.frame = requestAnimationFrame(this.tick);
    } else {
      this.running = false; // nothing connected: sleep until the next gamepadconnected
      this.tracker.reset();
    }
  };

  get isLearning(): boolean {
    return this.learning !== null;
  }

  /** Resolves with the next button pressed on any controller, or null if cancelled or timed out. */
  learn(slot: Slot): Promise<number | null> {
    this.cancelLearn();
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.cancelLearn(), this.opts.learnTimeoutMs ?? 10_000);
      this.learning = { slot, resolve, timer };
    });
  }

  cancelLearn(): void {
    const l = this.learning;
    if (!l) return;
    clearTimeout(l.timer);
    this.learning = null;
    l.resolve(null);
  }

  onButton(cb: (b: LastButton) => void): () => void {
    this.buttonListeners.add(cb);
    return () => this.buttonListeners.delete(cb);
  }

  /** Called with a description of the connected controllers whenever it changes ('' if none). */
  onPads(cb: (summary: string) => void): () => void {
    this.padListeners.add(cb);
    if (this.lastSummary !== null) cb(this.lastSummary);
    return () => this.padListeners.delete(cb);
  }

  /** One polling step. Public so tests can drive it without animation frames. */
  poll(now: number = this.opts.now?.() ?? performance.now()): void {
    const raw = this.opts.getPads ? this.opts.getPads() : (navigator.getGamepads?.() ?? []);
    const pads = Array.from(raw).filter((p): p is PadSnapshot => !!p && p.connected);
    this.hasPads = pads.length > 0;

    const summary = padSummary(pads);
    if (summary !== this.lastSummary) {
      this.lastSummary = summary;
      for (const cb of this.padListeners) cb(summary);
    }

    for (const ev of this.tracker.update(now, pads)) {
      if (ev.kind !== 'press') {
        this.act(ev.button);
        continue;
      }
      const mapping = pads.find((p) => p.index === ev.padIndex)?.mapping;
      for (const cb of this.buttonListeners)
        cb({ button: ev.button, label: buttonLabel(ev.button, mapping) });
      const l = this.learning;
      if (l) {
        clearTimeout(l.timer);
        this.learning = null;
        l.resolve(ev.button); // captured for assignment, not acted on
        continue;
      }
      this.act(ev.button);
    }
  }

  private act(button: number): void {
    if (!this.settings.enabled || this.learning || !this.opts.canNudge()) return;
    const { up, down } = this.settings;
    if (button === up) this.opts.nudge(1);
    else if (button === down) this.opts.nudge(-1);
  }
}
