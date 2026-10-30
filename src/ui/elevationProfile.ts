export interface ProfileGeometry {
  /** Closed filled area under the profile. */
  area: string;
  /** Just the top line. */
  line: string;
  minEle: number;
  maxEle: number;
}

/** Build SVG path data for an elevation profile, downsampled to at most `maxPoints` columns. */
export function profilePaths(
  ele: number[],
  width: number,
  height: number,
  maxPoints = 300,
): ProfileGeometry {
  const n = ele.length;
  const minEle = Math.min(...ele);
  const maxEle = Math.max(...ele);
  // Keep at least 20 m of vertical range so flat routes don't look like mountains.
  const span = Math.max(20, maxEle - minEle);
  const step = Math.max(1, Math.ceil(n / maxPoints));
  const pts: string[] = [];
  for (let i = 0; i < n; i += step) pts.push(point(i));
  if ((n - 1) % step !== 0) pts.push(point(n - 1));
  const line = 'M' + pts.join('L');
  return { line, area: `${line}L${width},${height}L0,${height}Z`, minEle, maxEle };

  function point(i: number): string {
    const x = n > 1 ? (i / (n - 1)) * width : 0;
    const y = height - ((ele[i] - minEle) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }
}

const NS = 'http://www.w3.org/2000/svg';

/** Terrain looks change with absolute elevation: green hills, then mountains, then snow. */
export const GRASS_MAX_M = 200;
export const SNOW_MIN_M = 500;
export type TerrainBand = 'grass' | 'rock' | 'snow';

export function terrainBand(eleM: number): TerrainBand {
  return eleM < GRASS_MAX_M ? 'grass' : eleM <= SNOW_MIN_M ? 'rock' : 'snow';
}

const COLOURS = { grass: '#5dbb63', rock: '#9a8672', snow: '#f4f9ff', outline: '#14213d' };

export interface GradientStop {
  offset: number;
  color: string;
}

/**
 * Hard-edged vertical gradient stops painting the terrain by absolute elevation. `yOf` maps an
 * elevation to a y coordinate in the same space as the gradient, which runs from `top` to `bottom`.
 */
export function terrainStops(
  yOf: (eleM: number) => number,
  top: number,
  bottom: number,
): GradientStop[] {
  const f = (eleM: number) => Math.min(1, Math.max(0, (yOf(eleM) - top) / (bottom - top)));
  const snow = f(SNOW_MIN_M);
  const grass = f(GRASS_MAX_M);
  return [
    { offset: 0, color: COLOURS.snow },
    { offset: snow, color: COLOURS.snow },
    { offset: snow, color: COLOURS.rock },
    { offset: grass, color: COLOURS.rock },
    { offset: grass, color: COLOURS.grass },
    { offset: 1, color: COLOURS.grass },
  ];
}

// Scene layout (viewBox units). Terrain occupies the lower part so there is room for sky and the rider.
const W = 600;
const H = 140;
const TOP = 36;
const BOTTOM_PAD = 12;
const PLOT_H = H - TOP - BOTTOM_PAD;
let uid = 0;

const svgEl = (tag: string, attrs: Record<string, string | number> = {}, parent?: Element) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.append(e);
  return e;
};

export interface ProfileView {
  svg: SVGSVGElement;
  /** Move the cyclist to `distanceM` and highlight the following `lookaheadM`. */
  update(distanceM: number, lookaheadM?: number): void;
}

interface Scene {
  svg: SVGSVGElement;
  /** Terrain-space group: y = 0 is the highest terrain, y = PLOT_H the lowest. */
  world: SVGGElement;
  xAt(i: number): number;
  yAt(eleM: number): number;
}

