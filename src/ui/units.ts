export type Units = 'metric' | 'imperial';

const KM_PER_MI = 1.609344;
const FT_PER_M = 3.280839895;

let current: Units = 'metric';

/** Display units for the whole UI; stored data is always metric. */
export function setUnits(u: Units): void {
  current = u;
}
export function getUnits(): Units {
  return current;
}

export const distanceUnit = (u: Units = current) => (u === 'metric' ? 'km' : 'mi');
export const speedUnit = (u: Units = current) => (u === 'metric' ? 'km/h' : 'mph');
export const elevationUnit = (u: Units = current) => (u === 'metric' ? 'm' : 'ft');

export const metersToDistance = (m: number, u: Units = current) =>
  u === 'metric' ? m / 1000 : m / 1000 / KM_PER_MI;
export const kmhToSpeed = (kmh: number, u: Units = current) =>
  u === 'metric' ? kmh : kmh / KM_PER_MI;
export const metersToElevation = (m: number, u: Units = current) =>
  u === 'metric' ? m : m * FT_PER_M;

/** Number only, e.g. "12.35". */
export const distanceValue = (m: number, u: Units = current) => metersToDistance(m, u).toFixed(2);
export const speedValue = (kmh: number, u: Units = current) => kmhToSpeed(kmh, u).toFixed(1);

/** With unit, e.g. "12.35 km" or "340 ft". */
export const distanceText = (m: number, u: Units = current) =>
  `${distanceValue(m, u)} ${distanceUnit(u)}`;
export const elevationText = (m: number, u: Units = current) =>
  `${Math.round(metersToElevation(m, u))} ${elevationUnit(u)}`;
