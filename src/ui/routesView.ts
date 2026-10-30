import { buildRoute, parseGpx } from '../route/gpx';
import { DEFAULT_SETTINGS, getSetting, setSetting, type OxDb, type RouteRow } from '../storage/db';
import { addRoute, deleteRoute, listRoutes, renameRoute } from '../storage/routes';
import { confirmButton, el } from './dom';
import { renderProfile } from './elevationProfile';
import { distanceText, elevationText } from './units';

/** Routes view: upload (button or drag-drop), list, select, rename, delete. */
export function mountRoutes(root: HTMLElement, db: OxDb) {
  const status = el('div', { className: 'hint' });
  const list = el('div', { className: 'routes' });
  const input = el('input', { type: 'file', accept: '.gpx,application/gpx+xml,text/xml' });
  input.multiple = true;
  const drop = el(
    'div',
    { className: 'drop' },
    el('div', { className: 'drop-title' }, 'Drop a GPX file here'),
    el('div', { className: 'muted' }, 'or choose one from your device'),
    input,
  );

  const sample = el('button', {
    className: 'ghost',
    textContent: 'Add test route',
    title:
      'A synthetic 8.6 km route through green hills, rocky mountain and snow, for trying things out',
    onclick: async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}debug-route.gpx`);
      await importFiles([new File([await res.text()], 'debug-route.gpx')]);
    },
  });

  async function importFiles(files: FileList | File[]) {
    const smoothing = await getSetting(db, 'smoothingWindow', DEFAULT_SETTINGS.smoothingWindow);
    for (const file of Array.from(files)) {
      try {
        const parsed = parseGpx(await file.text());
        const name = parsed.name || file.name.replace(/\.gpx$/i, '');
        await addRoute(db, buildRoute(name, parsed.points, smoothing));
        status.textContent = [`Imported “${name}”.`, ...parsed.warnings].join(' ');
      } catch (e) {
        status.textContent = `${file.name}: ${(e as Error).message}`;
      }
    }
    await refresh();
  }

  input.onchange = () => {
    if (input.files) void importFiles(input.files).then(() => (input.value = ''));
  };
  drop.ondragover = (e) => {
    e.preventDefault();
    drop.classList.add('over');
  };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer?.files.length) void importFiles(e.dataTransfer.files);
  };

  async function refresh() {
    const [routes, selected] = await Promise.all([
      listRoutes(db),
      getSetting<number | null>(db, 'selectedRouteId', null),
    ]);
    list.replaceChildren(
      ...(routes.length
        ? routes.map((r) => card(r, r.id === selected))
        : [
            el(
              'div',
              { className: 'empty' },
              el('strong', {}, 'No routes yet'),
              el(
                'p',
                {},
                'Add a GPX file from Strava, Komoot or Garmin to ride it with real gradients, or try the built-in test route.',
              ),
            ),
          ]),
    );
  }

  function card(r: RouteRow, selected: boolean) {
    const head = el(
      'div',
      { className: 'route-head' },
      el('strong', {}, r.name),
      el(
        'span',
        { className: 'muted' },
        `${distanceText(r.distance)} · ${elevationText(r.ascent)} ↑`,
      ),
    );

    const rename = () => {
      const field = el('input', { type: 'text', value: r.name, className: 'rename' });
      const done = async (save: boolean) => {
        const v = field.value.trim();
        if (save && v && v !== r.name) await renameRoute(db, r.id!, v);
        await refresh();
      };
      field.onkeydown = (e) => {
        if (e.key === 'Enter') void done(true);
        if (e.key === 'Escape') void done(false);
      };
      head.replaceChildren(
        field,
        el('button', { className: 'primary', textContent: 'Save', onclick: () => void done(true) }),
        el('button', {
          className: 'ghost',
          textContent: 'Cancel',
          onclick: () => void done(false),
        }),
      );
      field.focus();
      field.select();
    };

    return el(
      'div',
      { className: selected ? 'route selected' : 'route' },
      head,
      renderProfile(r.ele),
      el(
        'div',
        { className: 'row' },
        el('button', {
          className: selected ? '' : 'primary',
          textContent: selected ? 'Selected ✓' : 'Use this route',
          disabled: selected,
          onclick: async () => (await setSetting(db, 'selectedRouteId', r.id), refresh()),
        }),
        el('button', { className: 'ghost', textContent: 'Rename', onclick: rename }),
        confirmButton(
          'Delete',
          async () => {
            await deleteRoute(db, r.id!);
            if ((await getSetting<number | null>(db, 'selectedRouteId', null)) === r.id) {
              await setSetting(db, 'selectedRouteId', null);
            }
            await refresh();
          },
          { className: 'ghost', confirmLabel: 'Tap again to delete' },
        ),
      ),
    );
  }

  root.append(el('h2', {}, 'Routes'), drop, el('div', { className: 'row' }, sample), status, list);
  void refresh();
}
