export const ROUTE_SPACING_M = 10;
export const DEFAULT_SMOOTHING_M = 60;
export const MAX_GRADE_PCT = 25;
const EARTH_RADIUS_M = 6371008.8;

export interface GpxPoint {
  lat: number;
  lon: number;
  ele: number;
}

export interface ParsedGpx {
  name?: string;
  points: GpxPoint[];
  warnings: string[];
}

/** Processed route sampled every ROUTE_SPACING_M metres; index i is distance i * spacing. */
export interface RouteData {
  name: string;
  distance: number;
  ascent: number;
  dist: number[];
  ele: number[];
  /** Percent grade. */
  grade: number[];
  lat: number[];
  lon: number[];
}

export function haversine(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Parse GPX text. `trkpt` is preferred, falling back to `rtept`. The DOMParser is injectable for tests. */
export function parseGpx(xml: string, Parser: typeof DOMParser = DOMParser): ParsedGpx {
  const doc = new Parser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Not a valid GPX/XML file');

  let nodes = Array.from(doc.getElementsByTagName('trkpt'));
  if (!nodes.length) nodes = Array.from(doc.getElementsByTagName('rtept'));
  if (!nodes.length) throw new Error('GPX file contains no track or route points');

  const warnings: string[] = [];
  const all: { lat: number; lon: number; ele: number | null }[] = [];
  for (const n of nodes) {
    const lat = parseFloat(n.getAttribute('lat') ?? '');
    const lon = parseFloat(n.getAttribute('lon') ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const eleText = n.getElementsByTagName('ele')[0]?.textContent;
    const ele = eleText === null || eleText === undefined ? NaN : parseFloat(eleText);
    all.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null });
  }

  const withEle = all.filter((p) => p.ele !== null) as GpxPoint[];
  let points: GpxPoint[];
  if (withEle.length === 0) {
    warnings.push('No elevation data in this file; the route will be treated as flat.');
    points = all.map((p) => ({ ...p, ele: 0 }));
  } else {
    if (withEle.length < all.length) {
      warnings.push(`${all.length - withEle.length} points without elevation were skipped.`);
    }
    points = withEle;
  }

  const name =
    doc.querySelector('trk > name')?.textContent?.trim() ||
    doc.querySelector('metadata > name')?.textContent?.trim() ||
    doc.querySelector('rte > name')?.textContent?.trim() ||
    undefined;
  return { name, points, warnings };
}

interface Resampled {
  ele: number[];
  lat: number[];
  lon: number[];
}

/** Linear interpolation of the points onto a fixed distance grid. */
export function resample(points: GpxPoint[], spacing = ROUTE_SPACING_M): Resampled {
  // Cumulative distance, dropping points that don't advance (duplicates).
  const pts: (GpxPoint & { d: number })[] = [];
  let d = 0;
  for (const p of points) {
    const prev = pts[pts.length - 1];
    if (prev) {
      const step = haversine(prev, p);
      if (step <= 0) continue;
      d += step;
    }
    pts.push({ ...p, d });
  }
  if (pts.length < 2) throw new Error('Route needs at least two distinct points');

  const n = Math.floor(d / spacing) + 1;
  if (n < 3) throw new Error('Route is too short (under 20 m)');
  const out: Resampled = { ele: [], lat: [], lon: [] };
  let j = 0;
  for (let i = 0; i < n; i++) {
    const at = i * spacing;
    while (j < pts.length - 2 && pts[j + 1].d < at) j++;
    const a = pts[j];
    const b = pts[j + 1];
    const t = Math.min(1, Math.max(0, (at - a.d) / (b.d - a.d)));
    out.ele.push(a.ele + (b.ele - a.ele) * t);
    out.lat.push(a.lat + (b.lat - a.lat) * t);
    out.lon.push(a.lon + (b.lon - a.lon) * t);
  }
  return out;
}

/**
 * Centered moving average. Ends are padded by point reflection, which preserves linear trends,
 * so a steady climb keeps its full ascent and grade right up to the ends.
 */
export function smooth(values: number[], windowM: number, spacing = ROUTE_SPACING_M): number[] {
  const n = values.length;
  const half = Math.min(n - 1, Math.max(0, Math.round(windowM / spacing / 2)));
  if (half === 0) return values.slice();
  const at = (i: number) => {
    if (i < 0) return 2 * values[0] - values[Math.min(n - 1, -i)];
    if (i >= n) return 2 * values[n - 1] - values[Math.max(0, 2 * (n - 1) - i)];
    return values[i];
  };
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = -half; k <= half; k++) sum += at(i + k);
    out.push(sum / (2 * half + 1));
  }
  return out;
}

/** Percent grade by central difference (one-sided at the ends), clamped to ±MAX_GRADE_PCT. */
export function gradient(ele: number[], spacing = ROUTE_SPACING_M): number[] {
  const n = ele.length;
  return ele.map((_, i) => {
    const lo = Math.max(0, i - 1);
    const hi = Math.min(n - 1, i + 1);
    const g = ((ele[hi] - ele[lo]) / ((hi - lo) * spacing)) * 100;
    return Math.max(-MAX_GRADE_PCT, Math.min(MAX_GRADE_PCT, g));
  });
}

export function buildRoute(
  name: string,
  points: GpxPoint[],
  smoothingWindowM = DEFAULT_SMOOTHING_M,
): RouteData {
  const r = resample(points);
  const ele = smooth(r.ele, smoothingWindowM);
  let ascent = 0;
  for (let i = 1; i < ele.length; i++) ascent += Math.max(0, ele[i] - ele[i - 1]);
  return {
    name,
    distance: (ele.length - 1) * ROUTE_SPACING_M,
    ascent,
    dist: ele.map((_, i) => i * ROUTE_SPACING_M),
    ele,
    grade: gradient(ele),
    lat: r.lat,
    lon: r.lon,
  };
}

const index = (route: Pick<RouteData, 'ele'>, d: number) =>
  Math.min(route.ele.length - 1, Math.max(0, d / ROUTE_SPACING_M));

/** Grade (%) at distance d metres; O(1) by index. */
export function gradeAt(route: Pick<RouteData, 'grade' | 'ele'>, d: number): number {
  return route.grade[Math.min(route.grade.length - 1, Math.floor(index(route, d)))];
}

/** Elevation (m) at distance d metres, linearly interpolated; O(1) by index. */
export function eleAt(route: Pick<RouteData, 'ele'>, d: number): number {
  const x = index(route, d);
  const i = Math.floor(x);
  const j = Math.min(route.ele.length - 1, i + 1);
  return route.ele[i] + (route.ele[j] - route.ele[i]) * (x - i);
}
