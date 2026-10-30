export interface Support {
  ok: boolean;
  reason?: string;
}

export function checkSupport(w: {
  isSecureContext?: boolean;
  navigator?: { bluetooth?: unknown };
}): Support {
  if (!w.navigator?.bluetooth) {
    return {
      ok: false,
      reason:
        'Web Bluetooth is not available. Use Chrome, Edge or Opera on desktop or Android (Firefox, Safari and iOS browsers are not supported).',
    };
  }
  if (w.isSecureContext === false) {
    return { ok: false, reason: 'Web Bluetooth requires HTTPS or localhost.' };
  }
  return { ok: true };
}
