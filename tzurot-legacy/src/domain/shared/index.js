/**
 * Shared domain components
 * @module domain/shared
 */

const { AggregateRoot } = require('./AggregateRoot');
const { DomainEvent } = require('./DomainEvent');
const { ValueObject } = require('./ValueObject');
const { DomainEventBus, create: createEventBus } = require('./DomainEventBus');

module.exports = {
  AggregateRoot,
  DomainEvent,
  ValueObject,
  DomainEventBus,
  createEventBus,
};
