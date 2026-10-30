interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: 'release', cb: () => void): void;
}
export interface WakeLockHost {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
}

/**
 * Keeps the screen awake while wanted. Browsers drop the lock when the tab is hidden, so it is
 * re-acquired when the page becomes visible again.
 */
export class WakeLockManager {
  private sentinel: WakeLockSentinelLike | null = null;
  private wanted = false;

  constructor(
    private nav: WakeLockHost = navigator as WakeLockHost,
    doc?: Pick<Document, 'addEventListener' | 'visibilityState'>,
  ) {
    const d = doc ?? (typeof document !== 'undefined' ? document : undefined);
    d?.addEventListener('visibilitychange', () => {
      if (d.visibilityState === 'visible' && this.wanted) void this.request();
    });
  }

  get supported(): boolean {
    return !!this.nav.wakeLock;
  }

  get held(): boolean {
    return this.sentinel !== null;
  }

  async acquire(): Promise<void> {
    this.wanted = true;
    await this.request();
  }

  async release(): Promise<void> {
    this.wanted = false;
    const s = this.sentinel;
    this.sentinel = null;
    await s?.release().catch(() => {});
  }

  private async request(): Promise<void> {
    if (!this.nav.wakeLock || this.sentinel) return;
    try {
      const s = await this.nav.wakeLock.request('screen');
      // A release() may have raced the request.
      if (!this.wanted) return void (await s.release().catch(() => {}));
      this.sentinel = s;
      s.addEventListener('release', () => {
        if (this.sentinel === s) this.sentinel = null;
      });
    } catch {
      // Denied (e.g. low battery or hidden tab). We'll retry on the next visibilitychange.
    }
  }
}
