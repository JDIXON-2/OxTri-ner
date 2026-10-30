import type {
  GeoJSONSource,
  Map as MLMap,
  Marker as MLMarker,
  StyleSpecification,
} from 'maplibre-gl';
import { positionAt, progressCoords, routeBounds, routeCoords, zoomForScale } from '../route/geo';
import { ROUTE_SPACING_M } from '../route/gpx';
import type { RideState } from '../sim/rideEngine';
import { getSetting, setSetting, type OxDb, type RouteRow } from '../storage/db';
import { getRoute } from '../storage/routes';
import { el } from './dom';
import { cyclistIcon } from './elevationProfile';

/**
 * OpenTopoMap (contours, hillshading, paths) as the base, with a light hillshade from open AWS
 * Terrain Tiles on top. No account or API key is needed for either.
 */
export const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    topo: {
      type: 'raster',
      tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
      tileSize: 256,
      maxzoom: 17,
      attribution:
        'Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, SRTM | Style © <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA)',
    },
    dem: {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15,
      attribution:
        'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">AWS Terrain Tiles</a>',
    },
  },
  layers: [
    { id: 'topo', type: 'raster', source: 'topo' },
    {
      id: 'hillshade',
      type: 'hillshade',
      source: 'dem',
      paint: {
        'hillshade-exaggeration': 0.35,
        'hillshade-shadow-color': '#2b3a4a',
        'hillshade-highlight-color': '#ffffff',
      },
    },
  ],
};

export interface MapView {
  /** Call when the Map tab is shown: creates the map (if allowed) and resizes it. */
  onShow(): void;
  /** Move the rider; call on every sample. */
  update(st: RideState, routeId: number | null): void;
}

const EMPTY_LINE = {
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: [] },
} as const;

