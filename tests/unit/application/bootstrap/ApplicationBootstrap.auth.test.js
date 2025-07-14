/**
 * Tests for ApplicationBootstrap authentication integration
 * Focus on DDD authentication services wiring
 */

// Unmock ApplicationBootstrap since we're testing it directly
jest.unmock('../../../../src/application/bootstrap/ApplicationBootstrap');

// Mock all dependencies before imports
jest.mock('../../../../src/logger');
jest.mock('../../../../src/domain/shared/DomainEventBus');
jest.mock('../../../../src/application/services/PersonalityApplicationService');
jest.mock('../../../../src/application/services/AuthenticationApplicationService');
jest.mock('../../../../src/application/services/AuthenticationAntiCorruptionLayer');
jest.mock('../../../../src/infrastructure/authentication/OAuthTokenService');
jest.mock('../../../../src/adapters/persistence/FilePersonalityRepository');
jest.mock('../../../../src/adapters/persistence/FileAuthenticationRepository');
jest.mock('../../../../src/adapters/ai/HttpAIServiceAdapter');
jest.mock('../../../../src/application/eventHandlers/EventHandlerRegistry');
jest.mock('../../../../src/application/services/FeatureFlags');
jest.mock('../../../../src/application/routers/PersonalityRouter');
jest.mock('../../../../src/adapters/CommandIntegrationAdapter');
jest.mock('../../../../src/profileInfoFetcher');
jest.mock('../../../../src/messageTracker');
jest.mock('../../../../src/core/conversation');
jest.mock('../../../../config');
jest.mock('../../../../src/utils/webhookUserTracker');
jest.mock('../../../../src/utils/channelUtils');
jest.mock('../../../../src/utils/avatarStorage');
jest.mock('../../../../src/utils/aliasResolver');
jest.mock('../../../../src/config/MessageHandlerConfig');
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
} = require('../../../../src/application/bootstrap/ApplicationBootstrap');

const logger = require('../../../../src/logger');
const { DomainEventBus } = require('../../../../src/domain/shared/DomainEventBus');
const { PersonalityApplicationService } = require('../../../../src/application/services/PersonalityApplicationService');
const { HttpAIServiceAdapter } = require('../../../../src/adapters/ai/HttpAIServiceAdapter');
const { EventHandlerRegistry } = require('../../../../src/application/eventHandlers/EventHandlerRegistry');
const { AuthenticationApplicationService } = require('../../../../src/application/services/AuthenticationApplicationService');
const { AuthenticationAntiCorruptionLayer } = require('../../../../src/application/services/AuthenticationAntiCorruptionLayer');
const { OAuthTokenService } = require('../../../../src/infrastructure/authentication/OAuthTokenService');
const { FileAuthenticationRepository } = require('../../../../src/adapters/persistence/FileAuthenticationRepository');
const { FilePersonalityRepository } = require('../../../../src/adapters/persistence/FilePersonalityRepository');
const { PersonalityRouter } = require('../../../../src/application/routers/PersonalityRouter');
const { getCommandIntegrationAdapter } = require('../../../../src/adapters/CommandIntegrationAdapter');
const avatarStorage = require('../../../../src/utils/avatarStorage');
const aliasResolver = require('../../../../src/utils/aliasResolver');
const messageHandlerConfig = require('../../../../src/config/MessageHandlerConfig');

