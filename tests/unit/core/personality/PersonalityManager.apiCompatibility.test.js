/**
 * Integration test to verify PersonalityManager API compatibility
 * This test ensures that the getPersonalityByAlias method has the correct signature
 */

// Mock dependencies to speed up tests
jest.mock('../../../../src/core/personality/PersonalityPersistence');
jest.mock('../../../../src/profileInfoFetcher');
jest.mock('../../../../src/logger');

const PersonalityManager = require('../../../../src/core/personality/PersonalityManager');
const PersonalityPersistence = require('../../../../src/core/personality/PersonalityPersistence');

describe('PersonalityManager API Compatibility', () => {
  let personalityManager;

  beforeEach(async () => {
    // Mock the persistence layer to return empty data
    PersonalityPersistence.prototype.load = jest.fn().mockResolvedValue({
      personalities: {},
      aliases: {},
    });
    PersonalityPersistence.prototype.save = jest.fn().mockResolvedValue(true);

    personalityManager = new PersonalityManager({
      delay: () => Promise.resolve(), // Mock delay for tests
    });

    // Initialize with test data (fast with mocked persistence)
    await personalityManager.initialize(false, { skipBackgroundSeeding: true });

    // Add a test personality with an alias
    await personalityManager.registerPersonality('test-personality', 'test-user', {
      displayName: 'Test',
      fetchInfo: false, // Skip profile fetching
    });

    await personalityManager.setPersonalityAlias('testalias', 'test-personality', true); // Skip save
  });

  describe('getPersonalityByAlias API', () => {
    it('should accept only one parameter (alias)', () => {
      // Get the function reference
      const fn = personalityManager.getPersonalityByAlias;

      // Check that the function exists
      expect(fn).toBeDefined();
      expect(typeof fn).toBe('function');

      // Check the function signature - it should have exactly 1 parameter
      expect(fn.length).toBe(1);
    });

    it('should return personality when called with just alias', () => {
      // Call with just the alias (correct API)
      const result = personalityManager.getPersonalityByAlias('testalias');

      expect(result).toBeDefined();
      expect(result.fullName).toBe('test-personality');
      expect(result.displayName).toBe('Test');
    });

    it('should return null for unknown alias', () => {
      const result = personalityManager.getPersonalityByAlias('unknown');

      expect(result).toBeNull();
    });

    it('should ignore extra parameters if passed', () => {
      // Even if called with extra parameters, it should still work
      // This tests backward compatibility
      const result = personalityManager.getPersonalityByAlias('testalias', 'ignored-param');

      expect(result).toBeDefined();
      expect(result.fullName).toBe('test-personality');
    });

    it('should handle null alias gracefully', () => {
      const result = personalityManager.getPersonalityByAlias(null);

      expect(result).toBeNull();
    });

    it('should handle undefined alias gracefully', () => {
      const result = personalityManager.getPersonalityByAlias(undefined);

      expect(result).toBeNull();
    });
  });

  describe('Error detection for wrong API usage', () => {
    it('should demonstrate the API mismatch issue', () => {
      // This test documents why the bug occurred
      // The old API expected (userId, alias) but the new API only takes (alias)

      // Mock a scenario where code passes userId as first param
      const userId = 'user123';
      const alias = 'testalias';

      // Wrong usage (passing userId as alias)
      const wrongResult = personalityManager.getPersonalityByAlias(userId);
      expect(wrongResult).toBeNull(); // Returns null because 'user123' is not an alias

      // Correct usage
      const correctResult = personalityManager.getPersonalityByAlias(alias);
      expect(correctResult).toBeDefined();
      expect(correctResult.fullName).toBe('test-personality');
    });
  });

  describe('Module exports API', () => {
    it('should export getPersonalityByAlias as a static method', () => {
      // Test the module-level export
      const { getPersonalityByAlias } = require('../../../../src/core/personality');

      expect(getPersonalityByAlias).toBeDefined();
      expect(typeof getPersonalityByAlias).toBe('function');
      // The exported function is a wrapper with ...args, so length is 0
      // This is OK - the wrapper forwards to the real function which has 1 parameter
      expect(getPersonalityByAlias.length).toBe(0); // Wrapper function
    });
  });
});
