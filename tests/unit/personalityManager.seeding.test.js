// Test suite for the personality auto-seeding feature
const personalityManager = require('../../src/personalityManager');

// Create a very basic test
describe('Personality Auto-Seeding Feature', () => {
  test('seedOwnerPersonalities function exists and is exported', () => {
    // Basic test to check that the function exists
    expect(typeof personalityManager.seedOwnerPersonalities).toBe('function');
    expect(personalityManager).toHaveProperty('seedOwnerPersonalities');
  });
});