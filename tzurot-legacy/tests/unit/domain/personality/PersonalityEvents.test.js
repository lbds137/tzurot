/**
 * @jest-environment node
 * @testType domain
 *
 * Personality Events Test
 * - Pure domain test with no external dependencies
 * - Tests personality domain events
 * - No mocking needed (testing the actual implementation)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain models under test - NOT mocked!
const {
  PersonalityCreated,
  PersonalityProfileUpdated,
  PersonalityRemoved,
  PersonalityAliasAdded,
  PersonalityAliasRemoved,
} = require('../../../../src/domain/personality/PersonalityEvents');
const { DomainEvent } = require('../../../../src/domain/shared/DomainEvent');

describe('PersonalityEvents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('PersonalityCreated', () => {
    it('should create event with valid payload', () => {
      const aggregateId = 'claude-3-opus';
      const payload = {
        personalityId: 'claude-3-opus',
        ownerId: '123456789012345678',
        createdAt: new Date().toISOString(),
      };

      const event = new PersonalityCreated(aggregateId, payload);

      expect(event).toBeInstanceOf(DomainEvent);
      expect(event).toBeInstanceOf(PersonalityCreated);
      expect(event.aggregateId).toBe(aggregateId);
      expect(event.payload).toEqual(payload);
      expect(event.eventType).toBe('PersonalityCreated');
    });

    it('should reject missing personalityId', () => {
      const payload = {
        ownerId: '123456789012345678',
        createdAt: new Date().toISOString(),
      };

      expect(() => new PersonalityCreated('id', payload)).toThrow(
        'PersonalityCreated requires personalityId, ownerId, and createdAt'
      );
    });

    it('should reject missing ownerId', () => {
      const payload = {
        personalityId: 'claude-3-opus',
        createdAt: new Date().toISOString(),
      };

      expect(() => new PersonalityCreated('id', payload)).toThrow(
        'PersonalityCreated requires personalityId, ownerId, and createdAt'
      );
    });

    it('should reject missing createdAt', () => {
      const payload = {
        personalityId: 'claude-3-opus',
        ownerId: '123456789012345678',
      };

      expect(() => new PersonalityCreated('id', payload)).toThrow(
        'PersonalityCreated requires personalityId, ownerId, and createdAt'
      );
    });

    it('should serialize to JSON correctly', () => {
      const event = new PersonalityCreated('claude-3-opus', {
        personalityId: 'claude-3-opus',
        ownerId: '123456789012345678',
        createdAt: '2024-01-01T00:00:00.000Z',
      });

      const json = event.toJSON();

      expect(json).toMatchObject({
        eventType: 'PersonalityCreated',
        aggregateId: 'claude-3-opus',
        payload: {
          personalityId: 'claude-3-opus',
          ownerId: '123456789012345678',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      });
      expect(json.eventId).toBeDefined();
      expect(json.occurredAt).toBeDefined();
    });
  });

  describe('PersonalityProfileUpdated', () => {
    it('should create event with valid payload', () => {
      const aggregateId = 'claude-3-opus';
      const payload = {
        profile: {
          displayName: 'Claude 3 Opus',
          avatarUrl: 'https://example.com/avatar.png',
          errorMessage: 'Custom error',
        },
        updatedAt: new Date().toISOString(),
      };

      const event = new PersonalityProfileUpdated(aggregateId, payload);

      expect(event).toBeInstanceOf(PersonalityProfileUpdated);
      expect(event.aggregateId).toBe(aggregateId);
      expect(event.payload).toEqual(payload);
      expect(event.eventType).toBe('PersonalityProfileUpdated');
    });

    it('should reject missing profile, configuration, and model', () => {
      const payload = {
        updatedAt: new Date().toISOString(),
      };

      expect(() => new PersonalityProfileUpdated('id', payload)).toThrow(
        'PersonalityProfileUpdated requires at least one of: profile, configuration, or model'
      );
    });

    it('should reject missing updatedAt', () => {
      const payload = {
        profile: { displayName: 'Test' },
      };

      expect(() => new PersonalityProfileUpdated('id', payload)).toThrow(
        'PersonalityProfileUpdated requires updatedAt'
      );
    });

    it('should accept empty profile object', () => {
      const payload = {
        profile: {},
        updatedAt: new Date().toISOString(),
      };

      expect(() => new PersonalityProfileUpdated('id', payload)).not.toThrow();
    });
  });

  describe('PersonalityRemoved', () => {
    it('should create event with valid payload', () => {
      const aggregateId = 'claude-3-opus';
      const payload = {
        removedBy: '123456789012345678',
        removedAt: new Date().toISOString(),
      };

      const event = new PersonalityRemoved(aggregateId, payload);

      expect(event).toBeInstanceOf(PersonalityRemoved);
      expect(event.aggregateId).toBe(aggregateId);
      expect(event.payload).toEqual(payload);
      expect(event.eventType).toBe('PersonalityRemoved');
    });

    it('should reject missing removedBy', () => {
      const payload = {
        removedAt: new Date().toISOString(),
      };

      expect(() => new PersonalityRemoved('id', payload)).toThrow(
        'PersonalityRemoved requires removedBy and removedAt'
      );
    });

    it('should reject missing removedAt', () => {
      const payload = {
        removedBy: '123456789012345678',
      };

      expect(() => new PersonalityRemoved('id', payload)).toThrow(
        'PersonalityRemoved requires removedBy and removedAt'
      );
    });
  });

  describe('PersonalityAliasAdded', () => {
    it('should create event with valid payload', () => {
      const aggregateId = 'claude-3-opus';
      const payload = {
        alias: 'claude',
        addedBy: '123456789012345678',
        addedAt: new Date().toISOString(),
      };

      const event = new PersonalityAliasAdded(aggregateId, payload);

      expect(event).toBeInstanceOf(PersonalityAliasAdded);
      expect(event.aggregateId).toBe(aggregateId);
      expect(event.payload).toEqual(payload);
      expect(event.eventType).toBe('PersonalityAliasAdded');
    });

    it('should reject missing alias', () => {
      const payload = {
        addedBy: '123456789012345678',
        addedAt: new Date().toISOString(),
      };

      expect(() => new PersonalityAliasAdded('id', payload)).toThrow(
        'PersonalityAliasAdded requires alias, addedBy, and addedAt'
      );
    });

    it('should reject missing addedBy', () => {
      const payload = {
        alias: 'claude',
        addedAt: new Date().toISOString(),
      };

      expect(() => new PersonalityAliasAdded('id', payload)).toThrow(
        'PersonalityAliasAdded requires alias, addedBy, and addedAt'
      );
    });

    it('should reject missing addedAt', () => {
      const payload = {
        alias: 'claude',
        addedBy: '123456789012345678',
      };

      expect(() => new PersonalityAliasAdded('id', payload)).toThrow(
        'PersonalityAliasAdded requires alias, addedBy, and addedAt'
      );
    });

    it('should accept alias object with value and original', () => {
      const payload = {
        alias: { value: 'claude', original: 'Claude' },
        addedBy: '123456789012345678',
        addedAt: new Date().toISOString(),
      };

      const event = new PersonalityAliasAdded('id', payload);
      expect(event.payload.alias).toEqual({ value: 'claude', original: 'Claude' });
    });
  });

  describe('PersonalityAliasRemoved', () => {
    it('should create event with valid payload', () => {
      const aggregateId = 'claude-3-opus';
      const payload = {
        alias: 'claude',
        removedBy: '123456789012345678',
        removedAt: new Date().toISOString(),
      };

      const event = new PersonalityAliasRemoved(aggregateId, payload);

      expect(event).toBeInstanceOf(PersonalityAliasRemoved);
      expect(event.aggregateId).toBe(aggregateId);
      expect(event.payload).toEqual(payload);
      expect(event.eventType).toBe('PersonalityAliasRemoved');
    });

    it('should reject missing alias', () => {
      const payload = {
        removedBy: '123456789012345678',
        removedAt: new Date().toISOString(),
      };

      expect(() => new PersonalityAliasRemoved('id', payload)).toThrow(
        'PersonalityAliasRemoved requires alias, removedBy, and removedAt'
      );
    });

    it('should reject missing removedBy', () => {
      const payload = {
        alias: 'claude',
        removedAt: new Date().toISOString(),
      };

      expect(() => new PersonalityAliasRemoved('id', payload)).toThrow(
        'PersonalityAliasRemoved requires alias, removedBy, and removedAt'
      );
    });

    it('should reject missing removedAt', () => {
      const payload = {
        alias: 'claude',
        removedBy: '123456789012345678',
      };

      expect(() => new PersonalityAliasRemoved('id', payload)).toThrow(
        'PersonalityAliasRemoved requires alias, removedBy, and removedAt'
      );
    });
  });

  describe('Event inheritance', () => {
    it('should all extend DomainEvent', () => {
      const events = [
        new PersonalityCreated('id', {
          personalityId: 'test',
          ownerId: '123',
          createdAt: new Date().toISOString(),
        }),
        new PersonalityProfileUpdated('id', {
          profile: {},
          updatedAt: new Date().toISOString(),
        }),
        new PersonalityRemoved('id', {
          removedBy: '123',
          removedAt: new Date().toISOString(),
        }),
        new PersonalityAliasAdded('id', {
          alias: 'test',
          addedBy: '123',
          addedAt: new Date().toISOString(),
        }),
        new PersonalityAliasRemoved('id', {
          alias: 'test',
          removedBy: '123',
          removedAt: new Date().toISOString(),
        }),
      ];

      events.forEach(event => {
        expect(event).toBeInstanceOf(DomainEvent);
        expect(event.eventId).toBeDefined();
        expect(event.occurredAt).toBeInstanceOf(Date);
        expect(event.toJSON).toBeInstanceOf(Function);
      });
    });

    it('should have correct event types', () => {
      const eventTypes = {
        PersonalityCreated: new PersonalityCreated('id', {
          personalityId: 'test',
          ownerId: '123',
          createdAt: new Date().toISOString(),
        }),
        PersonalityProfileUpdated: new PersonalityProfileUpdated('id', {
          profile: {},
          updatedAt: new Date().toISOString(),
        }),
        PersonalityRemoved: new PersonalityRemoved('id', {
          removedBy: '123',
          removedAt: new Date().toISOString(),
        }),
        PersonalityAliasAdded: new PersonalityAliasAdded('id', {
          alias: 'test',
          addedBy: '123',
          addedAt: new Date().toISOString(),
        }),
        PersonalityAliasRemoved: new PersonalityAliasRemoved('id', {
          alias: 'test',
          removedBy: '123',
          removedAt: new Date().toISOString(),
        }),
      };

      Object.entries(eventTypes).forEach(([expectedType, event]) => {
        expect(event.getEventType()).toBe(expectedType);
      });
    });
  });
});
