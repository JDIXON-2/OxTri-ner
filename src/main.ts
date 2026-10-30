import './style.css';
import { GradePolicy } from './ride/gradePolicy';
import { RideEngine } from './sim/rideEngine';
import { Recorder } from './ride/recorder';
import { DEFAULT_SETTINGS, getSetting, OxDb, setSetting } from './storage/db';
import { readDevPrefs, safeLocalStorage } from './devMode';
import { checkSupport } from './support';
import { SimulatedTrainer } from './trainer/SimulatedTrainer';
import type { Trainer } from './trainer/Trainer';
import { WebBluetoothTrainer } from './trainer/WebBluetoothTrainer';
import { mountDashboard } from './ui/dashboard';
import { mountDebug } from './ui/debug';
import { mountHistory } from './ui/historyView';
import { mountMap } from './ui/mapView';
import { mountRoutes } from './ui/routesView';
import { mountSettings } from './ui/settingsView';
import { setUnits, type Units } from './ui/units';
import { el } from './ui/dom';
import { statusLabel } from './ui/status';

// The simulated trainer, the Debug tab and auto-connect only exist once "Debug mode" has been
// switched on in Settings. Otherwise this is a plain Bluetooth app.
const dev = readDevPrefs(safeLocalStorage(), location.search);
const useSim = dev.useSim;

const app = document.getElementById('app')!;
const support = checkSupport(window);

if (!useSim && !support.ok) {
  const simulatorHint = dev.debug
    ? '<p>Debug mode is on, so you can still try the app with a simulated trainer: <a href="?sim=1">open the simulator</a>.</p>'
    : '';
  app.innerHTML = `<div class="unsupported card"><h1>This browser can't connect to a trainer</h1><p>${support.reason}</p>${simulatorHint}</div>`;
} else {
  void start();
}

async function start() {
  const trainer: Trainer = useSim ? new SimulatedTrainer() : new WebBluetoothTrainer();
  const db = new OxDb();
  // Ask the browser not to evict our data; Settings will show the result later.
  if (!(await navigator.storage?.persisted?.())) await navigator.storage?.persist?.();

  setUnits(await getSetting<Units>(db, 'units', 'metric'));
  const D = DEFAULT_SETTINGS;
  const [ftp, minGrade, maxGrade, difficulty, mass, eta, crr, cdA, rho] = await Promise.all([
    getSetting(db, 'ftp', D.ftp),
    getSetting(db, 'gradeMin', D.gradeMin),
    getSetting(db, 'gradeMax', D.gradeMax),
    getSetting(db, 'difficulty', D.difficulty),
    getSetting(db, 'mass', D.mass),
    getSetting(db, 'eta', D.eta),
    getSetting(db, 'crr', D.crr),
    getSetting(db, 'cdA', D.cdA),
    getSetting(db, 'rho', D.rho),
  ]);
  const engine = new RideEngine(
    { mass, eta, crr, cdA, rho },
    new GradePolicy({ minGrade, maxGrade, difficulty }),
  );

  trainer.onStatus((st) => {
    if (st === 'controlling' && trainer.info.deviceName)
      void setSetting(db, 'lastDevice', trainer.info.deviceName);
  });

  const views: Record<string, HTMLElement> = {
    Ride: el('section'),
    Map: el('section', { hidden: true }),
    Routes: el('section', { hidden: true }),
    History: el('section', { hidden: true }),
    Settings: el('section', { hidden: true }),
    // The Debug tab only exists in debug mode.
    ...(dev.debug ? { Debug: el('section', { hidden: true }) } : {}),
  };
  const nav = el('nav', { className: 'tabs' });
  const tabButtons = new Map<string, HTMLButtonElement>();
  function showTab(name: string) {
    for (const [n, v] of Object.entries(views)) v.hidden = n !== name;
    for (const [n, b] of tabButtons) b.classList.toggle('active', n === name);
    if (name === 'History') void history.refresh();
    if (name === 'Map') mapView.onShow();
    if (name === 'Ride') dashboard.onShow();
  }
  for (const name of Object.keys(views)) {
    const button = el('button', {
      textContent: name,
      className: name === 'Ride' ? 'active' : '',
      onclick: () => showTab(name),
    });
    tabButtons.set(name, button);
    nav.append(button);
  }
  // Connection status stays visible on every tab.
  const pill = el('span', { className: 'pill' });
  const showStatus = () => {
    pill.textContent = statusLabel(trainer.status);
    pill.dataset.status = trainer.status;
  };
  showStatus();
  trainer.onStatus(showStatus);
  const header = el(
    'header',
    { className: 'app-header' },
    el('div', { className: 'brand-row' }, el('div', { className: 'brand' }, 'OxTri-ner'), pill),
    nav,
  );
  app.replaceChildren(header, ...Object.values(views));

  const mapView = mountMap(views.Map, db);
  const recorder = new Recorder(db, ftp);
  const dashboard = mountDashboard(views.Ride, {
    trainer,
    recorder,
    engine,
    db,
    onRideState: mapView.update,
    openSettings: () => showTab('Settings'),
  });
  mountRoutes(views.Routes, db);
  const history = mountHistory(views.History, db);
  await mountSettings(views.Settings, db, trainer, dev, {
    isRideActive: () => recorder.state !== 'idle',
    onTrainerTouched: () => dashboard.resetCommands(),
  });
  if (dev.debug) mountDebug(views.Debug, trainer, useSim);

  // Debug mode only: bring the simulated trainer up without pressing Connect. (A real Bluetooth
  // trainer can't do this; the browser requires a button press to open the device picker.)
  if (dev.debug && useSim && dev.autoConnectSim) void trainer.connect();
}

// Offline support. Skipped in dev so the service worker never serves stale modules.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
