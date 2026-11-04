import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { Recorder } from '../ride/recorder';
import type { RideEngine, RideMode, RideState } from '../sim/rideEngine';
import { getSetting, type OxDb, type RouteRow } from '../storage/db';
import { exportRideTcx } from '../storage/backup';
import { getRoute } from '../storage/routes';
import { downloadText } from './download';
import type { Trainer, TrainerSample, TrainerStatus } from '../trainer/Trainer';
import { statusLabel } from './status';
import { confirmButton, el } from './dom';
import { createProfileView, type ProfileView } from './elevationProfile';
import { formatDateTime, formatDuration } from './format';
import { cssVar } from './theme';
import {
  distanceText,
  distanceUnit,
  distanceValue,
  elevationText,
  speedUnit,
  speedValue,
} from './units';
import { WakeLockManager } from '../ride/wakeLock';
import { createWorkoutPanel } from './workoutPanel';

export interface DashboardDeps {
  trainer: Trainer;
  recorder: Recorder;
  engine: RideEngine;
  db: OxDb;
  /** Called on every sample, e.g. to move the rider on the map. */
  onRideState?: (st: RideState, routeId: number | null) => void;
  /** Switch to the Settings tab (used to reach effort calibration). */
  openSettings?: () => void;
}

export interface DashboardApi {
  /** Call when the Ride tab is shown, to pick up changes made elsewhere (e.g. calibration). */
  onShow(): void;
  /** Forget what the trainer was last told, so grade / target power are sent again. */
  resetCommands(): void;
  /** Step the free-ride grade or ERG target up (+1) or down (-1). False if this mode has no manual control. */
  nudge(direction: 1 | -1): boolean;
}

const CHART_WINDOW_S = 600;
const CHART_HEIGHT = 220;
const GRADE_STEP = 0.5;
const ERG_STEP = 5;

