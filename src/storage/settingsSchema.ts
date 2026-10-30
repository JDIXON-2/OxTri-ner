export interface SettingField {
  key: string;
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  /** One-line explanation shown under the input. */
  help?: string;
}

/** Numeric settings shown in the Settings view, with the ranges they are validated against. */
export const SETTING_FIELDS: SettingField[] = [
  {
    key: 'ftp',
    label: 'FTP',
    unit: 'W',
    min: 50,
    max: 600,
    step: 1,
    help: 'Used for intensity factor (IF) and TSS.',
  },
  {
    key: 'mass',
    label: 'Rider + bike mass',
    unit: 'kg',
    min: 30,
    max: 200,
    step: 0.5,
    help: 'Rider plus bike. Heavier means slower climbing.',
  },
  {
    key: 'cdA',
    label: 'CdA',
    unit: 'm²',
    min: 0.1,
    max: 1,
    step: 0.01,
    help: 'Drag area. Lower is more aerodynamic; about 0.32 for hoods.',
  },
  {
    key: 'crr',
    label: 'Crr',
    min: 0.001,
    max: 0.02,
    step: 0.0005,
    help: 'Rolling resistance. 0.004 suits road tyres.',
  },
  {
    key: 'eta',
    label: 'Drivetrain efficiency',
    min: 0.8,
    max: 1,
    step: 0.01,
    help: 'Share of your power that reaches the wheel.',
  },
  {
    key: 'rho',
    label: 'Air density',
    unit: 'kg/m³',
    min: 0.8,
    max: 1.4,
    step: 0.005,
    help: 'Thinner air (altitude, heat) is faster. 1.225 is sea level.',
  },
  {
    key: 'difficulty',
    label: 'Trainer difficulty',
    unit: '%',
    min: 0,
    max: 100,
    step: 5,
    help: 'Scales the grade sent to the trainer. 100 % is full feel; the route and speed always use the true grade.',
  },
  {
    key: 'smoothingWindow',
    label: 'Route smoothing window',
    unit: 'm',
    min: 10,
    max: 300,
    step: 10,
  },
  {
    key: 'gradeMin',
    label: 'Minimum grade sent',
    unit: '%',
    min: -25,
    max: 0,
    step: 1,
    help: "Steepest descent sent to the trainer. The H3 can't drive the pedals, so descents just feel light.",
  },
  {
    key: 'gradeMax',
    label: 'Maximum grade sent',
    unit: '%',
    min: 0,
    max: 25,
    step: 1,
    help: 'Steepest climb sent to the trainer.',
  },
];

/** Returns the parsed number, or an error message. */
export function validateSetting(
  field: SettingField,
  raw: string,
): { value: number } | { error: string } {
  const value = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(value))
    return { error: `${field.label}: enter a number` };
  if (value < field.min || value > field.max) {
    return { error: `${field.label}: must be between ${field.min} and ${field.max}` };
  }
  return { value };
}
