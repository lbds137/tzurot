/**
 * BaseCacheInvalidationService
 *
 * Generic base class for Redis pub/sub cache invalidation services.
 * Provides standardized pub/sub patterns for broadcasting cache invalidation
 * events across microservices.
 *
 * Usage:
 * ```typescript
 * type MyEvent = { type: 'user'; discordId: string } | { type: 'all' };
 *
 * class MyCacheInvalidationService extends BaseCacheInvalidationService<MyEvent> {
 *   constructor(redis: Redis) {
 *     super(redis, REDIS_CHANNELS.MY_CACHE, 'MyCacheInvalidation', isValidMyEvent);
 *   }
 *
 *   async invalidateUser(discordId: string): Promise<void> {
 *     await this.publish({ type: 'user', discordId });
 *   }
 * }
 * ```
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import type { Logger } from 'pino';
import type { Redis } from 'ioredis';

/**
 * Standard event types supported by all cache invalidation services
 */
interface BaseInvalidationEvent {
  type: string;
}

/**
 * Common event type for user-based invalidation
 */
export interface UserInvalidationEvent extends BaseInvalidationEvent {
  type: 'user';
  discordId: string;
}

/**
 * Common event type for invalidating all caches
 */
export interface AllInvalidationEvent extends BaseInvalidationEvent {
  type: 'all';
}

/**
 * Union of standard event types (user | all)
 * Most services use this pattern
 */
export type StandardInvalidationEvent = UserInvalidationEvent | AllInvalidationEvent;

/**
 * Callback function for handling invalidation events
 */
export type InvalidationCallback<TEvent> = (event: TEvent) => void;

/**
 * Type guard function signature
 */
export type EventValidator<TEvent> = (obj: unknown) => obj is TEvent;

/**
 * Specification for expected fields on an event type (beyond 'type').
 * Maps field names to their expected typeof result.
 */
export type EventFieldSpec = Record<string, 'string' | 'number' | 'boolean'>;

/**
 * Declarative spec for a single event type variant.
 * Events with only a `type` field (e.g., 'all', 'admin') omit `fields`.
 */
export interface EventTypeSpec {
  /** The event.type value this spec matches */
  type: string;
  /** Fields to validate beyond 'type'. Omit for type-only events. */
  fields?: EventFieldSpec;
}

/**
 * Create a type-safe event validator from declarative specs.
 *
 * Each spec defines an event.type value and its expected fields.
 * The generated validator checks:
 * 1. Input is a non-null object
 * 2. event.type matches one of the specs
 * 3. All declared fields exist with correct types
 * 4. No extra fields are present (strict key count)
 *
 * @example
 * ```typescript
 * const validator = createEventValidator<MyEvent>([
 *   { type: 'user', fields: { discordId: 'string' } },
 *   { type: 'config', fields: { configId: 'string' } },
 *   { type: 'all' },
 * ]);
 * ```
 */
export function createEventValidator<TEvent extends BaseInvalidationEvent>(
  typeSpecs: EventTypeSpec[]
): EventValidator<TEvent> {
  return (obj: unknown): obj is TEvent => {
    if (typeof obj !== 'object' || obj === null) {
      return false;
    }

    const event = obj as Record<string, unknown>;

    // First matching typeSpec wins if duplicate types are provided
    for (const spec of typeSpecs) {
      if (event.type !== spec.type) {
        continue;
      }

      const fields = spec.fields ?? {};
      // Strict key-count check: reject events with extra fields to catch
      // partial/malformed messages from Redis. This is intentionally not
      // forward-compatible — when adding new fields to an event type,
      // update the spec so both publisher and subscriber stay in sync.
      const expectedKeyCount = Object.keys(fields).length + 1; // +1 for 'type'

      if (Object.keys(event).length !== expectedKeyCount) {
        return false;
      }

      for (const [fieldName, fieldType] of Object.entries(fields)) {
        if (typeof event[fieldName] !== fieldType) {
          return false;
        }
      }

      return true;
    }

    return false;
  };
}

/**
 * Create a standard validator for user/all event patterns
 * Use this when your service only needs { type: 'user', discordId } | { type: 'all' }
 */
export function createStandardEventValidator<
  TEvent extends StandardInvalidationEvent,
>(): EventValidator<TEvent> {
  return createEventValidator<TEvent>([
    { type: 'user', fields: { discordId: 'string' } },
    { type: 'all' },
  ]);
}

/**
 * Options for logging invalidation events
 */
interface InvalidationLogOptions<TEvent> {
  /** Extract log context from event (e.g., { discordId: event.discordId }) */
  getLogContext?: (event: TEvent) => Record<string, unknown>;
  /** Get human-readable description for log message */
  getEventDescription?: (event: TEvent) => string;
}

/**
 * Base class for cache invalidation services
 *
 * Handles Redis pub/sub connection management, message parsing,
 * callback registration, and proper cleanup.
 */
