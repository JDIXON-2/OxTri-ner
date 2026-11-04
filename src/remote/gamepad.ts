export interface PadButton {
  pressed: boolean;
  value?: number;
}

/** The parts of a browser `Gamepad` we use, so the logic can be tested without a real controller. */
export interface PadSnapshot {
  index: number;
  id: string;
  mapping: string;
  connected: boolean;
  buttons: readonly PadButton[];
}

export interface ButtonEvent {
  kind: 'press' | 'repeat';
  padIndex: number;
  button: number;
}

/** Holding a button repeats it, after a pause, so you can sweep the grade without tapping. */
export const REPEAT_DELAY_MS = 400;
export const REPEAT_EVERY_MS = 150;

/** Turns "is this button down right now" snapshots into press and hold-repeat events. */
export class ButtonTracker {
  private held = new Map<string, { since: number; lastFired: number }>();

  /** Feed the current pads each frame; returns the presses and repeats since the previous call. */
  update(now: number, pads: readonly PadSnapshot[]): ButtonEvent[] {
    const events: ButtonEvent[] = [];
    const down = new Set<string>();
    for (const pad of pads) {
      if (!pad.connected) continue;
      pad.buttons.forEach((b, button) => {
        if (!b.pressed) return;
        const key = `${pad.index}:${button}`;
        down.add(key);
        const h = this.held.get(key);
        if (!h) {
          this.held.set(key, { since: now, lastFired: now });
          events.push({ kind: 'press', padIndex: pad.index, button });
        } else if (now - h.since >= REPEAT_DELAY_MS && now - h.lastFired >= REPEAT_EVERY_MS) {
          h.lastFired = now;
          events.push({ kind: 'repeat', padIndex: pad.index, button });
        }
      });
    }
    for (const key of [...this.held.keys()]) if (!down.has(key)) this.held.delete(key);
    return events;
  }

  reset(): void {
    this.held.clear();
  }
}

/** Names for the standard gamepad layout, which is what a DualShock 4 reports in Chrome. */
const STANDARD_NAMES = [
  'Cross (✕)',
  'Circle (○)',
  'Square (□)',
  'Triangle (△)',
  'L1',
  'R1',
  'L2',
  'R2',
  'Share',
  'Options',
  'L3 (left stick press)',
  'R3 (right stick press)',
  'D-pad up',
  'D-pad down',
  'D-pad left',
  'D-pad right',
  'PS button',
  'Touchpad',
];

export function buttonLabel(button: number, mapping = 'standard'): string {
  const name = mapping === 'standard' ? STANDARD_NAMES[button] : undefined;
  return name ? `${name} · button ${button}` : `Button ${button}`;
}

/** One-line description of the connected controllers, for the Settings card. */
export function padSummary(pads: readonly PadSnapshot[]): string {
  const live = pads.filter((p) => p.connected);
  if (live.length === 0) return '';
  return live.map((p) => p.id.replace(/\s*\(.*?\)\s*/g, ' ').trim() || 'Controller').join(', ');
}
