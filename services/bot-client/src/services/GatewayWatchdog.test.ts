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
const PROBE_GRACE_MS = 2 * 60 * 1000;
// Arm A's wedge no longer lands on the crossing tick: that tick fires the
// probe, and the verdict waits out the grace window.
const ARM_A_WEDGE_AT_MS = STALE_THRESHOLD_MS + CHECK_INTERVAL_MS + PROBE_GRACE_MS;

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
  fetchMock: ReturnType<typeof vi.fn>;
  memberFetchMock: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
}

function buildHarness(): Harness {
  const handlers = new Map<string, Handler>();
  const on = vi.fn((event: string, handler: Handler) => {
    handlers.set(event, handler);
  });
  const off = vi.fn((event: string, handler: Handler) => {
    if (handlers.get(event) === handler) {
      handlers.delete(event);
    }
  });
  const wsState = { status: Status.Ready };
  const guildState = { size: 1 };
  const memberFetchMock = vi.fn().mockResolvedValue(new Map());
  const mockGuild = { members: { fetch: memberFetchMock } };
  const client = {
    on,
    off,
    ws: wsState,
    guilds: {
      cache: {
        get size(): number {
          return guildState.size;
        },
        first: () => (guildState.size === 0 ? undefined : mockGuild),
      },
    },
  } as unknown as Client;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  return { client, handlers, wsState, guildState, logger, fetchMock, memberFetchMock, on, off };
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

  it('fires arm A (silent hang) past the stale threshold when guilds are present, and exits', async () => {
    const { client, guildState, logger, fetchMock } = buildHarness();
    guildState.size = 1;
    const exit = vi.fn();
    startGatewayWatchdog(client, logger as unknown as Parameters<typeof startGatewayWatchdog>[1], {
      exit,
      uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    await vi.advanceTimersByTimeAsync(ARM_A_WEDGE_AT_MS);

    // Exact payload shape — both clocks, not just the firing arm's. A silent
    // hang has never left Ready, so notReadyForMs must be null here; that
    // null-vs-number contrast is what distinguishes the two incident shapes
    // in the log.
    expect(logger.error).toHaveBeenCalledWith(
      {
        arm: 'silent-hang',
        staleForMs: ARM_A_WEDGE_AT_MS,
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

  it('T1 probe-at-crossing: fires the gateway liveness probe on the crossing tick rather than wedging immediately', async () => {
    const { client, guildState, logger, fetchMock, memberFetchMock } = buildHarness();
    guildState.size = 1;
    const exit = vi.fn();
    startGatewayWatchdog(client, logger as unknown as Parameters<typeof startGatewayWatchdog>[1], {
      exit,
      uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
      alertWebhookUrl: 'https://discord.com/api/webhooks/1/abc',
      fetchFn: fetchMock as unknown as typeof fetch,
    });

    await vi.advanceTimersByTimeAsync(STALE_THRESHOLD_MS + CHECK_INTERVAL_MS);

    expect(memberFetchMock).toHaveBeenCalledWith({ query: '', limit: 1, time: 30_000 });
    expect(exit).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('T2 one-probe-per-episode: further stale ticks inside the grace window do not re-probe', async () => {
    const { client, guildState, logger, memberFetchMock } = buildHarness();
    guildState.size = 1;
    const exit = vi.fn();
    startGatewayWatchdog(client, logger as unknown as Parameters<typeof startGatewayWatchdog>[1], {
      exit,
      uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
    });

    await vi.advanceTimersByTimeAsync(STALE_THRESHOLD_MS + CHECK_INTERVAL_MS);
    expect(memberFetchMock).toHaveBeenCalledTimes(1);

    // Still inside PROBE_GRACE_MS — no second probe.
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(memberFetchMock).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
  });

  it('T3 wedge-after-grace: staleness persisting through the probe grace window reaches the wedge path', async () => {
    const { client, guildState, logger } = buildHarness();
    guildState.size = 1;
    const exit = vi.fn();
    startGatewayWatchdog(client, logger as unknown as Parameters<typeof startGatewayWatchdog>[1], {
      exit,
      uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
    });

    await vi.advanceTimersByTimeAsync(ARM_A_WEDGE_AT_MS);

    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ arm: 'silent-hang', staleForMs: ARM_A_WEDGE_AT_MS }),
      expect.stringContaining('wedged')
    );
  });

  it('T4 recovery-and-rearm: a raw event after the probe resets the clock, and a later quiet spell probes again', async () => {
    const { client, handlers, guildState, logger, memberFetchMock } = buildHarness();
    guildState.size = 1;
    const exit = vi.fn();
    startGatewayWatchdog(client, logger as unknown as Parameters<typeof startGatewayWatchdog>[1], {
      exit,
      uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
    });

    // First quiet spell: crosses the threshold, fires the probe.
    await vi.advanceTimersByTimeAsync(STALE_THRESHOLD_MS + CHECK_INTERVAL_MS);
    expect(memberFetchMock).toHaveBeenCalledTimes(1);

    // A raw gateway event (the healthy GUILD_MEMBERS_CHUNK response, or any
    // other dispatch) resets the clock through the existing raw listener —
    // no wedge, and the probe episode ends.
    emitRaw(handlers);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(exit).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();

    // A second, distinct quiet spell fires its OWN probe — proving
    // probeStartedAt was reset by updateReadinessState on recovery.
    await vi.advanceTimersByTimeAsync(STALE_THRESHOLD_MS + CHECK_INTERVAL_MS);
    expect(memberFetchMock).toHaveBeenCalledTimes(2);
  });

  it('T5 probe-rejection-is-survivable: a rejected probe fetch does not crash the tick, and the wedge still fires after grace', async () => {
    const { client, guildState, logger, memberFetchMock } = buildHarness();
    guildState.size = 1;
    memberFetchMock.mockRejectedValue(new Error('gateway members timeout'));
    const exit = vi.fn();
    startGatewayWatchdog(client, logger as unknown as Parameters<typeof startGatewayWatchdog>[1], {
      exit,
      uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
    });

    await vi.advanceTimersByTimeAsync(ARM_A_WEDGE_AT_MS);

    expect(logger.error).not.toHaveBeenCalledWith(
      { err: expect.any(Error) },
      expect.stringContaining('tick failed unexpectedly')
    );
    expect(logger.warn).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      expect.stringContaining('probe')
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('does not fire arm A when guilds.cache.size is 0 (idle/reconnecting process)', async () => {
    const { client, guildState, logger } = buildHarness();
    guildState.size = 0;
    const exit = vi.fn();
    startGatewayWatchdog(client, logger as unknown as Parameters<typeof startGatewayWatchdog>[1], {
      exit,
      uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
    });

    await vi.advanceTimersByTimeAsync(STALE_THRESHOLD_MS + CHECK_INTERVAL_MS);

    expect(logger.error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it('resets the staleness clock on a raw gateway event, avoiding a false arm-A fire', async () => {
    const { client, handlers, guildState, logger } = buildHarness();
    guildState.size = 1;
    const exit = vi.fn();
    startGatewayWatchdog(client, logger as unknown as Parameters<typeof startGatewayWatchdog>[1], {
      exit,
      uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
    });

    await vi.advanceTimersByTimeAsync(STALE_THRESHOLD_MS - CHECK_INTERVAL_MS);
    expect(exit).not.toHaveBeenCalled();

    emitRaw(handlers);

    await vi.advanceTimersByTimeAsync(STALE_THRESHOLD_MS - CHECK_INTERVAL_MS);
    expect(exit).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('fires arm B (never-ready hot loop) on continuous not-Ready even while raw events keep flowing', async () => {
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
      await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
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

  it('resets arm B when ws.status recovers to Ready before the not-ready threshold', async () => {
    const { client, wsState, guildState, logger } = buildHarness();
    wsState.status = Status.Reconnecting;
    guildState.size = 1;
    const exit = vi.fn();
    startGatewayWatchdog(client, logger as unknown as Parameters<typeof startGatewayWatchdog>[1], {
      exit,
      uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
    });

    await vi.advanceTimersByTimeAsync(NOT_READY_THRESHOLD_MS - CHECK_INTERVAL_MS);
    expect(exit).not.toHaveBeenCalled();

    wsState.status = Status.Ready;
    await vi.advanceTimersByTimeAsync(NOT_READY_THRESHOLD_MS + CHECK_INTERVAL_MS);

    expect(exit).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('defers the exit under the min-uptime gate, then exits once uptime crosses it with the wedge still present', async () => {
    const { client, guildState, logger } = buildHarness();
    guildState.size = 1;
    const exit = vi.fn();
    let uptime = 0;
    startGatewayWatchdog(client, logger as unknown as Parameters<typeof startGatewayWatchdog>[1], {
      exit,
      uptimeMs: () => uptime,
    });

    await vi.advanceTimersByTimeAsync(ARM_A_WEDGE_AT_MS);

    expect(exit).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ arm: 'silent-hang', minUptimeMs: MIN_UPTIME_BEFORE_EXIT_MS }),
      expect.stringContaining('deferred')
    );

    logger.error.mockClear();
    uptime = MIN_UPTIME_BEFORE_EXIT_MS;
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('stops all further ticks after stop() is called', async () => {
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
    await vi.advanceTimersByTimeAsync(STALE_THRESHOLD_MS + CHECK_INTERVAL_MS * 2);

    expect(logger.error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

    // Safe to call more than once.
    expect(() => watchdog.stop()).not.toThrow();
  });

  it('deregisters the raw gateway listener on stop(), not just the interval', async () => {
    const { client, handlers, guildState, logger, on, off } = buildHarness();
    guildState.size = 1;
    const watchdog = startGatewayWatchdog(
      client,
      logger as unknown as Parameters<typeof startGatewayWatchdog>[1],
      {
        exit: vi.fn(),
        uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
      }
    );

    const [registeredEvent, registeredListener] = on.mock.calls[0] as [string, Handler];
    expect(handlers.has(Events.Raw)).toBe(true);

    watchdog.stop();

    // The SAME function reference must come back off the emitter — passing a
    // fresh closure to off() would silently leave the listener attached.
    expect(off).toHaveBeenCalledWith(registeredEvent, registeredListener);
    expect(handlers.has(Events.Raw)).toBe(false);
  });

  it('logs a tick that throws and keeps ticking afterwards', async () => {
    const { wsState, guildState, logger, on, off } = buildHarness();
    // Not-Ready from the start so the very first tick reaches a guild-cache
    // read: arm A short-circuits on the still-fresh staleness clock without
    // touching the cache, and only arm B gets that far this early.
    wsState.status = Status.Reconnecting;
    // A field read inside the arms is the realistic failure surface for a tick:
    // discord.js structures can be torn down under the watchdog mid-outage.
    let cacheThrows = true;
    const client = {
      on,
      off,
      ws: wsState,
      guilds: {
        get cache(): { size: number } {
          if (cacheThrows) {
            throw new Error('guild cache unavailable');
          }
          return guildState;
        },
      },
    } as unknown as Client;
    const exit = vi.fn();
    startGatewayWatchdog(client, logger as unknown as Parameters<typeof startGatewayWatchdog>[1], {
      exit,
      uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
    });

    // The throw rejects runTick's promise and is absorbed by the interval's
    // catch, rather than surfacing as an unhandled rejection.
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(logger.error).toHaveBeenCalledWith(
      { err: expect.any(Error) },
      expect.stringContaining('tick failed unexpectedly')
    );
    expect(exit).not.toHaveBeenCalled();

    // A crashed tick must not kill the interval: once the reads succeed again,
    // a later tick still fires arm B on the by-then long-not-Ready connection.
    logger.error.mockClear();
    cacheThrows = false;
    await vi.advanceTimersByTimeAsync(NOT_READY_THRESHOLD_MS + CHECK_INTERVAL_MS);

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('reports a real notReadyForMs when arm A fires while ALSO not-Ready (both wedged)', async () => {
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
    // continue until arm A's longer threshold (now including the probe grace
    // window) is crossed too.
    await vi.advanceTimersByTimeAsync(ARM_A_WEDGE_AT_MS);

    // The point of the test: arm A's payload must carry the REAL not-Ready
    // age, not null. The readiness clock starts one tick after the staleness
    // clock (the first tick is what observes not-Ready), hence the offset.
    expect(logger.error).toHaveBeenCalledWith(
      {
        arm: 'silent-hang',
        staleForMs: ARM_A_WEDGE_AT_MS,
        notReadyForMs: ARM_A_WEDGE_AT_MS - CHECK_INTERVAL_MS,
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
  it('stamps the not-Ready clock before arm A fires on the same tick, so the payload is never a false null', async () => {
    const { client, wsState, guildState, logger } = buildHarness();
    guildState.size = 1;
    const exit = vi.fn();
    startGatewayWatchdog(client, logger as unknown as Parameters<typeof startGatewayWatchdog>[1], {
      exit,
      uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
    });

    // Ready the whole time the staleness clock runs out — one tick short of
    // arm A firing (crossing the threshold and riding out the probe grace
    // window along the way) — so notReadySince is still null here.
    await vi.advanceTimersByTimeAsync(ARM_A_WEDGE_AT_MS - CHECK_INTERVAL_MS);
    expect(logger.error).not.toHaveBeenCalled();

    // Now drop out of Ready. The next tick both stamps the clock AND fires arm A.
    wsState.status = Status.Reconnecting;
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);

    expect(logger.error).toHaveBeenCalledWith(
      {
        arm: 'silent-hang',
        staleForMs: ARM_A_WEDGE_AT_MS,
        notReadyForMs: 0,
        wsStatus: Status.Reconnecting,
        guildCount: 1,
        uptimeMs: MIN_UPTIME_BEFORE_EXIT_MS,
      },
      expect.stringContaining('wedged')
    );
  });

  describe('owner-alert webhook', () => {
    it('POSTs the alert before exiting, in order, with the arm and environment in the body', async () => {
      const { client, guildState, logger, fetchMock } = buildHarness();
      guildState.size = 1;
      const order: string[] = [];
      fetchMock.mockImplementation(() => {
        order.push('alert');
        return Promise.resolve(new Response(null, { status: 204 }));
      });
      const exit = vi.fn(() => {
        order.push('exit');
      });
      startGatewayWatchdog(
        client,
        logger as unknown as Parameters<typeof startGatewayWatchdog>[1],
        {
          exit,
          uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
          alertWebhookUrl: 'https://discord.com/api/webhooks/1/abc',
          environment: 'production',
          fetchFn: fetchMock as unknown as typeof fetch,
        }
      );

      await vi.advanceTimersByTimeAsync(ARM_A_WEDGE_AT_MS);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://discord.com/api/webhooks/1/abc');
      const body = JSON.parse(init.body as string) as { content: string };
      expect(body.content).toContain('silent-hang');
      expect(body.content).toContain('production');
      // The alert must be self-sufficient for the two-clock diagnosis: both
      // clocks plus the socket status and guild count they are read against.
      expect(body.content).toContain(`staleForMs=${ARM_A_WEDGE_AT_MS}`);
      expect(body.content).toContain('notReadyForMs=n/a');
      expect(body.content).toContain('wsStatus=Ready');
      expect(body.content).toContain('guilds=1');
      expect(init.signal).toBeInstanceOf(AbortSignal);

      expect(order).toEqual(['alert', 'exit']);
      expect(exit).toHaveBeenCalledWith(1);
    });

    // The arm-A alert above carries notReadyForMs=n/a and wsStatus=Ready. This
    // is the other side of the two-clock diagnosis — a real not-Ready age beside
    // a one-tick staleness — which is the hot-loop signature the alert text has
    // to make legible without going to the logs.
    it('carries the real not-Ready clock, socket status and guild count in a never-ready alert', async () => {
      const { client, handlers, wsState, guildState, logger, fetchMock } = buildHarness();
      wsState.status = Status.Reconnecting;
      guildState.size = 2;
      startGatewayWatchdog(
        client,
        logger as unknown as Parameters<typeof startGatewayWatchdog>[1],
        {
          exit: vi.fn(),
          uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
          alertWebhookUrl: 'https://discord.com/api/webhooks/1/abc',
          environment: 'production',
          fetchFn: fetchMock as unknown as typeof fetch,
        }
      );

      // Raw events keep flowing, so arm A can never fire and arm B is the only
      // possible source of this alert.
      const iterations = NOT_READY_THRESHOLD_MS / CHECK_INTERVAL_MS + 2;
      for (let i = 0; i < iterations; i++) {
        emitRaw(handlers);
        await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
      }

      const body = JSON.parse(
        (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string
      ) as { content: string };
      expect(body.content).toContain('never-ready');
      expect(body.content).toContain(`notReadyForMs=${NOT_READY_THRESHOLD_MS + CHECK_INTERVAL_MS}`);
      expect(body.content).toContain(`staleForMs=${CHECK_INTERVAL_MS}`);
      expect(body.content).toContain('wsStatus=Reconnecting');
      expect(body.content).toContain('guilds=2');
    });

    it('still exits when the alert POST rejects', async () => {
      const { client, guildState, logger, fetchMock } = buildHarness();
      guildState.size = 1;
      fetchMock.mockRejectedValue(new Error('network down'));
      const exit = vi.fn();
      startGatewayWatchdog(
        client,
        logger as unknown as Parameters<typeof startGatewayWatchdog>[1],
        {
          exit,
          uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
          alertWebhookUrl: 'https://discord.com/api/webhooks/1/abc',
          fetchFn: fetchMock as unknown as typeof fetch,
        }
      );

      await vi.advanceTimersByTimeAsync(ARM_A_WEDGE_AT_MS);

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(1);
    });

    it('warns on a non-OK webhook response (dead webhook is not a delivered alert) and still exits', async () => {
      const { client, guildState, logger, fetchMock } = buildHarness();
      guildState.size = 1;
      fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
      const exit = vi.fn();
      startGatewayWatchdog(
        client,
        logger as unknown as Parameters<typeof startGatewayWatchdog>[1],
        {
          exit,
          uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
          alertWebhookUrl: 'https://discord.com/api/webhooks/1/abc',
          fetchFn: fetchMock as unknown as typeof fetch,
        }
      );

      await vi.advanceTimersByTimeAsync(ARM_A_WEDGE_AT_MS);

      expect(logger.warn).toHaveBeenCalledWith({ status: 404 }, expect.stringContaining('non-OK'));
      expect(exit).toHaveBeenCalledWith(1);
    });

    it('still exits when the fetch function throws synchronously', async () => {
      const { client, guildState, logger } = buildHarness();
      guildState.size = 1;
      const fetchMock = vi.fn(() => {
        throw new Error('boom');
      });
      const exit = vi.fn();
      startGatewayWatchdog(
        client,
        logger as unknown as Parameters<typeof startGatewayWatchdog>[1],
        {
          exit,
          uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
          alertWebhookUrl: 'https://discord.com/api/webhooks/1/abc',
          fetchFn: fetchMock as unknown as typeof fetch,
        }
      );

      await vi.advanceTimersByTimeAsync(ARM_A_WEDGE_AT_MS);

      expect(exit).toHaveBeenCalledWith(1);
    });

    it('never calls fetch when no webhook URL is configured, and logs the log-only state at startup', async () => {
      const { client, guildState, logger, fetchMock } = buildHarness();
      guildState.size = 1;
      const exit = vi.fn();
      startGatewayWatchdog(
        client,
        logger as unknown as Parameters<typeof startGatewayWatchdog>[1],
        {
          exit,
          uptimeMs: () => MIN_UPTIME_BEFORE_EXIT_MS,
          fetchFn: fetchMock as unknown as typeof fetch,
        }
      );

      expect(logger.info).toHaveBeenCalledWith({}, expect.stringContaining('unconfigured'));

      await vi.advanceTimersByTimeAsync(ARM_A_WEDGE_AT_MS);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        {
          arm: 'silent-hang',
          staleForMs: ARM_A_WEDGE_AT_MS,
          notReadyForMs: null,
          wsStatus: Status.Ready,
          guildCount: 1,
          uptimeMs: MIN_UPTIME_BEFORE_EXIT_MS,
        },
        expect.stringContaining('wedged')
      );
      expect(exit).toHaveBeenCalledWith(1);
    });

    // The latch is per-EPISODE, and this test owns the ongoing-wedge half of
    // that contract: while the wedge persists, later ticks must not re-alert.
    // The wedge-recover-wedge test below owns the other half.
    it('sends the deferred alert at most once per ongoing wedge, then sends the exit alert once uptime crosses the gate', async () => {
      const { client, guildState, logger, fetchMock } = buildHarness();
      guildState.size = 1;
      const exit = vi.fn();
      let uptime = 0;
      startGatewayWatchdog(
        client,
        logger as unknown as Parameters<typeof startGatewayWatchdog>[1],
        {
          exit,
          uptimeMs: () => uptime,
          alertWebhookUrl: 'https://discord.com/api/webhooks/1/abc',
          fetchFn: fetchMock as unknown as typeof fetch,
        }
      );

      // First deferring tick.
      await vi.advanceTimersByTimeAsync(ARM_A_WEDGE_AT_MS);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const firstBody = JSON.parse(
        (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string
      ) as { content: string };
      expect(firstBody.content).toContain('deferred');

      // Several more deferring ticks — no additional alert.
      await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 3);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(exit).not.toHaveBeenCalled();

      // Cross the min-uptime gate — the exit-path alert is a SECOND send.
      uptime = MIN_UPTIME_BEFORE_EXIT_MS;
      await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const secondBody = JSON.parse(
        (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string
      ) as { content: string };
      expect(secondBody.content).toContain('exiting');
      expect(exit).toHaveBeenCalledWith(1);
    });

    // The other half of the per-episode contract. Without the latch reset, a
    // process that wedges, recovers, and wedges again inside the min-uptime
    // window alerts only for the first episode — every later wedge is silent
    // for the whole 30 minutes, which is exactly when the owner most needs to
    // hear about it.
    it('re-alerts on a SECOND wedge after a full recovery, under the same min-uptime gate', async () => {
      const { client, handlers, wsState, guildState, logger, fetchMock } = buildHarness();
      guildState.size = 1;
      const exit = vi.fn();
      // Uptime stays under the gate for the whole test, so every wedge takes
      // the deferred path and `exit` never fires to end the episode for us.
      startGatewayWatchdog(
        client,
        logger as unknown as Parameters<typeof startGatewayWatchdog>[1],
        {
          exit,
          uptimeMs: () => 0,
          alertWebhookUrl: 'https://discord.com/api/webhooks/1/abc',
          fetchFn: fetchMock as unknown as typeof fetch,
        }
      );

      // Episode 1: go quiet past the stale threshold.
      await vi.advanceTimersByTimeAsync(ARM_A_WEDGE_AT_MS);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Recover fully — BOTH signals healthy: a fresh raw event AND Ready.
      wsState.status = Status.Ready;
      emitRaw(handlers);
      await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Episode 2: a second, distinct wedge — go quiet again from here.
      await vi.advanceTimersByTimeAsync(ARM_A_WEDGE_AT_MS);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const bodies = fetchMock.mock.calls.map(
        call =>
          (JSON.parse((call as [string, RequestInit])[1].body as string) as { content: string })
            .content
      );
      expect(bodies[0]).toContain('deferred');
      expect(bodies[1]).toContain('deferred');
      expect(exit).not.toHaveBeenCalled();
    });

    // The per-episode latch reset holds for arm B too, not just arm A: a
    // process that never-readies, recovers, and never-readies again inside
    // the min-uptime window must alert for BOTH episodes.
    it('re-alerts on a SECOND arm-B wedge after a full recovery, under the same min-uptime gate', async () => {
      const { client, handlers, wsState, guildState, logger, fetchMock } = buildHarness();
      wsState.status = Status.Reconnecting;
      guildState.size = 1;
      const exit = vi.fn();
      // Uptime stays under the gate for the whole test, so every wedge takes
      // the deferred path and `exit` never fires to end the episode for us.
      startGatewayWatchdog(
        client,
        logger as unknown as Parameters<typeof startGatewayWatchdog>[1],
        {
          exit,
          uptimeMs: () => 0,
          alertWebhookUrl: 'https://discord.com/api/webhooks/1/abc',
          fetchFn: fetchMock as unknown as typeof fetch,
        }
      );

      const iterations = NOT_READY_THRESHOLD_MS / CHECK_INTERVAL_MS + 2;

      // Episode 1: continuous not-Ready, with raw events flowing throughout
      // so arm A can never fire — only arm B can.
      for (let i = 0; i < iterations; i++) {
        emitRaw(handlers);
        await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
      }
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Recover fully — BOTH signals healthy: a fresh raw event AND Ready.
      wsState.status = Status.Ready;
      emitRaw(handlers);
      await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Episode 2: a second, distinct never-ready wedge.
      wsState.status = Status.Reconnecting;
      for (let i = 0; i < iterations; i++) {
        emitRaw(handlers);
        await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
      }

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const bodies = fetchMock.mock.calls.map(
        call =>
          (JSON.parse((call as [string, RequestInit])[1].body as string) as { content: string })
            .content
      );
      expect(bodies[0]).toContain('deferred');
      expect(bodies[0]).toContain('never-ready');
      expect(bodies[1]).toContain('deferred');
      expect(bodies[1]).toContain('never-ready');
      expect(exit).not.toHaveBeenCalled();
    });
  });
});