/** Sky, sun, clouds, coloured terrain with outline, and a few trees on the green parts. */
function buildScene(ele: number[]): Scene {
  const id = `p${uid++}`;
  const n = ele.length;
  const minEle = Math.min(...ele);
  const maxEle = Math.max(...ele);
  const span = Math.max(20, maxEle - minEle); // matches profilePaths: flat routes stay flat
  const xAt = (i: number) => (n > 1 ? (i / (n - 1)) * W : 0);
  const yAt = (e: number) => PLOT_H - ((e - minEle) / span) * PLOT_H;
  const geo = profilePaths(ele, W, PLOT_H);

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'profile',
    role: 'img',
    'aria-label': 'Route elevation profile',
  }) as SVGSVGElement;

  const defs = svgEl('defs', {}, svg);
  const sky = svgEl('linearGradient', { id: `${id}-sky`, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  svgEl('stop', { offset: 0, 'stop-color': '#3d94f0' }, sky);
  svgEl('stop', { offset: 1, 'stop-color': '#bfe2ff' }, sky);
  const ground = svgEl(
    'linearGradient',
    { id: `${id}-ground`, gradientUnits: 'userSpaceOnUse', x1: 0, y1: -TOP, x2: 0, y2: H - TOP },
    defs,
  );
  for (const st of terrainStops(yAt, -TOP, H - TOP)) {
    svgEl('stop', { offset: st.offset.toFixed(4), 'stop-color': st.color }, ground);
  }

  svgEl('rect', { width: W, height: H, fill: `url(#${id}-sky)` }, svg);
  // Sun
  svgEl(
    'circle',
    { cx: 552, cy: 26, r: 12, fill: '#ffd84d', stroke: COLOURS.outline, 'stroke-width': 1.5 },
    svg,
  );
  // Clouds: overlapping ellipses with a soft outline
  for (const [cx, cy, k] of [
    [90, 24, 1],
    [300, 16, 0.8],
    [440, 34, 0.7],
  ] as const) {
    const cloud = svgEl(
      'g',
      {
        transform: `translate(${cx} ${cy}) scale(${k})`,
        fill: '#fff',
        stroke: '#9ccaf5',
        'stroke-width': 1.2,
      },
      svg,
    );
    svgEl('ellipse', { cx: 0, cy: 4, rx: 22, ry: 8 }, cloud);
    svgEl('ellipse', { cx: -9, cy: -2, rx: 11, ry: 9 }, cloud);
    svgEl('ellipse', { cx: 7, cy: -4, rx: 13, ry: 11 }, cloud);
  }

  const world = svgEl('g', { transform: `translate(0 ${TOP})` }, svg) as SVGGElement;
  svgEl(
    'path',
    { d: `${geo.line}L${W},${H - TOP}L0,${H - TOP}Z`, fill: `url(#${id}-ground)` },
    world,
  );

  // Trees on the green stretches only, drawn behind the terrain outline.
  for (let x = 14; x < W - 8; x += 34) {
    const i = Math.round((x / W) * (n - 1));
    if (terrainBand(ele[i]) !== 'grass') continue;
    const y = yAt(ele[i]);
    const r = 5 + ((i * 7) % 3);
    const tree = svgEl(
      'g',
      {
        transform: `translate(${x} ${y + 1})`,
        stroke: COLOURS.outline,
        'stroke-width': 1.2,
        'stroke-linejoin': 'round',
      },
      world,
    );
    svgEl('rect', { x: -1.5, y: -r, width: 3, height: r, fill: '#7a4e2d' }, tree);
    svgEl('circle', { cx: 0, cy: -r - 4, r: r, fill: '#2f9e4a' }, tree);
  }

  svgEl(
    'path',
    {
      d: geo.line,
      fill: 'none',
      stroke: COLOURS.outline,
      'stroke-width': 2.2,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
    },
    world,
  );
  return { svg, world, xAt, yAt };
}

/** Cartoon cyclist, facing right, wheels resting on y = 0. Thick outlines and bright colours. */
function buildCyclist(parent: Element): SVGGElement {
  const g = svgEl('g', { class: 'cyclist' }, parent) as SVGGElement;
  const line = (d: string, stroke: string, width: number) =>
    svgEl(
      'path',
      {
        d,
        fill: 'none',
        stroke,
        'stroke-width': width,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      },
      g,
    );
  const ink = COLOURS.outline;

  // Wheels and frame
  for (const cx of [-9, 9]) {
    svgEl(
      'circle',
      { cx, cy: -6, r: 6, fill: 'rgba(255,255,255,.35)', stroke: ink, 'stroke-width': 1.8 },
      g,
    );
    svgEl('circle', { cx, cy: -6, r: 1, fill: ink }, g);
  }
  line('M-9,-6 L-1,-6 L6,-14 L-4,-14 Z M-9,-6 L-4,-14 M6,-14 L9,-6', '#d9a441', 1.8);
  line('M-4,-14 L-4,-17', ink, 1.6); // seat post
  svgEl('rect', { x: -7, y: -18.5, width: 6, height: 2, rx: 1, fill: ink }, g); // saddle
  line('M6,-14 L6,-17 L9,-17', ink, 1.6); // stem + bars

  // Legs (dark shorts, then bare shins), arms, torso
  line('M-4,-16 L2,-10.5', ink, 3.4);
  line('M2,-10.5 L0,-5', '#ffd3a8', 2.2);
  line('M3,-22 L7,-16.5', '#ffd3a8', 2);
  line('M-4,-17 L3.5,-22', ink, 5.6); // jersey outline
  line('M-4,-17 L3.5,-22', '#3a78c9', 3.6); // jersey (Oxford-ish blue)

  // Head + helmet
  svgEl('circle', { cx: 6, cy: -26, r: 3.4, fill: '#ffd3a8', stroke: ink, 'stroke-width': 1.3 }, g);
  svgEl(
    'path',
    {
      d: 'M2.6,-26.5 A3.6,3.6 0 0 1 9.6,-26.5 L9,-27.6 L3.2,-27.6 Z',
      fill: '#d9a441',
      stroke: ink,
      'stroke-width': 1.2,
      'stroke-linejoin': 'round',
    },
    g,
  );
  return g;
}

/** The cartoon cyclist as a standalone icon (for the map marker). Wheels rest on the bottom edge. */
export function cyclistIcon(): SVGSVGElement {
  const svg = svgEl('svg', {
    viewBox: '-16 -34 32 38',
    width: 40,
    height: 48,
    class: 'cyclist-icon',
  }) as SVGSVGElement;
  buildCyclist(svg);
  return svg;
}

/** Small cartoon scene for lists (no rider). */
export function renderProfile(ele: number[]): SVGSVGElement {
  return buildScene(ele).svg;
}

/** Large scene with a cartoon cyclist that rides along the terrain and the next stretch highlighted. */
export function createProfileView(ele: number[], spacingM = 10): ProfileView {
  const { svg, world, xAt, yAt } = buildScene(ele);
  svg.classList.add('profile-large');
  const n = ele.length;
  const ahead = svgEl(
    'path',
    {
      fill: 'none',
      stroke: '#ffb020',
      'stroke-width': 4.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      opacity: 0.95,
    },
    world,
  );
  const rider = buildCyclist(world);
  const eleAtPos = (pos: number) => {
    const lo = Math.floor(pos);
    const hi = Math.min(n - 1, lo + 1);
    return ele[lo] + (ele[hi] - ele[lo]) * (pos - lo);
  };

  return {
    svg,
    update(distanceM, lookaheadM = 500) {
      const pos = Math.min(n - 1, Math.max(0, distanceM / spacingM));
      const x = xAt(pos);
      const y = yAt(eleAtPos(pos));

      // Tilt the rider with the terrain under them (clamped so steep screen slopes stay cute).
      const a = Math.max(0, pos - 3);
      const b = Math.min(n - 1, pos + 3);
      const angle =
        (Math.atan2(yAt(eleAtPos(b)) - yAt(eleAtPos(a)), xAt(b) - xAt(a)) * 180) / Math.PI;
      rider.setAttribute(
        'transform',
        `translate(${x.toFixed(1)} ${(y + 1).toFixed(1)}) rotate(${Math.max(-30, Math.min(30, angle)).toFixed(1)})`,
      );

      const end = Math.min(n - 1, pos + lookaheadM / spacingM);
      const pts = [`${x.toFixed(1)},${y.toFixed(1)}`];
      for (let i = Math.ceil(pos); i < end; i++)
        pts.push(`${xAt(i).toFixed(1)},${yAt(ele[i]).toFixed(1)}`);
      pts.push(`${xAt(end).toFixed(1)},${yAt(eleAtPos(end)).toFixed(1)}`);
      ahead.setAttribute('d', 'M' + pts.join('L'));
    },
  };
}
