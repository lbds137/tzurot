/**
 * @jest-environment node
 * @testType index
 *
 * Shared Domain Index Test
 * - Tests exports of the shared domain module
 * - Verifies API surface and basic functionality
 * - Pure tests with no external dependencies
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Module under test - NOT mocked!
const sharedDomain = require('../../../../src/domain/shared/index');

describe('Shared Domain Index', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('exports', () => {
    it('should export all base classes', () => {
      expect(sharedDomain.AggregateRoot).toBeDefined();
      expect(typeof sharedDomain.AggregateRoot).toBe('function');

      expect(sharedDomain.DomainEvent).toBeDefined();
      expect(typeof sharedDomain.DomainEvent).toBe('function');

      expect(sharedDomain.ValueObject).toBeDefined();
      expect(typeof sharedDomain.ValueObject).toBe('function');
    });

    it('should export event bus components', () => {
      expect(sharedDomain.DomainEventBus).toBeDefined();
      expect(typeof sharedDomain.DomainEventBus).toBe('function');

      expect(sharedDomain.createEventBus).toBeDefined();
      expect(typeof sharedDomain.createEventBus).toBe('function');
    });
  });

  describe('functionality', () => {
    it('should allow creating custom aggregates', () => {
      class TestAggregate extends sharedDomain.AggregateRoot {
        constructor(id) {
          super(id);
          this.testProperty = 'test';
        }
      }

      const aggregate = new TestAggregate('test-123');

      expect(aggregate).toBeInstanceOf(sharedDomain.AggregateRoot);
      expect(aggregate).toBeInstanceOf(TestAggregate);
      expect(aggregate.id).toBe('test-123');
      expect(aggregate.testProperty).toBe('test');
    });

    it('should allow creating custom value objects', () => {
      class TestValue extends sharedDomain.ValueObject {
        constructor(value) {
          super();
          this.value = value;
        }

        equals(other) {
          return other instanceof TestValue && this.value === other.value;
        }

        toString() {
          return this.value;
        }
      }

      const value = new TestValue('test');

      expect(value).toBeInstanceOf(sharedDomain.ValueObject);
      expect(value).toBeInstanceOf(TestValue);
      expect(value.toString()).toBe('test');
    });

    it('should allow creating custom domain events', () => {
      class TestEvent extends sharedDomain.DomainEvent {
        constructor(aggregateId, payload) {
          super(aggregateId, payload);
        }
      }

      const event = new TestEvent('test-123', { message: 'test event' });

      expect(event).toBeInstanceOf(sharedDomain.DomainEvent);
      expect(event).toBeInstanceOf(TestEvent);
      expect(event.eventType).toBe('TestEvent');
      expect(event.aggregateId).toBe('test-123');
      expect(event.payload.message).toBe('test event');
    });

    it('should allow creating event bus instances', () => {
      const eventBus = sharedDomain.createEventBus();

      expect(eventBus).toBeInstanceOf(sharedDomain.DomainEventBus);
      expect(typeof eventBus.publish).toBe('function');
      expect(typeof eventBus.subscribe).toBe('function');
    });

    it('should allow using singleton event bus', () => {
      const eventBus = new sharedDomain.DomainEventBus();

      expect(eventBus).toBeInstanceOf(sharedDomain.DomainEventBus);
      expect(typeof eventBus.publish).toBe('function');
      expect(typeof eventBus.subscribe).toBe('function');
    });
  });

  describe('domain boundary', () => {
    it('should not export internal implementation details', () => {
      // These should not be exported
      expect(sharedDomain.EventHandler).toBeUndefined();
      expect(sharedDomain.EventSubscription).toBeUndefined();
      expect(sharedDomain.AggregateVersion).toBeUndefined();
    });

    it('should provide complete public API', () => {
      const exportedKeys = Object.keys(sharedDomain);
      const expectedKeys = [
        'AggregateRoot',
        'DomainEvent',
        'ValueObject',
        'DomainEventBus',
        'createEventBus',
      ];

      for (const key of expectedKeys) {
        expect(exportedKeys).toContain(key);
      }

      expect(exportedKeys).toHaveLength(expectedKeys.length);
    });
  });

  describe('inheritance patterns', () => {
    it('should allow proper aggregate inheritance with events', () => {
      class SomethingDoneEvent extends sharedDomain.DomainEvent {
        constructor(aggregateId, payload) {
          super(aggregateId, payload);
        }
      }

      class TestAggregate extends sharedDomain.AggregateRoot {
        constructor(id) {
          super(id);
          this.status = 'created';
        }

        doSomething() {
          this.status = 'active';
          this.applyEvent(
            new SomethingDoneEvent(this.id, {
              previousStatus: 'created',
              newStatus: 'active',
            })
          );
        }
      }

      const aggregate = new TestAggregate('test-123');
      aggregate.doSomething();

      const events = aggregate.getUncommittedEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('SomethingDoneEvent');
      expect(events[0].payload.newStatus).toBe('active');
    });

    it('should allow proper value object inheritance with immutability', () => {
      class TestValue extends sharedDomain.ValueObject {
        constructor(name, value) {
          super();
          this.name = name;
          this.value = value;
        }

        equals(other) {
          return (
            other instanceof TestValue && this.name === other.name && this.value === other.value
          );
        }

        copyWith(changes) {
          return new TestValue(
            changes.name !== undefined ? changes.name : this.name,
            changes.value !== undefined ? changes.value : this.value
          );
        }
      }

      const original = new TestValue('test', 42);
      const modified = original.copyWith({ value: 84 });

      expect(original.value).toBe(42); // Original unchanged
      expect(modified.value).toBe(84); // New instance with change
      expect(modified.name).toBe('test'); // Other properties preserved
      expect(original.equals(modified)).toBe(false);
    });
  });
});
