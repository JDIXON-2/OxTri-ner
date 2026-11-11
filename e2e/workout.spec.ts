import { expect, test, type Page } from './fixtures';

const tab = (page: Page, name: string) => page.locator('nav.tabs button', { hasText: name });
const setPower = (page: Page, watts: number) =>
  page.locator('input[type=range]').evaluate((el: HTMLInputElement, w) => {
    el.value = String(w);
    el.dispatchEvent(new Event('input'));
  }, watts);
const calRow = (page: Page, pct: string) => page.locator('.cal-row', { hasText: pct });

async function connect(page: Page) {
  await page.getByRole('button', { name: 'Connect trainer' }).click();
  await expect(page.locator('.pill').first()).toHaveAttribute('data-status', 'controlling');
}

test.beforeEach(async ({ page }) => {
  await page.clock.install(); // simulated trainer ticks run instantly on a fake clock
  await page.goto('/?sim=1');
});

test('calibration measures 20 % and 100 %: the 10 s ramp is ignored, the next 10 s averaged', async ({
  page,
}) => {
  await connect(page);
  await tab(page, 'Settings').click();
  await expect(page.getByRole('button', { name: 'Start calibration' })).toBeEnabled();

  // 50 W while getting up to effort, then 200 W for the measured window, for both levels.
  await setPower(page, 50);
  await page.getByRole('button', { name: 'Start calibration' }).click();
  await expect(page.locator('.cal-run')).toContainText('Ride at 20 % effort');
  for (let level = 0; level < 2; level++) {
    await setPower(page, 50);
    await page.clock.runFor(level === 0 ? 10_000 : 10_000); // ramp (first sample has dt 0)
    await setPower(page, 200);
    await page.clock.runFor(level === 0 ? 11_000 : 10_000);
  }
  await expect(page.getByText('Done — your calibration is saved.')).toBeVisible();
  // The two measured levels are exact; the rest are worked out from the line through them.
  for (const pct of ['20 %', '100 %']) await expect(calRow(page, pct)).toContainText('200 W');
  for (const pct of ['40 %', '60 %', '80 %']) {
    await expect(calRow(page, pct)).toContainText('≈ 200 W');
    await expect(calRow(page, pct).getByRole('button')).toHaveCount(0); // nothing to calibrate
  }
});

test('workout: needs calibration, then target watts follow the calibrated curve through to the end', async ({
  page,
}) => {
  await connect(page);

  // Without calibration the workout can't be started.
  await page.getByRole('button', { name: 'Workout', exact: true }).click();
  await page.getByRole('button', { name: 'Add example: short intervals' }).click();
  await expect(page.locator('.workout-card .banner.warn')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start ride' })).toBeDisabled();
  await expect(page.locator('.actionbar .state')).toContainText('Calibrate your effort levels');

  // Calibrate two levels: 20 % = 100 W and 100 % = 300 W. Everything else is inferred.
  await tab(page, 'Settings').click();
  for (const [pct, watts] of [
    ['20 %', 100],
    ['100 %', 300],
  ] as const) {
    await setPower(page, watts);
    await calRow(page, pct).getByRole('button').click();
    await page.clock.runFor(21_000); // first sample has dt 0, then 10 s ramp + 10 s measure
    await expect(calRow(page, pct)).toContainText(`${watts} W`);
  }

  // 60 % was never measured: it sits on the line between the two points (200 W).
  await expect(calRow(page, '60 %')).toContainText('≈ 200 W');

  // Back on the Ride tab the workout is ready.
  await tab(page, 'Ride').click();
  await expect(page.getByRole('button', { name: 'Start ride' })).toBeEnabled();
  await expect(page.locator('.workout-card .banner.warn')).toBeHidden();
  // 30 % is on the line from 20 % (100 W) to 100 % (300 W): 125 W.
  await expect(page.locator('.workout-target')).toHaveText('30 % · 125 W');

  await page.getByRole('button', { name: 'Start ride' }).click();
  await page.clock.runFor(5_000);
  await expect(page.locator('.workout-target')).toHaveText('30 % · 125 W');
  // The meter shows the target; the rider hits it with cadence and resistance.
  await expect(page.locator('.pmeter-readouts')).toContainText('125 W');

  // After 2 minutes the second step (50 % → 175 W) takes over.
  await page.clock.runFor(120_000);
  await expect(page.locator('.workout-target')).toHaveText('50 % · 175 W');
  // The trainer is never told to hold the watts: resistance stays with the rider.
  await tab(page, 'Debug').click();
  const log = (await page.locator('pre.log').textContent()) ?? '';
  expect(log).not.toContain('"type":"power"');
  await tab(page, 'Ride').click();

  // Run out the rest of the 8-minute workout: it hands over to a free ride at 0 %.
  await page.clock.runFor(400_000);
  await expect(page.locator('.banner.ok', { hasText: 'Workout complete' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Free ride' })).toHaveClass(/active/);
});

test('a bad workout CSV is rejected with the offending line number', async ({ page }) => {
  await page.getByRole('button', { name: 'Workout', exact: true }).click();
  await page.locator('.workout-card input[type=file]').setInputFiles({
    name: 'bad.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('300,0.5\n120,75\n'),
  });
  await expect(page.locator('.workout-card .banner.err')).toContainText('Line 2');
  await expect(page.locator('.workout-card .banner.err')).toContainText(
    'use a decimal such as 0.75',
  );
});

test('a good uploaded CSV becomes a selectable workout', async ({ page }) => {
  await page.getByRole('button', { name: 'Workout', exact: true }).click();
  await page.locator('.workout-card input[type=file]').setInputFiles({
    name: 'my-intervals.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('seconds,effort\n600,0.5\n60,1.0\n'),
  });
  await expect(page.locator('.workout-card select')).toContainText('my-intervals');
  await expect(page.locator('.workout-card select')).toContainText('11:00');
});

test('the 30 minute pyramids workout can be added with one tap', async ({ page }) => {
  await page.getByRole('button', { name: 'Workout', exact: true }).click();
  await page.getByRole('button', { name: 'Add example: 30 min pyramids' }).click();
  await expect(page.locator('.workout-card select')).toContainText('pyramids-30min');
  await expect(page.locator('.workout-card select')).toContainText('30:00');
  // Eighteen 100 s steps: two pyramids of nine.
  await expect(page.locator('.workout-svg rect')).toHaveCount(18);
  // Adding the other example alongside it works too, and both are selectable.
  await page.getByRole('button', { name: 'Add example: short intervals' }).click();
  await expect(page.locator('.workout-card select option')).toHaveCount(2);
});
