import { expect, test } from '@playwright/test';

// Plain test (not the debug-mode fixture): this is the real first-run experience.
test('debug mode gates the Debug tab, the simulator and its auto-connect', async ({ page }) => {
  // Headless Chromium may lack Web Bluetooth; the app only needs it to exist to start up.
  await page.addInitScript(() => {
    if (!('bluetooth' in navigator))
      Object.defineProperty(navigator, 'bluetooth', { value: {}, configurable: true });
  });
  const tabs = page.locator('nav.tabs');
  const pill = page.locator('.pill').first();
  const reloadAfter = (action: Promise<unknown>) =>
    Promise.all([page.waitForEvent('load'), action]);
  const openSettings = () => page.locator('nav.tabs button', { hasText: 'Settings' }).click();

  // 1. Off by default: no Debug tab, no simulator, and ?sim=1 in the URL does nothing.
  await page.goto('/?sim=1');
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole('button', { name: 'Debug' })).toHaveCount(0);
  await expect(pill).toHaveAttribute('data-status', 'disconnected');
  await openSettings();
  await expect(page.getByLabel('Debug mode')).not.toBeChecked();
  await expect(page.getByLabel(/Use the simulated trainer/)).toHaveCount(0);
  await expect(page.getByLabel(/Connect the simulated trainer automatically/)).toHaveCount(0);

  // 2. Switch it on: the Debug tab appears and the simulator connects by itself.
  await reloadAfter(page.getByLabel('Debug mode').check());
  await expect(tabs.getByRole('button', { name: 'Debug' })).toBeVisible();
  await expect(pill).toHaveAttribute('data-status', 'controlling'); // no Connect press needed
  await openSettings();
  await expect(page.getByLabel('Debug mode')).toBeChecked();
  await expect(page.getByLabel(/Use the simulated trainer/)).toBeChecked();
  await expect(page.getByLabel(/Connect the simulated trainer automatically/)).toBeChecked();

  // 3. Auto-connect can be turned off on its own: the simulator waits for the Connect button.
  await reloadAfter(page.getByLabel(/Connect the simulated trainer automatically/).uncheck());
  await expect(tabs.getByRole('button', { name: 'Debug' })).toBeVisible();
  await expect(pill).toHaveAttribute('data-status', 'disconnected');
  await page.getByRole('button', { name: 'Connect trainer' }).click();
  await expect(pill).toHaveAttribute('data-status', 'controlling');

  // 4. Switch debug mode off again: everything goes away, even though the simulator was saved on.
  await openSettings();
  await reloadAfter(page.getByLabel('Debug mode').uncheck());
  await expect(tabs.getByRole('button', { name: 'Debug' })).toHaveCount(0);
  await expect(pill).toHaveAttribute('data-status', 'disconnected');
  await openSettings();
  await expect(page.getByLabel(/Use the simulated trainer/)).toHaveCount(0);
});

test('without debug mode, a browser with no Web Bluetooth gets no simulator shortcut', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'bluetooth', { value: undefined, configurable: true });
  });
  await page.goto('/?sim=1');
  await expect(page.getByText("This browser can't connect to a trainer")).toBeVisible();
  await expect(page.getByRole('link', { name: /simulator/i })).toHaveCount(0);
});
