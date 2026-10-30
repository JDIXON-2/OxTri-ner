// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseGpx } from './gpx';

const gpx = (body: string) =>
  `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">${body}</gpx>`;

describe('parseGpx', () => {
  it('reads track points and the track name', () => {
    const r = parseGpx(
      gpx(`<trk><name>Hill</name><trkseg>
        <trkpt lat="51" lon="-1"><ele>100</ele></trkpt>
        <trkpt lat="51.001" lon="-1"><ele>105.5</ele></trkpt></trkseg></trk>`),
    );
    expect(r.name).toBe('Hill');
    expect(r.points).toEqual([
      { lat: 51, lon: -1, ele: 100 },
      { lat: 51.001, lon: -1, ele: 105.5 },
    ]);
    expect(r.warnings).toEqual([]);
  });

  it('falls back to route points', () => {
    const r = parseGpx(gpx('<rte><rtept lat="1" lon="2"><ele>3</ele></rtept></rte>'));
    expect(r.points).toHaveLength(1);
  });

  it('skips points without elevation', () => {
    const r = parseGpx(
      gpx(
        '<trk><trkseg><trkpt lat="1" lon="1"><ele>5</ele></trkpt><trkpt lat="1.1" lon="1"/></trkseg></trk>',
      ),
    );
    expect(r.points).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/skipped/);
  });

  it('warns and treats the route as flat when no point has elevation', () => {
    const r = parseGpx(
      gpx('<trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="1.1" lon="1"/></trkseg></trk>'),
    );
    expect(r.points.every((p) => p.ele === 0)).toBe(true);
    expect(r.warnings[0]).toMatch(/No elevation/);
  });

  it('rejects invalid files', () => {
    expect(() => parseGpx('not xml <')).toThrow();
    expect(() => parseGpx(gpx(''))).toThrow(/no track/);
  });
});

describe('public/debug-route.gpx', () => {
  async function load() {
    const { readFileSync } = await import('node:fs');
    const { buildRoute } = await import('./gpx');
    const parsed = parseGpx(readFileSync('public/debug-route.gpx', 'utf8'));
    return { parsed, route: buildRoute(parsed.name ?? 'x', parsed.points) };
  }

  it('parses into an ~8.6 km route with a big climb and bounded gradients', async () => {
    const { parsed, route: r } = await load();
    expect(parsed.warnings).toEqual([]);
    expect(r.distance).toBeGreaterThan(8300);
    expect(r.distance).toBeLessThan(8900);
    expect(r.ascent).toBeGreaterThan(450); // designed climbs sum to about 509 m
    expect(r.ascent).toBeLessThan(560);
    expect(Math.max(...r.grade)).toBeGreaterThan(9);
    expect(Math.max(...r.grade.map(Math.abs))).toBeLessThan(15);
  });

  it('passes through every terrain type: green hill, rocky mountain and snow', async () => {
    const { route } = await load();
    const { terrainBand } = await import('../ui/elevationProfile');
    const bands = new Set(route.ele.map(terrainBand));
    expect([...bands].sort()).toEqual(['grass', 'rock', 'snow']);
  });
});
