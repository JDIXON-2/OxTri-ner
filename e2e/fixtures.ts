import { test as base, expect } from '@playwright/test';

export { expect };
export type { Page } from '@playwright/test';

/**
 * The simulator, the Debug tab and auto-connect only exist in debug mode, so most tests (which ride
 * the simulated trainer) start with it on. Auto-connect is off so they can press "Connect trainer"
 * themselves; debug-mode.spec.ts covers the gating and auto-connect directly.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      localStorage.setItem('debugMode', '1');
      localStorage.setItem('autoConnectSim', '0');
    });
    await use(page);
  },
});
