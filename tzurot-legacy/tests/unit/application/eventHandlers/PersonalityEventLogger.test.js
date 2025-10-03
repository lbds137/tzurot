/**
 * Tests for PersonalityEventLogger
 * Focus on event handling behavior and logging
 */

// Mock dependencies before imports
jest.mock('../../../../src/logger');

const {
  PersonalityEventLogger,
} = require('../../../../src/application/eventHandlers/PersonalityEventLogger');
const logger = require('../../../../src/logger');

describe('PersonalityEventLogger', () => {
  let eventLogger;

  beforeEach(() => {
    jest.clearAllMocks();
    eventLogger = new PersonalityEventLogger();
  });

  describe('Constructor', () => {
    it('should create an instance', () => {
      expect(eventLogger).toBeInstanceOf(PersonalityEventLogger);
    });
  });

  describe('handlePersonalityCreated', () => {
    it('should log personality creation with correct information', async () => {
      const event = {
        type: 'PersonalityCreated',
        aggregateId: 'test-personality',
        payload: {
          profile: {
            name: 'test-personality',
            displayName: 'Test Personality',
            avatarUrl: 'https://example.com/avatar.png',
          },
          ownerId: '123456789012345678',
        },
        timestamp: new Date().toISOString(),
      };

      await eventLogger.handlePersonalityCreated(event);

      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityEventLogger] Personality created: test-personality by user 123456789012345678'
      );
    });

    it('should handle personality creation with minimal data', async () => {
      const event = {
        type: 'PersonalityCreated',
        aggregateId: 'minimal-personality',
        payload: {
          profile: {
            name: 'minimal-personality',
          },
          ownerId: '987654321098765432',
        },
      };

      await eventLogger.handlePersonalityCreated(event);

      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityEventLogger] Personality created: minimal-personality by user 987654321098765432'
      );
    });

    it('should handle personality creation with special characters in name', async () => {
      const event = {
        type: 'PersonalityCreated',
        aggregateId: 'special-chars-test',
        payload: {
          profile: {
            name: 'special-chars@test#personality',
          },
          ownerId: '111222333444555666',
        },
      };

      await eventLogger.handlePersonalityCreated(event);

      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityEventLogger] Personality created: special-chars@test#personality by user 111222333444555666'
      );
    });

    it('should complete successfully and return undefined', async () => {
      const event = {
        type: 'PersonalityCreated',
        aggregateId: 'test-personality',
        payload: {
          profile: { name: 'test-personality' },
          ownerId: '123456789012345678',
        },
      };

      const result = await eventLogger.handlePersonalityCreated(event);

      expect(result).toBeUndefined();
      expect(logger.info).toHaveBeenCalledTimes(1);
    });
  });

  describe('handlePersonalityProfileUpdated', () => {
    it('should log personality profile update with correct information', async () => {
      const event = {
        type: 'PersonalityProfileUpdated',
        aggregateId: 'updated-personality',
        payload: {
          changes: {
            displayName: 'New Display Name',
            avatarUrl: 'https://example.com/new-avatar.png',
          },
        },
        timestamp: new Date().toISOString(),
      };

      await eventLogger.handlePersonalityProfileUpdated(event);

      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityEventLogger] Personality profile updated: updated-personality'
      );
    });

    it('should handle profile update with long personality name', async () => {
      const longPersonalityName = 'a'.repeat(100);
      const event = {
        type: 'PersonalityProfileUpdated',
        aggregateId: longPersonalityName,
        payload: {
          changes: { displayName: 'Updated Name' },
        },
      };

      await eventLogger.handlePersonalityProfileUpdated(event);

      expect(logger.info).toHaveBeenCalledWith(
        `[PersonalityEventLogger] Personality profile updated: ${longPersonalityName}`
      );
    });

    it('should handle profile update with minimal event data', async () => {
      const event = {
        type: 'PersonalityProfileUpdated',
        aggregateId: 'minimal-update',
        payload: {},
      };

      await eventLogger.handlePersonalityProfileUpdated(event);

      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityEventLogger] Personality profile updated: minimal-update'
      );
    });

    it('should complete successfully and return undefined', async () => {
      const event = {
        type: 'PersonalityProfileUpdated',
        aggregateId: 'test-personality',
        payload: { changes: {} },
      };

      const result = await eventLogger.handlePersonalityProfileUpdated(event);

      expect(result).toBeUndefined();
      expect(logger.info).toHaveBeenCalledTimes(1);
    });
  });

  describe('handlePersonalityRemoved', () => {
    it('should log personality removal with correct information', async () => {
      const event = {
        type: 'PersonalityRemoved',
        aggregateId: 'removed-personality',
        payload: {
          reason: 'User request',
        },
        timestamp: new Date().toISOString(),
      };

      await eventLogger.handlePersonalityRemoved(event);

      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityEventLogger] Personality removed: removed-personality'
      );
    });

    it('should handle personality removal with empty payload', async () => {
      const event = {
        type: 'PersonalityRemoved',
        aggregateId: 'simple-removal',
        payload: {},
      };

      await eventLogger.handlePersonalityRemoved(event);

      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityEventLogger] Personality removed: simple-removal'
      );
    });

    it('should handle personality removal with null payload', async () => {
      const event = {
        type: 'PersonalityRemoved',
        aggregateId: 'null-payload-removal',
        payload: null,
      };

      await eventLogger.handlePersonalityRemoved(event);

      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityEventLogger] Personality removed: null-payload-removal'
      );
    });

    it('should complete successfully and return undefined', async () => {
      const event = {
        type: 'PersonalityRemoved',
        aggregateId: 'test-personality',
        payload: {},
      };

      const result = await eventLogger.handlePersonalityRemoved(event);

      expect(result).toBeUndefined();
      expect(logger.info).toHaveBeenCalledTimes(1);
    });
  });

  describe('handlePersonalityAliasAdded', () => {
    it('should log alias addition with correct information', async () => {
      const event = {
        type: 'PersonalityAliasAdded',
        aggregateId: 'main-personality',
        payload: {
          alias: 'new-alias',
        },
        timestamp: new Date().toISOString(),
      };

      await eventLogger.handlePersonalityAliasAdded(event);

      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityEventLogger] Alias added: new-alias to personality main-personality'
      );
    });

    it('should handle alias addition with special characters', async () => {
      const event = {
        type: 'PersonalityAliasAdded',
        aggregateId: 'personality-with-special-chars',
        payload: {
          alias: 'alias@with#special$chars',
        },
      };

      await eventLogger.handlePersonalityAliasAdded(event);

      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityEventLogger] Alias added: alias@with#special$chars to personality personality-with-special-chars'
      );
    });

    it('should handle alias addition with long names', async () => {
      const longPersonality = 'a'.repeat(50);
      const longAlias = 'b'.repeat(50);
      const event = {
        type: 'PersonalityAliasAdded',
        aggregateId: longPersonality,
        payload: {
          alias: longAlias,
        },
      };

      await eventLogger.handlePersonalityAliasAdded(event);

      expect(logger.info).toHaveBeenCalledWith(
        `[PersonalityEventLogger] Alias added: ${longAlias} to personality ${longPersonality}`
      );
    });

    it('should handle alias addition with empty string alias', async () => {
      const event = {
        type: 'PersonalityAliasAdded',
        aggregateId: 'test-personality',
        payload: {
          alias: '',
        },
      };

      await eventLogger.handlePersonalityAliasAdded(event);

      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityEventLogger] Alias added:  to personality test-personality'
      );
    });

    it('should complete successfully and return undefined', async () => {
      const event = {
        type: 'PersonalityAliasAdded',
        aggregateId: 'test-personality',
        payload: { alias: 'test-alias' },
      };

      const result = await eventLogger.handlePersonalityAliasAdded(event);

      expect(result).toBeUndefined();
      expect(logger.info).toHaveBeenCalledTimes(1);
    });
  });

  describe('handlePersonalityAliasRemoved', () => {
    it('should log alias removal with correct information', async () => {
      const event = {
        type: 'PersonalityAliasRemoved',
        aggregateId: 'main-personality',
        payload: {
          alias: 'old-alias',
        },
        timestamp: new Date().toISOString(),
      };

      await eventLogger.handlePersonalityAliasRemoved(event);

      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityEventLogger] Alias removed: old-alias from personality main-personality'
      );
    });

    it('should handle alias removal with unicode characters', async () => {
      const event = {
        type: 'PersonalityAliasRemoved',
        aggregateId: 'unicode-personality',
        payload: {
          alias: '🤖-robot-alias',
        },
      };

      await eventLogger.handlePersonalityAliasRemoved(event);

      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityEventLogger] Alias removed: 🤖-robot-alias from personality unicode-personality'
      );
    });

    it('should handle alias removal with minimal data', async () => {
      const event = {
        type: 'PersonalityAliasRemoved',
        aggregateId: 'minimal-personality',
        payload: {
          alias: 'a',
        },
      };

      await eventLogger.handlePersonalityAliasRemoved(event);

      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityEventLogger] Alias removed: a from personality minimal-personality'
      );
    });

    it('should handle alias removal with undefined payload values', async () => {
      const event = {
        type: 'PersonalityAliasRemoved',
        aggregateId: 'undefined-test',
        payload: {
          alias: undefined,
        },
      };

      await eventLogger.handlePersonalityAliasRemoved(event);

      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityEventLogger] Alias removed: undefined from personality undefined-test'
      );
    });

    it('should complete successfully and return undefined', async () => {
      const event = {
        type: 'PersonalityAliasRemoved',
        aggregateId: 'test-personality',
        payload: { alias: 'test-alias' },
      };

      const result = await eventLogger.handlePersonalityAliasRemoved(event);

      expect(result).toBeUndefined();
      expect(logger.info).toHaveBeenCalledTimes(1);
    });
  });

  describe('Event Handler Integration', () => {
    it('should handle all event types consistently', async () => {
      const basePayload = {
        timestamp: new Date().toISOString(),
      };

      const events = [
        {
          type: 'PersonalityCreated',
          aggregateId: 'integration-test',
          payload: {
            ...basePayload,
            profile: { name: 'integration-test' },
            ownerId: '123456789012345678',
          },
        },
        {
          type: 'PersonalityProfileUpdated',
          aggregateId: 'integration-test',
          payload: {
            ...basePayload,
            changes: { displayName: 'Updated Name' },
          },
        },
        {
          type: 'PersonalityAliasAdded',
          aggregateId: 'integration-test',
          payload: {
            ...basePayload,
            alias: 'test-alias',
          },
        },
        {
          type: 'PersonalityAliasRemoved',
          aggregateId: 'integration-test',
          payload: {
            ...basePayload,
            alias: 'test-alias',
          },
        },
        {
          type: 'PersonalityRemoved',
          aggregateId: 'integration-test',
          payload: basePayload,
        },
      ];

      // Process all events
      for (const event of events) {
        if (event.type === 'PersonalityCreated') {
          await eventLogger.handlePersonalityCreated(event);
        } else if (event.type === 'PersonalityProfileUpdated') {
          await eventLogger.handlePersonalityProfileUpdated(event);
        } else if (event.type === 'PersonalityAliasAdded') {
          await eventLogger.handlePersonalityAliasAdded(event);
        } else if (event.type === 'PersonalityAliasRemoved') {
          await eventLogger.handlePersonalityAliasRemoved(event);
        } else if (event.type === 'PersonalityRemoved') {
          await eventLogger.handlePersonalityRemoved(event);
        }
      }

      // Verify all events were logged
      expect(logger.info).toHaveBeenCalledTimes(5);
      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityEventLogger] Personality created: integration-test by user 123456789012345678'
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityEventLogger] Personality profile updated: integration-test'
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityEventLogger] Alias added: test-alias to personality integration-test'
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityEventLogger] Alias removed: test-alias from personality integration-test'
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityEventLogger] Personality removed: integration-test'
      );
    });

    it('should handle concurrent event processing', async () => {
      const events = Array.from({ length: 10 }, (_, i) => ({
        type: 'PersonalityCreated',
        aggregateId: `concurrent-test-${i}`,
        payload: {
          profile: { name: `concurrent-test-${i}` },
          ownerId: '123456789012345678',
        },
      }));

      // Process all events concurrently
      const promises = events.map(event => eventLogger.handlePersonalityCreated(event));
      await Promise.all(promises);

      expect(logger.info).toHaveBeenCalledTimes(10);
      // Verify each event was logged
      for (let i = 0; i < 10; i++) {
        expect(logger.info).toHaveBeenCalledWith(
          `[PersonalityEventLogger] Personality created: concurrent-test-${i} by user 123456789012345678`
        );
      }
    });

    it('should maintain consistent logging format across all handlers', async () => {
      const testEvents = [
        {
          handler: 'handlePersonalityCreated',
          event: {
            payload: { profile: { name: 'test' }, ownerId: '123' },
          },
          expectedPattern: /^\[PersonalityEventLogger\] Personality created:/,
        },
        {
          handler: 'handlePersonalityProfileUpdated',
          event: { aggregateId: 'test' },
          expectedPattern: /^\[PersonalityEventLogger\] Personality profile updated:/,
        },
        {
          handler: 'handlePersonalityRemoved',
          event: { aggregateId: 'test' },
          expectedPattern: /^\[PersonalityEventLogger\] Personality removed:/,
        },
        {
          handler: 'handlePersonalityAliasAdded',
          event: { aggregateId: 'test', payload: { alias: 'alias' } },
          expectedPattern: /^\[PersonalityEventLogger\] Alias added:/,
        },
        {
          handler: 'handlePersonalityAliasRemoved',
          event: { aggregateId: 'test', payload: { alias: 'alias' } },
          expectedPattern: /^\[PersonalityEventLogger\] Alias removed:/,
        },
      ];

      for (const testCase of testEvents) {
        jest.clearAllMocks();
        await eventLogger[testCase.handler](testCase.event);

        expect(logger.info).toHaveBeenCalledWith(expect.stringMatching(testCase.expectedPattern));
      }
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle events with missing aggregateId', async () => {
      const event = {
        type: 'PersonalityProfileUpdated',
        aggregateId: undefined,
        payload: {},
      };

      await eventLogger.handlePersonalityProfileUpdated(event);

      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityEventLogger] Personality profile updated: undefined'
      );
    });

    it('should handle events with null aggregateId', async () => {
      const event = {
        type: 'PersonalityRemoved',
        aggregateId: null,
        payload: {},
      };

      await eventLogger.handlePersonalityRemoved(event);

      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityEventLogger] Personality removed: null'
      );
    });

    it('should handle events with missing payload properties', async () => {
      const event = {
        type: 'PersonalityAliasAdded',
        aggregateId: 'test-personality',
        payload: {}, // Empty payload, but payload exists
      };

      await eventLogger.handlePersonalityAliasAdded(event);

      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityEventLogger] Alias added: undefined to personality test-personality'
      );
    });

    it('should handle events with missing nested properties gracefully', async () => {
      const event = {
        type: 'PersonalityCreated',
        aggregateId: 'test-personality',
        payload: {}, // Missing profile and ownerId
      };

      // This should throw since the code doesn't have defensive checks
      await expect(eventLogger.handlePersonalityCreated(event)).rejects.toThrow();
    });
  });
});
