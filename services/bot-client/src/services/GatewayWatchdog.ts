/**
 * In-process liveness check for the Discord gateway connection.
 *
 * Two production incident shapes motivate this: (a) the gateway websocket
 * silently died — zero events for hours while the process looked healthy —
 * and (b) the websocket entered a reconnect hot loop, emitting shard events
 * several times a second for many minutes without ever reaching Ready, while
 * the bot was fully down. Both were only cured by a restart. The platform
 * restarts the process on a non-zero exit but runs no healthcheck against
 * this service, so only an in-process check can see a wedged-but-running
 * process.
 */
import { type Client, Events, Status } from 'discord.js';
import type { createLogger } from '@tzurot/common-types/utils/logger';

type Logger = ReturnType<typeof createLogger>;

/**
 * discord.js emits `raw` for every gateway dispatch packet (its
 * WebSocketManager fires it from the dispatch handler) but omits `raw` from
 * the ClientEvents typing, so the typed overload cannot express this
 * listener. Narrowing to the emitter shape is the minimum escape; the event
 * name still comes from the Events enum rather than a bare string.
 */
interface RawGatewayEmitter {
  on(event: string, listener: () => void): unknown;
}

/**
 * Detection thresholds. Service-internal — this module is the only consumer —
 * so they stay here rather than moving to common-types.
 */
const WATCHDOG_THRESHOLDS = {
  /**
   * How often the liveness check runs. Cheap (a handful of field reads), so a
   * 1-minute cadence costs nothing while keeping detection latency low
   * relative to the thresholds below.
   */
  CHECK_INTERVAL_MS: 60_000,

  /**
   * A genuinely quiet-but-healthy gateway must not false-alarm: the raw-event
   * signal only fires on gateway DISPATCH packets — heartbeat ACKs and other
   * non-dispatch opcodes do not produce one — so this is deliberately
   * conservative relative to normal server chatter.
   */
  STALE_THRESHOLD_MS: 15 * 60 * 1000,

  /**
   * A many-minute hot-loop outage, observed in production, would have been
   * cut to five minutes by this threshold.
   */
  NOT_READY_THRESHOLD_MS: 5 * 60 * 1000,

  /**
   * The platform's restart budget is finite (10 retries) with unknown reset
   * semantics; burning it fast against a persistent upstream fault would
   * leave the service STOPPED, which is worse than wedged. This gate holds
   * the exit until the process has had a fair chance to recover on its own.
   */
  MIN_UPTIME_BEFORE_EXIT_MS: 30 * 60 * 1000,
} as const;

export interface GatewayWatchdog {
  /** Stop the periodic check. Safe to call more than once. */
  stop(): void;
}

interface WatchdogState {
  lastGatewayEventAt: number;
  notReadySince: number | null;
}

/**
 * Everything a tick needs, assembled once at start. A cohesive bundle rather
 * than independent knobs — the arms are meaningless without any one member —
 * so it travels as one parameter, leaving `now` as the only per-tick argument.
 */
interface TickContext {
  client: Client;
  state: WatchdogState;
  logger: Logger;
  exit: (code: number) => void;
  uptimeMs: () => number;
}

/**
 * The one structured field set both arms log. BOTH clocks are always carried,
 * not just the firing arm's: it is the COMBINATION that identifies the shape.
 * A fresh `staleForMs` beside a large `notReadyForMs` is precisely the
 * reconnect-hot-loop signature, and reading either clock alone cannot tell the
 * two incident shapes apart.
 */
interface WedgePayload {
  arm: 'silent-hang' | 'never-ready';
  /** Age of the most recent gateway dispatch event, in ms. */
  staleForMs: number;
  /**
   * How long ws.status has been continuously not-Ready. Null means genuinely
   * Ready — never "arm B did not run this tick" — because the clock is
   * maintained unconditionally by updateReadinessState.
   */
  notReadyForMs: number | null;
  wsStatus: Status;
  guildCount: number;
  uptimeMs: number;
}

function buildWedgePayload(
  client: Client,
  state: WatchdogState,
  arm: WedgePayload['arm'],
  now: number,
  uptimeMs: number
): WedgePayload {
  return {
    arm,
    staleForMs: now - state.lastGatewayEventAt,
    notReadyForMs: state.notReadySince === null ? null : now - state.notReadySince,
    wsStatus: client.ws.status,
    guildCount: client.guilds.cache.size,
    uptimeMs,
  };
}

