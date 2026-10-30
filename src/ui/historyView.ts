import uPlot from 'uplot';
import { deleteRide, exportRideTcx, getRideSamples, listRides } from '../storage/backup';
import type { OxDb, RideRow } from '../storage/db';
import { downloadText } from './download';
import { confirmButton, el } from './dom';
import { formatDateTime, formatDuration } from './format';
import { cssVar } from './theme';
import { distanceText, elevationUnit } from './units';

const chip = (label: string, value: string) =>
  el(
    'div',
    { className: 'chip' },
    el('span', { className: 'chip-label' }, label),
    el('span', { className: 'chip-value' }, value),
  );

function stats(r: RideRow) {
  const s = r.summary;
  if (!s) return el('div', { className: 'hint' }, 'No data recorded');
  return el(
    'div',
    { className: 'chips' },
    chip('Distance', distanceText(s.distance)),
    chip('Avg', `${s.avg.toFixed(0)} W`),
    chip('NP', `${s.np.toFixed(0)} W`),
    chip('Work', `${s.kj.toFixed(0)} kJ`),
    chip('TSS', s.tss.toFixed(0)),
  );
}

/** History view: list of rides with summary stats; click one for its chart, TCX export and delete. */
export function mountHistory(root: HTMLElement, db: OxDb) {
  const list = el('div', { className: 'routes' });
  const detail = el('div', { className: 'detail' });
  root.append(el('h2', {}, 'History'), list, detail);

  async function refresh() {
    const rides = await listRides(db);
    list.replaceChildren(
      ...(rides.length
        ? rides.map(card)
        : [
            el(
              'div',
              { className: 'empty' },
              el('strong', {}, 'No rides yet'),
              el(
                'p',
                {},
                'When you finish a ride it is saved here, ready to export to Strava or Garmin as a TCX file.',
              ),
            ),
          ]),
    );
  }

  function card(r: RideRow) {
    return el(
      'button',
      { className: 'route clickable', onclick: () => void show(r) },
      el(
        'div',
        { className: 'route-head' },
        el('strong', {}, formatDateTime(r.startedAt)),
        el(
          'span',
          { className: r.status === 'active' ? 'tag warn' : 'tag' },
          r.status === 'active' ? 'unfinished' : formatDuration(r.summary?.elapsedS ?? 0),
        ),
      ),
      stats(r),
    );
  }

  async function show(r: RideRow) {
    const samples = await getRideSamples(db, r.id!);
    const box = el('div', { className: 'chart card' });
    detail.replaceChildren(
      el('h3', {}, formatDateTime(r.startedAt)),
      stats(r),
      box,
      el(
        'div',
        { className: 'row' },
        el('button', {
          className: 'primary',
          textContent: 'Export TCX',
          onclick: async () => {
            const out = await exportRideTcx(db, r.id!);
            if (out) downloadText(out.filename, out.xml, 'application/vnd.garmin.tcx+xml');
          },
        }),
        confirmButton(
          'Delete ride',
          async () => {
            await deleteRide(db, r.id!);
            detail.replaceChildren();
            await refresh();
          },
          { className: 'ghost', confirmLabel: 'Tap again to delete' },
        ),
      ),
    );
    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (!samples.length) return;

    const hasEle = samples.some((s) => s.ele !== undefined);
    const data: uPlot.AlignedData = [
      samples.map((s) => s.t / 1000),
      samples.map((s) => s.power),
      ...(hasEle ? [samples.map((s) => s.ele ?? null)] : []),
    ];
    const axis = {
      stroke: cssVar('--muted'),
      grid: { stroke: cssVar('--grid') },
      ticks: { stroke: cssVar('--grid') },
    };
    new uPlot(
      {
        width: box.clientWidth || 600,
        height: 280,
        legend: { show: false },
        scales: { x: { time: false }, ele: { auto: true } },
        axes: [
          {
            ...axis,
            label: 'Elapsed time (min:sec)',
            values: (_u, v) => v.map((n) => formatDuration(n)),
          },
          { ...axis, label: 'Power (W)', size: 60 },
          ...(hasEle
            ? [
                {
                  ...axis,
                  label: `Elevation (${elevationUnit()})`,
                  scale: 'ele',
                  side: 1,
                  grid: { show: false },
                  size: 60,
                },
              ]
            : []),
        ],
        series: [
          {},
          { stroke: cssVar('--chart-line'), width: 2, points: { show: false } },
          ...(hasEle
            ? [
                {
                  scale: 'ele',
                  stroke: cssVar('--accent'),
                  width: 1.5,
                  points: { show: false },
                  spanGaps: true,
                },
              ]
            : []),
        ],
      },
      data,
      box,
    );
  }

  void refresh();
  // Rides finish elsewhere in the app; refresh whenever this tab is shown again.
  return { refresh };
}
