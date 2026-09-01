import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { type Client, Events, Status } from 'discord.js';
import { startGatewayWatchdog } from './GatewayWatchdog.js';

type Handler = (...args: unknown[]) => void;

// Mirrors the module-local thresholds in GatewayWatchdog.ts — not exported,
// so the test recomputes them from the spec rather than importing internals.
const CHECK_INTERVAL_MS = 60_000;
const STALE_THRESHOLD_MS = 15 * 60 * 1000;
const NOT_READY_THRESHOLD_MS = 5 * 60 * 1000;
const MIN_UPTIME_BEFORE_EXIT_MS = 30 * 60 * 1000;

interface Harness {
  client: Client;
  handlers: Map<string, Handler>;
  wsState: { status: Status };
  guildState: { size: number };
  logger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
}

function buildHarness(): Harness {
  const handlers = new Map<string, Handler>();
  const on = vi.fn((event: string, handler: Handler) => {
    handlers.set(event, handler);
  });
  const wsState = { status: Status.Ready };
  const guildState = { size: 1 };
  const client = {
    on,
    ws: wsState,
    guilds: { cache: guildState },
  } as unknown as Client;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { client, handlers, wsState, guildState, logger };
}

function emitRaw(handlers: Map<string, Handler>): void {
  const handler = handlers.get(Events.Raw);
  if (handler === undefined) {
    throw new Error('No handler registered for raw gateway event');
  }
  handler();
}