export abstract class BaseCacheInvalidationService<TEvent extends BaseInvalidationEvent> {
  private subscriber: Redis | null = null;
  private callbacks: InvalidationCallback<TEvent>[] = [];
  private connectPromise: Promise<void> | null = null;
  protected readonly logger: Logger;

  constructor(
    protected readonly redis: Redis,
    protected readonly channel: string,
    protected readonly serviceName: string,
    protected readonly isValidEvent: EventValidator<TEvent>,
    protected readonly logOptions?: InvalidationLogOptions<TEvent>
  ) {
    this.logger = createLogger(serviceName);
  }

  /**
   * Start listening for cache invalidation events
   * Call this during service initialization
   */
  async subscribe(callback: InvalidationCallback<TEvent>): Promise<void> {
    // Captured before the push so the catch below can tell whether
    // unsubscribe() has replaced the callback list since this invocation
    // started: unsubscribe() reassigns `this.callbacks` to a fresh array
    // rather than mutating the existing one, so this reference stays the
    // OLD array once that happens — see the identity check in the catch.
    const registeredList = this.callbacks;

    // Dedupe by reference: a caller that stores one stable callback and
    // calls subscribe() repeatedly (the personality invalidator's `dispatch`
    // field; the other invalidators' callers subscribe once with an inline
    // closure) registers it exactly once, so an event dispatches to it once
    // per registration rather than once per call.
    if (this.callbacks.includes(callback)) {
      this.logger.debug('Callback already registered; skipping duplicate registration');
    } else {
      this.callbacks.push(callback);
    }

    // Single-flight: every concurrent caller shares the same in-flight
    // connect attempt rather than racing independent duplicate()s. The
    // settled promise is deliberately KEPT after success — it doubles as
    // the "already connected" cache, so later callers reuse it instead of
    // opening a second connection; only unsubscribe() clears it. Pinned by
    // "shares one connection across sequential successful callers".
    if (this.connectPromise !== null) {
      this.logger.debug('Joining existing subscriber connection');
    }

    const attempt = (this.connectPromise ??= this.establishSubscriber());

    try {
      await attempt;
    } catch (error) {
      // Clearing the attempt belongs HERE, not inside establishSubscriber():
      // when duplicate() throws synchronously, that method's catch runs
      // before `??=` has assigned, so a reset from in there would be
      // overwritten by the rejected attempt and every later subscribe()
      // would re-await it. Guarded by identity because a caller's catch
      // handler may already have started a fresh attempt, which must not be
      // evicted.
      if (this.connectPromise === attempt) {
        this.connectPromise = null;
      }

      // A failed subscribe must leave the instance exactly as it found it, so
      // a later subscribe() call starts clean. Eviction is guarded by array
      // identity: unsubscribe() REPLACES `this.callbacks` with a fresh array
      // rather than mutating the existing one, so `this.callbacks ===
      // registeredList` tells us whether the list this invocation registered
      // into is still the live one. A mismatch means unsubscribe() already
      // tore that list down — this invocation's own entry is already gone,
      // and the live array may since have been rebuilt by a fresh
      // subscribe() on the same reference, so splicing by index would evict
      // that NEW registration instead of a stale one.
      //
      // When the list is still the live one, remove by identity at its own
      // index (never pop() / filter()): the push above happens synchronously,
      // before this invocation awaits the shared `connectPromise` — so a
      // concurrent subscribe() can still interleave its own push while this
      // one is in flight, and position and "matches this reference" are not
      // the same thing.
      if (this.callbacks === registeredList) {
        const callbackIndex = this.callbacks.indexOf(callback);
        if (callbackIndex !== -1) {
          this.callbacks.splice(callbackIndex, 1);
        }
      }
      throw error;
    }
  }

