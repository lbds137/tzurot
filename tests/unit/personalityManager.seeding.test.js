// Test suite for the personality auto-seeding feature
const personalityManager = require('../../src/personalityManager');
const constants = require('../../src/constants');
const logger = require('../../src/logger');

// Mock dependencies
jest.mock('../../src/profileInfoFetcher', () => ({
  getProfileDisplayName: jest.fn(async (name) => {
    // Simple mock that returns "Lilith" for the first personality with "lilith" in name
    // and "Lilith" for the second one too, to test collision handling
    if (name.includes('lilith-tzel-shani')) return "Lilith";
    if (name.includes('lilith-sheda-khazra')) return "Lilith";
    // Default mock behavior for other personalities
    return name.split('-')[0].charAt(0).toUpperCase() + name.split('-')[0].slice(1);
  }),
  getProfileAvatarUrl: jest.fn(async () => "https://example.com/avatar.png")
}));

// Mock dataStorage and constants
jest.mock('../../src/dataStorage', () => ({
  saveData: jest.fn(async () => true),
  loadData: jest.fn(async () => ({}))
}));

// Create test suite
describe('Personality Auto-Seeding Feature', () => {
  // Reset all mocks and state before each test
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset the in-memory data
    personalityManager.personalityAliases.clear();
    
    // Mock console methods to avoid cluttering test output
    jest.spyOn(logger, 'info').mockImplementation(() => {});
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
    jest.spyOn(logger, 'error').mockImplementation(() => {});
    jest.spyOn(logger, 'debug').mockImplementation(() => {});
    
    // Mock USER_CONFIG for testing
    constants.USER_CONFIG = {
      OWNER_ID: 'test-owner-123',
      OWNER_PERSONALITIES_LIST: 'lilith-tzel-shani,lilith-sheda-khazra-le-khof-avud,other-personality'
    };
  });
  
  test('seedOwnerPersonalities function exists and is exported', () => {
    // Basic test to check that the function exists
    expect(typeof personalityManager.seedOwnerPersonalities).toBe('function');
    expect(personalityManager).toHaveProperty('seedOwnerPersonalities');
  });
  
  test('handles display name alias collisions properly during seeding', async () => {
    // Call the function we're testing
    await personalityManager.seedOwnerPersonalities();
    
    // Check that both personalities were registered
    expect(personalityManager.getPersonality('lilith-tzel-shani')).toBeTruthy();
    expect(personalityManager.getPersonality('lilith-sheda-khazra-le-khof-avud')).toBeTruthy();
    
    // Check that display name aliases were created with collision handling
    // First one should get the basic "lilith" alias - test the single parameter style
    const firstPersonality = personalityManager.getPersonalityByAlias('lilith');
    expect(firstPersonality).toBeTruthy();
    expect(firstPersonality.fullName).toBe('lilith-tzel-shani');
    
    // Second one should get a more meaningful alias like "lilith-sheda"
    // using our enhanced collision handling for display names - test the two parameter style
    const secondPersonality = personalityManager.getPersonalityByAlias(null, 'lilith-sheda');
    expect(secondPersonality).toBeTruthy();
    expect(secondPersonality.fullName).toBe('lilith-sheda-khazra-le-khof-avud');
    
    // The alternates should work but not the basic lilith for the second one
    // Test with the user ID parameter that's now supported
    const byShortAlias = personalityManager.getPersonalityByAlias('test-user', 'lilith');
    expect(byShortAlias.fullName).not.toBe('lilith-sheda-khazra-le-khof-avud');
  });
});