// The alert transport (e.g. an owner-channel notification) is itself
// unreliable exactly when this fires — the gateway is the thing that's
// wedged — so no notify call is placed here. The platform's crash
// notification on the non-zero exit is the alerting path for this condition.
function handleWedge(logger: Logger, exit: (code: number) => void, payload: WedgePayload): void {
  if (payload.uptimeMs >= WATCHDOG_THRESHOLDS.MIN_UPTIME_BEFORE_EXIT_MS) {
    // This line lands before exit() tears the process down because the
    // deployed logger is transport-free: createLogger attaches the
    // pino-pretty transport only under ENABLE_PRETTY_LOGS=true, so in
    // deployment pino writes to stdout synchronously. Under that local-dev
    // flag the transport's worker thread could lose this final line — an
    // accepted, dev-only gap. Giving the deployed logger an async transport
    // would require a flush-then-exit sequence here.
    logger.error(payload, 'Gateway watchdog detected a wedged connection — exiting');
    exit(1);
    return;
  }
  logger.error(
    { ...payload, minUptimeMs: WATCHDOG_THRESHOLDS.MIN_UPTIME_BEFORE_EXIT_MS },
    'Gateway watchdog detected a wedged connection — exit deferred by the min-uptime gate'
  );
}

function checkSilentHang(ctx: TickContext, now: number): boolean {
  const { client, state, logger, exit, uptimeMs } = ctx;
  if (
    now - state.lastGatewayEventAt <= WATCHDOG_THRESHOLDS.STALE_THRESHOLD_MS ||
    client.guilds.cache.size === 0
  ) {
    return false;
  }
  handleWedge(logger, exit, buildWedgePayload(client, state, 'silent-hang', now, uptimeMs()));
  return true;
}

/**
 * Maintains the not-Ready clock. Runs unconditionally at the top of EVERY
 * tick, before either arm, so the clock stays accurate even on a tick where
 * arm A fires and short-circuits arm B. Folding this into arm B would make a
 * both-wedged state log `notReadyForMs: null` — which the payload contract
 * above defines as "currently Ready" — turning the richer diagnosis into a
 * false reading. Pinned by the both-wedged test.
 */
function updateReadinessState({ client, state }: TickContext, now: number): void {
  if (client.ws.status === Status.Ready) {
    state.notReadySince = null;
    return;
  }
  state.notReadySince ??= now;
}

// This arm deliberately does not consult event freshness, so it catches a
// never-Ready wedge whether or not raw gateway traffic is flowing. That
// independence is the whole point: arm A can only see a connection that has
// gone quiet, and a wedge need not be quiet. The paired test constructs the
// still-flowing-raw case to pin it.
function checkNeverReady(ctx: TickContext, now: number): void {
  const { client, state, logger, exit, uptimeMs } = ctx;
  if (state.notReadySince === null || client.guilds.cache.size === 0) {
    return;
  }
  if (now - state.notReadySince <= WATCHDOG_THRESHOLDS.NOT_READY_THRESHOLD_MS) {
    return;
  }
  handleWedge(logger, exit, buildWedgePayload(client, state, 'never-ready', now, uptimeMs()));
}

export function startGatewayWatchdog(
  client: Client,
  logger: Logger,
  options?: {
    exit?: (code: number) => void;
    /** Process uptime in MILLISECONDS. Injected so tests control the min-uptime gate. */
    uptimeMs?: () => number;
  }
): GatewayWatchdog {
  const exit = options?.exit ?? ((code: number) => process.exit(code));
  const uptimeMs = options?.uptimeMs ?? (() => process.uptime() * 1000);

  const state: WatchdogState = {
    lastGatewayEventAt: Date.now(),
    notReadySince: null,
  };
  const ctx: TickContext = { client, state, logger, exit, uptimeMs };

  (client as unknown as RawGatewayEmitter).on(Events.Raw, () => {
    state.lastGatewayEventAt = Date.now();
  });

  // unref'd: this is a background check on an already-live process, not a
  // deadline that must keep the process alive to fire (contrast bootWatchdog,
  // which deliberately does NOT unref for that reason).
  const interval: NodeJS.Timeout = setInterval(() => {
    // One clock read per tick, shared by state maintenance and both arms, so
    // the two ages in a payload are always measured against the same instant.
    const now = Date.now();
    updateReadinessState(ctx, now);
    const hung = checkSilentHang(ctx, now);
    if (!hung) {
      checkNeverReady(ctx, now);
    }
  }, WATCHDOG_THRESHOLDS.CHECK_INTERVAL_MS);
  interval.unref();

  return {
    stop(): void {
      clearInterval(interval);
    },
  };
}
