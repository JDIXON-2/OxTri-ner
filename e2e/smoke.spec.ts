import { expect, test } from './fixtures';

test('simulated route ride: load route, ride 60 s at 200 W, grade commands sent, ride saved', async ({
  page,
}) => {
  // Fake timers so the simulated trainer's 1 Hz ticks run instantly and deterministically.
  await page.clock.install();
  await page.goto('/?sim=1');

  const tab = (name: string) => page.locator('nav.tabs button', { hasText: name });
  const tile = (label: string) => page.locator('.tile', { hasText: label }).locator('.value');

  // Load the fixture route and select it.
  await tab('Routes').click();
  await page.getByRole('button', { name: 'Add test route' }).click();
  await expect(page.locator('.route', { hasText: 'Debug Mountains' })).toBeVisible();
  await page.getByRole('button', { name: 'Use this route' }).click();
  await expect(page.getByRole('button', { name: /Selected/ })).toBeVisible();

  // Set the simulated rider to 200 W (Debug tab slider).
  await tab('Debug').click();
  await page.locator('input[type=range]').evaluate((el: HTMLInputElement) => {
    el.value = '200';
    el.dispatchEvent(new Event('input'));
  });

  // Connect, switch to route sim, start.
  await tab('Ride').click();
  await page.getByRole('button', { name: 'Connect' }).first().click();
  await expect(page.locator('.pill').first()).toHaveAttribute('data-status', 'controlling');
  await page.getByRole('button', { name: 'Route sim' }).click();
  await expect(page.getByRole('button', { name: 'Route sim' })).toHaveClass(/active/);
  await page.getByRole('button', { name: 'Start ride' }).click();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();

  await page.clock.runFor(60_000);

  const distanceKm = parseFloat((await tile('Distance').textContent()) ?? '0');
  expect(distanceKm).toBeGreaterThan(0);
  expect(await tile('Elapsed').textContent()).toBe('00:59');

  // Grade commands reached the (simulated) trainer: they show in the debug log.
  await tab('Debug').click();
  const log = (await page.locator('pre.log').textContent()) ?? '';
  expect(log.match(/"type":"grade"/g)?.length ?? 0).toBeGreaterThan(0);

  // Finish saves the ride and it shows up in History.
  await tab('Ride').click();
  // Finish needs a second tap so a ride can't be ended by accident.
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.getByRole('button', { name: 'Tap again to finish' }).click();
  await expect(page.getByText(/Ride saved/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download TCX' })).toBeVisible();
  await tab('History').click();
  await expect(page.locator('.route.clickable')).toHaveCount(1);
});
