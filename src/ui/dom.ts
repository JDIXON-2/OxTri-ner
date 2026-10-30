export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}

/**
 * A button that needs a second tap to go through: the first tap changes its label (and style) for
 * a few seconds. Avoids native confirm() dialogs, which are awkward on phones and in installed PWAs.
 */
export function confirmButton(
  label: string,
  onConfirm: () => void | Promise<void>,
  opts: { confirmLabel?: string; className?: string; timeoutMs?: number } = {},
): HTMLButtonElement {
  const { confirmLabel = 'Tap again to confirm', className = '', timeoutMs = 3000 } = opts;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const reset = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    btn.textContent = label;
    btn.classList.remove('danger');
  };
  const btn = el('button', {
    textContent: label,
    className,
    onclick: () => {
      if (timer === null) {
        btn.textContent = confirmLabel;
        btn.classList.add('danger');
        timer = setTimeout(reset, timeoutMs);
        return;
      }
      reset();
      void onConfirm();
    },
  });
  return btn;
}
