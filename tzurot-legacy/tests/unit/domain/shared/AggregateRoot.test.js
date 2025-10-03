/**
 * @jest-environment node
 * @testType domain
 *
 * AggregateRoot Base Class Test
 * - Pure domain test with no external dependencies
 * - Tests aggregate root base functionality
 * - No mocking needed (testing the actual implementation)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain models under test - NOT mocked!
const { AggregateRoot } = require('../../../../src/domain/shared/AggregateRoot');
const { DomainEvent } = require('../../../../src/domain/shared/DomainEvent');

// Test events
class TestCreatedEvent extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);
  }
}

class TestUpdatedEvent extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);
  }
}

// Test aggregate
class TestAggregate extends AggregateRoot {
  constructor(id) {
    super(id);
    this.name = null;
    this.value = null;
  }

  static create(id, name) {
    const aggregate = new TestAggregate(id);
    aggregate.applyEvent(new TestCreatedEvent(id, { name }));
    return aggregate;
  }

  update(value) {
    this.applyEvent(new TestUpdatedEvent(this.id, { value }));
  }

  onTestCreatedEvent(event) {
    this.name = event.payload.name;
  }

  onTestUpdatedEvent(event) {
    this.value = event.payload.value;
  }
}

describe('AggregateRoot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should require an ID', () => {
      expect(() => new AggregateRoot()).toThrow('Aggregate root must have an ID');
    });

    it('should initialize with ID and version 0', () => {
      const aggregate = new TestAggregate('test-123');

      expect(aggregate.id).toBe('test-123');
      expect(aggregate.version).toBe(0);
      expect(aggregate.uncommittedEvents).toEqual([]);
    });
  });

  describe('applyEvent', () => {
    it('should apply event and increment version', () => {
      const aggregate = new TestAggregate('test-123');
      const event = new TestCreatedEvent('test-123', { name: 'Test' });

      aggregate.applyEvent(event);

      expect(aggregate.name).toBe('Test');
      expect(aggregate.version).toBe(1);
      expect(aggregate.uncommittedEvents).toHaveLength(1);
    });

    it('should require DomainEvent instance', () => {
      const aggregate = new TestAggregate('test-123');

      expect(() => aggregate.applyEvent({})).toThrow('Event must be instance of DomainEvent');
    });

    it('should handle events without handlers gracefully', () => {
      class UnhandledEvent extends DomainEvent {}
      const aggregate = new TestAggregate('test-123');
      const event = new UnhandledEvent('test-123', {});

      expect(() => aggregate.applyEvent(event)).not.toThrow();
      expect(aggregate.version).toBe(1);
    });

    it('should apply multiple events in sequence', () => {
      const aggregate = TestAggregate.create('test-123', 'Initial');
      aggregate.update(42);

      expect(aggregate.name).toBe('Initial');
      expect(aggregate.value).toBe(42);
      expect(aggregate.version).toBe(2);
      expect(aggregate.uncommittedEvents).toHaveLength(2);
    });
  });

  describe('getUncommittedEvents', () => {
    it('should return copy of uncommitted events', () => {
      const aggregate = TestAggregate.create('test-123', 'Test');

      const events = aggregate.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(TestCreatedEvent);

      // Modifying returned array should not affect aggregate
      events.push(new TestUpdatedEvent('test-123', {}));
      expect(aggregate.uncommittedEvents).toHaveLength(1);
    });
  });

  describe('markEventsAsCommitted', () => {
    it('should clear uncommitted events', () => {
      const aggregate = TestAggregate.create('test-123', 'Test');
      aggregate.update(42);

      expect(aggregate.uncommittedEvents).toHaveLength(2);

      aggregate.markEventsAsCommitted();

      expect(aggregate.uncommittedEvents).toHaveLength(0);
      expect(aggregate.version).toBe(2); // Version unchanged
    });
  });

  describe('loadFromHistory', () => {
    it('should rebuild aggregate from event history', () => {
      const events = [
        new TestCreatedEvent('test-123', { name: 'Historical' }),
        new TestUpdatedEvent('test-123', { value: 99 }),
      ];

      const aggregate = new TestAggregate('test-123');
      aggregate.loadFromHistory(events);

      expect(aggregate.name).toBe('Historical');
      expect(aggregate.value).toBe(99);
      expect(aggregate.version).toBe(2);
      expect(aggregate.uncommittedEvents).toHaveLength(0);
    });

    it('should handle empty history', () => {
      const aggregate = new TestAggregate('test-123');

      expect(() => aggregate.loadFromHistory([])).not.toThrow();
      expect(aggregate.version).toBe(0);
    });

    it('should skip events without handlers', () => {
      class UnhandledEvent extends DomainEvent {}
      const events = [
        new TestCreatedEvent('test-123', { name: 'Test' }),
        new UnhandledEvent('test-123', {}),
        new TestUpdatedEvent('test-123', { value: 42 }),
      ];

      const aggregate = new TestAggregate('test-123');
      aggregate.loadFromHistory(events);

      expect(aggregate.name).toBe('Test');
      expect(aggregate.value).toBe(42);
      expect(aggregate.version).toBe(3); // All events increment version
    });
  });

  describe('hasUncommittedChanges', () => {
    it('should return false for new aggregate', () => {
      const aggregate = new TestAggregate('test-123');

      expect(aggregate.hasUncommittedChanges()).toBe(false);
    });

    it('should return true after applying events', () => {
      const aggregate = TestAggregate.create('test-123', 'Test');

      expect(aggregate.hasUncommittedChanges()).toBe(true);
    });

    it('should return false after marking events committed', () => {
      const aggregate = TestAggregate.create('test-123', 'Test');
      aggregate.markEventsAsCommitted();

      expect(aggregate.hasUncommittedChanges()).toBe(false);
    });
  });

  describe('validate', () => {
    it('should be overridable in subclasses', () => {
      class ValidatedAggregate extends AggregateRoot {
        constructor(id) {
          super(id);
          this.status = 'draft';
        }

        publish() {
          this.status = 'published';
          this.validate();
        }

        validate() {
          if (this.status === 'published' && !this.title) {
            throw new Error('Published aggregate must have title');
          }
        }
      }

      const aggregate = new ValidatedAggregate('test-123');

      expect(() => aggregate.publish()).toThrow('Published aggregate must have title');
    });
  });

  describe('getId and getVersion', () => {
    it('should return aggregate ID', () => {
      const aggregate = new TestAggregate('test-123');

      expect(aggregate.getId()).toBe('test-123');
    });

    it('should return current version', () => {
      const aggregate = TestAggregate.create('test-123', 'Test');

      expect(aggregate.getVersion()).toBe(1);
    });
  });
});
