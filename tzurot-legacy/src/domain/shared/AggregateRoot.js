/**
 * Base class for aggregate roots
 * @module domain/shared/AggregateRoot
 */

const { DomainEvent } = require('./DomainEvent');

/**
 * @class AggregateRoot
 * @description Base class for aggregate roots that maintain consistency boundaries
 */
class AggregateRoot {
  constructor(id) {
    if (!id) {
      throw new Error('Aggregate root must have an ID');
    }
    this.id = id;
    this.version = 0;
    this.uncommittedEvents = [];
  }

  /**
   * Apply a domain event to this aggregate
   * @protected
   * @param {DomainEvent} event - The event to apply
   */
  applyEvent(event) {
    if (!(event instanceof DomainEvent)) {
      throw new Error('Event must be instance of DomainEvent');
    }

    // Apply the event using convention-based method naming
    const handlerName = `on${event.getEventType()}`;
    if (typeof this[handlerName] === 'function') {
      this[handlerName](event);
    }

    this.uncommittedEvents.push(event);
    this.version++;
  }

  /**
   * Get all uncommitted events
   * @returns {DomainEvent[]} Array of uncommitted events
   */
  getUncommittedEvents() {
    return [...this.uncommittedEvents];
  }

  /**
   * Mark all events as committed
   */
  markEventsAsCommitted() {
    this.uncommittedEvents = [];
  }

  /**
   * Load aggregate from event history
   * @param {DomainEvent[]} events - Historical events
   */
  loadFromHistory(events) {
    events.forEach(event => {
      const handlerName = `on${event.getEventType()}`;
      if (typeof this[handlerName] === 'function') {
        this[handlerName](event);
      }
      // Always increment version for all events in history
      this.version++;
    });
  }

  /**
   * Validate aggregate state
   * @protected
   * @abstract
   * @throws {Error} If aggregate is in invalid state
   */
  validate() {
    // Override in subclasses to implement validation
  }

  /**
   * Get aggregate ID
   * @returns {string} Aggregate ID
   */
  getId() {
    return this.id;
  }

  /**
   * Get aggregate version
   * @returns {number} Current version
   */
  getVersion() {
    return this.version;
  }

  /**
   * Check if aggregate has uncommitted changes
   * @returns {boolean} True if there are uncommitted events
   */
  hasUncommittedChanges() {
    return this.uncommittedEvents.length > 0;
  }
}

module.exports = { AggregateRoot };
