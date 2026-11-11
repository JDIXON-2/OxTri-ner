import { DEFAULT_REMOTE, type RemoteController, type Slot } from '../remote/controller';
import { buttonLabel } from '../remote/gamepad';
import { saveRemoteSettings } from '../storage/remote';
import type { OxDb } from '../storage/db';
import { el } from './dom';

const SLOT_NAMES: Record<Slot, string> = { up: 'Increase (+)', down: 'Decrease (−)' };

/** Settings card for a Bluetooth game controller (e.g. a PS4 pad) that steps grade / ERG power. */
export function createRemoteCard(db: OxDb, remote: RemoteController): HTMLElement {
  const persist = () => void saveRemoteSettings(db, remote.settings);

  const status = el('div', { className: 'remote-status' });
  const lastButton = el('div', { className: 'muted' }, 'Last button pressed: none yet');
  const note = el('div', { className: 'banner warn', hidden: true });

  remote.onPads((summary) => {
    status.className = summary ? 'remote-status ok' : 'remote-status';
    status.textContent = summary
      ? `Controller connected: ${summary}`
      : 'No controller detected. Pair it in your device’s Bluetooth settings, then press any button on it while this page is open.';
  });
  remote.onButton((b) => (lastButton.textContent = `Last button pressed: ${b.label}`));

  const enabled = el('input', { type: 'checkbox', checked: remote.settings.enabled });
  enabled.onchange = () => {
    remote.settings.enabled = enabled.checked;
    persist();
  };

  const rows = el('div', { className: 'cal-table' });
  function renderRows() {
    rows.replaceChildren(
      ...(['up', 'down'] as const).map((slot) => {
        const assigned = remote.settings[slot];
        const learnBtn = el('button', { className: 'ghost', textContent: 'Learn' });
        learnBtn.onclick = async () => {
          note.hidden = true;
          learnBtn.textContent = 'Press a button…';
          learnBtn.disabled = true;
          const button = await remote.learn(slot);
          const other = slot === 'up' ? remote.settings.down : remote.settings.up;
          if (button === null) {
            note.hidden = false;
            note.textContent = 'No button was pressed, so nothing changed.';
          } else if (button === other) {
            note.hidden = false;
            note.textContent = `${buttonLabel(button)} is already used for ${SLOT_NAMES[slot === 'up' ? 'down' : 'up']}. Pick a different button.`;
          } else {
            remote.settings[slot] = button;
            persist();
          }
          renderRows();
        };
        const reset = el('button', {
          className: 'ghost',
          textContent: 'Reset',
          title: 'Back to the D-pad',
          onclick: () => {
            remote.settings[slot] = DEFAULT_REMOTE[slot];
            persist();
            note.hidden = true;
            renderRows();
          },
        });
        return el(
          'div',
          { className: 'cal-row remote-row' },
          el('span', { className: 'cal-level' }, SLOT_NAMES[slot]),
          el(
            'span',
            { className: 'cal-watts' },
            assigned === null ? 'Not set' : buttonLabel(assigned),
          ),
          el('span', { className: 'row' }, learnBtn, reset),
        );
      }),
    );
  }
  renderRows();

  return el(
    'section',
    { className: 'card' },
    el('h3', {}, 'Controller'),
    el(
      'p',
      {},
      'Use a Bluetooth game controller, such as a PS4 pad, to change the grade (free ride and workouts) or target power (ERG) without touching the screen.',
    ),
    el(
      'p',
      { className: 'hint' },
      'Pair it in your device’s Bluetooth settings first (on a PS4 pad, hold PS and Share together until the light bar flashes). The browser can’t pair it for you. Works in Chrome and Edge on desktop and Android, with this page open in front. Each press changes the grade by 0.5 % or the target by 5 W; holding the button repeats. Route rides are not affected.',
    ),
    status,
    el('label', { className: 'check' }, enabled, el('span', {}, 'Use the controller')),
    rows,
    note,
    lastButton,
  );
}
