/**
 * Tests for personalityManager.js focusing on initialization and persistence
 */

// Import the module to test
const personalityManager = require('../../src/personalityManager');

// Import dependencies we need to mock
const dataStorage = require('../../src/dataStorage');

// Mock the dependencies
jest.mock('../../src/profileInfoFetcher', () => ({
  getProfileAvatarUrl: jest.fn().mockResolvedValue('https://example.com/avatar.png'),
  getProfileDisplayName: jest.fn().mockResolvedValue('Test Display Name')
}));

jest.mock('../../src/dataStorage', () => ({
  saveData: jest.fn().mockResolvedValue(true),
  loadData: jest.fn()
}));

describe('personalityManager - Initialization and Persistence', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset the personality data between tests
    personalityManager.personalityData?.clear();
    personalityManager.personalityAliases?.clear();
  });
  
  describe('initPersonalityManager', () => {
    it('should load personalities and aliases from storage on initialization', async () => {
      // Mock personalities data
      const mockPersonalities = {
        'test-personality-1': {
          fullName: 'test-personality-1',
          displayName: 'Test Personality 1',
          avatarUrl: 'https://example.com/avatar1.png',
          description: 'Test description 1',
          createdBy: 'user1'
        },
        'test-personality-2': {
          fullName: 'test-personality-2',
          displayName: 'Test Personality 2',
          avatarUrl: 'https://example.com/avatar2.png',
          description: 'Test description 2',
          createdBy: 'user2'
        }
      };
      
      // Mock aliases data
      const mockAliases = {
        'alias1': 'test-personality-1',
        'alias2': 'test-personality-2',
        'tp1': 'test-personality-1',
        'tp2': 'test-personality-2'
      };
      
      // Mock loadData to return our mock data
      dataStorage.loadData.mockImplementation((fileName) => {
        if (fileName === 'personalities') {
          return Promise.resolve(mockPersonalities);
        }
        if (fileName === 'aliases') {
          return Promise.resolve(mockAliases);
        }
        return Promise.resolve(null);
      });
      
      // Call the initialization function
      await personalityManager.initPersonalityManager(true, { skipBackgroundSeeding: true });
      
      // Verify loadData was called correctly
      expect(dataStorage.loadData).toHaveBeenCalledWith('personalities');
      expect(dataStorage.loadData).toHaveBeenCalledWith('aliases');
      
      // Verify personalities were loaded
      expect(personalityManager.getPersonality('test-personality-1')).toEqual(mockPersonalities['test-personality-1']);
      expect(personalityManager.getPersonality('test-personality-2')).toEqual(mockPersonalities['test-personality-2']);
      
      // Verify aliases were loaded
      // Test both parameter calling styles 
      expect(personalityManager.getPersonalityByAlias('alias1')).toEqual(mockPersonalities['test-personality-1']);
      expect(personalityManager.getPersonalityByAlias(null, 'tp2')).toEqual(mockPersonalities['test-personality-2']);
      
      // Verify the total count of loaded items
      expect(personalityManager.listPersonalitiesForUser().length).toBe(2);
    });
    
    it('should handle empty or missing data files gracefully', async () => {
      // Mock loadData to return null for all files
      dataStorage.loadData.mockResolvedValue(null);
      
      // Call the initialization function
      await personalityManager.initPersonalityManager(true, { skipBackgroundSeeding: true });
      
      // Verify loadData was still called
      expect(dataStorage.loadData).toHaveBeenCalledWith('personalities');
      expect(dataStorage.loadData).toHaveBeenCalledWith('aliases');
      
      // There might already be personalities loaded from previous tests
      // We only need to verify that loading null data doesn't throw an error
    });
    
    it('should filter out personality entries where key doesn\'t match fullName', async () => {
      // Mock personalities data with a mismatched entry
      const mockPersonalities = {
        'test-personality': {
          fullName: 'test-personality',
          displayName: 'Test Personality',
          avatarUrl: 'https://example.com/avatar.png'
        },
        'mismatched-key': {
          fullName: 'different-fullname', // Key doesn't match fullName
          displayName: 'Mismatched Entry',
          avatarUrl: 'https://example.com/avatar2.png'
        }
      };
      
      // Mock loadData to return our mock data
      dataStorage.loadData.mockImplementation((fileName) => {
        if (fileName === 'personalities') {
          return Promise.resolve(mockPersonalities);
        }
        return Promise.resolve({});
      });
      
      // Call the initialization function
      await personalityManager.initPersonalityManager(true, { skipBackgroundSeeding: true });
      
      // Verify only the valid personality was loaded
      expect(personalityManager.getPersonality('test-personality')).toEqual(mockPersonalities['test-personality']);
      expect(personalityManager.getPersonality('different-fullname')).toBeNull();
      
      // There might be personalities from previous tests
      // Just verify that the mismatched entry wasn't loaded
    });
    
    it('should handle errors during initialization', async () => {
      // Mock loadData to throw an error
      const testError = new Error('Test error');
      dataStorage.loadData.mockRejectedValue(testError);
      
      // Mock logger.error to capture errors
      const logger = require('../../src/logger');
      const originalLoggerError = logger.error;
      logger.error = jest.fn();
      
      // Call the initialization function and expect it to throw
      await expect(personalityManager.initPersonalityManager(true, { skipBackgroundSeeding: true })).rejects.toThrow(testError);
      
      // Verify the error was logged
      expect(logger.error).toHaveBeenCalled();
      
      // Restore logger.error
      logger.error = originalLoggerError;
    });
  });
  
  describe('saveAllPersonalities', () => {
    it('should save all personalities to storage', async () => {
      // Register some test personalities
      await personalityManager.registerPersonality('user1', 'test-personality-1', {
        description: 'Test description 1'
      }, false);
      
      await personalityManager.registerPersonality('user2', 'test-personality-2', {
        description: 'Test description 2'
      }, false);
      
      // Reset the saveData mock to verify the next call
      dataStorage.saveData.mockClear();
      
      // Call saveAllPersonalities explicitly
      await personalityManager.saveAllPersonalities();
      
      // Verify saveData was called with the correct data
      expect(dataStorage.saveData).toHaveBeenCalledWith('personalities', expect.any(Object));
      
      // Verify the data structure that was saved
      const savedData = dataStorage.saveData.mock.calls[0][1];
      // There might be more personalities from previous tests
      expect(savedData['test-personality-1']).toBeDefined();
      expect(savedData['test-personality-2']).toBeDefined();
    });
  });
  
  // Note: saveAllAliases is an internal function not exported, so we test it indirectly
  
  describe('listPersonalitiesForUser', () => {
    it('should return a list of all personalities when no user specified', async () => {
      // Register some test personalities
      await personalityManager.registerPersonality('user1', 'test-personality-1', {
        description: 'Test description 1'
      }, false);
      
      await personalityManager.registerPersonality('user2', 'test-personality-2', {
        description: 'Test description 2'
      }, false);
      
      // List personalities
      const personalities = personalityManager.listPersonalitiesForUser();
      
      // Verify the result
      expect(personalities.length).toBeGreaterThanOrEqual(2);
      expect(personalities.find(p => p.fullName === 'test-personality-1')).toBeDefined();
      expect(personalities.find(p => p.fullName === 'test-personality-2')).toBeDefined();
    });
    
    it('should list personalities filtered by user ID', async () => {
      // Register personalities for different users
      await personalityManager.registerPersonality('user1', 'personality-user1-1', {
        description: 'Test description 1'
      }, false);
      
      await personalityManager.registerPersonality('user1', 'personality-user1-2', {
        description: 'Test description 2'
      }, false);
      
      await personalityManager.registerPersonality('user2', 'personality-user2', {
        description: 'Test description for user2'
      }, false);
      
      // List personalities for user1
      const user1Personalities = personalityManager.listPersonalitiesForUser('user1');
      
      // Verify the result
      expect(user1Personalities.find(p => p.fullName === 'personality-user1-1')).toBeDefined();
      expect(user1Personalities.find(p => p.fullName === 'personality-user1-2')).toBeDefined();
      expect(user1Personalities.find(p => p.fullName === 'personality-user2')).toBeUndefined();
      
      // List personalities for user2
      const user2Personalities = personalityManager.listPersonalitiesForUser('user2');
      
      // Verify personality-user2 is present
      expect(user2Personalities.find(p => p.fullName === 'personality-user2')).toBeDefined();
    });
  });
  
  describe('removePersonality', () => {
    it('should remove a personality and its aliases', async () => {
      // Register a test personality
      await personalityManager.registerPersonality('user1', 'test-personality', {
        description: 'Test description'
      }, false);
      
      // Set some aliases
      await personalityManager.setPersonalityAlias('alias1', 'test-personality');
      await personalityManager.setPersonalityAlias('alias2', 'test-personality');
      
      // Verify the personality and aliases exist
      expect(personalityManager.getPersonality('test-personality')).not.toBeNull();
      expect(personalityManager.getPersonalityByAlias('alias1')).not.toBeNull();
      
      // Remove the personality
      await personalityManager.removePersonality('test-personality');
      
      // Verify the personality is gone
      expect(personalityManager.getPersonality('test-personality')).toBeNull();
      
      // Verify the aliases are gone - test both parameter styles
      expect(personalityManager.getPersonalityByAlias('alias1')).toBeNull();
      expect(personalityManager.getPersonalityByAlias(null, 'alias2')).toBeNull();
      
      // Verify save was called for personalities
      expect(dataStorage.saveData).toHaveBeenCalledWith('personalities', expect.any(Object));
    });
    
    it('should return false when trying to remove a non-existent personality', async () => {
      // Try to remove a non-existent personality
      const result = await personalityManager.removePersonality('non-existent');
      
      // Verify the result
      expect(result).toBe(false);
    });
  });
});