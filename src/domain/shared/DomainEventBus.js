/**
 * Event bus for domain events
 * @module domain/shared/DomainEventBus
 */

const { DomainEvent } = require('./DomainEvent');
const logger = require('../../logger');

/**
 * @class DomainEventBus
 * @description Central event bus for publishing and subscribing to domain events
 */
class DomainEventBus {
  constructor() {
    this.handlers = new Map();
    this.middlewares = [];
  }

  /**
   * Subscribe to a domain event
   * @param {string} eventType - The event type to subscribe to
   * @param {Function} handler - The handler function
   * @returns {Function} Unsubscribe function
   */
  subscribe(eventType, handler) {
    if (typeof handler !== 'function') {
      throw new Error('Handler must be a function');
    }

    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }

    this.handlers.get(eventType).add(handler);
    logger.debug(`[DomainEventBus] Subscribed handler to ${eventType}`);

    // Return unsubscribe function
    return () => {
      const handlers = this.handlers.get(eventType);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.handlers.delete(eventType);
        }
      }
    };
  }

  /**
   * Publish a domain event
   * @param {DomainEvent} event - The event to publish
   * @returns {Promise<void>}
   */
  async publish(event) {
    if (!(event instanceof DomainEvent)) {
      throw new Error('Event must be instance of DomainEvent');
    }

    const eventType = event.getEventType();
    logger.info(
      `[DomainEventBus] Publishing event: ${eventType} for aggregate ${event.aggregateId}`
    );

    // Apply middlewares
    let processedEvent = event;
    for (const middleware of this.middlewares) {
      processedEvent = await middleware(processedEvent);
      if (!processedEvent) {
        logger.debug(`[DomainEventBus] Event ${eventType} was filtered by middleware`);
        return;
      }
    }

    // Get handlers for this event type
    const handlers = this.handlers.get(eventType) || new Set();
    const wildcardHandlers = this.handlers.get('*') || new Set();

    const allHandlers = [...handlers, ...wildcardHandlers];

    if (allHandlers.length === 0) {
      logger.debug(`[DomainEventBus] No handlers registered for event: ${eventType}`);
      return;
    }

    // Execute handlers
    const results = await Promise.allSettled(
      allHandlers.map(handler =>
        Promise.resolve(handler(processedEvent)).catch(error => {
          logger.error(`[DomainEventBus] Handler error for ${eventType}: ${error.message}`);
          throw error;
        })
      )
    );

    // Log any failures
    const failures = results.filter(r => r.status === 'rejected');
    if (failures.length > 0) {
      logger.error(`[DomainEventBus] ${failures.length} handlers failed for event ${eventType}`);
    }
  }

  /**
   * Add middleware to process events before handlers
   * @param {Function} middleware - Middleware function
   */
  use(middleware) {
    if (typeof middleware !== 'function') {
      throw new Error('Middleware must be a function');
    }
    this.middlewares.push(middleware);
  }

  /**
   * Clear all handlers and middlewares
   */
  clear() {
    this.handlers.clear();
    this.middlewares = [];
  }

  /**
   * Get handler count for an event type
   * @param {string} eventType - Event type
   * @returns {number} Number of handlers
   */
  getHandlerCount(eventType) {
    const handlers = this.handlers.get(eventType);
    return handlers ? handlers.size : 0;
  }

  /**
   * Check if there are any handlers for an event type
   * @param {string} eventType - Event type
   * @returns {boolean} True if handlers exist
   */
  hasHandlers(eventType) {
    return this.getHandlerCount(eventType) > 0 || this.getHandlerCount('*') > 0;
  }
}

// Export factory function and class
module.exports = {
  DomainEventBus,
  create: () => new DomainEventBus(),
};