  /**
   * Create the (single-flight) subscriber connection: duplicate the shared
   * Redis client, attach the error listener, subscribe to the channel, and
   * wire up the message listener. Concurrent subscribe() callers await the
   * same promise this method returns, so this body runs at most once per
   * connect attempt.
   */
  private async establishSubscriber(): Promise<void> {
    let connection: Redis | undefined;
    try {
      // Create a separate Redis connection for subscribing
      // (Redis pub/sub requires dedicated connection)
      connection = this.redis.duplicate();
      this.subscriber = connection;

      // Registered BEFORE the subscribe handshake below: ioredis's retry
      // strategy can emit 'error' per attempt while that first command is
      // still queued, and an 'error' with no listener falls to ioredis's
      // internal silentEmit console.error instead of our structured logger.
      // An unhandled 'error' event on an ioredis instance does not throw, so
      // this listener is about observability, not crash-prevention.
      //
      // External-system claim, hedged: ioredis auto-resubscribes on reconnect
      // per its built/redis/event_handler.js readyHandler, gated on the
      // `autoResubscribe` option (defaults true) — re-verify after an ioredis
      // version bump. The message stays neutral about that because this
      // listener also covers the initial-connect window, where the catch
      // below disconnects the connection rather than letting it reconnect.
      //
      // A failed initial connect logs here at warn and again at error from
      // the catch below; two levels, one incident.
      connection.on('error', (err: Error) => {
        this.logger.warn({ err }, 'Cache invalidation subscriber connection error');
      });

      await connection.subscribe(this.channel);

      // A shutdown can land while the subscribe above is still pending:
      // unsubscribe() disconnects this connection and clears the callback
      // list, so completing the wiring here would leave every caller of this
      // attempt believing it is subscribed while its callback is gone and its
      // listeners sit on a disconnected connection. Failing the attempt
      // instead routes through the catch below, which every caller already
      // handles. Pinned by "fails a connect attempt that SUCCEEDS after
      // unsubscribe() tore it down".
      if (this.subscriber !== connection) {
        throw new Error('Subscriber connection was torn down while connecting');
      }

      connection.on('message', (channel: string, message: string) => {
        if (channel !== this.channel) {
          return;
        }

        try {
          const parsed: unknown = JSON.parse(message);

          if (!this.isValidEvent(parsed)) {
            this.logger.error({ message }, 'Invalid invalidation event structure');
            return;
          }

          this.handleInvalidationEvent(parsed);
        } catch (error) {
          this.logger.error({ err: error, message }, 'Failed to parse invalidation event');
        }
      });

      this.logger.info('Subscribed to cache invalidation events');
    } catch (error) {
      // A failed subscribe cleans up only the connection THIS invocation
      // created. Always disconnect it, but null out `this.subscriber` only
      // when it still points at that same connection — a connection a later,
      // concurrently-successful invocation has since installed is left alone.
      //
      // The disconnect can be the second one on this object, since a racing
      // unsubscribe() may already have closed it — the torn-down-while-
      // connecting path reaches this for real. External-system claim,
      // probed against ioredis 5.11.1 (re-verify on a version bump): its
      // disconnect() only sets flags and delegates, with the timeout clear
      // guarded, so a repeat call is a no-op rather than a throw.
      if (connection !== undefined) {
        connection.disconnect();
        if (this.subscriber === connection) {
          this.subscriber = null;
        }
      }
      this.logger.error({ err: error }, 'Failed to subscribe to cache invalidation events');
      throw error;
    }
  }

  /**
   * Publish a cache invalidation event
   */
  async publish(event: TEvent): Promise<void> {
    try {
      const message = JSON.stringify(event);
      await this.redis.publish(this.channel, message);

      const logContext = this.logOptions?.getLogContext?.(event) ?? {};
      const description = this.logOptions?.getEventDescription?.(event) ?? `type: ${event.type}`;

      this.logger.info({ ...logContext, description }, 'Published cache invalidation event');
    } catch (error) {
      this.logger.error({ err: error, event }, 'Failed to publish cache invalidation event');
      throw error;
    }
  }

  /**
   * Handle received invalidation event
   */
  private handleInvalidationEvent(event: TEvent): void {
    const logContext = this.logOptions?.getLogContext?.(event) ?? {};
    const description = this.logOptions?.getEventDescription?.(event) ?? `type: ${event.type}`;

    this.logger.info({ ...logContext, description }, 'Received cache invalidation event');

    // Notify all registered callbacks
    for (const callback of this.callbacks) {
      try {
        callback(event);
      } catch (error) {
        this.logger.error({ err: error }, 'Error in invalidation callback');
      }
    }
  }

  /**
   * Clean up subscription on shutdown
   */
  async unsubscribe(): Promise<void> {
    const connection = this.subscriber;
    if (connection === null) {
      return;
    }
    // State is torn down BEFORE the awaited command: an overlapping
    // unsubscribe() sees "not subscribed" and returns, a connect attempt still
    // in its handshake fails the torn-down check, and a subscribe() landing
    // during the await starts a fresh attempt instead of joining a dead one.
    this.subscriber = null;
    this.callbacks = [];
    this.connectPromise = null;
    try {
      await connection.unsubscribe(this.channel);
    } finally {
      // After the null-out this local is the only handle; a rejected UNSUBSCRIBE
      // must not orphan an open socket.
      connection.disconnect();
    }
    this.logger.info('Unsubscribed from cache invalidation events');
  }

  /**
   * Reports INTENT — that a subscriber connection was established — not
   * current connection liveness. This stays true across a dropped
   * connection: the 'error' listener above hedges the reason it's still
   * correct to report true then (ioredis auto-resubscribes underneath),
   * so this value is eventually-consistent-correct rather than exact.
   * If ioredis exhausts its retry strategy, this stays true with no automatic
   * recovery; unsubscribe() followed by subscribe() is the reset path.
   */
  isSubscribed(): boolean {
    return this.subscriber !== null;
  }
}
