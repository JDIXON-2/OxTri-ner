export const SERVICE_FTMS = 0x1826;
export const CHAR_FEATURE = 0x2acc;
export const CHAR_INDOOR_BIKE_DATA = 0x2ad2;
export const CHAR_TRAINING_STATUS = 0x2ad3;
export const CHAR_RESISTANCE_RANGE = 0x2ad6;
export const CHAR_POWER_RANGE = 0x2ad8;
export const CHAR_CONTROL_POINT = 0x2ad9;
export const CHAR_MACHINE_STATUS = 0x2ada;
export const SERVICE_CYCLING_POWER = 0x1818;
export const SERVICE_DEVICE_INFO = 0x180a;

export const OP = {
  REQUEST_CONTROL: 0x00,
  RESET: 0x01,
  SET_TARGET_RESISTANCE: 0x04,
  SET_TARGET_POWER: 0x05,
  START: 0x07,
  STOP: 0x08,
  SET_SIM_PARAMS: 0x11,
  RESPONSE: 0x80,
} as const;

export const RESULT = {
  SUCCESS: 1,
  NOT_SUPPORTED: 2,
  INVALID_PARAMETER: 3,
  OPERATION_FAILED: 4,
  CONTROL_NOT_PERMITTED: 5,
} as const;

export const RESULT_NAMES: Record<number, string> = {
  1: 'success',
  2: 'op code not supported',
  3: 'invalid parameter',
  4: 'operation failed',
  5: 'control not permitted',
};
