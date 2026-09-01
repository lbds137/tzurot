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
 *
 * Arm A (checkSilentHang) does not treat crossing its staleness threshold as
 * a verdict by itself — a low-traffic guild can legitimately go quiet for
 * hours. Crossing the threshold instead fires an active gateway liveness
 * probe (a REQUEST_GUILD_MEMBERS round-trip); only staleness that persists
 * through the probe's grace window is reported as incident shape (a).
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
  off(event: string, listener: () => void): unknown;
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
   *
   * Coupled invariant: this must stay comfortably LONGER than the lifecycle
   * shutdown's hard-exit backstop (processLifecycle DEFAULT_HARD_EXIT_MS,
   * 10s), or a tick could fire again mid-exit and duplicate the wedge alert —
   * the exit path does not consult the deferred-alert latch. Re-check this if
   * either constant is retuned; not pinned by a test.
   */
  CHECK_INTERVAL_MS: 60_000,

  /**
   * Crossing this threshold no longer means a wedge VERDICT — it means "fire
   * an active gateway liveness probe" (an op-8 REQUEST_GUILD_MEMBERS
   * round-trip; see checkSilentHang). A healthy-but-quiet gateway answers
   * with a GUILD_MEMBERS_CHUNK dispatch, which resets the clock through the
   * existing raw-event listener same as any other dispatch. Only silence that
   * PERSISTS through PROBE_GRACE_MS after the probe fires is a wedge. The
   * previous premise here — that quiet gateways are rare enough for this
   * threshold to be a safe verdict on its own — was wrong: a low-traffic
   * guild produces zero DISPATCH packets for hours at a time, and the
   * raw-event signal only fires on those, so a purely passive threshold
   * false-alarmed in production against exactly that guild shape.
   */
  STALE_THRESHOLD_MS: 15 * 60 * 1000,

  /**
   * How long the probe fired at STALE_THRESHOLD_MS gets to be answered by a
   * GUILD_MEMBERS_CHUNK dispatch (which resets the clock via the raw-event
   * listener, not via any code in the probe's own .then) before persisting
   * staleness escalates to a wedge verdict. Two CHECK_INTERVAL_MS ticks, so a
   * healthy gateway's chunk dispatch has two chances to land before the grace
   * window closes. Pinned by the probe-at-crossing and wedge-after-grace
   * tests.
   */
  PROBE_GRACE_MS: 2 * 60 * 1000,

  /**
   * The `time` option handed to the probe's `guild.members.fetch` call,
   * bounding its own promise so a genuinely wedged socket's fetch cannot
   * linger indefinitely. The probe's result is advisory/log-only and never
   * awaited by the tick, so this only bounds how long the fire-and-forget
   * .then/.catch stays outstanding — not pinned by a test, since the probe
   * fetch is mocked to settle immediately in the suite.
   */
  PROBE_FETCH_TIMEOUT_MS: 30_000,

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

  /**
   * Ceiling on the owner-alert POST. The alert is best-effort context for a
   * human, never a precondition for recovery, so it must not meaningfully
   * delay the self-heal exit — a wedged bot stays wedged for however long
   * this waits.
   */
  ALERT_TIMEOUT_MS: 2500,
} as const;

export interface GatewayWatchdog {
  /** Stop the periodic check. Safe to call more than once. */
  stop(): void;
}

interface WatchdogState {
  lastGatewayEventAt: number;
  notReadySince: number | null;
  /**
   * Set to the tick timestamp that fired the gateway liveness probe (the
   * first tick to observe staleness crossing STALE_THRESHOLD_MS this
   * episode). Null means no probe is currently outstanding — either
   * staleness hasn't crossed yet, or a fresh raw event ended the episode (see
   * updateReadinessState) and the next crossing must fire its own probe.
   * Keyed to staleness ALONE, independent of Ready — a deliberate asymmetry
   * with `deferredAlertSent` below, which requires BOTH signals: Arm A's
   * crossing depends only on staleness, so that is the only signal that
   * should re-arm its probe.
   */
  probeStartedAt: number | null;
  /**
   * One deferred alert per wedge EPISODE, not per process. It latches on the
   * first min-uptime-deferred alert so a long deferral does not re-alert every
   * tick, and `updateReadinessState` clears it on any tick where BOTH signals
   * are healthy — ws.status Ready AND a gateway event inside
   * STALE_THRESHOLD_MS — which is what ends an episode. A later, distinct
   * wedge in the same process therefore alerts again; an ongoing one does not.
   * (An exit ends an episode the other way, by restarting the process and
   * rebuilding this state from scratch.) Both halves are pinned: the
   * wedge-recover-wedge test for the reset, the single-deferred-alert test for
   * the ongoing case.
   */
  deferredAlertSent: boolean;
}

