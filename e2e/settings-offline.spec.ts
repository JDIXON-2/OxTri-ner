import { expect, test } from '@playwright/test';

test('imperial units apply after saving settings', async ({ page }) => {
  await page.goto('/?sim=1');
  await page.locator('nav.tabs button', { hasText: 'Settings' }).click();
  await page.getByLabel('Units').selectOption('imperial');
  await Promise.all([
    page.waitForEvent('load'),
    page.getByRole('button', { name: 'Save and reload' }).click(),
  ]);
  await expect(page.locator('.tile', { hasText: 'Speed' }).locator('.label')).toContainText('mph');
  await expect(page.locator('.tile', { hasText: 'Distance' }).locator('.label')).toContainText(
    'mi',
  );
});

test.describe('offline', () => {
  test.use({ serviceWorkers: 'allow' });

  test('app loads from the service-worker cache with no network', async ({ page, context }) => {
    await page.goto('/?sim=1');
    await page.evaluate(() => navigator.serviceWorker.ready);
    // Reload once so the page itself is controlled and every asset has passed through the worker.
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('nav.tabs')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect' }).first()).toBeVisible();
  });
});
