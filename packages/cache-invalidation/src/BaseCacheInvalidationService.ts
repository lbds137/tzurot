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
type InvalidationCallback<TEvent> = (event: TEvent) => void;

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
    this.callbacks.push(callback);

    // Only create subscriber connection once
    if (this.subscriber !== null) {
      this.logger.debug('Already subscribed to cache invalidation events');
      return;
    }

    let connection: Redis | undefined;
    try {
      // Create a separate Redis connection for subscribing
      // (Redis pub/sub requires dedicated connection)
      connection = this.redis.duplicate();
      this.subscriber = connection;

      await connection.subscribe(this.channel);

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
      // A failed subscribe must leave the instance exactly as it found it, so a
      // later subscribe() call starts clean. Remove only THIS invocation's
      // callback, by identity and at its own index (never pop() / filter()):
      // the await above lets a concurrent subscribe() interleave — another
      // caller can hit the early-return path and push its own callback while
      // this one is still connecting, so position and "matches this
      // reference" are not the same thing, and removing every matching
      // reference would over-delete a duplicate registration.
      //
      // Taking the FIRST match is fine even when the same reference was
      // registered twice: the entries are indistinguishable, so dropping
      // either one leaves the identical array behind.
      const callbackIndex = this.callbacks.indexOf(callback);
      if (callbackIndex !== -1) {
        this.callbacks.splice(callbackIndex, 1);
      }

      // A failed subscribe cleans up only the connection THIS invocation
      // created. Always disconnect it, but null out `this.subscriber` only
      // when it still points at that same connection — a connection a later,
      // concurrently-successful invocation has since installed is left alone.
      //
      // The disconnect can be the second one on this object, since a racing
      // unsubscribe() may already have closed it. ioredis tolerates that:
      // its disconnect() only sets flags and delegates, with the timeout
      // clear guarded, so a repeat call is a no-op rather than a throw.
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
    if (this.subscriber) {
      await this.subscriber.unsubscribe(this.channel);
      this.subscriber.disconnect();
      this.subscriber = null;
      this.callbacks = [];
      this.logger.info('Unsubscribed from cache invalidation events');
    }
  }

  /**
   * Check if currently subscribed
   */
  isSubscribed(): boolean {
    return this.subscriber !== null;
  }
}
