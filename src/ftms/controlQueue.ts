import { decodeControlPointResponse, type ControlPointResponse } from './codec';
import { RESULT_NAMES } from './constants';

export interface LogEntry {
  dir: 'tx' | 'rx' | 'info' | 'error';
  text: string;
}

interface Pending {
  opcode: number;
  resolve: (r: ControlPointResponse) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Serializes Control Point writes: one outstanding write at a time, each waiting
 * for its `[0x80, opcode, result]` indication (or a timeout) before the next goes out.
 */
export class ControlQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending: Pending | null = null;

  constructor(
    private writeFn: (data: Uint8Array) => Promise<void>,
    private log: (e: LogEntry) => void = () => {},
    private timeoutMs = 5000,
  ) {}

  /** Resolves with the trainer's response (any result code); rejects on timeout or write error. */
  send(data: Uint8Array): Promise<ControlPointResponse> {
    const run = () => this.sendNow(data);
    const p = this.tail.then(run, run);
    this.tail = p.catch(() => {});
    return p;
  }

  private async sendNow(data: Uint8Array): Promise<ControlPointResponse> {
    const opcode = data[0];
    this.log({ dir: 'tx', text: hex(data) });
    const response = new Promise<ControlPointResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error(`Control Point timeout waiting for response to opcode 0x${hex1(opcode)}`));
      }, this.timeoutMs);
      this.pending = { opcode, resolve, reject, timer };
    });
    // A rejection before anyone awaits `response` must not be reported as unhandled.
    response.catch(() => {});
    try {
      await this.writeFn(data);
    } catch (e) {
      this.clearPending();
      this.log({ dir: 'error', text: `write failed: ${(e as Error).message}` });
      throw e;
    }
    try {
      return await response;
    } catch (e) {
      this.log({ dir: 'error', text: (e as Error).message });
      throw e;
    }
  }

  handleIndication(dv: DataView): void {
    const r = decodeControlPointResponse(dv);
    if (!r) {
      this.log({ dir: 'rx', text: `unrecognised: ${hex(new Uint8Array(dv.buffer))}` });
      return;
    }
    const name = RESULT_NAMES[r.result] ?? `unknown(${r.result})`;
    this.log({ dir: 'rx', text: `op 0x${hex1(r.requestOpcode)} → ${name}` });
    const p = this.pending;
    if (p && p.opcode === r.requestOpcode) {
      this.clearPending();
      p.resolve(r);
    }
  }

  /** Fail the in-flight write (e.g. on disconnect). */
  abort(reason: string): void {
    const p = this.pending;
    if (!p) return;
    this.clearPending();
    p.reject(new Error(reason));
  }

  private clearPending() {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }
}

const hex1 = (n: number) => n.toString(16).padStart(2, '0');
const hex = (u: Uint8Array) => [...u].map(hex1).join(' ');
