import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './db';
import { SETTING_FIELDS, validateSetting } from './settingsSchema';

it('accepts every default value', () => {
  for (const f of SETTING_FIELDS) {
    expect(
      validateSetting(f, String(DEFAULT_SETTINGS[f.key as keyof typeof DEFAULT_SETTINGS])),
    ).toHaveProperty('value');
  }
});

it('rejects blanks, non-numbers and out-of-range values', () => {
  const ftp = SETTING_FIELDS.find((f) => f.key === 'ftp')!;
  expect(validateSetting(ftp, '')).toHaveProperty('error');
  expect(validateSetting(ftp, 'abc')).toHaveProperty('error');
  expect(validateSetting(ftp, '5')).toHaveProperty('error');
  expect(validateSetting(ftp, '999')).toHaveProperty('error');
  expect(validateSetting(ftp, '280')).toEqual({ value: 280 });
});
