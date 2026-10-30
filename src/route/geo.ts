import { ROUTE_SPACING_M, type RouteData } from './gpx';

export type LngLat = [number, number];
type GeoRoute = Pick<RouteData, 'lat' | 'lon'>;

/** Route as [lon, lat] pairs (GeoJSON order). */
export function routeCoords(route: GeoRoute): LngLat[] {
  return route.lon.map((lon, i) => [lon, route.lat[i]]);
}

/** The part of the route already ridden, ending exactly at the rider's interpolated position. */
export function progressCoords(route: GeoRoute, distanceM: number): LngLat[] {
  const n = route.lat.length;
  const pos = Math.min(n - 1, Math.max(0, distanceM / ROUTE_SPACING_M));
  const lo = Math.floor(pos);
  const coords = routeCoords(route).slice(0, lo + 1);
  coords.push(positionAt(route, distanceM));
  return coords;
}

/** Rider position at a distance, linearly interpolated between the 10 m samples. */
export function positionAt(route: GeoRoute, distanceM: number): LngLat {
  const n = route.lat.length;
  const pos = Math.min(n - 1, Math.max(0, distanceM / ROUTE_SPACING_M));
  const lo = Math.floor(pos);
  const hi = Math.min(n - 1, lo + 1);
  const t = pos - lo;
  return [
    route.lon[lo] + (route.lon[hi] - route.lon[lo]) * t,
    route.lat[lo] + (route.lat[hi] - route.lat[lo]) * t,
  ];
}

/** [[west, south], [east, north]] for fitting the map to the route. */
export function routeBounds(route: GeoRoute): [LngLat, LngLat] {
  return [
    [Math.min(...route.lon), Math.min(...route.lat)],
    [Math.max(...route.lon), Math.max(...route.lat)],
  ];
}

/** MapLibre uses 512 px tiles, so zoom 0 spans the equator in 512 px. */
const METERS_PER_PIXEL_AT_ZOOM_0 = 78271.517;

export function metersPerPixel(zoom: number, latDeg: number): number {
  return (METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((latDeg * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * Zoom level at which `meters` spans `barPx` pixels at this latitude. With MapLibre's scale bar
 * limited to 100 px, a 500 m / 90 px zoom makes the bar read exactly "500 m".
 */
export function zoomForScale(latDeg: number, meters = 500, barPx = 90): number {
  return Math.log2(
    (METERS_PER_PIXEL_AT_ZOOM_0 * Math.cos((latDeg * Math.PI) / 180) * barPx) / meters,
  );
}
