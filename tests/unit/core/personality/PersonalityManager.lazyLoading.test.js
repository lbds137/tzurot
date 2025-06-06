/**
 * Tests for PersonalityManager lazy loading functionality
 */

// Mock dependencies
jest.mock('../../../../src/profileInfoFetcher', () => ({
  getProfileAvatarUrl: jest.fn(),
  getProfileDisplayName: jest.fn(),
  getProfileErrorMessage: jest.fn(),
}));

jest.mock('../../../../src/logger');
jest.mock('../../../../src/utils/avatarStorage');

const PersonalityManager = require('../../../../src/core/personality/PersonalityManager');
const {
  getProfileAvatarUrl,
  getProfileDisplayName,
  getProfileErrorMessage,
} = require('../../../../src/profileInfoFetcher');
const logger = require('../../../../src/logger');
const avatarStorage = require('../../../../src/utils/avatarStorage');

describe('PersonalityManager - Lazy Loading', () => {
  let manager;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Set up logger mock
    logger.info = jest.fn();
    logger.error = jest.fn();
    logger.warn = jest.fn();
    logger.debug = jest.fn();
    
    // Set up avatarStorage mock
    avatarStorage.needsUpdate = jest.fn().mockResolvedValue(false);
    avatarStorage.getLocalAvatarUrl = jest.fn().mockResolvedValue(null);

    // Create new manager instance
    manager = PersonalityManager.create({
      delay: () => Promise.resolve(), // No delays in tests
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Error message lazy loading', () => {
    it('should refresh stale personality data', async () => {
      // Register a personality with old timestamp
      const oldPersonalityData = {
        fullName: 'test-personality',
        addedBy: '123456789012345678',
        displayName: 'Test',
        avatarUrl: 'https://example.com/avatar.png',
        errorMessage: 'Old error message',
        lastUpdated: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
      };

      // Create manager with 1 hour staleness threshold
      manager = PersonalityManager.create({
        delay: () => Promise.resolve(),
        staleDuration: 60 * 60 * 1000, // 1 hour
      });

      // Directly add to registry
      manager.registry.personalities.set('test-personality', oldPersonalityData);

      // Mock API responses
      getProfileAvatarUrl.mockResolvedValue('https://example.com/new-avatar.png');
      getProfileDisplayName.mockResolvedValue('Updated Test');
      getProfileErrorMessage.mockResolvedValue('New error message!');

      // Get the personality - should trigger refresh due to staleness
      const personality = manager.getPersonality('test-personality');

      // Should return the old data immediately
      expect(personality).toEqual(oldPersonalityData);
      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityManager] Personality test-personality has stale data, refreshing...'
      );

      // Wait for async refresh
      await jest.runAllTimersAsync();

      // Check that data was refreshed
      const updated = manager.getPersonality('test-personality');
      expect(updated.errorMessage).toBe('New error message!');
      expect(updated.displayName).toBe('Updated Test');
      expect(new Date(updated.lastUpdated).getTime()).toBeGreaterThan(
        new Date(oldPersonalityData.lastUpdated).getTime()
      );
    });
    it('should refresh personality data when lastUpdated is missing', async () => {
      // Register a personality without lastUpdated field (simulating very old data)
      const oldPersonalityData = {
        fullName: 'test-personality',
        addedBy: '123456789012345678',
        displayName: 'Test',
        avatarUrl: 'https://example.com/avatar.png',
        errorMessage: 'Error message exists',
        // Note: no lastUpdated field at all
      };

      // Directly add to registry
      manager.registry.personalities.set('test-personality', oldPersonalityData);

      // Mock API responses
      getProfileAvatarUrl.mockResolvedValue('https://example.com/new-avatar.png');
      getProfileDisplayName.mockResolvedValue('Updated Test');
      getProfileErrorMessage.mockResolvedValue('Updated error message!');

      // Get the personality - should trigger refresh due to missing lastUpdated
      const personality = manager.getPersonality('test-personality');

      // Should return the old data immediately
      expect(personality).toEqual(oldPersonalityData);
      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityManager] Personality test-personality has stale data, refreshing...'
      );

      // Wait for async refresh
      await jest.runAllTimersAsync();

      // Check that data was refreshed and lastUpdated was added
      const updated = manager.getPersonality('test-personality');
      expect(updated.lastUpdated).toBeDefined();
      expect(updated.errorMessage).toBe('Updated error message!');
    });

    it('should refresh personality data when errorMessage is missing', async () => {
      // Register a personality without errorMessage (simulating old data)
      const oldPersonalityData = {
        fullName: 'test-personality',
        addedBy: '123456789012345678',
        displayName: 'Test',
        avatarUrl: 'https://example.com/avatar.png',
        // Note: no errorMessage field
      };

      // Directly add to registry to simulate old data
      manager.registry.personalities.set('test-personality', oldPersonalityData);

      // Mock API responses for refresh
      getProfileAvatarUrl.mockResolvedValue('https://example.com/new-avatar.png');
      getProfileDisplayName.mockResolvedValue('Test Personality');
      getProfileErrorMessage.mockResolvedValue('Oops! Something went wrong! ||*(an error has occurred)*||');

      // Get the personality - should trigger lazy loading
      const personality = manager.getPersonality('test-personality');

      // Should return the old data immediately
      expect(personality).toEqual(oldPersonalityData);
      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityManager] Personality test-personality missing errorMessage, refreshing...'
      );

      // Wait for async refresh to complete
      await jest.runAllTimersAsync();

      // Check that API calls were made
      expect(getProfileAvatarUrl).toHaveBeenCalledWith('test-personality');
      expect(getProfileDisplayName).toHaveBeenCalledWith('test-personality');
      expect(getProfileErrorMessage).toHaveBeenCalledWith('test-personality');

      // Get personality again - should have updated data
      const updatedPersonality = manager.getPersonality('test-personality');
      expect(updatedPersonality.errorMessage).toBe('Oops! Something went wrong! ||*(an error has occurred)*||');
      expect(updatedPersonality.avatarUrl).toBe('https://example.com/new-avatar.png');
      expect(updatedPersonality.displayName).toBe('Test Personality');
    });

    it('should not refresh if errorMessage already exists and data is fresh', async () => {
      // Register a personality with errorMessage and recent timestamp
      const personalityData = {
        fullName: 'test-personality',
        addedBy: '123456789012345678',
        displayName: 'Test',
        avatarUrl: 'https://example.com/avatar.png',
        errorMessage: 'Existing error message',
        lastUpdated: new Date().toISOString(), // Fresh timestamp
      };

      manager.registry.personalities.set('test-personality', personalityData);

      // Get the personality
      const personality = manager.getPersonality('test-personality');

      // Should return the data without refreshing
      expect(personality).toEqual(personalityData);
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('refreshing')
      );

      // API should not be called
      expect(getProfileAvatarUrl).not.toHaveBeenCalled();
      expect(getProfileDisplayName).not.toHaveBeenCalled();
      expect(getProfileErrorMessage).not.toHaveBeenCalled();
    });

    it('should handle refresh errors gracefully', async () => {
      // Register a personality without errorMessage
      const oldPersonalityData = {
        fullName: 'test-personality',
        addedBy: '123456789012345678',
        displayName: 'Test',
      };

      manager.registry.personalities.set('test-personality', oldPersonalityData);

      // Mock API error
      getProfileErrorMessage.mockRejectedValue(new Error('API Error'));
      getProfileAvatarUrl.mockRejectedValue(new Error('API Error'));
      getProfileDisplayName.mockRejectedValue(new Error('API Error'));

      // Get the personality
      const personality = manager.getPersonality('test-personality');

      // Should return the old data
      expect(personality).toEqual(oldPersonalityData);

      // Wait for async refresh to complete
      await jest.runAllTimersAsync();

      // Should log the warning from _fetchProfileData
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not fetch profile info for test-personality')
      );

      // Personality should have been updated with lastUpdated timestamp
      const updated = manager.getPersonality('test-personality');
      expect(updated.lastUpdated).toBeDefined();
      expect(updated.fullName).toBe('test-personality');
    });

    it('should update all fields during refresh', async () => {
      // Register a personality with outdated data
      const oldPersonalityData = {
        fullName: 'test-personality',
        addedBy: '123456789012345678',
        displayName: 'Old Name',
        avatarUrl: 'https://example.com/old.png',
        // No errorMessage
      };

      manager.registry.personalities.set('test-personality', oldPersonalityData);

      // Mock API responses with all new data
      getProfileAvatarUrl.mockResolvedValue('https://example.com/new.png');
      getProfileDisplayName.mockResolvedValue('New Name');
      getProfileErrorMessage.mockResolvedValue('New error message!');

      // Trigger refresh
      manager.getPersonality('test-personality');

      // Wait for refresh
      await jest.runAllTimersAsync();

      // Check updated data
      const updated = manager.getPersonality('test-personality');
      expect(updated.avatarUrl).toBe('https://example.com/new.png');
      expect(updated.displayName).toBe('New Name');
      expect(updated.errorMessage).toBe('New error message!');
    });
  });
});