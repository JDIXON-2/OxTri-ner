import { describe, expect, it } from 'vitest';
import {
  GRASS_MAX_M,
  SNOW_MIN_M,
  profilePaths,
  terrainBand,
  terrainStops,
} from './elevationProfile';

it('maps low ground to the bottom and high ground to the top', () => {
  const g = profilePaths([0, 50, 100], 200, 100);
  expect(g.line).toBe('M0.0,100.0L100.0,50.0L200.0,0.0');
  expect(g.area.endsWith('L200,100L0,100Z')).toBe(true);
});

it('downsamples long routes but keeps the last point', () => {
  const ele = Array.from({ length: 1000 }, (_, i) => i);
  const pts = profilePaths(ele, 300, 60, 100).line.split('L');
  expect(pts.length).toBeLessThanOrEqual(101);
  expect(pts[pts.length - 1].startsWith('300.0')).toBe(true);
});

it('does not exaggerate flat routes', () => {
  const g = profilePaths([100, 101, 100], 100, 100);
  expect(g.line).toContain(',95.0');
});

describe('terrain bands', () => {
  it('is green under 200 m, mountain from 200 m, snowy over 500 m', () => {
    expect(terrainBand(0)).toBe('grass');
    expect(terrainBand(GRASS_MAX_M - 0.1)).toBe('grass');
    expect(terrainBand(GRASS_MAX_M)).toBe('rock');
    expect(terrainBand(SNOW_MIN_M)).toBe('rock');
    expect(terrainBand(SNOW_MIN_M + 0.1)).toBe('snow');
  });

  // Elevation → y with 0 m at y=100 (bottom) and 1000 m at y=0 (top).
  const yOf = (e: number) => 100 - e / 10;
  const colourAt = (stops: ReturnType<typeof terrainStops>, frac: number) =>
    [...stops].reverse().find((s) => s.offset <= frac)!.color;

  it('paints each band at the right height', () => {
    const stops = terrainStops(yOf, 0, 100);
    expect(colourAt(stops, 0.95)).toBe(colourAt(stops, 0.85)); // 50 m and 150 m: both grass
    const grass = colourAt(stops, 0.95);
    const rock = colourAt(stops, 0.65); // 350 m
    const snow = colourAt(stops, 0.2); // 800 m
    expect(new Set([grass, rock, snow]).size).toBe(3);
    expect(stops.map((s) => s.offset)).toEqual(
      [...stops.map((s) => s.offset)].sort((a, b) => a - b),
    );
  });

  it('a route entirely below 200 m is all green', () => {
    // Range 80–150 m shown in a 100 px tall plot: 200 m and 500 m are both above the top edge.
    const yLow = (e: number) => 100 - ((e - 80) / 70) * 100;
    const stops = terrainStops(yLow, 0, 100);
    for (const frac of [0, 0.5, 1]) expect(colourAt(stops, frac)).toBe(colourAt(stops, 1));
  });
});