type AlertAction = 'exit' | 'deferred';

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
  sendAlert: (payload: WedgePayload, action: AlertAction) => Promise<void>;
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

function formatAlertText(payload: WedgePayload, action: AlertAction, environment: string): string {
  const notReadyText = payload.notReadyForMs === null ? 'n/a' : String(payload.notReadyForMs);
  const actionText =
    action === 'exit' ? 'exiting for self-heal restart' : 'exit deferred by min-uptime gate';
  // The alert channel is the one the owner actually watches, so the text
  // carries the same fields as the structured log line: both clocks plus the
  // socket status and guild count they are read against. Without those last
  // two, diagnosing the incident shape means going and finding the logs.
  return (
    `🚨 bot-client [${environment}] gateway watchdog: ${payload.arm} wedge — ` +
    `staleForMs=${payload.staleForMs}, notReadyForMs=${notReadyText}, ` +
    `wsStatus=${Status[payload.wsStatus]}(${payload.wsStatus}), guilds=${payload.guildCount}, ` +
    `uptimeMs=${payload.uptimeMs} — ${actionText}`
  );
}

/**
 * Builds the best-effort owner alert sender. It never throws or rejects, so a
 * failed alert cannot block the self-heal exit it accompanies — pinned by the
 * rejecting-fetch and synchronously-throwing-fetch tests. Slowness is bounded
 * by the ALERT_TIMEOUT_MS abort signal rather than by a test: driving that
 * abort under fake timers is not practical, so the tests inject a fetch that
 * settles immediately and the timeout arm is unverified here.
 */
function createAlertSender(
  logger: Logger,
  alertWebhookUrl: string | undefined,
  environment: string | undefined,
  fetchFn: typeof fetch
): (payload: WedgePayload, action: AlertAction) => Promise<void> {
  const resolvedEnvironment = environment ?? 'unknown';
  return async (payload: WedgePayload, action: AlertAction): Promise<void> => {
    if (alertWebhookUrl === undefined || alertWebhookUrl.trim() === '') {
      return;
    }
    try {
      const response = await fetchFn(alertWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: formatAlertText(payload, action, resolvedEnvironment) }),
        signal: AbortSignal.timeout(WATCHDOG_THRESHOLDS.ALERT_TIMEOUT_MS),
      });
      if (!response.ok) {
        // A revoked or misconfigured webhook fails as an HTTP status, not a
        // rejection — without this branch a permanently dead webhook would be
        // indistinguishable from a delivered alert.
        logger.warn(
          { status: response.status },
          'Gateway watchdog owner-alert webhook returned a non-OK status'
        );
      }
    } catch (err: unknown) {
      logger.warn({ err }, 'Gateway watchdog owner-alert webhook POST failed');
    }
  };
}

// The in-bot owner-channel notification path is unusable here — it posts
// through the very gateway this watchdog exists to detect as wedged — so the
// alert instead goes out over a plain-HTTPS webhook, independent of the
// gateway socket. It is gated on WATCHDOG_ALERT_WEBHOOK_URL configuration —
// with it unset, no send is attempted and the exit path is unchanged (pinned
// by the unconfigured-webhook test) — and bounded by ALERT_TIMEOUT_MS.
async function handleWedge(ctx: TickContext, payload: WedgePayload): Promise<void> {
  const { logger, exit, state, sendAlert } = ctx;
  if (payload.uptimeMs >= WATCHDOG_THRESHOLDS.MIN_UPTIME_BEFORE_EXIT_MS) {
    // This line lands before exit() tears the process down because the
    // deployed logger is transport-free: createLogger attaches the
    // pino-pretty transport only under ENABLE_PRETTY_LOGS=true, so in
    // deployment pino writes to stdout synchronously. Under that local-dev
    // flag the transport's worker thread could lose this final line — an
    // accepted, dev-only gap. Giving the deployed logger an async transport
    // would require a flush-then-exit sequence here.
    logger.error(payload, 'Gateway watchdog detected a wedged connection — exiting');
    await sendAlert(payload, 'exit');
    exit(1);
    return;
  }
  logger.error(
    { ...payload, minUptimeMs: WATCHDOG_THRESHOLDS.MIN_UPTIME_BEFORE_EXIT_MS },
    'Gateway watchdog detected a wedged connection — exit deferred by the min-uptime gate'
  );
  if (!state.deferredAlertSent) {
    state.deferredAlertSent = true; // set BEFORE the await so an overlapping tick cannot double-send
    await sendAlert(payload, 'deferred');
  }
}

