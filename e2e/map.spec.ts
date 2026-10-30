import { expect, test } from './fixtures';

// 1x1 transparent PNG, standing in for map and terrain tiles.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const TILE_HOSTS = /(opentopomap\.org|elevation-tiles-prod)/;

test('map is opt-in: no tile requests until "Load map", then the route is drawn', async ({
  page,
}) => {
  const tileRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && pageErrors.push(m.text()));
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.route(TILE_HOSTS, (route) => {
    tileRequests.push(route.request().url());
    return route.fulfill({ contentType: 'image/png', body: PNG });
  });

  await page.goto('/?sim=1');
  const tab = (name: string) => page.locator('nav.tabs button', { hasText: name });

  // A route has to be selected for the map to have something to show.
  await tab('Routes').click();
  await page.getByRole('button', { name: 'Add test route' }).click();
  await page.getByRole('button', { name: 'Use this route' }).click();

  // Opening the Map tab alone must not touch the network.
  await tab('Map').click();
  await expect(page.getByRole('button', { name: 'Load map' })).toBeVisible();
  await page.waitForTimeout(500);
  expect(tileRequests).toEqual([]);

  // Consent, then the map loads and requests tiles.
  await page.getByRole('button', { name: 'Load map' }).click();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect.poll(() => tileRequests.length, { timeout: 15_000 }).toBeGreaterThan(0);
  expect(tileRequests.some((u) => u.includes('opentopomap.org'))).toBe(true);
  expect(tileRequests.some((u) => u.includes('elevation-tiles-prod'))).toBe(true);

  // The route line is drawn in red by MapLibre's worker. If the worker fails to load (as it did when
  // the bundled worker URL was wrong) the line silently never appears, so look for its pixels.
  const redPixels = async () => {
    const png = (await page.locator('.map').screenshot()).toString('base64');
    return page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] < 90 && d[i + 2] < 100) n++;
      return n;
    }, png);
  };
  await expect
    .poll(redPixels, { timeout: 15_000, message: 'route line is drawn on the map' })
    .toBeGreaterThan(50);
  expect(pageErrors.filter((e) => /worker/i.test(e))).toEqual([]);

  // The map opens at the 500 m scale (the scale bar reads "500 m"), not zoomed out to the whole route.
  await expect(page.locator('.maplibregl-ctrl-scale')).toHaveText('500 m');

  // Attribution is shown, and the rider marker is on the map.
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText(/OpenStreetMap|OpenTopoMap/);
  await expect(page.locator('.map-rider')).toBeVisible();
  const mapBox = (await page.locator('.map').boundingBox())!;
  const riderBox = (await page.locator('.map-rider').boundingBox())!;
  // Regression: the marker was once left at the map's top-left corner with no position.
  expect(riderBox.x - mapBox.x > 60 || riderBox.y - mapBox.y > 60).toBe(true);

  // The choice is remembered: after a reload the map loads without asking again.
  await page.reload();
  await tab('Map').click();
  await expect(page.getByRole('button', { name: 'Load map' })).toBeHidden();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();

  // And it can be turned off again.
  await page.getByRole('button', { name: 'Turn off map' }).click();
  await expect(page.getByRole('button', { name: 'Load map' })).toBeVisible();
});
