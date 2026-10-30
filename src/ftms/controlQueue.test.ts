import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlQueue } from './controlQueue';

const resp = (op: number, result = 1) => new DataView(Uint8Array.of(0x80, op, result).buffer);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ControlQueue', () => {
  it('has only one write outstanding at a time', async () => {
    const written: number[] = [];
    const q = new ControlQueue(async (d) => void written.push(d[0]));
    const a = q.send(Uint8Array.of(0x00));
    const b = q.send(Uint8Array.of(0x07));
    await vi.advanceTimersByTimeAsync(0);
    expect(written).toEqual([0x00]);
    q.handleIndication(resp(0x00));
    await a;
    await vi.advanceTimersByTimeAsync(0);
    expect(written).toEqual([0x00, 0x07]);
    q.handleIndication(resp(0x07, 2));
    expect((await b).result).toBe(2);
  });

  it('rejects after the timeout and then continues with the next write', async () => {
    const written: number[] = [];
    const q = new ControlQueue(async (d) => void written.push(d[0]), undefined, 5000);
    const a = q.send(Uint8Array.of(0x00));
    const aErr = expect(a).rejects.toThrow(/timeout/);
    const b = q.send(Uint8Array.of(0x07));
    await vi.advanceTimersByTimeAsync(5000);
    await aErr;
    await vi.advanceTimersByTimeAsync(0);
    expect(written).toEqual([0x00, 0x07]);
    q.handleIndication(resp(0x07));
    await b;
  });

  it('abort rejects the in-flight write', async () => {
    const q = new ControlQueue(async () => {});
    const a = q.send(Uint8Array.of(0x05, 0, 0));
    const err = expect(a).rejects.toThrow(/disconnected/);
    await vi.advanceTimersByTimeAsync(0);
    q.abort('disconnected');
    await err;
  });
});
