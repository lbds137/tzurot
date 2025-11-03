/**
 * Circuit Breaker Pattern Implementation
 *
 * Prevents cascading failures by temporarily blocking operations
 * when a service is experiencing repeated failures.
 *
 * **NOTE**: This implementation is provided for future use but is NOT currently
 * integrated into any services. The timeout configurations added to Redis
 * connections are the critical fix. This circuit breaker can be optionally
 * integrated later if Redis instability continues, particularly for non-critical
 * operations like webhook tracking and transcript caching.
 *
 * States:
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Too many failures, all requests rejected immediately
 * - HALF_OPEN: Testing if service has recovered
 */

import { createLogger } from './logger.js';

const logger = createLogger('CircuitBreaker');

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /**
   * Number of failures before opening circuit
   * @default 5
   */
  failureThreshold?: number;

  /**
   * Time window for counting failures (milliseconds)
   * @default 30000 (30 seconds)
   */
  failureWindow?: number;

  /**
   * How long to wait before attempting recovery (milliseconds)
   * @default 60000 (60 seconds)
   */
  recoveryTimeout?: number;

  /**
   * Name for logging purposes
   * @default 'unnamed'
   */
  name?: string;
}

export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: CircuitState = 'closed';
  private readonly failureThreshold: number;
  private readonly failureWindow: number;
  private readonly recoveryTimeout: number;
  private readonly name: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.failureWindow = options.failureWindow || 30000;
    this.recoveryTimeout = options.recoveryTimeout || 60000;
    this.name = options.name || 'unnamed';
  }

  /**
   * Execute a function with circuit breaker protection
   *
   * @param fn Function to execute
   * @returns Promise with function result
   * @throws Error if circuit is open or function fails
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if we should attempt recovery
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeout) {
        logger.info({ name: this.name }, '[CircuitBreaker] Attempting recovery (half-open)');
        this.state = 'half-open';
      } else {
        throw new Error(`Circuit breaker '${this.name}' is open`);
      }
    }

    try {
      const result = await fn();

      // Success - reset on half-open, or just continue on closed
      if (this.state === 'half-open') {
        logger.info({ name: this.name }, '[CircuitBreaker] Recovery successful (closing circuit)');
        this.reset();
      }

      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Record a failure and potentially open the circuit
   */
  private recordFailure(): void {
    const now = Date.now();

    // Reset failure count if outside window
    if (now - this.lastFailureTime > this.failureWindow) {
      this.failures = 0;
    }

    this.failures++;
    this.lastFailureTime = now;

    logger.warn(
      {
        name: this.name,
        failures: this.failures,
        threshold: this.failureThreshold,
        state: this.state,
      },
      '[CircuitBreaker] Failure recorded'
    );

    // Open circuit if threshold exceeded
    if (this.failures >= this.failureThreshold) {
      this.state = 'open';
      logger.error(
        {
          name: this.name,
          failures: this.failures,
          threshold: this.failureThreshold,
        },
        '[CircuitBreaker] Circuit opened due to repeated failures'
      );
    }
  }

  /**
   * Reset the circuit breaker to closed state
   */
  private reset(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get current failure count
   */
  getFailureCount(): number {
    return this.failures;
  }

  /**
   * Manually reset the circuit breaker (use with caution)
   */
  forceReset(): void {
    logger.info({ name: this.name }, '[CircuitBreaker] Manually resetting circuit');
    this.reset();
  }

  /**
   * Get circuit breaker statistics
   */
  getStats(): {
    name: string;
    state: CircuitState;
    failures: number;
    failureThreshold: number;
    lastFailureTime: number;
  } {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      failureThreshold: this.failureThreshold,
      lastFailureTime: this.lastFailureTime,
    };
  }
}

/**
 * Example usage:
 *
 * ```typescript
 * const redisBreaker = new CircuitBreaker({
 *   name: 'redis',
 *   failureThreshold: 5,
 *   failureWindow: 30000,
 *   recoveryTimeout: 60000
 * });
 *
 * try {
 *   const result = await redisBreaker.execute(async () => {
 *     return await redis.get('key');
 *   });
 * } catch (error) {
 *   // Handle failure or open circuit
 * }
 * ```
 */
