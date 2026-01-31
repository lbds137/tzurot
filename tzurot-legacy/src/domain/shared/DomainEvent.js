/**
 * Base class for all domain events
 * @module domain/shared/DomainEvent
 */

/**
 * @class DomainEvent
 * @description Base class for domain events that occur within bounded contexts
 */
class DomainEvent {
  /**
   * @param {string} aggregateId - The ID of the aggregate that emitted this event
   * @param {Object} payload - The event data
   */
  constructor(aggregateId, payload = {}) {
    this.aggregateId = aggregateId;
    this.payload = payload;
    this.occurredAt = new Date();
    this.eventId = this.generateEventId();
    this.eventType = this.constructor.name;
  }

  /**
   * Generate a unique event ID
   * @private
   * @returns {string} Unique event ID
   */
  generateEventId() {
    return `${this.eventType}_${this.aggregateId}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Get the event type name
   * @returns {string} Event type
   */
  getEventType() {
    return this.eventType;
  }

  /**
   * Convert event to plain object for serialization
   * @returns {Object} Plain object representation
   */
  toJSON() {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      aggregateId: this.aggregateId,
      payload: this.payload,
      occurredAt: this.occurredAt.toISOString(),
    };
  }

  /**
   * Create event from plain object
   * @static
   * @param {Object} data - Serialized event data
   * @returns {DomainEvent} Domain event instance
   */
  static fromJSON(data) {
    const event = new this(data.aggregateId, data.payload);
    event.eventId = data.eventId;
    event.occurredAt = new Date(data.occurredAt);
    return event;
  }
}

module.exports = { DomainEvent };
