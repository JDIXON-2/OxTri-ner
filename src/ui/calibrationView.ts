import { getCalibration, saveCalibration } from '../storage/calibration';
import type { OxDb } from '../storage/db';
import type { Trainer, TrainerSample } from '../trainer/Trainer';
import { CalibrationRunner, type CalibrationState } from '../workout/calibrationRunner';
import {
  CALIBRATION_LEVELS,
  CALIBRATION_PREVIEW_LEVELS,
  effortToWatts,
  isCalibrationLevel,
  isMonotonic,
  setPoint,
  type CalibrationPoint,
} from '../workout/effortCurve';
import { confirmButton, el } from './dom';

export interface CalibrationOptions {
  /** True while a ride is recording or paused; calibrating then would fight the ride's settings. */
  isRideActive?: () => boolean;
  /** Called when calibration has sent commands to the trainer, so other views resend theirs. */
  onTrainerTouched?: () => void;
}

const pct = (effort: number) => `${Math.round(effort * 100)} %`;
const MAX_DT_S = 2;

/** Settings card that measures what wattage each effort level means for this rider. */
export async function createCalibrationCard(
  db: OxDb,
  trainer: Trainer,
  opts: CalibrationOptions = {},
): Promise<HTMLElement> {
  let points: CalibrationPoint[] = await getCalibration(db);
  let runner: CalibrationRunner | null = null;
  let unsubscribe: (() => void) | null = null;
  let lastT: number | null = null;
  let runnerLevels = 0;

  const table = el('div', { className: 'cal-table' });
  const warn = el('div', { className: 'banner warn', hidden: true });
  const hint = el('div', { className: 'hint' });
  const result = el('div', { className: 'banner ok', hidden: true });
  const runPanel = el('div', { className: 'cal-run', hidden: true });
  const startAll = el('button', {
    className: 'primary',
    textContent: 'Start calibration',
    onclick: () => begin(CALIBRATION_LEVELS),
  });
  const clearBtn = confirmButton(
    'Clear calibration',
    async () => {
      points = [];
      await saveCalibration(db, points);
      renderTable();
    },
    { className: 'ghost', confirmLabel: 'Tap again to clear' },
  );
  const redoButtons: HTMLButtonElement[] = [];

  function canRun(): string | null {
    if (trainer.status !== 'controlling') return 'Connect your trainer on the Ride tab first.';
    if (opts.isRideActive?.()) return 'Finish or discard your current ride first.';
    return null;
  }

  function renderTable() {
    redoButtons.length = 0;
    const measuredBoth = CALIBRATION_LEVELS.every((l) =>
      points.some((q) => Math.abs(q.effort - l) < 1e-9),
    );
    table.replaceChildren(
      ...CALIBRATION_PREVIEW_LEVELS.map((level) => {
        if (!isCalibrationLevel(level)) {
          // Not measured: worked out from the line through the two measured levels.
          const inferred = measuredBoth ? effortToWatts(points, level) : null;
          return el(
            'div',
            { className: 'cal-row inferred' },
            el('span', { className: 'cal-level' }, pct(level)),
            el(
              'span',
              { className: 'cal-watts' },
              inferred === null ? '—' : `≈ ${Math.round(inferred)} W`,
            ),
            el('span', { className: 'muted cal-tag' }, 'worked out'),
          );
        }
        const p = points.find((q) => Math.abs(q.effort - level) < 1e-9);
        const redo = el('button', {
          className: 'ghost',
          textContent: p ? 'Redo' : 'Calibrate',
          onclick: () => begin([level]),
        });
        redoButtons.push(redo);
        return el(
          'div',
          { className: 'cal-row' },
          el('span', { className: 'cal-level' }, pct(level)),
          el('span', { className: 'cal-watts' }, p ? `${p.watts} W` : '—'),
          redo,
        );
      }),
    );
    clearBtn.hidden = points.length === 0;
    const bad = points.length > 1 && !isMonotonic(points);
    warn.hidden = !bad;
    warn.textContent = bad
      ? 'Your 100 % effort came out lower than your 20 % effort. One of them was probably mis-paced; redo the one that looks off.'
      : '';
    syncEnabled();
  }

  function syncEnabled() {
    const reason = runner?.active ? null : canRun();
    const disabled = reason !== null || !!runner?.active;
    startAll.disabled = disabled;
    for (const b of redoButtons) b.disabled = disabled;
    hint.textContent = runner?.active ? '' : (reason ?? '');
  }

  function begin(levels: number[]) {
    const reason = canRun();
    if (reason) {
      hint.textContent = reason;
      return;
    }
    result.hidden = true;
    lastT = null;
    runnerLevels = levels.length;
    runner = new CalibrationRunner(levels, {
      onLevelDone: (p) => {
        // Save as each level finishes so cancelling halfway keeps the levels already measured.
        points = setPoint(points, p);
        void saveCalibration(db, points);
        renderTable();
      },
    });
    // A neutral 0 % grade so the resistance doesn't change under the rider while they find their effort.
    trainer.setGrade(0).catch(() => {});
    unsubscribe = trainer.onSample(onSample);
    runner.start();
    runPanel.hidden = false;
    renderRun(runner.state);
    syncEnabled();
  }

  function onSample(s: TrainerSample) {
    if (!runner) return;
    const dt = lastT === null ? 0 : Math.min(MAX_DT_S, Math.max(0, (s.t - lastT) / 1000));
    lastT = s.t;
    const state = runner.update(dt, s.power_w ?? 0);
    if (runner.active) renderRun(state);
    else end(state);
  }

  function end(state: CalibrationState) {
    unsubscribe?.();
    unsubscribe = null;
    runPanel.hidden = true;
    result.hidden = false;
    result.textContent =
      state.phase === 'done'
        ? 'Done — your calibration is saved.'
        : 'Stopped. Levels you had already finished were kept.';
    runner = null;
    renderTable();
    opts.onTrainerTouched?.();
  }

  function renderRun(st: CalibrationState) {
    const total = runner ? runnerLevels : 0;
    const ramp = st.phase === 'ramp';
    const secs = Math.ceil(st.phaseRemainingS - 1e-9);
    const progress = st.phaseDurationS > 0 ? 1 - st.phaseRemainingS / st.phaseDurationS : 0;
    const fill = el('div', { className: ramp ? 'cal-fill ramp' : 'cal-fill' });
    fill.style.width = `${(progress * 100).toFixed(1)}%`;
    runPanel.replaceChildren(
      el('div', { className: 'label' }, `Level ${st.levelIndex + 1} of ${total}`),
      el(
        'div',
        { className: 'cal-instruction' },
        `Ride at ${st.level === null ? '' : pct(st.level)} effort`,
      ),
      el(
        'div',
        { className: `cal-phase ${st.phase}` },
        ramp
          ? `Get up to this effort — measuring starts in ${secs} s`
          : `Hold it steady — measuring, ${secs} s left`,
      ),
      el('div', { className: 'cal-bar' }, fill),
      el(
        'div',
        { className: 'cal-power' },
        `${Math.round(st.livePower)} W`,
        st.liveAverage !== null
          ? el('span', { className: 'muted' }, ` · average so far ${Math.round(st.liveAverage)} W`)
          : '',
      ),
      el('button', {
        className: 'ghost',
        textContent: 'Cancel',
        onclick: () => {
          runner?.cancel();
          if (runner) end(runner.state);
        },
      }),
    );
  }

  trainer.onStatus(() => {
    // Losing control mid-run would give nonsense numbers, so stop.
    if (runner?.active && trainer.status !== 'controlling') {
      runner.cancel();
      end(runner.state);
    } else {
      syncEnabled();
    }
  });

  renderTable();
  return el(
    'section',
    { className: 'card' },
    el('h3', {}, 'Effort calibration'),
    el(
      'p',
      {},
      'Workouts ask for an effort from 0.0 to 1.0. Calibration teaches the app what that means in watts for you, using just two measurements.',
    ),
    el(
      'p',
      { className: 'hint' },
      'You calibrate an easy effort (20 %) and an all-out effort (100 %). For each you get 10 seconds to ride up to that effort as you feel it, then your average power over the next 10 seconds is recorded. Every other effort is worked out from the straight line between the two.',
    ),
    table,
    el('div', { className: 'row' }, startAll, clearBtn),
    hint,
    warn,
    runPanel,
    result,
  );
}
