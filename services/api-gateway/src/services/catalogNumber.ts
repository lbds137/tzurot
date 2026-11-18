/** A catalog number string: optional sign, decimal digits, optional fraction and exponent. */
const DECIMAL_NUMBER_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;

/**
 * The single parser for catalog numbers. Passes: finite numbers, and strings
 * whose trim is a decimal or exponent form (`"0.1"`, `"+.5"`, `"1."`, `"1E-6"`)
 * with a finite value. Does not pass (`undefined`): blank or whitespace-only
 * strings, trailing text (`"0.1abc"`, which `parseFloat` would read as 0.1),
 * hex, binary and octal strings (`"0x1"`, `"0b11"`, `"0o7"`), and non-finite
 * values.
 */
export function parseFiniteNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!DECIMAL_NUMBER_PATTERN.test(trimmed)) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}
