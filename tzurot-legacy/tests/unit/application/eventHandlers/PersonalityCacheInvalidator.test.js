/**
 * Tests for PersonalityCacheInvalidator
 */

const {
  PersonalityCacheInvalidator,
} = require('../../../../src/application/eventHandlers/PersonalityCacheInvalidator');
const {
  PersonalityProfileUpdated,
  PersonalityRemoved,
  PersonalityAliasAdded,
  PersonalityAliasRemoved,
} = require('../../../../src/domain/personality/PersonalityEvents');

describe('PersonalityCacheInvalidator', () => {
  let cacheInvalidator;
  let mockProfileInfoCache;
  let mockMessageTracker;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock dependencies
    mockProfileInfoCache = {
      deleteFromCache: jest.fn(),
    };

    mockMessageTracker = {
      // Add methods as needed
    };

    // Create instance
    cacheInvalidator = new PersonalityCacheInvalidator({
      profileInfoCache: mockProfileInfoCache,
      messageTracker: mockMessageTracker,
    });
  });

  describe('handlePersonalityProfileUpdated', () => {
    it('should clear cache when personality profile is updated', async () => {
      const event = new PersonalityProfileUpdated('personality-123', {
        profile: {
          name: 'testpersonality',
          prompt: 'Updated prompt',
        },
        updatedAt: new Date().toISOString(),
      });

      await cacheInvalidator.handlePersonalityProfileUpdated(event);

      expect(mockProfileInfoCache.deleteFromCache).toHaveBeenCalledWith('testpersonality');
    });

    it('should handle missing profile name gracefully', async () => {
      const event = new PersonalityProfileUpdated('personality-123', {
        profile: {},
        updatedAt: new Date().toISOString(),
      });

      await cacheInvalidator.handlePersonalityProfileUpdated(event);

      expect(mockProfileInfoCache.deleteFromCache).not.toHaveBeenCalled();
    });

    it('should handle missing profile info cache gracefully', async () => {
      cacheInvalidator.profileInfoCache = null;

      const event = new PersonalityProfileUpdated('personality-123', {
        profile: { name: 'test' },
        updatedAt: new Date().toISOString(),
      });

      await expect(cacheInvalidator.handlePersonalityProfileUpdated(event)).resolves.not.toThrow();
    });
  });

  describe('handlePersonalityRemoved', () => {
    it('should clear cache when personality is removed', async () => {
      const event = new PersonalityRemoved('personality-123', {
        personalityName: 'testpersonality',
        removedBy: 'user-123',
        removedAt: new Date().toISOString(),
      });

      await cacheInvalidator.handlePersonalityRemoved(event);

      expect(mockProfileInfoCache.deleteFromCache).toHaveBeenCalledWith('testpersonality');
    });

    it('should handle missing personality name gracefully', async () => {
      const event = new PersonalityRemoved('personality-123', {
        removedBy: 'user-123',
        removedAt: new Date().toISOString(),
      });

      await cacheInvalidator.handlePersonalityRemoved(event);

      expect(mockProfileInfoCache.deleteFromCache).not.toHaveBeenCalled();
    });
  });

  describe('handlePersonalityAliasAdded', () => {
    it('should clear cache when alias is added', async () => {
      const event = new PersonalityAliasAdded('personality-123', {
        personalityName: 'testpersonality',
        alias: 'testalias',
        addedBy: 'user-123',
        addedAt: new Date().toISOString(),
      });

      await cacheInvalidator.handlePersonalityAliasAdded(event);

      expect(mockProfileInfoCache.deleteFromCache).toHaveBeenCalledWith('testpersonality');
    });
  });

  describe('handlePersonalityAliasRemoved', () => {
    it('should clear both personality and alias caches when alias is removed', async () => {
      const event = new PersonalityAliasRemoved('personality-123', {
        personalityName: 'testpersonality',
        alias: 'testalias',
        removedBy: 'user-123',
        removedAt: new Date().toISOString(),
      });

      await cacheInvalidator.handlePersonalityAliasRemoved(event);

      expect(mockProfileInfoCache.deleteFromCache).toHaveBeenCalledWith('testpersonality');
      expect(mockProfileInfoCache.deleteFromCache).toHaveBeenCalledWith('testalias');
    });

    it('should handle missing alias gracefully', async () => {
      const event = new PersonalityAliasRemoved('personality-123', {
        personalityName: 'testpersonality',
        alias: 'testalias',
        removedBy: 'user-123',
        removedAt: new Date().toISOString(),
      });

      await cacheInvalidator.handlePersonalityAliasRemoved(event);

      expect(mockProfileInfoCache.deleteFromCache).toHaveBeenCalledWith('testpersonality');
      expect(mockProfileInfoCache.deleteFromCache).toHaveBeenCalledWith('testalias');
      expect(mockProfileInfoCache.deleteFromCache).toHaveBeenCalledTimes(2);
    });
  });
});
