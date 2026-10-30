export interface WorkoutStep {
  /** How long to hold this effort, in seconds. */
  seconds: number;
  /** Effort from 0.0 to 1.0; what watts that means is up to the rider's calibration. */
  effort: number;
}

export const MAX_STEPS = 2000;
export const MAX_TOTAL_SECONDS = 12 * 3600;

const isNumber = (s: string) => s.trim() !== '' && Number.isFinite(Number(s));

/**
 * Parse a workout CSV: one step per line, `seconds,effort`. Blank lines and `#` comments are
 * ignored, as is a single header line such as `seconds,effort`. Comma, semicolon and tab all work
 * as separators. Throws an Error naming the line number for the first problem found.
 */
export function parseWorkoutCsv(text: string): WorkoutStep[] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip a byte-order mark
  const lines = body.split(/\r\n|\r|\n/);
  const steps: WorkoutStep[] = [];
  let sawData = false;

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const n = i + 1;
    const cells = line.split(/[,;\t]/).map((c) => c.trim());
    while (cells.length > 2 && cells[cells.length - 1] === '') cells.pop(); // trailing separator
    if (cells.length !== 2) {
      throw new Error(`Line ${n}: expected 2 columns (seconds, effort) but found ${cells.length}`);
    }
    const [secText, effortText] = cells;

    // A header row is only allowed as the first data line, and only if neither cell is a number.
    if (!sawData && !isNumber(secText) && !isNumber(effortText)) {
      sawData = true;
      return;
    }
    sawData = true;

    if (!isNumber(secText)) throw new Error(`Line ${n}: "${secText}" is not a number of seconds`);
    if (!isNumber(effortText))
      throw new Error(`Line ${n}: "${effortText}" is not an effort between 0.0 and 1.0`);
    const seconds = Number(secText);
    const effort = Number(effortText);
    if (seconds <= 0) throw new Error(`Line ${n}: seconds must be greater than 0 (got ${secText})`);
    if (effort < 0 || effort > 1) {
      const hint =
        effort > 1 && effort <= 100 ? ' — use a decimal such as 0.75 rather than 75' : '';
      throw new Error(`Line ${n}: effort must be between 0.0 and 1.0 (got ${effortText})${hint}`);
    }
    steps.push({ seconds, effort });
  });

  if (steps.length === 0) throw new Error('The file has no workout steps');
  if (steps.length > MAX_STEPS)
    throw new Error(`Too many steps (${steps.length}); the limit is ${MAX_STEPS}`);
  if (steps.reduce((a, s) => a + s.seconds, 0) > MAX_TOTAL_SECONDS) {
    throw new Error('The workout is longer than 12 hours');
  }
  return steps;
}
