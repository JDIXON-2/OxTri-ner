import type { Trainer, TrainerSample } from '../trainer/Trainer';
import { el } from './dom';
import { SimulatedTrainer } from '../trainer/SimulatedTrainer';

/** Debug page: live decoded samples, manual commands, and a Control Point log. */
export function mountDebug(root: HTMLElement, trainer: Trainer, useSim = false) {
  const sim = trainer instanceof SimulatedTrainer ? trainer : null;

  const status = el('span', { className: 'pill', textContent: trainer.status });
  const connect = el('button', { textContent: 'Connect' });
  const disconnect = el('button', { textContent: 'Disconnect' });
  const banner = el('div', {
    className: 'banner',
    hidden: true,
    textContent: 'Connection lost — reconnecting…',
  });
  const live = el('pre', { className: 'live', textContent: 'No data yet' });
  const info = el('pre', { className: 'info' });
  const log = el('pre', { className: 'log' });
  const logWrap = el('details', { open: true }, el('summary', {}, 'Debug log'), log);

  const number = (value: number, step = 1) =>
    el('input', { type: 'number', value: String(value), step: String(step) });
  const grade = number(0, 0.1);
  const watts = number(150, 5);
  const resistance = number(10, 0.1);
  const run = (fn: () => Promise<void>) => () =>
    fn().catch((e) => append('error', (e as Error).message));
  const controls = el(
    'div',
    { className: 'row' },
    el('label', {}, 'Grade %', grade),
    el('button', { textContent: 'Set grade', onclick: run(() => trainer.setGrade(+grade.value)) }),
    el('label', {}, 'ERG W', watts),
    el('button', {
      textContent: 'Set power',
      onclick: run(() => trainer.setTargetPower(+watts.value)),
    }),
    el('label', {}, 'Resistance', resistance),
    el('button', {
      textContent: 'Set resistance',
      onclick: run(() => trainer.setResistance(+resistance.value)),
    }),
  );

  const simToggle = el('input', { type: 'checkbox', checked: useSim });
  simToggle.onchange = () => {
    try {
      localStorage.setItem('useSim', simToggle.checked ? '1' : '0');
    } catch {
      /* storage unavailable; the ?sim= query param still works */
    }
    const url = new URL(location.href);
    url.searchParams.delete('sim');
    location.href = url.toString();
  };

  root.replaceChildren(
    el('h1', {}, 'OxTri-ner — trainer debug'),
    el(
      'p',
      { className: 'hint' },
      'Disconnect Zwift, the Saris app and phones before connecting: only one app can control the trainer.',
    ),
    el(
      'div',
      { className: 'row' },
      connect,
      disconnect,
      status,
      el('label', {}, simToggle, ' Simulated trainer'),
    ),
    banner,
    live,
    controls,
    info,
    logWrap,
  );

  if (sim) {
    const slider = el('input', { type: 'range', min: '0', max: '600', value: '150' });
    const label = el('span', {}, '150 W');
    slider.oninput = () => {
      sim.riderPower = () => +slider.value;
      label.textContent = `${slider.value} W`;
    };
    root.append(
      el(
        'div',
        { className: 'row' },
        'Sim power',
        slider,
        label,
        el('button', { textContent: 'Simulate dropout', onclick: () => sim.simulateDisconnect() }),
      ),
    );
  }

  function append(dir: string, text: string) {
    const time = new Date().toLocaleTimeString();
    log.textContent += `${time} ${dir.padEnd(5)} ${text}\n`;
    log.scrollTop = log.scrollHeight;
  }

  connect.onclick = () => trainer.connect().catch(() => {});
  disconnect.onclick = () => void trainer.disconnect();
  trainer.onLog((e) => append(e.dir, e.text));
  trainer.onStatus((s) => {
    status.textContent = s;
    status.dataset.status = s;
    banner.hidden = s !== 'reconnecting';
    info.textContent = JSON.stringify(trainer.info, null, 2);
  });
  trainer.onSample((s: TrainerSample) => {
    const { t, ...fields } = s;
    live.textContent =
      `t=${t.toFixed(0)} ms\n` +
      Object.entries(fields)
        .map(([k, v]) => `${k.padEnd(18)} ${typeof v === 'number' ? +v.toFixed(2) : v}`)
        .join('\n');
  });
}
