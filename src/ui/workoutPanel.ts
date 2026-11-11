import { getSetting, setSetting, type OxDb, type WorkoutRow } from '../storage/db';
import { getCalibration } from '../storage/calibration';
import { addWorkout, deleteWorkout, getWorkout, listWorkouts } from '../storage/workouts';
import { parseWorkoutCsv } from '../workout/csv';
import { effortToWatts, type CalibrationPoint } from '../workout/effortCurve';
import { effortGuidance, meterLayout } from '../workout/guidance';
import { barLayout, positionAt, totalSeconds, type WorkoutPosition } from '../workout/schedule';
import { confirmButton, el } from './dom';
import { formatDuration } from './format';

export interface WorkoutPanelDeps {
  db: OxDb;
  /** Called whenever the selected workout or the calibration changes what can be ridden. */
  onChange: () => void;
  openSettings?: () => void;
}

/** What the rider is doing right now, for the power meter. */
export interface LiveReading {
  /** Smoothed current power in watts. */
  currentW: number;
  /** True while the ride is recording; guidance is only given then. */
  active: boolean;
}

export interface WorkoutPanel {
  root: HTMLElement;
  /** Reload the workout list and calibration from the database. */
  refresh(): Promise<void>;
  selectById(id: number): Promise<boolean>;
  readonly workout: WorkoutRow | null;
  /** Why the workout can't be started yet, or null if it can. */
  notReadyReason(): string | null;
  /** Update the display for `elapsedS` of ride time; returns the step and the watts to aim for, or null if not ready. */
  update(elapsedS: number, live?: LiveReading): { position: WorkoutPosition; watts: number } | null;
}

/** Workouts bundled in `public/` that can be added with one tap. */
const EXAMPLES = [
  {
    file: 'example-workout.csv',
    label: 'Add example: short intervals',
    title: 'An 8 minute interval workout to try things out',
  },
  {
    file: 'pyramids-30min.csv',
    label: 'Add example: 30 min pyramids',
    title: 'Two pyramids: build from 40 % to 100 % and release back down, 100 s per step',
  },
] as const;

const NS = 'http://www.w3.org/2000/svg';
const W = 600;
const H = 70;
const pct = (effort: number) => `${Math.round(effort * 100)} %`;
const barColour = (effort: number) => `hsl(${Math.round(210 * (1 - effort))} 70% 52%)`;

