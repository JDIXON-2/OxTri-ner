const DELAYS_S = [1, 2, 4, 8, 15];

/** Backoff for reconnect attempt n (0-based): 1, 2, 4, 8, then 15 s cap. */
export function backoffDelayMs(attempt: number): number {
  return DELAYS_S[Math.min(attempt, DELAYS_S.length - 1)] * 1000;
}