/** Map tab: the selected route over a topographic map, with the rider moving along it. Opt-in. */
export function mountMap(root: HTMLElement, db: OxDb): MapView {
  let enabled = false;
  let map: MLMap | null = null;
  let marker: MLMarker | null = null;
  let styleReady = false;
  let route: RouteRow | null = null;
  let rideRouteId: number | null = null;
  let follow = false;
  let loadingRoute = false;
  let riderDistance = 0;
  // MapLibre positions the marker element with its own `transform`, so only the inner icon is mirrored.
  const rider = cyclistIcon();
  const icon = el('div', { className: 'map-rider' }, rider);

  // --- opt-in card ---
  const consent = el(
    'div',
    { className: 'card' },
    el('h3', {}, 'Online map'),
    el('p', {}, 'Shows your route on a topographic map with contour lines and shading.'),
    el(
      'p',
      { className: 'hint' },
      'The map is downloaded from OpenTopoMap and AWS terrain servers as you pan and zoom, so those servers can see roughly which area you are looking at. Your ride data, power and the GPX file itself are never sent. Nothing is loaded until you press the button.',
    ),
    el('button', {
      className: 'primary big',
      textContent: 'Load map',
      onclick: () => void turnOn(),
    }),
  );

  // --- map card ---
  const container = el('div', { className: 'map' });
  const note = el('div', { className: 'empty', hidden: true });
  const followBtn = el('button', {
    className: 'ghost',
    textContent: 'Follow rider',
    onclick: () => setFollow(!follow),
  });
  const fitBtn = el('button', {
    className: 'ghost',
    textContent: 'Fit route',
    onclick: () => fit(),
  });
  const closeBtn = el('button', {
    className: 'ghost',
    textContent: '500 m view',
    title: 'Zoom to the rider with the scale bar at 500 m',
    onclick: () => focusRider(),
  });
  const offBtn = el('button', {
    className: 'ghost',
    textContent: 'Turn off map',
    onclick: () => void turnOff(),
  });
  const mapCard = el(
    'div',
    { hidden: true },
    note,
    el('div', { className: 'row' }, closeBtn, fitBtn, followBtn, offBtn),
    container,
  );

  root.append(el('h2', {}, 'Map'), consent, mapCard);

  void getSetting<boolean>(db, 'mapEnabled', false).then((v) => {
    enabled = v;
    syncCards();
  });

  function syncCards() {
    consent.hidden = enabled;
    mapCard.hidden = !enabled;
  }

  async function turnOn() {
    enabled = true;
    await setSetting(db, 'mapEnabled', true);
    syncCards();
    await show();
  }

  async function turnOff() {
    enabled = false;
    await setSetting(db, 'mapEnabled', false);
    marker?.remove();
    map?.remove();
    map = marker = null;
    styleReady = false;
    syncCards();
  }

  function setFollow(on: boolean) {
    follow = on;
    followBtn.classList.toggle('active', on);
    followBtn.textContent = on ? 'Following rider ✓' : 'Follow rider';
  }

  async function ensureMap(): Promise<MLMap> {
    if (map) return map;
    // Loaded on demand so the library only reaches people who use the map.
    const [ml, worker] = await Promise.all([
      import('maplibre-gl'),
      // Vite bundles the worker (with its shared code) and gives us its URL. MapLibre's own default
      // path to it breaks once the app is bundled, which silently disables GeoJSON and hillshade.
      import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
      import('maplibre-gl/dist/maplibre-gl.css'),
    ]);
    ml.setWorkerUrl(worker.default);
    const m = new ml.Map({
      container,
      style: MAP_STYLE,
      center: [-1.26, 51.75],
      zoom: 9,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    m.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
    // Top-left so the attribution box can never cover it; 100 px max makes the bar read "500 m" at our zoom.
    m.addControl(new ml.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'top-left');
    marker = new ml.Marker({ element: icon, anchor: 'bottom' });
    // 'style.load' (not 'load') so the route appears even while tiles are slow or offline.
    m.once('style.load', () => {
      styleReady = true;
      addRouteLayers(m);
      applyRoute();
    });
    // The user taking over the map cancels follow mode.
    m.on('dragstart', () => follow && setFollow(false));
    map = m;
    return m;
  }

  function addRouteLayers(m: MLMap) {
    m.addSource('route', { type: 'geojson', data: EMPTY_LINE });
    m.addSource('progress', { type: 'geojson', data: EMPTY_LINE });
    m.addSource('ends', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
    m.addLayer({
      id: 'route-casing',
      type: 'line',
      source: 'route',
      layout: round,
      paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9 },
    });
    m.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: round,
      paint: { 'line-color': '#d62839', 'line-width': 4.5 },
    });
    m.addLayer({
      id: 'progress-line',
      type: 'line',
      source: 'progress',
      layout: round,
      paint: { 'line-color': '#1c5fc7', 'line-width': 4.5 },
    });
    m.addLayer({
      id: 'ends',
      type: 'circle',
      source: 'ends',
      paint: {
        'circle-radius': 7,
        'circle-color': ['get', 'color'],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2.5,
      },
    });
  }

  /** Push the current route into the map sources and frame it. */
  function applyRoute() {
    if (!map || !styleReady) return;
    const src = (id: string) => map!.getSource(id) as GeoJSONSource;
    if (!route) {
      src('route').setData(EMPTY_LINE);
      src('progress').setData(EMPTY_LINE);
      src('ends').setData({ type: 'FeatureCollection', features: [] });
      marker?.remove();
      return;
    }
    const coords = routeCoords(route);
    src('route').setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    });
    src('progress').setData(EMPTY_LINE);
    src('ends').setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { color: '#2f9e4a' },
          geometry: { type: 'Point', coordinates: coords[0] },
        },
        {
          type: 'Feature',
          properties: { color: '#14213d' },
          geometry: { type: 'Point', coordinates: coords[coords.length - 1] },
        },
      ],
    });
    marker!.setLngLat(coords[0]).addTo(map);
    focusRider();
  }

  /** Centre on the rider (or the start) at the zoom where the scale bar reads 500 m. */
  function focusRider() {
    if (!map || !route) return;
    const pos = positionAt(route, riderDistance);
    map.jumpTo({ center: pos, zoom: zoomForScale(pos[1]) });
  }

  function fit() {
    if (!map || !route) return;
    map.fitBounds(routeBounds(route), { padding: 48, duration: 0, maxZoom: 15 });
  }

  /** Which route the map should show: the one being ridden, else the selected one. */
  async function loadWantedRoute() {
    if (loadingRoute) return;
    loadingRoute = true;
    try {
      const id = rideRouteId ?? (await getSetting<number | null>(db, 'selectedRouteId', null));
      const row = id === null ? undefined : await getRoute(db, id);
      const changed = (row?.id ?? null) !== (route?.id ?? null) || row?.name !== route?.name;
      if ((row?.id ?? null) !== (route?.id ?? null) && row?.id !== rideRouteId) riderDistance = 0;
      route = row ?? null;
      note.hidden = route !== null;
      note.textContent =
        'No route selected yet. Pick one in the Routes tab and it will show up here.';
      if (changed) applyRoute();
    } finally {
      loadingRoute = false;
    }
  }

  async function show() {
    if (!enabled) return;
    const m = await ensureMap();
    await loadWantedRoute();
    // The container was hidden when the map was created; tell it the real size now.
    m.resize();
  }

  return {
    onShow: () => void show(),
    update(st, routeId) {
      if (st.mode !== 'route' && !st.finished) return;
      if (routeId !== null && routeId !== rideRouteId) {
        rideRouteId = routeId;
        void loadWantedRoute();
      }
      riderDistance = st.distance;
      if (!map || !styleReady || !route || !marker) return;
      const pos = positionAt(route, st.distance);
      marker.setLngLat(pos);
      // Face the direction of travel (the cartoon rider faces east by default).
      const ahead = positionAt(route, st.distance + ROUTE_SPACING_M);
      const behind = positionAt(route, Math.max(0, st.distance - ROUTE_SPACING_M));
      rider.style.transform = ahead[0] < behind[0] ? 'scaleX(-1)' : '';
      (map.getSource('progress') as GeoJSONSource).setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: progressCoords(route, st.distance) },
      });
      if (follow) map.easeTo({ center: pos, duration: 800 });
    },
  };
}