async function checkSilentHang(ctx: TickContext, now: number): Promise<boolean> {
  const { client, state, logger, uptimeMs } = ctx;
  // Canonical statement of the empty-guild-cache exclusion, which BOTH arms
  // apply (arm B repeats it below). An empty cache is what an idle or
  // still-booting process looks like, and neither is a wedge, so the gate
  // keeps those from tripping the watchdog. Its cost is a real blind spot
  // rather than a free filter: for a process whose cache never fills, the
  // cache stays empty for the whole episode, so no tick of either arm can ever
  // fire — the watchdog simply cannot see a wedge that happens before the
  // first guild sync completes. bootWatchdog's own 5-minute deadline covers
  // the process that never finishes logging in; a process that gets past that
  // and still never populates guilds is an accepted residual gap with no
  // detection here. It is also what makes the `guild === undefined` guard
  // below unreachable in practice: `guilds.cache.first()` cannot return
  // undefined once `cache.size > 0`.
  if (
    now - state.lastGatewayEventAt <= WATCHDOG_THRESHOLDS.STALE_THRESHOLD_MS ||
    client.guilds.cache.size === 0
  ) {
    return false;
  }

  if (state.probeStartedAt === null) {
    // First tick past the threshold this episode: fire the probe rather than
    // a verdict. The guild's own GUILD_MEMBERS_CHUNK response — not this
    // function — is what resets lastGatewayEventAt, via the existing
    // raw-event listener; the .then/.catch below is log-only. Pinned by the
    // probe-at-crossing test.
    const guild = client.guilds.cache.first();
    if (guild === undefined) {
      return false; // TS-strict guard; unreachable given the size gate above
    }
    state.probeStartedAt = now;
    logger.info(
      { staleForMs: now - state.lastGatewayEventAt },
      'Gateway dispatch silence crossed the probe threshold — firing gateway liveness probe'
    );
    void guild.members
      .fetch({ query: '', limit: 1, time: WATCHDOG_THRESHOLDS.PROBE_FETCH_TIMEOUT_MS })
      .then(() => {
        logger.info({}, 'Gateway watchdog liveness probe resolved');
      })
      .catch((err: unknown) => {
        logger.warn({ err }, 'Gateway watchdog liveness probe rejected');
      });
    return false;
  }

  if (now - state.probeStartedAt < WATCHDOG_THRESHOLDS.PROBE_GRACE_MS) {
    // Probe already fired this episode and its grace window hasn't closed —
    // give the GUILD_MEMBERS_CHUNK dispatch (or any other dispatch) more
    // ticks to land and reset the clock via the raw-event listener.
    return false;
  }

  // Staleness has now persisted through the probe AND its grace window —
  // this is a wedge verdict, unchanged from the original single-threshold
  // path. Pinned by the wedge-after-grace test.
  await handleWedge(ctx, buildWedgePayload(client, state, 'silent-hang', now, uptimeMs()));
  return true;
}

/**
 * Maintains the not-Ready clock and ends a wedge episode. Runs unconditionally
 * at the top of EVERY tick, before either arm, so the clock stays accurate even
 * on a tick where arm A fires and short-circuits arm B. Folding this into arm B
 * would make a both-wedged state log `notReadyForMs: null` — which the payload
 * contract above defines as "currently Ready" — turning the richer diagnosis
 * into a false reading. Pinned by the both-wedged test.
 *
 * Episode end is deliberately the conjunction of BOTH signals, since either one
 * alone is exactly what one arm treats as a candidate wedge: a Ready socket
 * that stays quiet past its probe's grace window is arm A's case, and fresh
 * raw traffic without Ready is arm B's. Only when neither arm has anything to
 * say is the connection healthy enough to re-arm the deferred alert.
 */
function updateReadinessState({ client, state }: TickContext, now: number): void {
  const isReady = client.ws.status === Status.Ready;
  const eventsAreFresh = now - state.lastGatewayEventAt <= WATCHDOG_THRESHOLDS.STALE_THRESHOLD_MS;
  if (isReady && eventsAreFresh) {
    state.deferredAlertSent = false;
  }

  // Deliberately a SEPARATE condition from the deferredAlertSent reset above,
  // keyed to eventsAreFresh alone rather than the BOTH-signals conjunction:
  // Arm A's crossing (checkSilentHang) depends only on staleness, so a fresh
  // raw event is sufficient on its own to end that arm's probe episode, even
  // on a tick where ws.status is not yet Ready.
  if (eventsAreFresh) {
    state.probeStartedAt = null;
  }

  if (isReady) {
    state.notReadySince = null;
    return;
  }
  state.notReadySince ??= now;
}

