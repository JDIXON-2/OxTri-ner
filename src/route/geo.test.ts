import { describe, expect, it } from 'vitest';
import {
  metersPerPixel,
  positionAt,
  progressCoords,
  routeBounds,
  routeCoords,
  zoomForScale,
} from './geo';

// Four samples 10 m apart heading north-east.
const route = { lon: [-1, -0.999, -0.998, -0.997], lat: [51, 51.001, 51.002, 51.003] };

describe('route geometry', () => {
  it('writes coordinates in GeoJSON [lon, lat] order', () => {
    expect(routeCoords(route)[1]).toEqual([-0.999, 51.001]);
  });

  it('interpolates the rider position between samples', () => {
    const [lon, lat] = positionAt(route, 15);
    expect(lon).toBeCloseTo(-0.9985, 6);
    expect(lat).toBeCloseTo(51.0015, 6);
  });

  it('clamps the position to the ends of the route', () => {
    expect(positionAt(route, -50)).toEqual([-1, 51]);
    expect(positionAt(route, 9999)).toEqual([-0.997, 51.003]);
  });

  it('progress line ends exactly at the rider', () => {
    const p = progressCoords(route, 15);
    expect(p).toHaveLength(3); // two whole samples + the interpolated point
    expect(p[p.length - 1]).toEqual(positionAt(route, 15));
    expect(progressCoords(route, 0)).toHaveLength(2); // start point + rider, both at the start
  });

  it('computes bounds', () => {
    expect(routeBounds(route)).toEqual([
      [-1, 51],
      [-0.997, 51.003],
    ]);
  });
});

describe('map scale', () => {
  it('zoomForScale puts 500 m across the requested number of pixels', () => {
    for (const lat of [0, 40, 51.75, 65]) {
      const z = zoomForScale(lat, 500, 90);
      expect(metersPerPixel(z, lat) * 90).toBeCloseTo(500, 6);
    }
  });

  it('needs a lower zoom number further from the equator', () => {
    // Web-mercator stretches distances with latitude, so each pixel covers fewer ground metres at
    // the same zoom; spanning the same 500 m in 90 px therefore needs a lower zoom number.
    expect(zoomForScale(60)).toBeLessThan(zoomForScale(0));
  });

  it('is about zoom 13 at Oxford latitude', () => {
    expect(zoomForScale(51.75)).toBeGreaterThan(12.8);
    expect(zoomForScale(51.75)).toBeLessThan(13.4);
  });
});
