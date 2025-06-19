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
jest.mock('../../../../src/application/routers/PersonalityRouter');
jest.mock('../../../../src/application/commands/CommandIntegration');
jest.mock('../../../../src/adapters/CommandIntegrationAdapter');
jest.mock('../../../../src/profileInfoFetcher');
jest.mock('../../../../src/messageTracker');
jest.mock('../../../../src/core/conversation');
jest.mock('../../../../config');
jest.mock('../../../../src/auth');
jest.mock('../../../../src/utils/webhookUserTracker');
jest.mock('../../../../src/utils/channelUtils');
jest.mock('../../../../src/core/personality/PersonalityManager');

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
const { getFeatureFlags } = require('../../../../src/application/services/FeatureFlags');
const { getPersonalityRouter } = require('../../../../src/application/routers/PersonalityRouter');
const {
  getCommandIntegration,
} = require('../../../../src/application/commands/CommandIntegration');
const {
  getCommandIntegrationAdapter,
} = require('../../../../src/adapters/CommandIntegrationAdapter');

describe('ApplicationBootstrap', () => {
  let mockEventBus;
  let mockFeatureFlags;
  let mockPersonalityRouter;
  let mockCommandIntegration;
  let mockCommandAdapter;
  let mockEventHandlerRegistry;
  let mockConversationManager;

  beforeEach(() => {
    jest.clearAllMocks();

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
    getFeatureFlags.mockReturnValue(mockFeatureFlags);

    // Mock router
    mockPersonalityRouter = {
      personalityService: null,
    };
    getPersonalityRouter.mockReturnValue(mockPersonalityRouter);

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

    // Mock PersonalityManager
    const PersonalityManager = require('../../../../src/core/personality/PersonalityManager');
    PersonalityManager.getInstance = jest.fn().mockReturnValue({
      initialized: false,
      initialize: jest.fn().mockResolvedValue(),
      listPersonalitiesForUser: jest.fn().mockReturnValue([]),
      registerPersonality: jest.fn().mockResolvedValue({ success: true }),
    });

    // Reset singleton
    resetApplicationBootstrap();
  });

  afterEach(() => {
    resetApplicationBootstrap();
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
      });
      expect(mockEventHandlerRegistry.registerHandlers).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        '[ApplicationBootstrap] Registered domain event handlers'
      );
    });

    it('should skip event handlers when events disabled', async () => {
      mockFeatureFlags.isEnabled.mockImplementation(flag => flag !== 'ddd.events.enabled');
      const bootstrap = new ApplicationBootstrap();

      await bootstrap.initialize();

      expect(EventHandlerRegistry).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        '[ApplicationBootstrap] Domain event handlers disabled by feature flag'
      );
    });

    it('should configure PersonalityRouter with application service', async () => {
      const bootstrap = new ApplicationBootstrap();

      await bootstrap.initialize();

      expect(mockPersonalityRouter.personalityService).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith(
        '[ApplicationBootstrap] Configured PersonalityRouter'
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
        conversationManager: mockConversationManager,
        profileInfoCache: expect.any(Object),
        messageTracker: expect.any(Object),
        featureFlags: mockFeatureFlags,
        botPrefix: expect.any(String),
        auth: expect.any(Object),
        webhookUserTracker: expect.any(Object),
        channelUtils: expect.any(Object),
        authenticationRepository: expect.any(Object),
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

      // Wait for async error handling using a Promise-based approach
      await new Promise(resolve => {
        setTimeout(() => {
          expect(logger.error).toHaveBeenCalledWith(
            '[ApplicationBootstrap] Error during reset shutdown:',
            expect.any(Error)
          );
          resolve();
        }, 10);
      });
    });
  });

  describe('Feature Logging', () => {
    it('should log active features during initialization', async () => {
      mockFeatureFlags.isEnabled.mockImplementation(flag => {
        const enabledFlags = ['ddd.commands.enabled', 'ddd.events.enabled'];
        return enabledFlags.includes(flag);
      });
      const bootstrap = new ApplicationBootstrap();

      await bootstrap.initialize();

      expect(logger.info).toHaveBeenCalledWith('[ApplicationBootstrap] Active DDD features:');
      expect(logger.info).toHaveBeenCalledWith('  - Commands: ✅');
      expect(logger.info).toHaveBeenCalledWith('  - Events: ✅');
      expect(logger.info).toHaveBeenCalledWith('  - Personality Read: ❌');
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
});