// This arm deliberately does not consult event freshness, so it catches a
// never-Ready wedge whether or not raw gateway traffic is flowing. That
// independence is the whole point: arm A can only ever raise a candidate on a
// connection that has gone quiet (and only confirms it past the probe's grace
// window), and a wedge need not be quiet. The paired test constructs the
// still-flowing-raw case to pin it.
async function checkNeverReady(ctx: TickContext, now: number): Promise<void> {
  const { client, state, uptimeMs } = ctx;
  // Same empty-guild-cache exclusion as arm A, with the same blind spot — see
  // the canonical explanation on checkSilentHang above.
  if (state.notReadySince === null || client.guilds.cache.size === 0) {
    return;
  }
  if (now - state.notReadySince <= WATCHDOG_THRESHOLDS.NOT_READY_THRESHOLD_MS) {
    return;
  }
  await handleWedge(ctx, buildWedgePayload(client, state, 'never-ready', now, uptimeMs()));
}

/**
 * One tick's worth of watchdog logic: maintain the readiness clock, then run
 * arm A and (if it didn't fire) arm B. Extracted to a module-level function so
 * the interval callback can drive it without ever producing an unhandled
 * rejection (see the `void runTick(ctx).catch(...)` wrapper below).
 */
async function runTick(ctx: TickContext): Promise<void> {
  // One clock read per tick, shared by state maintenance and both arms, so
  // the two ages in a payload are always measured against the same instant.
  const now = Date.now();
  updateReadinessState(ctx, now);
  const hung = await checkSilentHang(ctx, now);
  if (!hung) {
    await checkNeverReady(ctx, now);
  }
}

export function startGatewayWatchdog(
  client: Client,
  logger: Logger,
  options?: {
    exit?: (code: number) => void;
    /** Process uptime in MILLISECONDS. Injected so tests control the min-uptime gate. */
    uptimeMs?: () => number;
    /** Discord webhook for the owner alert. Unset/empty means log-only. */
    alertWebhookUrl?: string;
    /** Deployment environment name, carried into the alert text. */
    environment?: string;
    fetchFn?: typeof fetch;
  }
): GatewayWatchdog {
  const exit = options?.exit ?? ((code: number) => process.exit(code));
  const uptimeMs = options?.uptimeMs ?? (() => process.uptime() * 1000);
  const fetchFn = options?.fetchFn ?? globalThis.fetch;
  const alertWebhookUrl = options?.alertWebhookUrl;

  if (alertWebhookUrl === undefined || alertWebhookUrl.trim() === '') {
    logger.info(
      {},
      'Gateway watchdog owner alerting is unconfigured (WATCHDOG_ALERT_WEBHOOK_URL unset) — log-only'
    );
  }

  const state: WatchdogState = {
    lastGatewayEventAt: Date.now(),
    notReadySince: null,
    probeStartedAt: null,
    deferredAlertSent: false,
  };
  const sendAlert = createAlertSender(logger, alertWebhookUrl, options?.environment, fetchFn);
  const ctx: TickContext = { client, state, logger, exit, uptimeMs, sendAlert };

  // Held in a named const so stop() can deregister this exact function: the
  // interval is only half the subscription, and leaving the listener attached
  // would keep a stopped watchdog's state object reachable from the client.
  const rawEmitter = client as unknown as RawGatewayEmitter;
  const onRawGatewayEvent = (): void => {
    state.lastGatewayEventAt = Date.now();
  };
  rawEmitter.on(Events.Raw, onRawGatewayEvent);

  // unref'd: this is a background check on an already-live process, not a
  // deadline that must keep the process alive to fire (contrast bootWatchdog,
  // which deliberately does NOT unref for that reason).
  const interval: NodeJS.Timeout = setInterval(() => {
    void runTick(ctx).catch((err: unknown) => {
      logger.error({ err }, 'Gateway watchdog tick failed unexpectedly');
    });
  }, WATCHDOG_THRESHOLDS.CHECK_INTERVAL_MS);
  interval.unref();

  return {
    stop(): void {
      clearInterval(interval);
      rawEmitter.off(Events.Raw, onRawGatewayEvent);
    },
  };
}
