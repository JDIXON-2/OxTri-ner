import { expect, test } from './fixtures';

// A page that scrolls sideways on a phone is a real usability bug, so guard against it on every tab,
// including after the viewport shrinks (rotation, window resize) once charts have been drawn.
test('no horizontal overflow on a phone, on any tab, even after shrinking from desktop', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto('/?sim=1');
  await page.getByRole('button', { name: 'Connect trainer' }).click();
  await page.setViewportSize({ width: 390, height: 844 });

  for (const name of ['Ride', 'Map', 'Routes', 'History', 'Settings', 'Debug']) {
    await page.locator('nav.tabs button', { hasText: name }).click();
    // Let ResizeObserver-driven charts settle.
    await page.waitForTimeout(100);
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scrollWidth, `${name} tab overflows horizontally`).toBeLessThanOrEqual(innerWidth);
  }
});
