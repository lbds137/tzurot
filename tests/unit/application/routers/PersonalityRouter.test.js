const { PersonalityRouter, getPersonalityRouter, resetPersonalityRouter } = require('../../../../src/application/routers/PersonalityRouter');
const { FeatureFlags } = require('../../../../src/application/services/FeatureFlags');
const { ComparisonTester } = require('../../../../src/application/services/ComparisonTester');

// Mock dependencies
jest.mock('../../../../src/core/personality');
jest.mock('../../../../src/logger');
jest.mock('../../../../src/application/services/PersonalityApplicationService');
jest.mock('../../../../src/adapters/persistence/FilePersonalityRepository');
jest.mock('../../../../src/adapters/persistence/FileAuthenticationRepository');
jest.mock('../../../../src/adapters/ai/HttpAIServiceAdapter');
jest.mock('../../../../src/core/api/ProfileInfoFetcher');
jest.mock('../../../../src/domain/shared/DomainEventBus');

const personalityManager = require('../../../../src/core/personality');
const logger = require('../../../../src/logger');
const { PersonalityApplicationService } = require('../../../../src/application/services/PersonalityApplicationService');
const { FilePersonalityRepository } = require('../../../../src/adapters/persistence/FilePersonalityRepository');
const { FileAuthenticationRepository } = require('../../../../src/adapters/persistence/FileAuthenticationRepository');
const { HttpAIServiceAdapter } = require('../../../../src/adapters/ai/HttpAIServiceAdapter');
const { ProfileInfoFetcher } = require('../../../../src/core/api');
const { DomainEventBus } = require('../../../../src/domain/shared/DomainEventBus');

// Mock constructors  
FilePersonalityRepository.mockImplementation(() => ({}));
FileAuthenticationRepository.mockImplementation(() => ({}));
HttpAIServiceAdapter.mockImplementation(() => ({}));
if (ProfileInfoFetcher && ProfileInfoFetcher.mockImplementation) {
  ProfileInfoFetcher.mockImplementation(() => ({}));
}
DomainEventBus.mockImplementation(() => ({}));

// Setup mock functions for personality manager
personalityManager.getPersonalityByNameOrAlias = jest.fn();
personalityManager.getAllPersonalities = jest.fn();
personalityManager.registerPersonality = jest.fn();
personalityManager.removePersonality = jest.fn();
personalityManager.addAlias = jest.fn();

// Setup logger mock methods
logger.info = jest.fn();
logger.error = jest.fn();
logger.warn = jest.fn();
logger.debug = jest.fn();

