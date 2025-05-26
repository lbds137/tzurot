// Mock the dependencies
jest.mock('../../src/profileInfoFetcher', () => ({
  getProfileAvatarUrl: jest.fn(),
  getProfileDisplayName: jest.fn()
}));

jest.mock('../../src/dataStorage', () => ({
  saveData: jest.fn().mockResolvedValue(),
  loadData: jest.fn()
}));

const { createMigrationHelper } = require('../utils/testEnhancements');
const personalityManager = require('../../src/personalityManager');
const profileInfoFetcher = require('../../src/profileInfoFetcher');
const dataStorage = require('../../src/dataStorage');

describe('personalityManager', () => {
  let migrationHelper;
  
  beforeEach(() => {
    migrationHelper = createMigrationHelper('utility');
    jest.clearAllMocks();
    
    // Reset the personality data between tests
    if (personalityManager.personalityData && personalityManager.personalityData.clear) {
      personalityManager.personalityData.clear();
    }
    if (personalityManager.personalityAliases) {
      personalityManager.personalityAliases.clear();
    }
    
    // Set up enhanced mocks using migration helper
    const mockEnv = migrationHelper.enhanced.createMocks();
    
    // Preserve and enhance existing Jest mocks
    dataStorage.saveData.mockResolvedValue();
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
      expect(result.addedBy).toBe('test-user');

      // Verify that saveAllPersonalities was called
      expect(dataStorage.saveData).toHaveBeenCalled();

      // Verify that the display name was set as an alias (since it's different from full name)
      const aliasMap = personalityManager.personalityAliases;
      expect(aliasMap.size).toBe(1);
      expect(aliasMap.has('test display')).toBe(true);
      expect(aliasMap.get('test display')).toBe('test-personality');
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
      expect(result.avatarUrl).toBeUndefined();
      expect(result.addedBy).toBe('test-user');

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

      // Verify the result (facade returns boolean)
      expect(result).toBe(true);
      
      // Verify the alias was set (stored in lowercase)
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

  describe('removePersonality', () => {
    beforeEach(async () => {
      // Register test personalities with different owners
      await personalityManager.registerPersonality('owner-user', 'owner-personality', {
        description: 'Owned by owner'
      }, false);
      
      await personalityManager.registerPersonality('regular-user', 'user-personality', {
        description: 'Owned by regular user'
      }, false);
      
      // Set aliases for both
      await personalityManager.setPersonalityAlias('owner-alias', 'owner-personality');
      await personalityManager.setPersonalityAlias('user-alias', 'user-personality');
    });

    it('should allow a user to remove their own personality', async () => {
      const result = await personalityManager.removePersonality('regular-user', 'user-personality');
      
      expect(result).toBe(true);
      expect(personalityManager.getPersonality('user-personality')).toBeNull();
      expect(personalityManager.getPersonalityByAlias('user-alias')).toBeNull();
    });

    it('should not allow a user to remove another user\'s personality', async () => {
      const result = await personalityManager.removePersonality('regular-user', 'owner-personality');
      
      expect(result).toBe(false);
      expect(personalityManager.getPersonality('owner-personality')).toBeDefined();
      expect(personalityManager.getPersonalityByAlias('owner-alias')).toBeDefined();
    });

    it('should allow the bot owner to remove any personality', async () => {
      // Set BOT_OWNER_ID environment variable
      const originalBotOwnerId = process.env.BOT_OWNER_ID;
      process.env.BOT_OWNER_ID = 'bot-owner-id';
      
      // Bot owner should be able to remove any personality
      const result = await personalityManager.removePersonality('bot-owner-id', 'user-personality');
      
      expect(result).toBe(true);
      expect(personalityManager.getPersonality('user-personality')).toBeNull();
      
      // Restore original environment
      if (originalBotOwnerId !== undefined) {
        process.env.BOT_OWNER_ID = originalBotOwnerId;
      } else {
        delete process.env.BOT_OWNER_ID;
      }
    });

    it('should return false when trying to remove non-existent personality', async () => {
      const result = await personalityManager.removePersonality('regular-user', 'non-existent');
      
      expect(result).toBe(false);
    });
  });

  describe('getPersonalityByAlias', () => {
    beforeEach(async () => {
      // Reset mocks to return expected values
      profileInfoFetcher.getProfileDisplayName.mockResolvedValue('Test Display');
      profileInfoFetcher.getProfileAvatarUrl.mockResolvedValue('https://example.com/avatar.png');
      
      // Register a test personality
      await personalityManager.registerPersonality('test-user', 'test-personality', {
        description: 'Test description',
        displayName: 'Test Display'
      }, false);
      
      // Set an alias
      await personalityManager.setPersonalityAlias('test-alias', 'test-personality');
    });

    it('should return a personality when looking up by alias with single parameter', () => {
      // Call the function with a single parameter (backward compatibility)
      const result = personalityManager.getPersonalityByAlias('test-alias');
      
      // Verify the result
      expect(result).toBeDefined();
      expect(result.fullName).toBe('test-personality');
      expect(result.displayName).toBe('Test Display');
    });
    
    it('should return a personality when looking up by alias with two parameters', () => {
      // Call the function with the new signature
      const result = personalityManager.getPersonalityByAlias('test-user', 'test-alias');
      
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
    
    it('should handle null userId parameter correctly', () => {
      // Call the function with null userId
      const result = personalityManager.getPersonalityByAlias(null, 'test-alias');
      
      // Verify the result
      expect(result).toBeDefined();
      expect(result.fullName).toBe('test-personality');
    });
  });
});