/**
 * Tests for ApplicationBootstrap
 * Focus on initialization behavior and integration
 */

// Unmock ApplicationBootstrap since we're testing it directly
jest.unmock('../../../../src/application/bootstrap/ApplicationBootstrap');

// Mock all dependencies before imports
jest.mock('../../../../src/logger');
jest.mock('../../../../src/domain/shared/DomainEventBus');
jest.mock('../../../../src/application/services/PersonalityApplicationService');
jest.mock('../../../../src/adapters/persistence/FilePersonalityRepository');
jest.mock('../../../../src/adapters/persistence/FileAuthenticationRepository');
jest.mock('../../../../src/adapters/ai/HttpAIServiceAdapter');
jest.mock('../../../../src/application/eventHandlers/EventHandlerRegistry');
jest.mock('../../../../src/application/services/FeatureFlags');
jest.mock('../../../../src/application/commands/CommandIntegration');
jest.mock('../../../../src/adapters/CommandIntegrationAdapter');
jest.mock('../../../../src/infrastructure/authentication/OAuthTokenService');
jest.mock('../../../../src/application/services/AuthenticationApplicationService');
jest.mock('../../../../src/profileInfoFetcher');
jest.mock('../../../../src/messageTracker');
jest.mock('../../../../src/core/conversation');
jest.mock('../../../../config');
jest.mock('../../../../src/utils/webhookUserTracker');
jest.mock('../../../../src/utils/channelUtils');
// PersonalityManager removed - now using DDD system
jest.mock('../../../../src/application/services/RequestTrackingService', () => {
  return jest.fn().mockImplementation((options = {}) => ({
    pendingRequests: new Map(),
    completedRequests: new Map(),
    messageProcessing: new Set(),
    checkRequest: jest.fn().mockReturnValue({ canProceed: true }),
    startRequest: jest.fn(),
    completeRequest: jest.fn(),
    failRequest: jest.fn(),
    isMessageBeingProcessed: jest.fn().mockReturnValue(false),
    startMessageProcessing: jest.fn(),
    endMessageProcessing: jest.fn(),
    cleanup: jest.fn(),
    stopCleanup: jest.fn(),
    getStats: jest.fn().mockReturnValue({ pendingRequests: 0, completedRequests: 0, processingMessages: 0 }),
    clear: jest.fn(),
  }));
});

const {
  ApplicationBootstrap,
  getApplicationBootstrap,
  resetApplicationBootstrap,
} = require('../../../../src/application/bootstrap/ApplicationBootstrap');

const logger = require('../../../../src/logger');
const { DomainEventBus } = require('../../../../src/domain/shared/DomainEventBus');
const {
  PersonalityApplicationService,
} = require('../../../../src/application/services/PersonalityApplicationService');
const {
  FilePersonalityRepository,
} = require('../../../../src/adapters/persistence/FilePersonalityRepository');
const {
  FileAuthenticationRepository,
} = require('../../../../src/adapters/persistence/FileAuthenticationRepository');
const { HttpAIServiceAdapter } = require('../../../../src/adapters/ai/HttpAIServiceAdapter');
const {
  EventHandlerRegistry,
} = require('../../../../src/application/eventHandlers/EventHandlerRegistry');
const { createFeatureFlags } = require('../../../../src/application/services/FeatureFlags');
const {
  getCommandIntegration,
} = require('../../../../src/application/commands/CommandIntegration');
const {
  getCommandIntegrationAdapter,
} = require('../../../../src/adapters/CommandIntegrationAdapter');
const { OAuthTokenService } = require('../../../../src/infrastructure/authentication/OAuthTokenService');
const { AuthenticationApplicationService } = require('../../../../src/application/services/AuthenticationApplicationService');

