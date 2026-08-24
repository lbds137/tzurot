import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted: createLogger runs at module scope when bootWatchdog.ts is
// evaluated, which happens before a plain `const` in this file would be
// initialized.
const { mockError } = vi.hoisted(() => ({ mockError: vi.fn() }));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: mockError }),
  };
});

import { armBootWatchdog } from './bootWatchdog.js';

describe('armBootWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits with code 1 and logs the last phase when the deadline is exceeded', () => {
    const exit = vi.fn();
    const watchdog = armBootWatchdog({ deadlineMs: 1000, exit });

    watchdog.notePhase('commands-deployed');
    vi.advanceTimersByTime(1001);

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({ lastPhase: 'commands-deployed', deadlineMs: 1000 }),
      expect.stringContaining('Boot deadline exceeded')
    );
  });

  it('logs the LAST noted phase at expiry, not the first (last-write-wins)', () => {
    const exit = vi.fn();
    const watchdog = armBootWatchdog({ deadlineMs: 1000, exit });

    watchdog.notePhase('commands-deployed');
    watchdog.notePhase('services-initialized');
    watchdog.notePhase('logged-in');
    vi.advanceTimersByTime(1001);

    expect(exit).toHaveBeenCalledWith(1);
    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({ lastPhase: 'logged-in' }),
      expect.any(String)
    );
  });

  it('logs lastPhase as "armed" when no phase was ever noted', () => {
    const exit = vi.fn();
    armBootWatchdog({ deadlineMs: 1000, exit });

    vi.advanceTimersByTime(1001);

    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({ lastPhase: 'armed' }),
      expect.any(String)
    );
  });

  it('does not exit or log when disarmed before the deadline', () => {
    const exit = vi.fn();
    const watchdog = armBootWatchdog({ deadlineMs: 1000, exit });

    watchdog.disarm();
    vi.advanceTimersByTime(1001);

    expect(exit).not.toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
  });

  it('does not exit on a normal boot that notes phases then disarms', () => {
    const exit = vi.fn();
    const watchdog = armBootWatchdog({ deadlineMs: 1000, exit });

    watchdog.notePhase('commands-deployed');
    watchdog.notePhase('commands-loaded');
    watchdog.notePhase('services-initialized');
    watchdog.disarm();
    vi.advanceTimersByTime(10_000);

    expect(exit).not.toHaveBeenCalled();
  });

  it('is a safe no-op to disarm after the deadline already fired', () => {
    const exit = vi.fn();
    const watchdog = armBootWatchdog({ deadlineMs: 1000, exit });

    vi.advanceTimersByTime(1001);
    expect(exit).toHaveBeenCalledTimes(1);

    expect(() => watchdog.disarm()).not.toThrow();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('does not fire before the default 5-minute deadline but does fire past it', () => {
    const exit = vi.fn();
    armBootWatchdog({ exit });

    vi.advanceTimersByTime(4 * 60 * 1000 + 59 * 1000);
    expect(exit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
