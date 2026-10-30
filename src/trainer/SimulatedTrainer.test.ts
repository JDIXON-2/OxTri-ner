import { describe, expect, it } from 'vitest';
import { SimulatedTrainer } from './SimulatedTrainer';
import type { TrainerSample, TrainerStatus } from './Trainer';

describe('SimulatedTrainer', () => {
  it('emits scripted power and cadence near 90 rpm', async () => {
    const t = new SimulatedTrainer({ intervalMs: 0, power: () => 200 });
    const out: TrainerSample[] = [];
    t.onSample((s) => out.push(s));
    await t.connect();
    t.tick(1000);
    t.tick(2000);
    expect(out.map((s) => s.power_w)).toEqual([200, 200]);
    expect(out[0].cadence_rpm).toBeGreaterThanOrEqual(85);
    expect(out[0].cadence_rpm).toBeLessThanOrEqual(95);
  });

  it('records grade commands and returns ERG target ± noise', async () => {
    const t = new SimulatedTrainer({ intervalMs: 0, power: () => 100 });
    const out: TrainerSample[] = [];
    t.onSample((s) => out.push(s));
    await t.connect();
    await t.setGrade(5.5);
    expect(t.commands[0]).toMatchObject({ type: 'grade', gradePct: 5.5 });
    await t.setTargetPower(250);
    t.tick(0);
    expect(Math.abs(out[0].power_w! - 250)).toBeLessThanOrEqual(3);
  });

  it('walks through the status sequence and can simulate a dropout', async () => {
    const t = new SimulatedTrainer({ intervalMs: 0, reconnectDelayMs: 5 });
    const seen: TrainerStatus[] = [];
    t.onStatus((s) => seen.push(s));
    await t.connect();
    t.simulateDisconnect();
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual(['connecting', 'connected', 'controlling', 'reconnecting', 'controlling']);
  });
});
