const {
  PersonalityRouter,
} = require('../../../../src/application/routers/PersonalityRouter');

// Mock dependencies
jest.mock('../../../../src/logger');
jest.mock('../../../../src/application/services/PersonalityApplicationService');
jest.mock('../../../../src/adapters/persistence/FilePersonalityRepository');
jest.mock('../../../../src/adapters/persistence/FileAuthenticationRepository');
jest.mock('../../../../src/adapters/ai/HttpAIServiceAdapter');
jest.mock('../../../../src/domain/shared/DomainEventBus');

const logger = require('../../../../src/logger');
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
const { DomainEventBus } = require('../../../../src/domain/shared/DomainEventBus');

// Mock constructors
FilePersonalityRepository.mockImplementation(() => ({}));
FileAuthenticationRepository.mockImplementation(() => ({}));
HttpAIServiceAdapter.mockImplementation(() => ({}));
DomainEventBus.mockImplementation(() => ({}));

// Setup logger mock methods
logger.info = jest.fn();
logger.error = jest.fn();
logger.warn = jest.fn();
logger.debug = jest.fn();

describe('PersonalityRouter', () => {
  let router;
  let mockPersonalityService;

  const mockDDDPersonality = {
    name: 'test-personality',
    ownerId: 'user123',
    aliases: [{ alias: 'test-alias' }],
    profile: {
      displayName: 'Test',
      avatarUrl: 'https://example.com/avatar.png',
      isNSFW: false,
      temperature: 0.7,
      maxWordCount: 500,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup personality service mock
    mockPersonalityService = {
      getPersonality: jest.fn().mockResolvedValue(mockDDDPersonality),
      listPersonalities: jest.fn().mockResolvedValue([mockDDDPersonality]),
      registerPersonality: jest.fn().mockResolvedValue(mockDDDPersonality),
      removePersonality: jest.fn().mockResolvedValue(),
      addAlias: jest.fn().mockResolvedValue(),
    };

    PersonalityApplicationService.mockImplementation(() => mockPersonalityService);

    router = new PersonalityRouter({ logger });
  });

  describe('getPersonality', () => {
    it('should use DDD system and return DDD format', async () => {
      const result = await router.getPersonality('test-personality');

      expect(result).toBe(mockDDDPersonality);
      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('test-personality');
      expect(router.routingStats.reads).toBe(1);
    });

    it('should return null when personality not found', async () => {
      mockPersonalityService.getPersonality.mockResolvedValue(null);

      const result = await router.getPersonality('unknown');

      expect(result).toBeNull();
      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('unknown');
    });

    it('should handle errors from DDD system', async () => {
      mockPersonalityService.getPersonality.mockRejectedValue(new Error('DDD Error'));

      await expect(router.getPersonality('error-test')).rejects.toThrow('DDD Error');
      expect(logger.error).toHaveBeenCalledWith(
        '[PersonalityRouter] Error in new system getPersonality:',
        expect.any(Error)
      );
    });
  });

  describe('getAllPersonalities', () => {
    it('should use DDD system and return DDD format', async () => {
      const result = await router.getAllPersonalities();

      expect(result).toEqual([mockDDDPersonality]);
      expect(mockPersonalityService.listPersonalities).toHaveBeenCalled();
      expect(router.routingStats.reads).toBe(1);
    });

    it('should handle empty list', async () => {
      mockPersonalityService.listPersonalities.mockResolvedValue([]);

      const result = await router.getAllPersonalities();

      expect(result).toEqual([]);
    });
  });

  describe('registerPersonality', () => {
    const registrationOptions = {
      avatarUrl: 'https://example.com/avatar.png',
      displayName: 'Test',
      nsfwContent: false,
      temperature: 0.7,
      maxWordCount: 500,
    };

    it('should use DDD system for registration', async () => {
      const result = await router.registerPersonality(
        'test-personality',
        'user123',
        registrationOptions
      );

      expect(result.success).toBe(true);
      expect(result.personality).toBe(mockDDDPersonality);
      expect(mockPersonalityService.registerPersonality).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-personality',
          ownerId: 'user123',
          prompt: 'You are test-personality',
          modelPath: '/default',
          maxWordCount: 500,
          aliases: [],
        })
      );
      expect(router.routingStats.writes).toBe(1);
    });

    it('should handle registration errors', async () => {
      mockPersonalityService.registerPersonality.mockRejectedValue(
        new Error('Registration failed')
      );

      await expect(router.registerPersonality('fail-test', 'user123', {})).rejects.toThrow(
        'Registration failed'
      );
    });
  });

  describe('removePersonality', () => {
    it('should use DDD system for removal', async () => {
      const result = await router.removePersonality('test-personality', 'user123');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Personality test-personality removed successfully');
      expect(mockPersonalityService.removePersonality).toHaveBeenCalledWith({
        personalityName: 'test-personality',
        requesterId: 'user123',
      });
      expect(router.routingStats.writes).toBe(1);
    });

    it('should handle removal errors', async () => {
      mockPersonalityService.removePersonality.mockRejectedValue(new Error('Not authorized'));

      const result = await router.removePersonality('test-personality', 'user123');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Not authorized');
    });
  });

  describe('addAlias', () => {
    it('should use DDD system for alias addition', async () => {
      const result = await router.addAlias('test-personality', 'new-alias', 'user123');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Alias new-alias added successfully');
      expect(mockPersonalityService.addAlias).toHaveBeenCalledWith({
        personalityName: 'test-personality',
        alias: 'new-alias',
        requesterId: 'user123',
      });
      expect(router.routingStats.writes).toBe(1);
    });

    it('should handle alias addition errors', async () => {
      mockPersonalityService.addAlias.mockRejectedValue(new Error('Alias exists'));

      const result = await router.addAlias('test-personality', 'existing', 'user123');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Alias exists');
    });
  });

  describe('getRoutingStatistics', () => {
    it('should return accurate statistics', async () => {
      // Perform some operations
      await router.getPersonality('test');
      await router.getAllPersonalities();
      await router.registerPersonality('test2', 'user123', {});

      const stats = router.getRoutingStatistics();

      expect(stats).toEqual({
        reads: 2,
        writes: 1,
        dddSystemActive: true,
      });
    });
  });

  describe('initialization', () => {
    it('should auto-initialize DDD system when personalityService not set', async () => {
      router.personalityService = null;

      await router.getPersonality('test');

      expect(PersonalityApplicationService).toHaveBeenCalled();
      expect(router.personalityService).toBeTruthy();
    });

    it('should not reinitialize if personalityService already set', async () => {
      const existingService = { mock: 'service' };
      router.personalityService = existingService;

      router._ensurePersonalityService();

      expect(router.personalityService).toBe(existingService);
      expect(PersonalityApplicationService).not.toHaveBeenCalled();
    });
  });

});
