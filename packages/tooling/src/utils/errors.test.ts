import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UsageError, reportUsageError } from './errors.js';

describe('reportUsageError', () => {
  let originalExitCode: typeof process.exitCode;
  let err: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // `process.exitCode` is global state shared with the vitest run itself:
    // leaving it at 1 would make an all-green run exit nonzero.
    originalExitCode = process.exitCode;
    err = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = originalExitCode;
  });

  it('reports a UsageError: prints the message, sets exitCode, claims the error', () => {
    expect(reportUsageError(new UsageError('--limit must be an integer, got: "abc"'))).toBe(true);
    expect(err).toHaveBeenCalledWith('--limit must be an integer, got: "abc"');
    expect(process.exitCode).toBe(1);
  });

  it("reports cac's own CACError, which it throws for an unknown option", () => {
    // cac does not export the class, so the handler matches on `name` — this
    // stand-in reproduces exactly what the handler can observe.
    const cacError = new Error('Unknown option `--nope`');
    cacError.name = 'CACError';

    expect(reportUsageError(cacError)).toBe(true);
    expect(err).toHaveBeenCalledWith('Unknown option `--nope`');
    expect(process.exitCode).toBe(1);
  });

  it('leaves a plain Error alone so a genuine bug keeps its stack trace', () => {
    expect(reportUsageError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(err).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(originalExitCode);
  });

  it('leaves a subclass that is not a usage error alone', () => {
    class OperationalError extends Error {}
    const operational = new OperationalError('database unreachable');
    operational.name = 'OperationalError';

    expect(reportUsageError(operational)).toBe(false);
    expect(err).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(originalExitCode);
  });

  it('leaves a non-Error thrown value alone', () => {
    expect(reportUsageError('just a string')).toBe(false);
    expect(reportUsageError(undefined)).toBe(false);
    expect(reportUsageError({ name: 'CACError', message: 'not a real Error' })).toBe(false);
    expect(err).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(originalExitCode);
  });
});

describe('UsageError', () => {
  it('is an Error named UsageError, so it survives an instanceof check', () => {
    const error = new UsageError('--channel is required');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(UsageError);
    expect(error.name).toBe('UsageError');
    expect(error.message).toBe('--channel is required');
  });
});
