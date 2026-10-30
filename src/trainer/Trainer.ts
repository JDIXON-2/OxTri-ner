import type { FitnessMachineFeature, IndoorBikeData, Range } from '../ftms/codec';
import type { LogEntry } from '../ftms/controlQueue';

export type { LogEntry };

/** A merged Indoor Bike Data sample stamped with `performance.now()` at receipt. */
export interface TrainerSample extends IndoorBikeData {
  t: number;
}

export type TrainerStatus =
  'disconnected' | 'connecting' | 'connected' | 'controlling' | 'reconnecting';

export interface TrainerInfo {
  deviceName?: string;
  feature?: FitnessMachineFeature;
  powerRange?: Range;
  resistanceRange?: Range;
}

export interface SimParamsOpts {
  crr?: number;
  /** Aerodynamic coefficient 0.5·ρ·CdA in kg/m. */
  cw?: number;
}

export interface Trainer {
  readonly status: TrainerStatus;
  readonly info: TrainerInfo;
  /** Must be called from a user gesture for the real trainer. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  setGrade(gradePct: number, opts?: SimParamsOpts): Promise<void>;
  setTargetPower(watts: number): Promise<void>;
  setResistance(level: number): Promise<void>;
  /** Each subscribe function returns an unsubscribe function. */
  onSample(cb: (s: TrainerSample) => void): () => void;
  onStatus(cb: (s: TrainerStatus) => void): () => void;
  onLog(cb: (e: LogEntry) => void): () => void;
}

export const DEFAULT_CRR = 0.004;
export const DEFAULT_CW = 0.5 * 1.225 * 0.32;

export class Emitter<T> {
  private subs = new Set<(v: T) => void>();
  on(cb: (v: T) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }
  emit(v: T) {
    for (const cb of this.subs) cb(v);
  }
}