describe('ApplicationBootstrap', () => {
  let mockEventBus;
  let mockFeatureFlags;
  let mockPersonalityApplicationService;
  let mockOAuthTokenService;
  let mockAuthenticationApplicationService;
  let mockCommandIntegration;
  let mockCommandAdapter;
  let mockEventHandlerRegistry;
  let mockConversationManager;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock event bus
    mockEventBus = {
      subscribe: jest.fn(),
      publish: jest.fn(),
      clear: jest.fn(),
    };
    DomainEventBus.mockImplementation(() => mockEventBus);

    // Mock feature flags (default: events enabled)
    mockFeatureFlags = {
      isEnabled: jest.fn().mockReturnValue(true),
    };
    createFeatureFlags.mockReturnValue(mockFeatureFlags);

    // Mock personality application service
    mockPersonalityApplicationService = {
      getPersonality: jest.fn(),
      listPersonalitiesByOwner: jest.fn(),
      registerPersonality: jest.fn(),
    };
    PersonalityApplicationService.mockImplementation(() => mockPersonalityApplicationService);

    // Mock command integration
    mockCommandIntegration = {
      initialize: jest.fn().mockResolvedValue(),
    };
    getCommandIntegration.mockReturnValue(mockCommandIntegration);

    // Mock command adapter
    mockCommandAdapter = {
      initialize: jest.fn().mockResolvedValue(),
    };
    getCommandIntegrationAdapter.mockReturnValue(mockCommandAdapter);

    // Mock event handler registry
    mockEventHandlerRegistry = {
      registerHandlers: jest.fn(),
      unregisterHandlers: jest.fn(),
    };
    EventHandlerRegistry.mockImplementation(() => mockEventHandlerRegistry);

    // Mock conversation manager
    mockConversationManager = {
      getInstance: jest.fn(),
    };
    require('../../../../src/core/conversation').getInstance.mockReturnValue(
      mockConversationManager
    );

    // Mock repositories and services
    FilePersonalityRepository.mockImplementation(() => ({
      initialize: jest.fn().mockResolvedValue(),
    }));
    FileAuthenticationRepository.mockImplementation(() => ({
      initialize: jest.fn().mockResolvedValue(),
    }));
    HttpAIServiceAdapter.mockImplementation(() => ({}));
    PersonalityApplicationService.mockImplementation(() => ({}));

    // Mock authentication services
    mockOAuthTokenService = {};
    OAuthTokenService.mockImplementation(() => mockOAuthTokenService);
    
    mockAuthenticationApplicationService = {};
    AuthenticationApplicationService.mockImplementation(() => mockAuthenticationApplicationService);

    // Legacy PersonalityManager removed - using DDD system now

    // Reset singleton
    resetApplicationBootstrap();
  });

  afterEach(() => {
    resetApplicationBootstrap();
    jest.useRealTimers();
  });

  describe('Initialization', () => {
    it('should initialize successfully with all components', async () => {
      const bootstrap = new ApplicationBootstrap();

      await bootstrap.initialize();

      expect(bootstrap.initialized).toBe(true);
      expect(DomainEventBus).toHaveBeenCalledTimes(1);
      expect(FilePersonalityRepository).toHaveBeenCalledWith({
        dataPath: './data',
        filename: 'personalities.json',
      });
      expect(FileAuthenticationRepository).toHaveBeenCalledWith({
        dataPath: './data',
        filename: 'auth.json',
      });
      expect(logger.info).toHaveBeenCalledWith(
        '[ApplicationBootstrap] ✅ DDD application layer initialization complete'
      );
    });

    it('should create event bus and wire up event handlers when events enabled', async () => {
      mockFeatureFlags.isEnabled.mockImplementation(flag => flag === 'ddd.events.enabled');
      const bootstrap = new ApplicationBootstrap();

      await bootstrap.initialize();

      expect(EventHandlerRegistry).toHaveBeenCalledWith({
        eventBus: mockEventBus,
        profileInfoCache: expect.any(Object),
        messageTracker: expect.any(Object),
        authenticationRepository: expect.any(Object),
        conversationManager: expect.any(Object),
      });
      expect(mockEventHandlerRegistry.registerHandlers).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        '[ApplicationBootstrap] Registered domain event handlers'
      );
    });

    it('should always register event handlers since DDD is now primary system', async () => {
      // Events are always enabled now that backward compatibility is removed
      const bootstrap = new ApplicationBootstrap();

      await bootstrap.initialize();

      expect(EventHandlerRegistry).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        '[ApplicationBootstrap] Registered domain event handlers'
      );
    });

    it('should configure PersonalityApplicationService', async () => {
      const bootstrap = new ApplicationBootstrap();

      await bootstrap.initialize();

      // Verify PersonalityApplicationService was created with correct dependencies
      expect(PersonalityApplicationService).toHaveBeenCalledWith({
        personalityRepository: expect.any(Object),
        aiService: expect.any(Object),
        authenticationRepository: expect.any(Object),
        eventBus: mockEventBus,
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('PersonalityApplicationService')
      );
    });

    it('should initialize command components', async () => {
      const bootstrap = new ApplicationBootstrap();

      await bootstrap.initialize();

      // CommandIntegration should only be initialized through the adapter (no direct initialization)
      expect(mockCommandIntegration.initialize).not.toHaveBeenCalled();

      // CommandIntegrationAdapter should be initialized with application services
      expect(mockCommandAdapter.initialize).toHaveBeenCalledWith(
        expect.objectContaining({
          personalityApplicationService: expect.any(Object),
        })
      );
    });

    it('should not reinitialize if already initialized', async () => {
      const bootstrap = new ApplicationBootstrap();
      await bootstrap.initialize();

      jest.clearAllMocks();
      await bootstrap.initialize();

      expect(DomainEventBus).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith('[ApplicationBootstrap] Already initialized');
    });

    it('should handle initialization errors gracefully', async () => {
      const error = new Error('Initialization failed');
      DomainEventBus.mockImplementation(() => {
        throw error;
      });
      const bootstrap = new ApplicationBootstrap();

      await expect(bootstrap.initialize()).rejects.toThrow('Initialization failed');
      expect(logger.error).toHaveBeenCalledWith(
        '[ApplicationBootstrap] Failed to initialize:',
        error
      );
      expect(bootstrap.initialized).toBe(false);
    });
  });

  describe('Service Access', () => {
    it('should provide access to application services after initialization', async () => {
      const bootstrap = new ApplicationBootstrap();
      await bootstrap.initialize();

      const services = bootstrap.getApplicationServices();

      expect(services).toEqual({
        personalityApplicationService: expect.any(Object),
        requestTrackingService: expect.any(Object),
        conversationManager: mockConversationManager,
        profileInfoCache: expect.any(Object),
        messageTracker: expect.any(Object),
        featureFlags: mockFeatureFlags,
        botPrefix: expect.any(String),
        auth: expect.any(Object), // DDD AuthenticationApplicationService
        authenticationService: expect.any(Object), // DDD AuthenticationApplicationService
        authenticationApplicationService: expect.any(Object), // DDD AuthenticationApplicationService
        webhookUserTracker: expect.any(Object),
        channelUtils: expect.any(Object),
        authenticationRepository: expect.any(Object),
        blacklistService: expect.any(Object), // Global blacklist service
      });
    });

    it('should provide access to event bus after initialization', async () => {
      const bootstrap = new ApplicationBootstrap();
      await bootstrap.initialize();

      const eventBus = bootstrap.getEventBus();

      expect(eventBus).toBe(mockEventBus);
    });

    it('should throw error when accessing services before initialization', () => {
      const bootstrap = new ApplicationBootstrap();

      expect(() => bootstrap.getApplicationServices()).toThrow(
        'ApplicationBootstrap not initialized'
      );
      expect(() => bootstrap.getEventBus()).toThrow('ApplicationBootstrap not initialized');
    });
  });

  describe('Shutdown', () => {
    it('should shutdown cleanly', async () => {
      const bootstrap = new ApplicationBootstrap();
      await bootstrap.initialize();

      await bootstrap.shutdown();

      expect(mockEventHandlerRegistry.unregisterHandlers).toHaveBeenCalled();
      expect(mockEventBus.clear).toHaveBeenCalled();
      expect(bootstrap.initialized).toBe(false);
      expect(logger.info).toHaveBeenCalledWith('[ApplicationBootstrap] Shutdown complete');
    });

    it('should handle shutdown when not initialized', async () => {
      const bootstrap = new ApplicationBootstrap();

      await bootstrap.shutdown();

      expect(bootstrap.initialized).toBe(false);
      expect(logger.info).toHaveBeenCalledWith('[ApplicationBootstrap] Shutdown complete');
    });

    it('should handle shutdown when event handlers not registered', async () => {
      mockFeatureFlags.isEnabled.mockReturnValue(false);
      const bootstrap = new ApplicationBootstrap();
      await bootstrap.initialize();

      await bootstrap.shutdown();

      expect(bootstrap.initialized).toBe(false);
      expect(logger.info).toHaveBeenCalledWith('[ApplicationBootstrap] Shutdown complete');
    });
  });

  describe('Singleton Pattern', () => {
    it('should return same instance for getApplicationBootstrap', () => {
      const instance1 = getApplicationBootstrap();
      const instance2 = getApplicationBootstrap();

      expect(instance1).toBe(instance2);
      expect(instance1).toBeInstanceOf(ApplicationBootstrap);
    });

    it('should reset singleton and allow new instance', async () => {
      const instance1 = getApplicationBootstrap();
      await instance1.initialize();

      resetApplicationBootstrap();
      const instance2 = getApplicationBootstrap();

      expect(instance2).not.toBe(instance1);
      expect(instance2.initialized).toBe(false);
    });

    it('should handle reset with shutdown errors gracefully', async () => {
      const instance = getApplicationBootstrap();
      await instance.initialize();

      // Mock shutdown to throw error
      instance.shutdown = jest.fn().mockRejectedValue(new Error('Shutdown error'));

      resetApplicationBootstrap();

      // Wait for async error handling
      await Promise.resolve(); // Let promises settle
      jest.runAllTimers(); // Run any pending timers
      
      expect(logger.error).toHaveBeenCalledWith(
        '[ApplicationBootstrap] Error during reset shutdown:',
        expect.any(Error)
      );
    });
  });

  describe('Feature Logging', () => {
    it('should log active features during initialization', async () => {
      // All DDD features are now always enabled since backward compatibility was removed
      const bootstrap = new ApplicationBootstrap();

      await bootstrap.initialize();

      expect(logger.info).toHaveBeenCalledWith('[ApplicationBootstrap] DDD system fully active:');
      expect(logger.info).toHaveBeenCalledWith('  - Commands: ✅');
      expect(logger.info).toHaveBeenCalledWith('  - Personality Read: ✅');
      expect(logger.info).toHaveBeenCalledWith('  - Personality Write: ✅');
      expect(logger.info).toHaveBeenCalledWith('  - Events: ✅');
    });
  });

  describe('Environment Configuration', () => {
    it('should use environment variables for AI service configuration', async () => {
      process.env.SERVICE_API_BASE_URL = 'http://test-ai-service:3000';
      process.env.SERVICE_API_KEY = 'test-api-key';
      const bootstrap = new ApplicationBootstrap();

      await bootstrap.initialize();

      expect(HttpAIServiceAdapter).toHaveBeenCalledWith({
        baseUrl: 'http://test-ai-service:3000',
        apiKey: 'test-api-key',
        logger: logger,
      });
    });

    it('should use default values when environment variables not set', async () => {
      delete process.env.SERVICE_API_BASE_URL;
      delete process.env.SERVICE_API_KEY;
      const bootstrap = new ApplicationBootstrap();

      await bootstrap.initialize();

      expect(HttpAIServiceAdapter).toHaveBeenCalledWith({
        baseUrl: 'http://localhost:8080',
        apiKey: 'test-key',
        logger: logger,
      });
    });
  });

  describe('Owner Personality Seeding', () => {
    let mockPersonalityService;
    let mockLegacyManager;
    let mockDelayFunction;

    beforeEach(() => {
      // Mock environment variables
      delete process.env.BOT_OWNER_ID;
      delete process.env.BOT_OWNER_PERSONALITIES;

      // Mock delay function that will be injected
      mockDelayFunction = jest.fn().mockResolvedValue();

      // Mock personality service for DDD
      mockPersonalityService = {
        listPersonalitiesByOwner: jest.fn().mockResolvedValue([]),
        registerPersonality: jest.fn().mockResolvedValue({ profile: { name: 'test' } }),
      };

      // Mock legacy manager
      mockLegacyManager = {
        initialized: true,
        initialize: jest.fn().mockResolvedValue(),
        listPersonalitiesByOwner: jest.fn().mockReturnValue([]),
        registerPersonality: jest.fn().mockResolvedValue({ success: true }),
      };
      // Legacy PersonalityManager removed - using DDD system now
    });

    it('should schedule seeding when DDD personality write is enabled', async () => {
      // Enable DDD personality write
      mockFeatureFlags.isEnabled.mockImplementation(flag => flag === 'ddd.personality.write');
      
      process.env.BOT_OWNER_ID = '123456789012345678';
      process.env.BOT_OWNER_PERSONALITIES = 'lilith,lucifer';

      const bootstrap = new ApplicationBootstrap({ delay: mockDelayFunction });
      await bootstrap.initialize();

      // Seeding should now be scheduled regardless of DDD flag
      expect(logger.info).toHaveBeenCalledWith(
        '[ApplicationBootstrap] ✅ DDD application layer initialization complete'
      );
      expect(mockDelayFunction).toHaveBeenCalledWith(5000);
    });

    it('should schedule seeding when DDD personality write is disabled', async () => {
      // Disable DDD personality write
      mockFeatureFlags.isEnabled.mockImplementation(flag => flag !== 'ddd.personality.write');
      
      process.env.BOT_OWNER_ID = '123456789012345678';
      process.env.BOT_OWNER_PERSONALITIES = 'lilith,lucifer';

      const bootstrap = new ApplicationBootstrap({ delay: mockDelayFunction });
      await bootstrap.initialize();

      // Verify delay was called for background seeding
      expect(mockDelayFunction).toHaveBeenCalledWith(5000);
    });

    describe('_seedOwnerPersonalities', () => {
      let bootstrap;

      beforeEach(() => {
        bootstrap = new ApplicationBootstrap({ delay: mockDelayFunction });
        bootstrap.applicationServices = {
          personalityApplicationService: mockPersonalityService,
        };
      });

      it('should skip seeding when BOT_OWNER_ID is not configured', async () => {
        await bootstrap._seedOwnerPersonalities();

        expect(logger.info).toHaveBeenCalledWith(
          '[ApplicationBootstrap] No BOT_OWNER_ID configured, skipping personality seeding'
        );
      });

      it('should skip seeding when BOT_OWNER_PERSONALITIES is not configured', async () => {
        process.env.BOT_OWNER_ID = '123456789012345678';

        await bootstrap._seedOwnerPersonalities();

        expect(logger.info).toHaveBeenCalledWith(
          '[ApplicationBootstrap] No BOT_OWNER_PERSONALITIES configured, skipping personality seeding'
        );
      });

      it('should use DDD seeding when feature flag is enabled', async () => {
        process.env.BOT_OWNER_ID = '123456789012345678';
        process.env.BOT_OWNER_PERSONALITIES = 'lilith,lucifer';
        mockFeatureFlags.isEnabled.mockReturnValue(true);

        await bootstrap._seedOwnerPersonalities();

        expect(logger.info).toHaveBeenCalledWith(
          '[ApplicationBootstrap] Using DDD PersonalityApplicationService for seeding'
        );
        expect(mockPersonalityService.listPersonalitiesByOwner).toHaveBeenCalled();
      });

      it('should always use DDD seeding since legacy system is removed', async () => {
        process.env.BOT_OWNER_ID = '123456789012345678';
        process.env.BOT_OWNER_PERSONALITIES = 'lilith,lucifer';
        // Legacy system no longer exists - DDD is always used

        await bootstrap._seedOwnerPersonalities();

        expect(logger.info).toHaveBeenCalledWith(
          '[ApplicationBootstrap] Using DDD PersonalityApplicationService for seeding'
        );
      });
    });

    describe('DDD personality seeding', () => {
      let bootstrap;

      beforeEach(() => {
        bootstrap = new ApplicationBootstrap({ delay: mockDelayFunction });
        bootstrap.applicationServices = {
          personalityApplicationService: mockPersonalityService,
        };
      });

      it('should skip when all personalities exist', async () => {
        mockPersonalityService.listPersonalitiesByOwner.mockResolvedValue([
          { profile: { name: 'lilith' } },
          { profile: { name: 'lucifer' } },
        ]);

        await bootstrap._seedOwnerPersonalitiesWithDDD('123456789012345678', ['lilith', 'lucifer']);

        expect(logger.info).toHaveBeenCalledWith(
          '[ApplicationBootstrap] Owner has all 2 expected personalities'
        );
        expect(mockPersonalityService.registerPersonality).not.toHaveBeenCalled();
      });

      it('should seed missing personalities', async () => {
        mockPersonalityService.listPersonalitiesByOwner.mockResolvedValue([
          { profile: { name: 'lilith' } },
        ]);

        await bootstrap._seedOwnerPersonalitiesWithDDD('123456789012345678', ['lilith', 'lucifer', 'baphomet']);

        expect(mockPersonalityService.registerPersonality).toHaveBeenCalledTimes(2);
        expect(mockPersonalityService.registerPersonality).toHaveBeenCalledWith({
          name: 'lucifer',
          ownerId: '123456789012345678',
          mode: 'external',
        });
        expect(mockPersonalityService.registerPersonality).toHaveBeenCalledWith({
          name: 'baphomet',
          ownerId: '123456789012345678',
          mode: 'external',
        });
      });

      it('should handle case-insensitive personality names', async () => {
        mockPersonalityService.listPersonalitiesByOwner.mockResolvedValue([
          { profile: { name: 'Lilith' } }, // Capital L
        ]);

        await bootstrap._seedOwnerPersonalitiesWithDDD('123456789012345678', ['lilith', 'lucifer']);

        expect(mockPersonalityService.registerPersonality).toHaveBeenCalledTimes(1);
        expect(mockPersonalityService.registerPersonality).toHaveBeenCalledWith({
          name: 'lucifer',
          ownerId: '123456789012345678',
          mode: 'external',
        });
      });

      it('should handle registration errors gracefully', async () => {
        mockPersonalityService.listPersonalitiesByOwner.mockResolvedValue([]);
        mockPersonalityService.registerPersonality
          .mockResolvedValueOnce({ profile: { name: 'lilith' } })
          .mockRejectedValueOnce(new Error('API error'));

        await bootstrap._seedOwnerPersonalitiesWithDDD('123456789012345678', ['lilith', 'lucifer']);

        expect(logger.error).toHaveBeenCalledWith(
          '[ApplicationBootstrap] Failed to seed lucifer via DDD: API error'
        );
        expect(logger.info).toHaveBeenCalledWith(
          '[ApplicationBootstrap] Seeded 1 owner personalities via DDD'
        );
      });
    });

    // Legacy personality seeding tests removed - legacy system no longer exists
  });
});
