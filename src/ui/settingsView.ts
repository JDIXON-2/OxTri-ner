import { createBackup, restoreBackup } from '../storage/backup';
import { DEFAULT_SETTINGS, getSetting, setSetting, type OxDb } from '../storage/db';
import { SETTING_FIELDS, validateSetting } from '../storage/settingsSchema';
import type { Trainer } from '../trainer/Trainer';
import type { RemoteController } from '../remote/controller';
import { createCalibrationCard, type CalibrationOptions } from './calibrationView';
import { createRemoteCard } from './remoteCard';
import { downloadText } from './download';
import { confirmButton, el } from './dom';
import { safeLocalStorage, writeDevPrefs, type DevPrefs } from '../devMode';
import type { Units } from './units';

/** Settings view: rider/physics parameters, calibration, units, trainer info, storage, backup, developer options. */
export async function mountSettings(
  root: HTMLElement,
  db: OxDb,
  trainer: Trainer,
  dev: DevPrefs,
  remote: RemoteController,
  calibration: CalibrationOptions = {},
) {
  // --- parameters ---
  const inputs = new Map<string, HTMLInputElement>();
  const form = el('div', { className: 'settings-grid' });
  for (const f of SETTING_FIELDS) {
    const value = await getSetting<number>(
      db,
      f.key,
      DEFAULT_SETTINGS[f.key as keyof typeof DEFAULT_SETTINGS],
    );
    const input = el('input', {
      type: 'number',
      value: String(value),
      min: String(f.min),
      max: String(f.max),
      step: String(f.step),
      inputMode: 'decimal',
    });
    inputs.set(f.key, input);
    form.append(
      el(
        'label',
        { className: 'field' },
        el(
          'span',
          { className: 'field-label' },
          f.label,
          f.unit ? el('span', { className: 'unit' }, ` ${f.unit}`) : '',
        ),
        input,
        f.help ? el('span', { className: 'help' }, f.help) : '',
      ),
    );
  }

  const units = el(
    'select',
    {},
    el('option', { value: 'metric', textContent: 'Metric (km, km/h, m)' }),
    el('option', { value: 'imperial', textContent: 'Imperial (mi, mph, ft)' }),
  );
  units.value = await getSetting<Units>(db, 'units', 'metric');
  const saveStatus = el('div', { className: 'banner err', hidden: true });

  const save = el('button', {
    className: 'primary big',
    textContent: 'Save and reload',
    onclick: async () => {
      const fail = (msg: string) => {
        saveStatus.hidden = false;
        saveStatus.textContent = msg;
      };
      const writes: [string, number | string][] = [];
      for (const f of SETTING_FIELDS) {
        const r = validateSetting(f, inputs.get(f.key)!.value);
        if ('error' in r) return fail(r.error);
        writes.push([f.key, r.value]);
      }
      if (Number(inputs.get('gradeMin')!.value) >= Number(inputs.get('gradeMax')!.value)) {
        return fail('Minimum grade must be below maximum grade');
      }
      writes.push(['units', units.value]);
      for (const [k, v] of writes) await setSetting(db, k, v);
      const url = new URL(location.href);
      url.searchParams.delete('sim');
      location.href = url.toString();
    },
  });

  // --- trainer info ---
  const lastDevice = await getSetting<string | null>(db, 'lastDevice', null);
  const info = el('pre', { className: 'info' });
  const renderInfo = () => {
    const i = trainer.info;
    const f = i.feature;
    const yn = (v?: boolean) =>
      f ? (v ? 'supported' : 'not supported') : 'unknown until connected';
    const range = (r?: { min: number; max: number; step: number }) =>
      r ? `${r.min} – ${r.max} (step ${r.step})` : 'unknown';
    info.textContent = [
      `Device:               ${i.deviceName ?? lastDevice ?? 'none yet'}${i.deviceName ? '' : lastDevice ? ' (last used)' : ''}`,
      `Status:               ${trainer.status}`,
      `Resistance target:    ${yn(f?.resistanceTarget)}`,
      `Power target (ERG):   ${yn(f?.powerTarget)}`,
      `Simulation params:    ${yn(f?.simulation)}`,
      `Power range (W):      ${range(i.powerRange)}`,
      `Resistance range:     ${range(i.resistanceRange)}`,
    ].join('\n');
  };
  renderInfo();
  trainer.onStatus(renderInfo);

  // --- storage + backup ---
  const persisted = el('span', { textContent: 'checking…' });
  async function checkPersisted() {
    const p = await navigator.storage?.persisted?.();
    persisted.textContent =
      p === undefined
        ? 'unknown'
        : p
          ? 'Yes — the browser will not clear your data.'
          : 'No — the browser may clear your data if the device runs low on space. Download a backup now and then.';
  }
  const restoreBox = el('div');
  const restoreStatus = el('div', { className: 'hint' });
  const file = el('input', { type: 'file', accept: 'application/json,.json' });
  file.onchange = () => {
    const f = file.files?.[0];
    if (!f) return;
    restoreBox.replaceChildren(
      el(
        'div',
        { className: 'banner warn' },
        el('span', {}, `Restoring “${f.name}” replaces ALL current rides, routes and settings.`),
        el(
          'div',
          { className: 'row' },
          confirmButton(
            'Replace everything',
            async () => {
              try {
                const b = await restoreBackup(db, await f.text());
                restoreStatus.textContent = `Restored ${b.tables.rides.length} rides and ${b.tables.routes.length} routes. Reloading…`;
                setTimeout(() => location.reload(), 800);
              } catch (e) {
                restoreStatus.textContent = `Restore failed: ${(e as Error).message}`;
              }
              restoreBox.replaceChildren();
              file.value = '';
            },
            { confirmLabel: 'Tap again — this cannot be undone' },
          ),
          el('button', {
            className: 'ghost',
            textContent: 'Cancel',
            onclick: () => {
              restoreBox.replaceChildren();
              file.value = '';
            },
          }),
        ),
      ),
    );
  };

  const card = (title: string, ...kids: (Node | string)[]) =>
    el('section', { className: 'card' }, el('h3', {}, title), ...kids);

  // --- developer options: everything simulator-related is behind the debug switch ---
  const applyDev = (next: DevPrefs) => {
    writeDevPrefs(safeLocalStorage(), next);
    const url = new URL(location.href);
    url.searchParams.delete('sim'); // a leftover ?sim= must not undo what was just chosen
    location.href = url.toString();
  };
  const checkbox = (checked: boolean, text: string, onchange: (on: boolean) => void) => {
    const box = el('input', { type: 'checkbox', checked });
    box.onchange = () => onchange(box.checked);
    return el('label', { className: 'check' }, box, el('span', {}, text));
  };
  const developer = card(
    'Developer',
    el(
      'p',
      { className: 'hint' },
      'Debug mode adds a Debug tab and lets you use a simulated trainer instead of Bluetooth. Leave it off for normal riding.',
    ),
    checkbox(dev.debug, 'Debug mode', (on) =>
      // Turning it on for the first time starts with the simulator and auto-connect on.
      applyDev({
        debug: on,
        useSim: dev.debug ? dev.useSim : true,
        autoConnectSim: dev.debug ? dev.autoConnectSim : true,
      }),
    ),
    dev.debug
      ? checkbox(dev.useSim, 'Use the simulated trainer (no Bluetooth needed)', (on) =>
          applyDev({ ...dev, useSim: on }),
        )
      : '',
    dev.debug
      ? checkbox(
          dev.autoConnectSim,
          'Connect the simulated trainer automatically when the app loads',
          (on) => applyDev({ ...dev, autoConnectSim: on }),
        )
      : '',
  );

  root.append(
    el('h2', {}, 'Settings'),
    card('Rider and physics', form),
    await createCalibrationCard(db, trainer, calibration),
    card(
      'Display',
      el('label', { className: 'field' }, el('span', { className: 'field-label' }, 'Units'), units),
    ),
    el('div', { className: 'savebar' }, save),
    saveStatus,
    createRemoteCard(db, remote),
    card('Trainer info', info),
    card(
      'Storage',
      el('p', {}, 'Persistent storage: ', persisted),
      el('button', {
        textContent: 'Request persistent storage',
        onclick: async () => {
          await navigator.storage?.persist?.();
          await checkPersisted();
        },
      }),
    ),
    card(
      'Backup',
      el(
        'p',
        { className: 'hint' },
        'Everything is stored in this browser only. A backup file includes all rides, routes and settings.',
      ),
      el(
        'div',
        { className: 'row' },
        el('button', {
          className: 'primary',
          textContent: 'Download full backup (JSON)',
          onclick: async () => {
            const b = await createBackup(db);
            downloadText(
              `oxtri-backup-${b.exportedAt.slice(0, 10)}.json`,
              JSON.stringify(b),
              'application/json',
            );
          },
        }),
      ),
      el('p', {}, 'Restore from a backup file: ', file),
      restoreBox,
      restoreStatus,
    ),
    developer,
  );
  void checkPersisted();
}
