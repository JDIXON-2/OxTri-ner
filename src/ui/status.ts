import type { TrainerStatus } from '../trainer/Trainer';

const LABELS: Record<TrainerStatus, string> = {
  disconnected: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  controlling: 'Ready',
  reconnecting: 'Reconnecting…',
};

export const statusLabel = (s: TrainerStatus): string => LABELS[s];
