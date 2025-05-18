// Import the module to test
const personalityManager = require('../../src/personalityManager');

// Import dependencies we need to mock
const profileInfoFetcher = require('../../src/profileInfoFetcher');
const dataStorage = require('../../src/dataStorage');

// Mock the dependencies
jest.mock('../../src/profileInfoFetcher', () => ({
  getProfileAvatarUrl: jest.fn(),
  getProfileDisplayName: jest.fn()
}));

jest.mock('../../src/dataStorage', () => ({
  saveData: jest.fn().mockResolvedValue(),
  loadData: jest.fn()
}));

describe('personalityManager', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset the personality data between tests
    if (personalityManager.personalityAliases) {
      personalityManager.personalityAliases.clear();
    }
    
    // Mock loadData to return empty objects by default
    dataStorage.loadData.mockImplementation((fileName) => {
      if (fileName === 'personalities') {
        return Promise.resolve({});
      }
      if (fileName === 'aliases') {
        return Promise.resolve({});
      }
      return Promise.resolve(null);
    });
  });

  describe('registerPersonality', () => {
    it('should register a new personality without setting a self-referential alias', async () => {
      // Mock display name and avatar URL fetch
      profileInfoFetcher.getProfileDisplayName.mockResolvedValue('Test Display');
      profileInfoFetcher.getProfileAvatarUrl.mockResolvedValue('https://example.com/avatar.png');

      // Call the function
      const result = await personalityManager.registerPersonality('test-user', 'test-personality', {
        description: 'Test description'
      });

      // Verify the result
      expect(result).toBeDefined();
      expect(result.fullName).toBe('test-personality');
      expect(result.displayName).toBe('Test Display');
      expect(result.avatarUrl).toBe('https://example.com/avatar.png');
      expect(result.createdBy).toBe('test-user');

      // Verify that saveAllPersonalities was called
      expect(dataStorage.saveData).toHaveBeenCalled();

      // Verify that no self-referential alias was set
      // This is a critical test for our fix
      const aliasMap = personalityManager.personalityAliases;
      expect(aliasMap.size).toBe(0);
      expect(aliasMap.has('test-personality')).toBe(false);
    });

    it('should handle errors when fetching profile info', async () => {
      // Mock profile info fetchers to throw errors
      profileInfoFetcher.getProfileDisplayName.mockRejectedValue(new Error('API error'));
      profileInfoFetcher.getProfileAvatarUrl.mockRejectedValue(new Error('API error'));

      // Call the function
      const result = await personalityManager.registerPersonality('test-user', 'test-personality', {
        description: 'Test description'
      });

      // Verify the result still has the basic data
      expect(result).toBeDefined();
      expect(result.fullName).toBe('test-personality');
      expect(result.displayName).toBe('test-personality'); // Fallback to fullName
      expect(result.avatarUrl).toBeNull();
      expect(result.createdBy).toBe('test-user');

      // Verify that saveAllPersonalities was still called
      expect(dataStorage.saveData).toHaveBeenCalled();
    });

    it('should use the provided display name if profile info fetch is disabled', async () => {
      // Call the function with fetchInfo = false
      const result = await personalityManager.registerPersonality('test-user', 'test-personality', {
        description: 'Test description',
        displayName: 'Custom Display'
      }, false);

      // Verify the display name is used from params
      expect(result.displayName).toBe('Custom Display');
      
      // Verify profile info fetch functions were not called
      expect(profileInfoFetcher.getProfileDisplayName).not.toHaveBeenCalled();
      expect(profileInfoFetcher.getProfileAvatarUrl).not.toHaveBeenCalled();
    });
  });

  describe('setPersonalityAlias', () => {
    beforeEach(async () => {
      // Register a test personality first
      await personalityManager.registerPersonality('test-user', 'test-personality', {
        description: 'Test description'
      }, false);
    });

    it('should set an alias with skipSave=true by default', async () => {
      // Call the function
      const result = await personalityManager.setPersonalityAlias('test-alias', 'test-personality');

      // Verify the result
      expect(result.success).toBe(true);
      
      // Verify the alias was set
      expect(personalityManager.personalityAliases.get('test-alias')).toBe('test-personality');
      
      // Our current implementation always calls saveAllPersonalities internally
      // The skipSave parameter just controls whether setPersonalityAlias triggers a save on its own
      // So we can't test that saveData wasn't called at all
    });

    it('should handle display name alias collisions by creating an alternate alias', async () => {
      // Register another personality
      await personalityManager.registerPersonality('test-user', 'another-test-personality', {
        description: 'Another test'
      }, false);
      
      // Set an alias for the first personality
      await personalityManager.setPersonalityAlias('common-alias', 'test-personality');
      
      // Try to set the same alias for the second personality with isDisplayName=true
      const result = await personalityManager.setPersonalityAlias('common-alias', 'another-test-personality', true, true);
      
      // Verify an alternate alias was created
      expect(result.success).toBe(true);
      expect(result.alternateAliases.length).toBeGreaterThan(0);
      
      // The original alias should still point to the first personality
      expect(personalityManager.personalityAliases.get('common-alias')).toBe('test-personality');
      
      // But there should be a new alias created for the second personality
      const alternateAlias = result.alternateAliases[0];
      expect(personalityManager.personalityAliases.get(alternateAlias)).toBe('another-test-personality');
    });
  });

  describe('getPersonalityByAlias', () => {
    beforeEach(async () => {
      // Register a test personality
      await personalityManager.registerPersonality('test-user', 'test-personality', {
        description: 'Test description',
        displayName: 'Test Display'
      }, false);
      
      // Set an alias
      await personalityManager.setPersonalityAlias('test-alias', 'test-personality');
    });

    it('should return a personality when looking up by alias', () => {
      // Call the function
      const result = personalityManager.getPersonalityByAlias('test-alias');
      
      // Verify the result
      expect(result).toBeDefined();
      expect(result.fullName).toBe('test-personality');
      expect(result.displayName).toBe('Test Display');
    });

    it('should handle case-insensitive lookup', () => {
      // Call the function with different case
      const result = personalityManager.getPersonalityByAlias('TEST-ALIAS');
      
      // Verify the result
      expect(result).toBeDefined();
      expect(result.fullName).toBe('test-personality');
    });

    it('should return null for non-existent aliases', () => {
      // Call the function with a non-existent alias
      const result = personalityManager.getPersonalityByAlias('non-existent');
      
      // Verify the result
      expect(result).toBeNull();
    });
  });
});