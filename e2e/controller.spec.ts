import { expect, test, type Page } from './fixtures';

// A stand-in for a paired DualShock 4: the page polls navigator.getGamepads(), so we control what it sees.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __pad: unknown }).__pad = null;
    navigator.getGamepads = () =>
      [(window as unknown as { __pad: Gamepad | null }).__pad] as unknown as Gamepad[];
  });
  await page.goto('/?sim=1');
});

const setPad = (page: Page, down: number[] | null) =>
  page.evaluate((d) => {
    const w = window as unknown as { __pad: unknown };
    const wasConnected = w.__pad !== null;
    w.__pad =
      d === null
        ? null
        : {
            index: 0,
            id: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
            mapping: 'standard',
            connected: true,
            buttons: Array.from({ length: 18 }, (_, i) => ({
              pressed: d.includes(i),
              value: d.includes(i) ? 1 : 0,
            })),
          };
    // Browsers announce a controller the first time it is used; the app only polls once it hears this.
    if (d !== null && !wasConnected) window.dispatchEvent(new Event('gamepadconnected'));
  }, down);

/** Press and release one button, long enough for the polling loop to see it. */
async function tap(page: Page, button: number) {
  await setPad(page, [button]);
  await page.waitForTimeout(120);
  await setPad(page, []);
  await page.waitForTimeout(80);
}

const tab = (page: Page, name: string) => page.locator('nav.tabs button', { hasText: name });
const target = (page: Page) => page.locator('.target');
const row = (page: Page, name: string) => page.locator('.remote-row', { hasText: name });

test('the Settings card says whether a controller is connected and shows the default buttons', async ({
  page,
}) => {
  await tab(page, 'Settings').click();
  await expect(page.getByText('No controller detected')).toBeVisible();
  await expect(row(page, 'Increase')).toContainText('D-pad up · button 12');
  await expect(row(page, 'Decrease')).toContainText('D-pad down · button 13');

  await setPad(page, []);
  await expect(page.getByText('Controller connected: Wireless Controller')).toBeVisible();
  await tap(page, 0);
  await expect(page.getByText('Last button pressed: Cross (✕) · button 0')).toBeVisible();
});

test('D-pad up and down change the free-ride grade', async ({ page }) => {
  await setPad(page, []);
  await expect(target(page)).toHaveText('0.0 %');
  await tap(page, 12);
  await expect(target(page)).toHaveText('0.5 %');
  await tap(page, 12);
  await expect(target(page)).toHaveText('1.0 %');
  await tap(page, 13);
  await expect(target(page)).toHaveText('0.5 %');
});

test('holding the button keeps stepping', async ({ page }) => {
  await setPad(page, [12]);
  await page.waitForTimeout(1000);
  await setPad(page, []);
  const grade = parseFloat((await target(page).textContent()) ?? '0');
  expect(grade).toBeGreaterThan(1.5); // one press plus several repeats
});

test('in ERG the buttons change the target power by 5 W', async ({ page }) => {
  await page.getByRole('button', { name: 'ERG', exact: true }).click();
  await expect(target(page)).toHaveText('150 W');
  await tap(page, 12);
  await expect(target(page)).toHaveText('155 W');
  await tap(page, 13);
  await tap(page, 13);
  await expect(target(page)).toHaveText('145 W');
});

test('learn a different button for each direction; it is remembered after a reload', async ({
  page,
}) => {
  await setPad(page, []);
  await tab(page, 'Settings').click();
  await row(page, 'Increase').getByRole('button', { name: 'Learn' }).click();
  await expect(
    row(page, 'Increase').getByRole('button', { name: 'Press a button…' }),
  ).toBeVisible();
  await tap(page, 5); // R1
  await expect(row(page, 'Increase')).toContainText('R1 · button 5');
  await row(page, 'Decrease').getByRole('button', { name: 'Learn' }).click();
  await tap(page, 4); // L1
  await expect(row(page, 'Decrease')).toContainText('L1 · button 4');

  await tab(page, 'Ride').click();
  await tap(page, 5);
  await expect(target(page)).toHaveText('0.5 %');
  await tap(page, 12); // the old default is no longer assigned
  await expect(target(page)).toHaveText('0.5 %');
  await tap(page, 4);
  await expect(target(page)).toHaveText('0.0 %');

  await page.reload();
  await setPad(page, []);
  await tab(page, 'Settings').click();
  await expect(row(page, 'Increase')).toContainText('R1 · button 5');
});

test('refuses to give both directions the same button', async ({ page }) => {
  await setPad(page, []);
  await tab(page, 'Settings').click();
  await row(page, 'Decrease').getByRole('button', { name: 'Learn' }).click();
  await tap(page, 12); // already Increase
  await expect(
    page.locator('.banner.warn', { hasText: 'already used for Increase' }),
  ).toBeVisible();
  await expect(row(page, 'Decrease')).toContainText('D-pad down · button 13'); // unchanged
});

test('presses are ignored on other tabs, and when the controller is switched off', async ({
  page,
}) => {
  await setPad(page, []);
  await tab(page, 'Settings').click();
  await tap(page, 12);
  await tap(page, 12);
  await tab(page, 'Ride').click();
  await expect(target(page)).toHaveText('0.0 %'); // nothing happened while on Settings

  await tab(page, 'Settings').click();
  await page.getByLabel('Use the controller').uncheck();
  await tab(page, 'Ride').click();
  await tap(page, 12);
  await expect(target(page)).toHaveText('0.0 %');
});