describe('PersonalityRouter', () => {
  let router;
  let mockFeatureFlags;
  let mockComparisonTester;
  let mockPersonalityService;
  
  const mockLegacyPersonality = {
    fullName: 'test-personality',
    displayName: 'Test',
    owner: 'user123',
    aliases: ['test-alias'],
    avatarUrl: 'https://example.com/avatar.png',
    nsfwContent: false,
    temperature: 0.7,
    maxWordCount: 500
  };
  
  const mockDDDPersonality = {
    name: 'test-personality',
    ownerId: 'user123',
    aliases: [{ alias: 'test-alias' }],
    profile: {
      displayName: 'Test',
      avatarUrl: 'https://example.com/avatar.png',
      isNSFW: false,
      temperature: 0.7,
      maxWordCount: 500
    },
    createdAt: new Date(),
    updatedAt: new Date()
  };
  
  beforeEach(() => {
    jest.clearAllMocks();
    resetPersonalityRouter();
    
    // Setup feature flags mock
    mockFeatureFlags = new FeatureFlags();
    jest.spyOn(mockFeatureFlags, 'isEnabled').mockReturnValue(false);
    
    // Setup comparison tester mock
    mockComparisonTester = new ComparisonTester();
    jest.spyOn(mockComparisonTester, 'compare').mockImplementation(async (name, legacyOp, newOp) => ({
      match: true,
      legacyResult: await legacyOp(),
      newResult: await newOp(),
      discrepancies: []
    }));
    
    // Setup personality service mock
    mockPersonalityService = new PersonalityApplicationService({});
    PersonalityApplicationService.mockImplementation(() => mockPersonalityService);
    
    // Setup legacy personality manager mocks
    personalityManager.getPersonalityByNameOrAlias.mockReturnValue(mockLegacyPersonality);
    personalityManager.getAllPersonalities.mockReturnValue([mockLegacyPersonality]);
    personalityManager.registerPersonality.mockResolvedValue({ success: true, personality: mockLegacyPersonality });
    personalityManager.removePersonality.mockResolvedValue({ success: true, message: 'Removed' });
    personalityManager.addAlias.mockResolvedValue({ success: true, message: 'Alias added' });
    
    // Setup new personality service mocks
    mockPersonalityService.getPersonalityByName = jest.fn().mockResolvedValue(mockDDDPersonality);
    mockPersonalityService.getPersonalityByAlias = jest.fn().mockResolvedValue(null);
    mockPersonalityService.listAllPersonalities = jest.fn().mockResolvedValue([mockDDDPersonality]);
    mockPersonalityService.registerPersonality = jest.fn().mockResolvedValue(mockDDDPersonality);
    mockPersonalityService.removePersonality = jest.fn().mockResolvedValue();
    mockPersonalityService.addAlias = jest.fn().mockResolvedValue();
    
    router = new PersonalityRouter({
      featureFlags: mockFeatureFlags,
      comparisonTester: mockComparisonTester,
      logger
    });
  });
  
  describe('getPersonality', () => {
    it('should use legacy system when feature flag is disabled', async () => {
      mockFeatureFlags.isEnabled.mockReturnValue(false);
      
      const result = await router.getPersonality('test-personality');
      
      expect(result).toEqual(mockLegacyPersonality);
      expect(personalityManager.getPersonalityByNameOrAlias).toHaveBeenCalledWith('test-personality');
      expect(mockPersonalityService.getPersonalityByName).not.toHaveBeenCalled();
      expect(router.routingStats.legacyReads).toBe(1);
      expect(router.routingStats.newReads).toBe(0);
    });
    
    it('should use new system when feature flag is enabled', async () => {
      mockFeatureFlags.isEnabled.mockImplementation(flag => flag === 'ddd.personality.read');
      
      const result = await router.getPersonality('test-personality');
      
      expect(result).toMatchObject({
        fullName: 'test-personality',
        displayName: 'Test',
        owner: 'user123'
      });
      expect(mockPersonalityService.getPersonalityByName).toHaveBeenCalledWith('test-personality');
      expect(personalityManager.getPersonalityByNameOrAlias).not.toHaveBeenCalled();
      expect(router.routingStats.newReads).toBe(1);
      expect(router.routingStats.legacyReads).toBe(0);
    });
    
    it('should run comparison testing when enabled', async () => {
      mockFeatureFlags.isEnabled.mockImplementation(flag => flag === 'features.comparison-testing');
      
      const result = await router.getPersonality('test-personality');
      
      expect(result).toEqual(mockLegacyPersonality);
      expect(mockComparisonTester.compare).toHaveBeenCalled();
      expect(personalityManager.getPersonalityByNameOrAlias).toHaveBeenCalled();
      expect(mockPersonalityService.getPersonalityByName).toHaveBeenCalled();
      expect(router.routingStats.comparisonTests).toBe(1);
    });
    
    it('should try alias lookup when name lookup fails in new system', async () => {
      mockFeatureFlags.isEnabled.mockImplementation(flag => flag === 'ddd.personality.read');
      mockPersonalityService.getPersonalityByName.mockResolvedValue(null);
      mockPersonalityService.getPersonalityByAlias.mockResolvedValue(mockDDDPersonality);
      
      const result = await router.getPersonality('test-alias');
      
      expect(mockPersonalityService.getPersonalityByName).toHaveBeenCalledWith('test-alias');
      expect(mockPersonalityService.getPersonalityByAlias).toHaveBeenCalledWith('test-alias');
      expect(result).toMatchObject({ fullName: 'test-personality' });
    });
  });
  
  describe('getAllPersonalities', () => {
    it('should use legacy system when feature flag is disabled', async () => {
      mockFeatureFlags.isEnabled.mockReturnValue(false);
      
      const result = await router.getAllPersonalities();
      
      expect(result).toEqual([mockLegacyPersonality]);
      expect(personalityManager.getAllPersonalities).toHaveBeenCalled();
      expect(mockPersonalityService.listAllPersonalities).not.toHaveBeenCalled();
    });
    
    it('should use new system when feature flag is enabled', async () => {
      mockFeatureFlags.isEnabled.mockImplementation(flag => flag === 'ddd.personality.read');
      
      const result = await router.getAllPersonalities();
      
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ fullName: 'test-personality' });
      expect(mockPersonalityService.listAllPersonalities).toHaveBeenCalled();
      expect(personalityManager.getAllPersonalities).not.toHaveBeenCalled();
    });
  });
  
  describe('registerPersonality', () => {
    const registrationOptions = {
      avatarUrl: 'https://example.com/avatar.png',
      displayName: 'Test',
      nsfwContent: false,
      temperature: 0.7,
      maxWordCount: 500
    };
    
    it('should use legacy system when feature flag is disabled', async () => {
      mockFeatureFlags.isEnabled.mockReturnValue(false);
      
      const result = await router.registerPersonality('test-personality', 'user123', registrationOptions);
      
      expect(result).toEqual({ success: true, personality: mockLegacyPersonality });
      expect(personalityManager.registerPersonality).toHaveBeenCalledWith(
        'test-personality',
        'user123',
        registrationOptions.avatarUrl,
        registrationOptions.displayName,
        registrationOptions.nsfwContent,
        registrationOptions.temperature,
        registrationOptions.maxWordCount
      );
      expect(router.routingStats.legacyWrites).toBe(1);
    });
    
    it('should use new system when feature flag is enabled', async () => {
      mockFeatureFlags.isEnabled.mockImplementation(flag => flag === 'ddd.personality.write');
      
      const result = await router.registerPersonality('test-personality', 'user123', registrationOptions);
      
      expect(result.success).toBe(true);
      expect(result.personality).toMatchObject({ fullName: 'test-personality' });
      expect(mockPersonalityService.registerPersonality).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'test-personality',
          ownerId: 'user123',
          prompt: 'You are test-personality',
          modelPath: '/default',
          maxWordCount: 500,
          aliases: []
        })
      );
      expect(router.routingStats.newWrites).toBe(1);
    });
    
    it('should perform dual-write when enabled', async () => {
      mockFeatureFlags.isEnabled.mockImplementation(flag => flag === 'ddd.personality.dual-write');
      
      const result = await router.registerPersonality('test-personality', 'user123', registrationOptions);
      
      expect(result).toEqual({ success: true, personality: mockLegacyPersonality });
      expect(personalityManager.registerPersonality).toHaveBeenCalled();
      expect(mockPersonalityService.registerPersonality).toHaveBeenCalled();
      expect(router.routingStats.dualWrites).toBe(1);
    });
    
    it('should not fail operation if new system fails during dual-write', async () => {
      mockFeatureFlags.isEnabled.mockImplementation(flag => flag === 'ddd.personality.dual-write');
      mockPersonalityService.registerPersonality.mockRejectedValue(new Error('New system error'));
      
      const result = await router.registerPersonality('test-personality', 'user123', registrationOptions);
      
      expect(result).toEqual({ success: true, personality: mockLegacyPersonality });
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('[PersonalityRouter] Dual-write to new system failed:'),
        expect.any(Error)
      );
    });
  });
  
  describe('removePersonality', () => {
    it('should use legacy system when feature flag is disabled', async () => {
      mockFeatureFlags.isEnabled.mockReturnValue(false);
      
      const result = await router.removePersonality('test-personality', 'user123');
      
      expect(result).toEqual({ success: true, message: 'Removed' });
      expect(personalityManager.removePersonality).toHaveBeenCalledWith('test-personality', 'user123');
    });
    
    it('should use new system when feature flag is enabled', async () => {
      mockFeatureFlags.isEnabled.mockImplementation(flag => flag === 'ddd.personality.write');
      
      const result = await router.removePersonality('test-personality', 'user123');
      
      expect(result.success).toBe(true);
      expect(mockPersonalityService.removePersonality).toHaveBeenCalledWith({
        personalityName: 'test-personality',
        requesterId: 'user123'
      });
    });
  });
  
  describe('addAlias', () => {
    it('should use legacy system when feature flag is disabled', async () => {
      mockFeatureFlags.isEnabled.mockReturnValue(false);
      
      const result = await router.addAlias('test-personality', 'new-alias', 'user123');
      
      expect(result).toEqual({ success: true, message: 'Alias added' });
      expect(personalityManager.addAlias).toHaveBeenCalledWith('test-personality', 'new-alias', 'user123');
    });
    
    it('should use new system when feature flag is enabled', async () => {
      mockFeatureFlags.isEnabled.mockImplementation(flag => flag === 'ddd.personality.write');
      
      const result = await router.addAlias('test-personality', 'new-alias', 'user123');
      
      expect(result.success).toBe(true);
      expect(mockPersonalityService.addAlias).toHaveBeenCalledWith({
        personalityName: 'test-personality',
        alias: 'new-alias',
        requesterId: 'user123'
      });
    });
  });
  
  describe('getRoutingStatistics', () => {
    it('should return accurate statistics', async () => {
      // Perform some operations
      mockFeatureFlags.isEnabled.mockReturnValue(false);
      await router.getPersonality('test');
      await router.registerPersonality('test2', 'user123', {});
      
      mockFeatureFlags.isEnabled.mockImplementation(flag => flag === 'ddd.personality.read');
      await router.getPersonality('test3');
      
      const stats = router.getRoutingStatistics();
      
      expect(stats).toEqual({
        legacyReads: 1,
        newReads: 1,
        legacyWrites: 1,
        newWrites: 0,
        dualWrites: 0,
        comparisonTests: 0,
        dddSystemActive: true,
        comparisonTestingActive: false,
        dualWriteActive: false
      });
    });
  });
  
  describe('singleton behavior', () => {
    it('should return same instance', () => {
      const instance1 = getPersonalityRouter();
      const instance2 = getPersonalityRouter();
      
      expect(instance1).toBe(instance2);
    });
    
    it('should reset instance', () => {
      const instance1 = getPersonalityRouter();
      resetPersonalityRouter();
      const instance2 = getPersonalityRouter();
      
      expect(instance1).not.toBe(instance2);
    });
  });
});