/** Workout mode card: choose/upload a workout, see the current step, target and what's coming. */
export function createWorkoutPanel({ db, onChange, openSettings }: WorkoutPanelDeps): WorkoutPanel {
  let workouts: WorkoutRow[] = [];
  let selected: WorkoutRow | null = null;
  let curve: CalibrationPoint[] = [];
  let marker: SVGLineElement | null = null;

  const select = el('select', { title: 'Choose a workout' });
  const file = el('input', { type: 'file', accept: '.csv,text/csv,text/plain' });
  const uploadBtn = el('button', {
    className: 'primary',
    textContent: 'Upload CSV',
    onclick: () => file.click(),
  });
  file.hidden = true;
  const exampleBtns = EXAMPLES.map((ex) =>
    el('button', {
      className: 'ghost',
      textContent: ex.label,
      title: ex.title,
      onclick: async () => {
        const res = await fetch(`${import.meta.env.BASE_URL}${ex.file}`);
        await importText(ex.file, await res.text());
      },
    }),
  );
  const deleteBtn = confirmButton(
    'Delete',
    async () => {
      if (!selected?.id) return;
      await deleteWorkout(db, selected.id);
      await setSetting(db, 'selectedWorkoutId', null);
      await refresh();
    },
    { className: 'ghost', confirmLabel: 'Tap again to delete' },
  );
  const err = el('div', { className: 'banner err', hidden: true });
  const calWarn = el(
    'div',
    { className: 'banner warn', hidden: true },
    el(
      'span',
      {},
      'Your effort levels are not calibrated yet, so the app does not know how many watts each effort means for you.',
    ),
    el('button', {
      className: 'primary',
      textContent: 'Open calibration',
      onclick: () => openSettings?.(),
    }),
  );
  const empty = el(
    'div',
    { className: 'empty' },
    el('strong', {}, 'No workout yet'),
    el('p', {}, 'Upload a CSV with one step per line: seconds, effort (0.0 to 1.0).'),
  );

  // Details for the chosen workout
  const stepLabel = el('div', { className: 'label' });
  const targetBig = el('div', { className: 'workout-target' });
  const stepTime = el('div', { className: 'muted' });
  const nextLine = el('div', { className: 'muted' });
  const totalLine = el('div', { className: 'muted' });
  const chartBox = el('div', { className: 'workout-chart' });
  // Power meter: a track from 0 W with the target band and a needle at the current power.
  const nowW = el('span', { className: 'pmeter-value' });
  const targetW = el('span', { className: 'pmeter-value' });
  const band = el('div', { className: 'pmeter-band' });
  const tick = el('div', { className: 'pmeter-tick' });
  const needle = el('div', { className: 'pmeter-needle' });
  const track = el('div', { className: 'pmeter-track', role: 'img' }, band, tick, needle);
  const guidance = el('div', { className: 'pmeter-status idle' });
  const meter = el(
    'div',
    { className: 'pmeter' },
    el(
      'div',
      { className: 'pmeter-readouts' },
      el('div', {}, el('div', { className: 'label' }, 'Your power (3 s)'), nowW),
      el(
        'div',
        { className: 'pmeter-right' },
        el('div', { className: 'label' }, 'Target power'),
        targetW,
      ),
    ),
    track,
    guidance,
  );

  const details = el(
    'div',
    { className: 'workout-details' },
    el(
      'div',
      { className: 'workout-now' },
      el('div', {}, stepLabel, targetBig),
      el('div', { className: 'workout-times' }, stepTime, nextLine, totalLine),
    ),
    meter,
    chartBox,
  );

  const root = el(
    'div',
    { className: 'card workout-card', hidden: true },
    el('div', { className: 'row' }, select, uploadBtn, ...exampleBtns, deleteBtn, file),
    err,
    calWarn,
    empty,
    details,
  );

  select.onchange = async () => {
    const id = Number(select.value);
    await setSetting(db, 'selectedWorkoutId', Number.isFinite(id) ? id : null);
    await refresh();
  };
  file.onchange = async () => {
    const f = file.files?.[0];
    if (f) await importText(f.name, await f.text());
    file.value = '';
  };

  async function importText(fileName: string, text: string) {
    try {
      const steps = parseWorkoutCsv(text);
      const id = await addWorkout(db, fileName.replace(/\.csv$/i, ''), steps);
      await setSetting(db, 'selectedWorkoutId', id);
      err.hidden = true;
    } catch (e) {
      err.hidden = false;
      err.textContent = `${fileName}: ${(e as Error).message}`;
    }
    await refresh();
  }

  function drawChart() {
    chartBox.replaceChildren();
    marker = null;
    if (!selected) return;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'workout-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Workout effort over time');
    for (const b of barLayout(selected.steps, W, H)) {
      const r = document.createElementNS(NS, 'rect');
      const watts = effortToWatts(curve, b.effort);
      r.setAttribute('x', b.x.toFixed(2));
      r.setAttribute('y', b.y.toFixed(2));
      r.setAttribute('width', Math.max(0.5, b.w - 0.6).toFixed(2));
      r.setAttribute('height', b.h.toFixed(2));
      r.setAttribute('fill', barColour(b.effort));
      const t = document.createElementNS(NS, 'title');
      t.textContent = `${pct(b.effort)}${watts === null ? '' : ` · ${Math.round(watts)} W`}`;
      r.append(t);
      svg.append(r);
    }
    marker = document.createElementNS(NS, 'line');
    marker.setAttribute('y1', '0');
    marker.setAttribute('y2', String(H));
    marker.setAttribute('class', 'workout-marker');
    marker.setAttribute('x1', '0');
    marker.setAttribute('x2', '0');
    svg.append(marker);
    chartBox.append(svg);
  }

  async function refresh() {
    [workouts, curve] = await Promise.all([listWorkouts(db), getCalibration(db)]);
    const id = await getSetting<number | null>(db, 'selectedWorkoutId', null);
    selected = (id !== null && workouts.find((w) => w.id === id)) || workouts[0] || null;
    select.replaceChildren(
      ...workouts.map((w) =>
        el('option', {
          value: String(w.id),
          textContent: `${w.name} · ${formatDuration(totalSeconds(w.steps))}`,
          selected: w.id === selected?.id,
        }),
      ),
    );
    select.hidden = workouts.length === 0;
    deleteBtn.hidden = !selected;
    empty.hidden = selected !== null;
    details.hidden = selected === null;
    calWarn.hidden = curve.length > 0 || selected === null;
    drawChart();
    if (selected) update(0);
    onChange();
  }

  function update(elapsedS: number, live: LiveReading = { currentW: 0, active: false }) {
    if (!selected || curve.length === 0) return null;
    const position = positionAt(selected.steps, elapsedS);
    const watts = Math.max(0, Math.round(effortToWatts(curve, position.step.effort) ?? 0));
    const total = selected.steps.length;
    stepLabel.textContent = position.done
      ? 'Workout complete'
      : `Step ${position.index + 1} of ${total}`;
    targetBig.textContent = `${pct(position.step.effort)} · ${watts} W`;
    stepTime.textContent = position.done
      ? ''
      : `${formatDuration(position.remainingInStep)} left in this step`;
    nextLine.textContent = position.next
      ? `Next: ${pct(position.next.effort)} · ${Math.round(effortToWatts(curve, position.next.effort) ?? 0)} W for ${formatDuration(position.next.seconds)}`
      : position.done
        ? ''
        : 'Last step';
    totalLine.textContent = `${formatDuration(position.remainingTotal)} remaining in total`;
    const x = (Math.min(elapsedS, totalSeconds(selected.steps)) / totalSeconds(selected.steps)) * W;
    marker?.setAttribute('x1', x.toFixed(1));
    marker?.setAttribute('x2', x.toFixed(1));
    drawMeter(position.done, watts, live);
    return { position, watts };
  }

  function drawMeter(done: boolean, target: number, live: LiveReading) {
    meter.hidden = done;
    if (done) return;
    const m = meterLayout(live.currentW, target);
    nowW.textContent = `${Math.round(live.currentW)} W`;
    targetW.textContent = `${target} W`;
    band.style.left = `${m.bandLeftPct}%`;
    band.style.width = `${m.bandWidthPct}%`;
    tick.style.left = `${m.targetPct}%`;
    needle.style.left = `${m.currentPct}%`;
    const g = effortGuidance(live.currentW, target);
    // Words and arrows, not just colour, say what to do.
    const status = live.active ? g.status : 'idle';
    guidance.className = `pmeter-status ${status}`;
    needle.className = `pmeter-needle ${status}`;
    guidance.textContent = !live.active
      ? 'Start the ride to see how you are doing'
      : g.status === 'more'
        ? `▲ More effort  +${g.deltaW} W`
        : g.status === 'less'
          ? `▼ Ease off  −${g.deltaW} W`
          : '✓ On target';
    track.setAttribute(
      'aria-label',
      `Your power ${Math.round(live.currentW)} watts, target ${target} watts`,
    );
  }

  return {
    root,
    refresh,
    async selectById(id) {
      const w = await getWorkout(db, id);
      if (!w) return false;
      await setSetting(db, 'selectedWorkoutId', id);
      await refresh();
      return true;
    },
    get workout() {
      return selected;
    },
    notReadyReason() {
      if (!selected) return 'Upload or choose a workout to start';
      if (curve.length === 0) return 'Calibrate your effort levels in Settings first';
      return null;
    },
    update,
  };
}