/** Ride view: connect card, mode + controls, tiles, power chart and a sticky start/pause/finish bar. */
export function mountDashboard(
  root: HTMLElement,
  { trainer, recorder, engine, db, onRideState, openSettings }: DashboardDeps,
): DashboardApi {
  let mode: RideMode = engine.mode;
  let routeId: number | null = null;
  let profile: ProfileView | null = null;
  let ergWatts = 150;
  let lastErg: number | null = null;
  let autoPaused = false;

  // --- connection card ---
  const connTitle = el('div', { className: 'conn-title' });
  const connSub = el('div', { className: 'hint' });
  const connectBtn = el('button', { textContent: 'Connect trainer' });
  const connHint = el('p', {
    className: 'hint',
    textContent:
      'Close Zwift, the Saris app and any phone apps first: only one app can control the trainer.',
  });
  const connCard = el(
    'div',
    { className: 'card conn' },
    el('div', { className: 'conn-main' }, el('div', {}, connTitle, connSub), connectBtn),
    connHint,
  );

  const banner = el('div', {
    className: 'banner warn',
    hidden: true,
    textContent: 'Connection lost — reconnecting. The ride clock is paused.',
  });
  const errLine = el('div', { className: 'banner err', hidden: true });
  const showError = (e: unknown) => {
    errLine.replaceChildren(
      el('span', {}, (e as Error).message),
      el('button', {
        className: 'ghost',
        textContent: '✕',
        title: 'Dismiss',
        onclick: () => (errLine.hidden = true),
      }),
    );
    errLine.hidden = false;
  };
  const resumePrompt = el('div', { className: 'banner info', hidden: true });
  const message = el('div', { className: 'banner ok', hidden: true });
  function showMessage(text: string, ...extra: Node[]) {
    message.hidden = false;
    message.replaceChildren(el('span', {}, text), ...extra);
  }

  // --- tiles ---
  const tiles = new Map<string, HTMLElement>();
  const tile = (key: string, label: string, unit = '', cls = '') => {
    const value = el('div', { className: 'value', textContent: '--' });
    tiles.set(key, value);
    return el(
      'div',
      { className: `tile ${cls}`.trim() },
      el(
        'div',
        { className: 'label' },
        el('span', {}, label),
        el('span', { className: 'unit' }, unit),
      ),
      value,
    );
  };
  const set = (key: string, text: string) => {
    tiles.get(key)!.textContent = text;
  };
  const primary = el(
    'div',
    { className: 'tiles' },
    tile('power', 'Power', 'W · 3 s avg', 'hero'),
    tile('cadence', 'Cadence', 'rpm'),
    tile('speed', 'Speed', speedUnit()),
    tile('grade', 'Grade', '%'),
    tile('distance', 'Distance', distanceUnit()),
    tile('elapsed', 'Elapsed'),
  );
  const remainingTile = tile('remaining', 'Remaining', distanceUnit(), 'small');
  remainingTile.hidden = true;
  const secondary = el(
    'div',
    { className: 'tiles secondary' },
    tile('avg', 'Avg', 'W', 'small'),
    tile('np', 'NP', 'W', 'small'),
    tile('kj', 'Work', 'kJ', 'small'),
    tile('tss', 'TSS', '', 'small'),
    remainingTile,
  );

  // --- chart ---
  const chartBox = el('div', { className: 'chart card' });
  // Absolute sample times in seconds; the plot's x axis is "seconds ago" so the latest sample is at 0.
  const times: number[] = [];
  const ys: number[] = [];
  let chart: uPlot | null = null;
  const makeChart = () => {
    const axis = {
      stroke: cssVar('--muted'),
      grid: { stroke: cssVar('--grid') },
      ticks: { stroke: cssVar('--grid') },
    };
    chart = new uPlot(
      {
        width: chartBox.clientWidth || 600,
        height: CHART_HEIGHT,
        legend: { show: false },
        cursor: { show: false },
        scales: { x: { time: false, range: () => [-CHART_WINDOW_S, 0] } },
        axes: [
          {
            ...axis,
            label: 'Time (min:sec ago)',
            incrs: [60, 120, 300],
            values: (_u, v) => v.map((n) => (n === 0 ? 'now' : `-${formatDuration(-n)}`)),
          },
          { ...axis, label: 'Power (W)', size: 60 },
        ],
        series: [{}, { stroke: cssVar('--chart-line'), width: 2, points: { show: false } }],
      },
      [[], ys],
      chartBox,
    );
    new ResizeObserver(() =>
      chart?.setSize({ width: chartBox.clientWidth, height: CHART_HEIGHT }),
    ).observe(chartBox);
  };

  // --- route panel ---
  const routeInfo = el('div', { className: 'route-info' });
  const profileBox = el('div');
  const routePanel = el('div', { className: 'card', hidden: true }, routeInfo, profileBox);
  const workoutPanel = createWorkoutPanel({ db, onChange: () => syncButtons(), openSettings });

  // --- mode + controls ---
  const modeBtns: Record<RideMode, HTMLButtonElement> = {
    route: el('button', { textContent: 'Route sim', onclick: () => void setMode('route') }),
    free: el('button', { textContent: 'Free ride', onclick: () => void setMode('free') }),
    erg: el('button', { textContent: 'ERG', onclick: () => void setMode('erg') }),
    workout: el('button', { textContent: 'Workout', onclick: () => void setMode('workout') }),
  };
  const target = el('div', { className: 'target' });
  const targetLabel = el('div', { className: 'label' });
  const adjust = (label: string, title: string, fn: () => void) =>
    el('button', { className: 'adjust', textContent: label, title, onclick: fn });
  const controls = el('div', { className: 'controls' });

  function bumpGrade(delta: number) {
    engine.freeGrade = Math.min(20, Math.max(-10, engine.freeGrade + delta));
    renderControls();
  }

  function bumpErg(delta: number) {
    ergWatts = Math.max(0, ergWatts + delta);
    renderControls();
  }

  /** One step up (+1) or down (-1) from a remote: grade in free ride, target power in ERG. */
  function nudge(direction: 1 | -1): boolean {
    if (mode === 'free') bumpGrade(direction * GRADE_STEP);
    else if (mode === 'erg') bumpErg(direction * ERG_STEP);
    else return false; // route and workout modes set their own grade / power
    return true;
  }

  function renderControls() {
    for (const k of ['route', 'free', 'erg', 'workout'] as const) {
      modeBtns[k].classList.toggle('active', mode === k);
      modeBtns[k].setAttribute('aria-pressed', String(mode === k));
    }
    routePanel.hidden = mode !== 'route';
    workoutPanel.root.hidden = mode !== 'workout';
    remainingTile.hidden = mode !== 'route';
    if (mode === 'route' || mode === 'workout') {
      controls.hidden = true;
      if (mode === 'workout') set('grade', 'ERG');
    } else if (mode === 'free') {
      controls.hidden = false;
      targetLabel.textContent = 'Grade you are riding';
      target.textContent = `${engine.freeGrade.toFixed(1)} %`;
      controls.replaceChildren(
        adjust('−', 'Lower grade', () => bumpGrade(-GRADE_STEP)),
        el('div', { className: 'target-box' }, targetLabel, target),
        adjust('+', 'Raise grade', () => bumpGrade(GRADE_STEP)),
      );
      set('grade', engine.freeGrade.toFixed(1));
    } else {
      controls.hidden = false;
      targetLabel.textContent = 'Target power — the trainer holds this';
      target.textContent = `${ergWatts} W`;
      controls.replaceChildren(
        adjust('−', 'Lower target', () => bumpErg(-ERG_STEP)),
        el('div', { className: 'target-box' }, targetLabel, target),
        adjust('+', 'Raise target', () => bumpErg(ERG_STEP)),
      );
      set('grade', 'ERG');
    }
  }

  async function setMode(m: RideMode) {
    if (m === 'route') {
      if (recorder.state !== 'idle')
        return showError(new Error('Finish the current ride before switching to route sim.'));
      const id = await getSetting<number | null>(db, 'selectedRouteId', null);
      const row = id === null ? undefined : await getRoute(db, id);
      if (!row)
        return showError(new Error('No route selected yet. Pick one in the Routes tab first.'));
      errLine.hidden = true;
      loadRoute(row);
    }
    if (m === 'workout') {
      if (recorder.state !== 'idle')
        return showError(new Error('Finish the current ride before switching to a workout.'));
      errLine.hidden = true;
      await workoutPanel.refresh();
    }
    engine.setMode(m);
    mode = m;
    lastErg = null;
    renderControls();
    syncButtons();
  }

  function loadRoute(row: RouteRow) {
    routeId = row.id ?? null;
    engine.setRoute(row);
    profile = createProfileView(row.ele);
    profile.update(0);
    routeInfo.textContent = `${row.name} — ${distanceText(row.distance)}`;
    profileBox.replaceChildren(profile.svg);
  }

  /** Pick up a mode change made by the engine (end of route). */
  function syncMode(st: RideState) {
    if (st.mode === mode) return;
    mode = st.mode;
    if (st.finished) showMessage('Route complete — carrying on as a free ride at 0 %.');
    renderControls();
  }

  // --- ride lifecycle: sticky action bar ---
  const stateText = el('div', { className: 'state' });
  const startBtn = el('button', {
    className: 'primary big',
    textContent: 'Start ride',
    onclick: async () => {
      message.hidden = true;
      if (mode === 'workout') {
        await workoutPanel.refresh(); // pick up a calibration finished since the mode was chosen
        const why = workoutPanel.notReadyReason();
        if (why) return showError(new Error(why));
      }
      engine.reset();
      await recorder.start({
        routeId: mode === 'route' && routeId !== null ? routeId : undefined,
        workoutId: mode === 'workout' ? workoutPanel.workout?.id : undefined,
      });
      syncButtons();
    },
  });
  const pauseBtn = el('button', {
    className: 'big',
    textContent: 'Pause',
    onclick: () => (recorder.pause(), syncButtons()),
  });
  const resumeBtn = el('button', {
    className: 'primary big',
    textContent: 'Resume',
    onclick: () => (recorder.unpause(), syncButtons()),
  });
  const finishBtn = confirmButton(
    'Finish',
    async () => {
      const ride = await recorder.finish();
      autoPaused = false;
      syncButtons();
      const s = ride.summary;
      showMessage(
        `Ride saved — ${formatDuration(s?.elapsedS ?? 0)}, ${distanceText(s?.distance ?? 0)}, ${(s?.avg ?? 0).toFixed(0)} W average. `,
        el('button', {
          textContent: 'Download TCX',
          onclick: async () => {
            const out = await exportRideTcx(db, ride.id!);
            if (out) downloadText(out.filename, out.xml, 'application/vnd.garmin.tcx+xml');
          },
        }),
      );
    },
    { className: 'big', confirmLabel: 'Tap again to finish' },
  );
  const actionBar = el(
    'div',
    { className: 'actionbar' },
    stateText,
    el('div', { className: 'actions' }, startBtn, pauseBtn, resumeBtn, finishBtn),
  );

  const wakeLock = new WakeLockManager();
  function syncButtons() {
    const s = recorder.state;
    // Keep the screen on for the whole ride, including pauses.
    if (s === 'idle') void wakeLock.release();
    else void wakeLock.acquire();
    const ready = trainer.status === 'controlling';
    const workoutBlock = mode === 'workout' && s === 'idle' ? workoutPanel.notReadyReason() : null;
    startBtn.hidden = s !== 'idle';
    startBtn.disabled = !ready || workoutBlock !== null;
    pauseBtn.hidden = s !== 'recording';
    resumeBtn.hidden = s !== 'paused';
    finishBtn.hidden = s === 'idle';
    actionBar.dataset.state = s;
    stateText.textContent =
      s === 'recording'
        ? '● Recording'
        : s === 'paused'
          ? 'Paused'
          : !ready
            ? 'Connect your trainer to start'
            : (workoutBlock ?? 'Ready — start when you are pedalling');
  }

  connectBtn.onclick = () => {
    errLine.hidden = true;
    if (trainer.status === 'disconnected') trainer.connect().catch(showError);
    else void trainer.disconnect();
  };

  function syncConnection(s: TrainerStatus) {
    const disconnected = s === 'disconnected';
    connTitle.textContent = disconnected
      ? 'Trainer not connected'
      : (trainer.info.deviceName ?? 'Trainer');
    connSub.textContent = disconnected ? '' : statusLabel(s);
    connectBtn.textContent = disconnected ? 'Connect trainer' : 'Disconnect';
    connectBtn.className = disconnected ? 'primary' : 'ghost';
    connHint.hidden = !disconnected;
    connCard.classList.toggle('compact', !disconnected);
  }

  root.append(
    connCard,
    banner,
    errLine,
    resumePrompt,
    message,
    el(
      'div',
      { className: 'card modes-card' },
      el(
        'div',
        { className: 'segmented', role: 'group' },
        modeBtns.route,
        modeBtns.free,
        modeBtns.erg,
        modeBtns.workout,
      ),
      controls,
    ),
    primary,
    secondary,
    routePanel,
    workoutPanel.root,
    chartBox,
    actionBar,
  );
  makeChart();
  renderControls();
  syncConnection(trainer.status);
  syncButtons();

  // --- trainer events ---
  trainer.onStatus((s: TrainerStatus) => {
    syncConnection(s);
    banner.hidden = s !== 'reconnecting';
    if (s === 'reconnecting') {
      if (recorder.state === 'recording') {
        recorder.pause();
        autoPaused = true;
      }
      engine.policy.reset();
      lastErg = null;
    } else if (s === 'controlling') {
      // Control was just (re)granted: whatever we thought the trainer had is gone.
      engine.policy.reset();
      lastErg = null;
      if (autoPaused) {
        recorder.unpause();
        autoPaused = false;
      }
    }
    syncButtons();
  });

  trainer.onSample((s: TrainerSample) => {
    const power = s.power_w ?? 0;
    const st = engine.update(s.t, power, recorder.state === 'recording');
    syncMode(st);
    onRideState?.(st, routeId);
    const m = recorder.addSample(s, {
      grade: st.grade,
      ele: st.ele,
      lat: st.lat,
      lon: st.lon,
      virtualSpeed: st.speed * 3.6,
      distance: st.distance,
    });
    // Workout: the step comes from ride time (which stops while paused), the watts from calibration.
    let workoutWatts: number | null = null;
    if (mode === 'workout') {
      const w = workoutPanel.update(recorder.snapshot().elapsedS, {
        currentW: m ? m.avg3 : power,
        active: recorder.state === 'recording',
      });
      if (w) {
        workoutWatts = w.watts;
        if (w.position.done && recorder.state === 'recording') {
          engine.setMode('free');
          engine.freeGrade = 0;
          mode = 'free';
          workoutWatts = null;
          lastErg = null;
          showMessage('Workout complete — carrying on as a free ride at 0 %.');
          renderControls();
        }
      }
    }
    drive(st, workoutWatts);

    set('power', String(Math.round(m ? m.avg3 : power)));
    set('cadence', String(Math.round(s.cadence_rpm ?? 0)));
    set('speed', speedValue(st.speed * 3.6));
    set('grade', mode === 'erg' || mode === 'workout' ? 'ERG' : st.grade.toFixed(1));
    set('distance', distanceValue(st.distance));
    set('remaining', mode === 'route' ? distanceValue(st.remainingDistance) : '--');
    if (m) {
      set('elapsed', formatDuration(m.elapsedS));
      set('avg', m.avg.toFixed(0));
      set('np', m.np.toFixed(0));
      set('kj', m.kj.toFixed(1));
      set('tss', m.tss.toFixed(1));
    }
    if (mode === 'route') {
      profile?.update(st.distance);
      routeInfo.textContent =
        `Remaining ${distanceText(st.remainingDistance)} · ${elevationText(st.remainingAscent)} ↑ · ` +
        `Next 500 m: ${st.upcomingGrade.toFixed(1)} %`;
    }

    times.push(s.t / 1000);
    ys.push(power);
    while (times.length && times[0] < times[times.length - 1] - CHART_WINDOW_S) {
      times.shift();
      ys.shift();
    }
    const latest = times[times.length - 1];
    chart?.setData([times.map((t) => t - latest), ys]);
  });

  /** Send grade / ERG commands, driven by the sample cadence rather than a timer. */
  function drive(st: RideState, workoutWatts: number | null) {
    if (trainer.status !== 'controlling') return;
    if (st.sendGrade !== null) trainer.setGrade(st.sendGrade, engine.simParams()).catch(showError);
    const wanted = mode === 'erg' ? ergWatts : mode === 'workout' ? workoutWatts : null;
    if (wanted !== null) {
      // Some trainers refuse targets below their minimum, so never ask for less.
      const watts = Math.max(trainer.info.powerRange?.min ?? 0, wanted);
      if (watts !== lastErg) {
        lastErg = watts;
        trainer.setTargetPower(watts).catch(showError);
      }
    }
  }

  // Don't lose more than a few seconds if the tab is closed or backgrounded.
  const flush = () => void recorder.flush();
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  // Offer to resume a ride left unfinished by a closed tab.
  void (async () => {
    const active = await recorder.findActive();
    if (!active?.id) return;
    const id = active.id;
    resumePrompt.hidden = false;
    resumePrompt.append(
      el('span', {}, `You have an unfinished ride from ${formatDateTime(active.startedAt)}.`),
      el(
        'div',
        { className: 'row' },
        el('button', {
          className: 'primary',
          textContent: 'Resume it',
          onclick: async () => {
            const ride = await recorder.resume(id);
            const row = ride.routeId === undefined ? undefined : await getRoute(db, ride.routeId);
            if (row) {
              loadRoute(row);
              engine.setMode('route');
              mode = 'route';
            }
            if (ride.workoutId !== undefined && (await workoutPanel.selectById(ride.workoutId))) {
              engine.setMode('workout');
              mode = 'workout';
            }
            engine.setDistance(recorder.distance);
            renderControls();
            resumePrompt.hidden = true;
            syncButtons();
          },
        }),
        el('button', {
          textContent: 'Save and finish it',
          onclick: async () => {
            await recorder.resume(id);
            await recorder.finish();
            resumePrompt.replaceChildren(el('span', {}, 'Saved. You can find it in History.'));
            syncButtons();
          },
        }),
      ),
    );
  })();

  return {
    nudge,
    onShow: () => void workoutPanel.refresh(),
    resetCommands: () => {
      engine.policy.reset();
      lastErg = null;
    },
  };
}