describe('startGatewayWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fires arm A (silent hang) past the stale threshold when guilds are present, and exits', () => {
    const { client, guildState, logger } = buildHarness();
    guildState.size = 1;
    const exit = vi.fn();
    startGatewayWatchdog(client, logger as unknown as Parameters<typeof startGatewayWatchdog>[1], {
      exit,
      uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
    });

    vi.advanceTimersByTime(STALE_THRESHOLD_MS + CHECK_INTERVAL_MS);

    // Exact payload shape — both clocks, not just the firing arm's. A silent
    // hang has never left Ready, so notReadyForMs must be null here; that
    // null-vs-number contrast is what distinguishes the two incident shapes
    // in the log.
    expect(logger.error).toHaveBeenCalledWith(
      {
        arm: 'silent-hang',
        staleForMs: STALE_THRESHOLD_MS + CHECK_INTERVAL_MS,
        notReadyForMs: null,
        wsStatus: Status.Ready,
        guildCount: 1,
        uptimeMs: MIN_UPTIME_BEFORE_EXIT_MS,
      },
      expect.stringContaining('wedged')
    );
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('does not fire arm A when guilds.cache.size is 0 (idle/reconnecting process)', () => {
    const { client, guildState, logger } = buildHarness();
    guildState.size = 0;
    const exit = vi.fn();
    startGatewayWatchdog(client, logger as unknown as Parameters<typeof startGatewayWatchdog>[1], {
      exit,
      uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
    });

    vi.advanceTimersByTime(STALE_THRESHOLD_MS + CHECK_INTERVAL_MS);

    expect(logger.error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it('resets the staleness clock on a raw gateway event, avoiding a false arm-A fire', () => {
    const { client, handlers, guildState, logger } = buildHarness();
    guildState.size = 1;
    const exit = vi.fn();
    startGatewayWatchdog(client, logger as unknown as Parameters<typeof startGatewayWatchdog>[1], {
      exit,
      uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
    });

    vi.advanceTimersByTime(STALE_THRESHOLD_MS - CHECK_INTERVAL_MS);
    expect(exit).not.toHaveBeenCalled();

    emitRaw(handlers);

    vi.advanceTimersByTime(STALE_THRESHOLD_MS - CHECK_INTERVAL_MS);
    expect(exit).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('fires arm B (never-ready hot loop) on continuous not-Ready even while raw events keep flowing', () => {
    const { client, handlers, wsState, guildState, logger } = buildHarness();
    wsState.status = Status.Reconnecting;
    guildState.size = 1;
    const exit = vi.fn();
    startGatewayWatchdog(client, logger as unknown as Parameters<typeof startGatewayWatchdog>[1], {
      exit,
      uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
    });

    const iterations = NOT_READY_THRESHOLD_MS / CHECK_INTERVAL_MS + 2;
    for (let i = 0; i < iterations; i++) {
      emitRaw(handlers);
      vi.advanceTimersByTime(CHECK_INTERVAL_MS);
    }

    // The hot-loop signature: notReadyForMs past its threshold WHILE
    // staleForMs sits at one tick, proving arm A could not have fired.
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        arm: 'never-ready',
        notReadyForMs: NOT_READY_THRESHOLD_MS + CHECK_INTERVAL_MS,
        staleForMs: CHECK_INTERVAL_MS,
        wsStatus: Status.Reconnecting,
        guildCount: 1,
        uptimeMs: MIN_UPTIME_BEFORE_EXIT_MS,
      }),
      expect.stringContaining('wedged')
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('resets arm B when ws.status recovers to Ready before the not-ready threshold', () => {
    const { client, wsState, guildState, logger } = buildHarness();
    wsState.status = Status.Reconnecting;
    guildState.size = 1;
    const exit = vi.fn();
    startGatewayWatchdog(client, logger as unknown as Parameters<typeof startGatewayWatchdog>[1], {
      exit,
      uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
    });

    vi.advanceTimersByTime(NOT_READY_THRESHOLD_MS - CHECK_INTERVAL_MS);
    expect(exit).not.toHaveBeenCalled();

    wsState.status = Status.Ready;
    vi.advanceTimersByTime(NOT_READY_THRESHOLD_MS + CHECK_INTERVAL_MS);

    expect(exit).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('defers the exit under the min-uptime gate, then exits once uptime crosses it with the wedge still present', () => {
    const { client, guildState, logger } = buildHarness();
    guildState.size = 1;
    const exit = vi.fn();
    let uptime = 0;
    startGatewayWatchdog(client, logger as unknown as Parameters<typeof startGatewayWatchdog>[1], {
      exit,
      uptimeMs: () => uptime,
    });

    vi.advanceTimersByTime(STALE_THRESHOLD_MS + CHECK_INTERVAL_MS);

    expect(exit).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ arm: 'silent-hang', minUptimeMs: MIN_UPTIME_BEFORE_EXIT_MS }),
      expect.stringContaining('deferred')
    );

    logger.error.mockClear();
    uptime = MIN_UPTIME_BEFORE_EXIT_MS;
    vi.advanceTimersByTime(CHECK_INTERVAL_MS);

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('stops all further ticks after stop() is called', () => {
    const { client, guildState, logger } = buildHarness();
    guildState.size = 1;
    const exit = vi.fn();
    const watchdog = startGatewayWatchdog(
      client,
      logger as unknown as Parameters<typeof startGatewayWatchdog>[1],
      {
        exit,
        uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
      }
    );

    watchdog.stop();
    vi.advanceTimersByTime(STALE_THRESHOLD_MS + CHECK_INTERVAL_MS * 2);

    expect(logger.error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

    // Safe to call more than once.
    expect(() => watchdog.stop()).not.toThrow();
  });

  it('reports a real notReadyForMs when arm A fires while ALSO not-Ready (both wedged)', () => {
    const { client, wsState, guildState, logger } = buildHarness();
    // Both wedged from the start: never Ready AND no raw events ever arrive.
    wsState.status = Status.Reconnecting;
    guildState.size = 1;
    const exit = vi.fn();
    startGatewayWatchdog(client, logger as unknown as Parameters<typeof startGatewayWatchdog>[1], {
      exit,
      uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
    });

    // Arm B crosses its threshold first, but `exit` is a mock so ticks
    // continue until arm A's longer threshold is crossed too.
    vi.advanceTimersByTime(STALE_THRESHOLD_MS + CHECK_INTERVAL_MS);

    // The point of the test: arm A's payload must carry the REAL not-Ready
    // age, not null. The readiness clock starts one tick after the staleness
    // clock (the first tick is what observes not-Ready), hence the offset.
    expect(logger.error).toHaveBeenCalledWith(
      {
        arm: 'silent-hang',
        staleForMs: STALE_THRESHOLD_MS + CHECK_INTERVAL_MS,
        notReadyForMs: STALE_THRESHOLD_MS,
        wsStatus: Status.Reconnecting,
        guildCount: 1,
        uptimeMs: MIN_UPTIME_BEFORE_EXIT_MS,
      },
      expect.stringContaining('wedged')
    );
  });

  // Pins the ORDERING specifically: readiness state must be maintained before
  // arm A runs, not inside arm B. The connection drops out of Ready on the
  // very tick arm A fires, so no earlier tick has stamped notReadySince — if
  // maintenance were skipped when arm A short-circuits arm B, the payload
  // would carry null (contract: "genuinely Ready") for a connection that is
  // demonstrably not Ready.
  it('stamps the not-Ready clock before arm A fires on the same tick, so the payload is never a false null', () => {
    const { client, wsState, guildState, logger } = buildHarness();
    guildState.size = 1;
    const exit = vi.fn();
    startGatewayWatchdog(client, logger as unknown as Parameters<typeof startGatewayWatchdog>[1], {
      exit,
      uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
    });

    // Ready the whole time the staleness clock runs out — one tick short of
    // arm A firing — so notReadySince is still null here.
    vi.advanceTimersByTime(STALE_THRESHOLD_MS);
    expect(logger.error).not.toHaveBeenCalled();

    // Now drop out of Ready. The next tick both stamps the clock AND fires arm A.
    wsState.status = Status.Reconnecting;
    vi.advanceTimersByTime(CHECK_INTERVAL_MS);

    expect(logger.error).toHaveBeenCalledWith(
      {
        arm: 'silent-hang',
        staleForMs: STALE_THRESHOLD_MS + CHECK_INTERVAL_MS,
        notReadyForMs: 0,
        wsStatus: Status.Reconnecting,
        guildCount: 1,
        uptimeMs: MIN_UPTIME_BEFORE_EXIT_MS,
      },
      expect.stringContaining('wedged')
    );
  });
});
