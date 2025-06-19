const PersonalityRegistry = require('../../../../src/core/personality/PersonalityRegistry');
const logger = require('../../../../src/logger');

// Mock logger
jest.mock('../../../../src/logger');

describe('PersonalityRegistry - Null Alias Handling', () => {
  let registry;

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new PersonalityRegistry();
  });

  describe('getByAlias with null/undefined values', () => {
    it('should return null when alias is null', () => {
      const result = registry.getByAlias(null);
      expect(result).toBeNull();
    });

    it('should return null when alias is undefined', () => {
      const result = registry.getByAlias(undefined);
      expect(result).toBeNull();
    });

    it('should return null when alias is empty string', () => {
      const result = registry.getByAlias('');
      expect(result).toBeNull();
    });

    it('should not throw error when alias is null', () => {
      expect(() => {
        registry.getByAlias(null);
      }).not.toThrow();
    });

    it('should handle null alias in multi-word mention scenario', () => {
      // Register a personality with an alias
      const personalityData = {
        fullName: 'cold-kerach-batuach',
        displayName: 'Cold',
        addedBy: 'test-user',
      };

      registry.register('cold-kerach-batuach', personalityData);
      registry.setAlias('cold', 'cold-kerach-batuach');

      // Verify normal lookup works
      const found = registry.getByAlias('cold');
      expect(found).toEqual(personalityData);

      // Verify null lookup doesn't throw
      const notFound = registry.getByAlias(null);
      expect(notFound).toBeNull();
    });

    it('should handle the message handler bug scenario', () => {
      // This simulates the bug where multi-word mention processing
      // passes null as the first parameter to getPersonalityByAlias

      // The old API was getPersonalityByAlias(userId, alias)
      // In message handler it's called as getPersonalityByAlias(null, mentionText)
      // But our new API only takes one parameter: getPersonalityByAlias(alias)

      // Ensure that even if null is passed, it doesn't throw
      const result = registry.getByAlias(null);
      expect(result).toBeNull();
    });
  });

  describe('setAlias with null/undefined values', () => {
    it('should handle null alias gracefully', () => {
      const result = registry.setAlias(null, 'test-personality');
      expect(result).toBe(false);
    });

    it('should handle undefined alias gracefully', () => {
      const result = registry.setAlias(undefined, 'test-personality');
      expect(result).toBe(false);
    });

    it('should handle empty string alias gracefully', () => {
      const result = registry.setAlias('', 'test-personality');
      expect(result).toBe(false);
    });
  });
});