describe('ApplicationBootstrap - Authentication Integration', () => {
  let mockEventBus;
  let mockAuthAppService;
  let mockACL;
  let mockTokenService;
  let mockAuthRepository;
  let mockAuthManager;
  let mockCommandAdapter;

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

    // Mock auth repository
    mockAuthRepository = {
      initialize: jest.fn().mockResolvedValue(undefined),
      save: jest.fn(),
      findByUserId: jest.fn(),
    };
    FileAuthenticationRepository.mockImplementation(() => mockAuthRepository);

    // Mock token service
    mockTokenService = {
      getAuthorizationUrl: jest.fn(),
      exchangeCode: jest.fn(),
      refreshToken: jest.fn(),
      revokeToken: jest.fn(),
    };
    OAuthTokenService.mockImplementation(() => mockTokenService);

    // Mock auth application service
    mockAuthAppService = {
      getAuthorizationUrl: jest.fn(),
      exchangeCodeForToken: jest.fn(),
      getAuthenticationStatus: jest.fn(),
      checkPersonalityAccess: jest.fn(),
    };
    AuthenticationApplicationService.mockImplementation(() => mockAuthAppService);

    // Mock ACL
    mockACL = {
      getAuthorizationUrl: jest.fn(),
      exchangeCodeForToken: jest.fn(),
      isUserAuthenticated: jest.fn(),
      validateUserAccess: jest.fn(),
      getTokenFromCode: jest.fn(),
      storeUserToken: jest.fn(),
      hasValidToken: jest.fn(),
      getTokenAge: jest.fn(),
      getTokenExpirationInfo: jest.fn(),
      deleteUserToken: jest.fn(),
      cleanupExpiredTokens: jest.fn(),
    };
    AuthenticationAntiCorruptionLayer.mockImplementation(() => mockACL);

    // Mock legacy auth manager
    mockAuthManager = {
      validateUserAuth: jest.fn(),
      getAuthorizationUrl: jest.fn(),
    };

    // Mock command adapter
    mockCommandAdapter = {
      initialize: jest.fn().mockResolvedValue(undefined),
    };
    getCommandIntegrationAdapter.mockReturnValue(mockCommandAdapter);

    // Mock personality repository
    FilePersonalityRepository.mockImplementation(() => ({
      initialize: jest.fn().mockResolvedValue(undefined),
    }));

    // Mock personality router
    PersonalityRouter.mockImplementation(() => ({}));

    // Mock personality application service
    PersonalityApplicationService.mockImplementation(() => ({
      getMaxAliasWordCount: jest.fn().mockResolvedValue(5),
    }));

    // Mock AI service adapter
    HttpAIServiceAdapter.mockImplementation(() => ({}));

    // Mock event handler registry
    EventHandlerRegistry.mockImplementation(() => ({
      registerHandlers: jest.fn(),
      unregisterHandlers: jest.fn(),
    }));

    // Mock other required services
    require('../../../../src/profileInfoFetcher').deleteFromCache = jest.fn();
    require('../../../../src/messageTracker').messageTracker = {};
    require('../../../../src/core/conversation').getInstance = jest.fn().mockReturnValue({});
    require('../../../../src/utils/webhookUserTracker');
    require('../../../../src/utils/channelUtils');
    require('../../../../config').botPrefix = '!tz';

    // Mock avatar storage
    avatarStorage.initialize = jest.fn().mockResolvedValue(undefined);
    
    // Mock alias resolver
    aliasResolver.setPersonalityRouter = jest.fn();
    
    // Mock message handler config
    messageHandlerConfig.setMaxAliasWordCount = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Authentication Service Initialization', () => {
    it('should create OAuthTokenService with correct config', async () => {
      process.env.SERVICE_APP_ID = 'test-app-id';
      process.env.SERVICE_API_KEY = 'test-api-key';
      process.env.SERVICE_API_BASE_URL = 'http://test-api.com';
      process.env.SERVICE_WEBSITE = 'http://test-website.com';

      const bootstrap = new ApplicationBootstrap();
      await bootstrap.initialize();

      expect(OAuthTokenService).toHaveBeenCalledWith({
        appId: 'test-app-id',
        apiKey: 'test-api-key',
        authApiEndpoint: 'http://test-api.com/auth',
        authWebsite: 'http://test-website.com',
        serviceApiBaseUrl: 'http://test-api.com',
      });
    });

    it('should create AuthenticationApplicationService with dependencies', async () => {
      const bootstrap = new ApplicationBootstrap();
      await bootstrap.initialize();

      expect(AuthenticationApplicationService).toHaveBeenCalledWith({
        authenticationRepository: mockAuthRepository,
        tokenService: mockTokenService,
        eventBus: mockEventBus,
        config: expect.objectContaining({
          ownerId: process.env.BOT_OWNER_ID,
          tokenExpirationMs: 30 * 24 * 60 * 60 * 1000,
          nsfwVerificationExpiryMs: 24 * 60 * 60 * 1000,
        }),
      });
    });

    it('should create ACL when legacy auth manager is set', async () => {
      const bootstrap = new ApplicationBootstrap();
      bootstrap.setAuthManager(mockAuthManager);
      
      await bootstrap.initialize();

      expect(AuthenticationAntiCorruptionLayer).toHaveBeenCalledWith({
        legacyAuthManager: mockAuthManager,
        authenticationApplicationService: mockAuthAppService,
        logger,
        shadowMode: true,
      });
    });

    it('should use direct DDD service when no legacy auth manager', async () => {
      const bootstrap = new ApplicationBootstrap();
      // Don't set auth manager
      
      await bootstrap.initialize();

      expect(AuthenticationAntiCorruptionLayer).not.toHaveBeenCalled();
      
      const services = bootstrap.getApplicationServices();
      expect(services.auth).toBe(mockAuthAppService);
      expect(services.authenticationService).toBe(mockAuthAppService);
    });

    it('should use ACL as auth service when legacy exists', async () => {
      const bootstrap = new ApplicationBootstrap();
      bootstrap.setAuthManager(mockAuthManager);
      
      await bootstrap.initialize();

      const services = bootstrap.getApplicationServices();
      expect(services.auth).toBe(mockACL);
      expect(services.authenticationService).toBe(mockACL);
      expect(services.authManager).toBe(mockAuthManager); // Legacy still available
    });

    it('should include auth services in application services', async () => {
      const bootstrap = new ApplicationBootstrap();
      bootstrap.setAuthManager(mockAuthManager);
      
      await bootstrap.initialize();

      const services = bootstrap.getApplicationServices();
      expect(services).toMatchObject({
        authenticationApplicationService: mockAuthAppService,
        authenticationService: mockACL,
        auth: mockACL,
        authManager: mockAuthManager,
        authenticationRepository: mockAuthRepository,
      });
    });
  });

  describe('Shadow Mode Operation', () => {
    it('should start ACL in shadow mode by default', async () => {
      const bootstrap = new ApplicationBootstrap();
      bootstrap.setAuthManager(mockAuthManager);
      
      await bootstrap.initialize();

      expect(AuthenticationAntiCorruptionLayer).toHaveBeenCalledWith(
        expect.objectContaining({
          shadowMode: true,
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle token service creation failure', async () => {
      const error = new Error('Token service creation failed');
      OAuthTokenService.mockImplementation(() => {
        throw error;
      });

      const bootstrap = new ApplicationBootstrap();
      
      await expect(bootstrap.initialize()).rejects.toThrow('Token service creation failed');
      expect(logger.error).toHaveBeenCalledWith(
        '[ApplicationBootstrap] Failed to initialize:',
        error
      );
    });

    it('should handle auth service creation failure', async () => {
      const error = new Error('Auth service creation failed');
      AuthenticationApplicationService.mockImplementation(() => {
        throw error;
      });

      const bootstrap = new ApplicationBootstrap();
      
      await expect(bootstrap.initialize()).rejects.toThrow('Auth service creation failed');
    });
  });
});