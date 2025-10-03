/**
 * Tests for EventHandlerRegistry
 * Focus on event handler registration and coordination
 */

// Mock dependencies before imports
jest.mock('../../../../src/logger');
jest.mock('../../../../src/application/eventHandlers/PersonalityEventLogger');
jest.mock('../../../../src/application/eventHandlers/PersonalityCacheInvalidator');

const {
  EventHandlerRegistry,
} = require('../../../../src/application/eventHandlers/EventHandlerRegistry');
const logger = require('../../../../src/logger');
const {
  PersonalityEventLogger,
} = require('../../../../src/application/eventHandlers/PersonalityEventLogger');
const {
  PersonalityCacheInvalidator,
} = require('../../../../src/application/eventHandlers/PersonalityCacheInvalidator');

describe('EventHandlerRegistry', () => {
  let mockEventBus;
  let mockProfileInfoCache;
  let mockMessageTracker;
  let mockEventLogger;
  let mockCacheInvalidator;
  let registry;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock event bus
    mockEventBus = {
      subscribe: jest.fn().mockReturnValue(jest.fn()), // Returns unsubscribe function
    };

    // Mock dependencies
    mockProfileInfoCache = {
      deleteFromCache: jest.fn(),
    };

    mockMessageTracker = {
      clear: jest.fn(),
    };

    // Mock event handlers
    mockEventLogger = {
      handlePersonalityCreated: jest.fn(),
      handlePersonalityProfileUpdated: jest.fn(),
      handlePersonalityRemoved: jest.fn(),
      handlePersonalityAliasAdded: jest.fn(),
      handlePersonalityAliasRemoved: jest.fn(),
    };
    PersonalityEventLogger.mockImplementation(() => mockEventLogger);

    mockCacheInvalidator = {
      handlePersonalityProfileUpdated: jest.fn(),
      handlePersonalityRemoved: jest.fn(),
      handlePersonalityAliasAdded: jest.fn(),
      handlePersonalityAliasRemoved: jest.fn(),
    };
    PersonalityCacheInvalidator.mockImplementation(() => mockCacheInvalidator);

    registry = new EventHandlerRegistry({
      eventBus: mockEventBus,
      profileInfoCache: mockProfileInfoCache,
      messageTracker: mockMessageTracker,
    });
  });

  describe('Constructor', () => {
    it('should initialize with dependencies', () => {
      expect(registry.eventBus).toBe(mockEventBus);
      expect(registry.profileInfoCache).toBe(mockProfileInfoCache);
      expect(registry.messageTracker).toBe(mockMessageTracker);
      expect(registry.subscriptions).toEqual([]);
    });
  });

  describe('Handler Registration', () => {
    it('should register all event handlers', () => {
      registry.registerHandlers();

      // Verify handler instances were created
      expect(PersonalityEventLogger).toHaveBeenCalledTimes(1);
      expect(PersonalityCacheInvalidator).toHaveBeenCalledWith({
        profileInfoCache: mockProfileInfoCache,
        messageTracker: mockMessageTracker,
      });

      // Verify all event subscriptions (9 personality + 2 blacklist)
      expect(mockEventBus.subscribe).toHaveBeenCalledTimes(11);

      // Check specific event subscriptions
      expect(mockEventBus.subscribe).toHaveBeenCalledWith(
        'PersonalityCreated',
        expect.any(Function)
      );
      expect(mockEventBus.subscribe).toHaveBeenCalledWith(
        'PersonalityProfileUpdated',
        expect.any(Function)
      );
      expect(mockEventBus.subscribe).toHaveBeenCalledWith(
        'PersonalityRemoved',
        expect.any(Function)
      );
      expect(mockEventBus.subscribe).toHaveBeenCalledWith(
        'PersonalityAliasAdded',
        expect.any(Function)
      );
      expect(mockEventBus.subscribe).toHaveBeenCalledWith(
        'PersonalityAliasRemoved',
        expect.any(Function)
      );

      // Verify subscriptions are stored
      expect(registry.subscriptions).toHaveLength(9);

      // Verify logging
      expect(logger.info).toHaveBeenCalledWith(
        '[EventHandlerRegistry] Registering domain event handlers'
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[EventHandlerRegistry] Registered 9 event handlers'
      );
    });

    it('should register PersonalityCreated event handlers', () => {
      registry.registerHandlers();

      // Get the callback function for PersonalityCreated
      const personalityCreatedCalls = mockEventBus.subscribe.mock.calls.filter(
        call => call[0] === 'PersonalityCreated'
      );

      expect(personalityCreatedCalls).toHaveLength(1);

      // Test the callback
      const event = { type: 'PersonalityCreated', payload: { name: 'test' } };
      personalityCreatedCalls[0][1](event);

      expect(mockEventLogger.handlePersonalityCreated).toHaveBeenCalledWith(event);
    });

    it('should register PersonalityProfileUpdated event handlers', () => {
      registry.registerHandlers();

      // Get the callback functions for PersonalityProfileUpdated
      const profileUpdatedCalls = mockEventBus.subscribe.mock.calls.filter(
        call => call[0] === 'PersonalityProfileUpdated'
      );

      expect(profileUpdatedCalls).toHaveLength(2); // Logger + cache invalidator

      // Test both callbacks
      const event = { type: 'PersonalityProfileUpdated', payload: { name: 'test' } };

      profileUpdatedCalls[0][1](event); // Logger
      expect(mockEventLogger.handlePersonalityProfileUpdated).toHaveBeenCalledWith(event);

      profileUpdatedCalls[1][1](event); // Cache invalidator
      expect(mockCacheInvalidator.handlePersonalityProfileUpdated).toHaveBeenCalledWith(event);
    });

    it('should register PersonalityRemoved event handlers', () => {
      registry.registerHandlers();

      // Get the callback functions for PersonalityRemoved
      const removedCalls = mockEventBus.subscribe.mock.calls.filter(
        call => call[0] === 'PersonalityRemoved'
      );

      expect(removedCalls).toHaveLength(2); // Logger + cache invalidator

      // Test both callbacks
      const event = { type: 'PersonalityRemoved', payload: { name: 'test' } };

      removedCalls[0][1](event); // Logger
      expect(mockEventLogger.handlePersonalityRemoved).toHaveBeenCalledWith(event);

      removedCalls[1][1](event); // Cache invalidator
      expect(mockCacheInvalidator.handlePersonalityRemoved).toHaveBeenCalledWith(event);
    });

    it('should register PersonalityAliasAdded event handlers', () => {
      registry.registerHandlers();

      // Get the callback functions for PersonalityAliasAdded
      const aliasAddedCalls = mockEventBus.subscribe.mock.calls.filter(
        call => call[0] === 'PersonalityAliasAdded'
      );

      expect(aliasAddedCalls).toHaveLength(2); // Logger + cache invalidator

      // Test both callbacks
      const event = { type: 'PersonalityAliasAdded', payload: { alias: 'test-alias' } };

      aliasAddedCalls[0][1](event); // Logger
      expect(mockEventLogger.handlePersonalityAliasAdded).toHaveBeenCalledWith(event);

      aliasAddedCalls[1][1](event); // Cache invalidator
      expect(mockCacheInvalidator.handlePersonalityAliasAdded).toHaveBeenCalledWith(event);
    });

    it('should register PersonalityAliasRemoved event handlers', () => {
      registry.registerHandlers();

      // Get the callback functions for PersonalityAliasRemoved
      const aliasRemovedCalls = mockEventBus.subscribe.mock.calls.filter(
        call => call[0] === 'PersonalityAliasRemoved'
      );

      expect(aliasRemovedCalls).toHaveLength(2); // Logger + cache invalidator

      // Test both callbacks
      const event = { type: 'PersonalityAliasRemoved', payload: { alias: 'test-alias' } };

      aliasRemovedCalls[0][1](event); // Logger
      expect(mockEventLogger.handlePersonalityAliasRemoved).toHaveBeenCalledWith(event);

      aliasRemovedCalls[1][1](event); // Cache invalidator
      expect(mockCacheInvalidator.handlePersonalityAliasRemoved).toHaveBeenCalledWith(event);
    });
  });

  describe('Handler Unregistration', () => {
    it('should unregister all event handlers', () => {
      // First register handlers
      registry.registerHandlers();
      expect(registry.subscriptions).toHaveLength(9);

      // Mock unsubscribe functions
      const mockUnsubscribeFunctions = registry.subscriptions.map(() => jest.fn());
      registry.subscriptions = mockUnsubscribeFunctions;

      // Unregister
      registry.unregisterHandlers();

      // Verify all unsubscribe functions were called
      mockUnsubscribeFunctions.forEach(unsubscribe => {
        expect(unsubscribe).toHaveBeenCalledTimes(1);
      });

      // Verify subscriptions array is cleared
      expect(registry.subscriptions).toEqual([]);

      // Verify logging
      expect(logger.info).toHaveBeenCalledWith(
        '[EventHandlerRegistry] Unregistering domain event handlers'
      );
    });

    it('should handle unregistration when no handlers are registered', () => {
      expect(registry.subscriptions).toHaveLength(0);

      registry.unregisterHandlers();

      expect(registry.subscriptions).toEqual([]);
      expect(logger.info).toHaveBeenCalledWith(
        '[EventHandlerRegistry] Unregistering domain event handlers'
      );
    });
  });

  describe('End-to-End Handler Flow', () => {
    it('should properly register and unregister handlers', () => {
      // Register handlers
      registry.registerHandlers();

      const initialSubscriptionCount = registry.subscriptions.length;
      expect(initialSubscriptionCount).toBe(9);

      // Verify all event types are handled
      const subscribedEvents = mockEventBus.subscribe.mock.calls.map(call => call[0]);
      expect(subscribedEvents).toContain('PersonalityCreated');
      expect(subscribedEvents).toContain('PersonalityProfileUpdated');
      expect(subscribedEvents).toContain('PersonalityRemoved');
      expect(subscribedEvents).toContain('PersonalityAliasAdded');
      expect(subscribedEvents).toContain('PersonalityAliasRemoved');

      // Unregister handlers
      registry.unregisterHandlers();

      expect(registry.subscriptions).toHaveLength(0);
    });

    it('should handle multiple registration calls gracefully', () => {
      // Register twice
      registry.registerHandlers();
      const firstCount = registry.subscriptions.length;

      registry.registerHandlers();
      const secondCount = registry.subscriptions.length;

      // Should have double the subscriptions
      expect(secondCount).toBe(firstCount * 2);
      expect(PersonalityEventLogger).toHaveBeenCalledTimes(2);
      expect(PersonalityCacheInvalidator).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle errors in event handler creation', () => {
      PersonalityEventLogger.mockImplementation(() => {
        throw new Error('Failed to create logger');
      });

      expect(() => registry.registerHandlers()).toThrow('Failed to create logger');
    });

    it('should handle errors in event subscription', () => {
      mockEventBus.subscribe.mockImplementation(() => {
        throw new Error('Subscription failed');
      });

      expect(() => registry.registerHandlers()).toThrow('Subscription failed');
    });

    it('should handle errors during unregistration', () => {
      registry.registerHandlers();

      // Mock one unsubscribe function to throw error
      const errorFunction = jest.fn().mockImplementation(() => {
        throw new Error('Unsubscribe failed');
      });
      registry.subscriptions[0] = errorFunction;

      // Should throw error but attempt to call all unsubscribe functions
      expect(() => registry.unregisterHandlers()).toThrow('Unsubscribe failed');
    });
  });

  describe('Handler Dependencies', () => {
    it('should pass correct dependencies to PersonalityCacheInvalidator', () => {
      registry.registerHandlers();

      expect(PersonalityCacheInvalidator).toHaveBeenCalledWith({
        profileInfoCache: mockProfileInfoCache,
        messageTracker: mockMessageTracker,
      });
    });

    it('should create PersonalityEventLogger without dependencies', () => {
      registry.registerHandlers();

      expect(PersonalityEventLogger).toHaveBeenCalledWith();
    });
  });
});
