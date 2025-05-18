// Test suite for the embedHelpers.js createPersonalityListEmbed function
const embedHelpers = require('../../src/embedHelpers');
const personalityManager = require('../../src/personalityManager');

// Mock logger to avoid console spam during tests
console.error = jest.fn();
console.log = jest.fn();
console.debug = jest.fn();

// Mock personalityManager functions
jest.mock('../../src/personalityManager', () => ({
  listPersonalitiesForUser: jest.fn(),
  personalityAliases: new Map(), // This should be a Map, not an object!
}));

describe('embedHelpers.createPersonalityListEmbed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    personalityManager.personalityAliases.clear();
  });

  test('properly handles personalityAliases as a Map', () => {
    // Set up test data
    const userId = 'test-user-123';
    const testPersonalities = [
      {
        fullName: 'test-personality-one',
        displayName: 'Test Personality One',
        createdBy: userId,
        createdAt: Date.now()
      },
      {
        fullName: 'test-personality-two',
        displayName: 'Test Personality Two',
        createdBy: userId,
        createdAt: Date.now()
      }
    ];
    
    // Set up mock aliases - using Map instead of object
    personalityManager.personalityAliases.set('test1', 'test-personality-one');
    personalityManager.personalityAliases.set('alias1', 'test-personality-one');
    personalityManager.personalityAliases.set('test2', 'test-personality-two');
    
    // Set up return value for the mock
    personalityManager.listPersonalitiesForUser.mockReturnValue(testPersonalities);
    
    // Execute the function we're testing
    const result = embedHelpers.createPersonalityListEmbed(userId);
    
    // Verify listPersonalitiesForUser was called with the right args
    expect(personalityManager.listPersonalitiesForUser).toHaveBeenCalledWith(userId);
    
    // Check that result has the expected structure
    expect(result).toHaveProperty('embed');
    expect(result).toHaveProperty('totalPages', 1);
    expect(result).toHaveProperty('currentPage', 1);
    
    // Access the embed
    const embed = result.embed;
    
    // Check that embed has the correct title and description
    expect(embed.data.title).toBe('Your Personalities (Page 1/1)');
    expect(embed.data.description).toBe('You have 2 personalities');
    
    // Check that the embed fields contain the correct information
    expect(embed.data.fields).toHaveLength(2);
    
    // First field should mention the two aliases for the first personality
    expect(embed.data.fields[0].name).toBe('Test Personality One');
    expect(embed.data.fields[0].value).toContain('ID: `test-personality-one`');
    expect(embed.data.fields[0].value).toContain('Aliases: test1, alias1');
    
    // Second field should mention the one alias for the second personality
    expect(embed.data.fields[1].name).toBe('Test Personality Two');
    expect(embed.data.fields[1].value).toContain('ID: `test-personality-two`');
    expect(embed.data.fields[1].value).toContain('Aliases: test2');
  });

  test('handles personalities with no aliases', () => {
    // Set up test data
    const userId = 'test-user-123';
    const testPersonalities = [
      {
        fullName: 'test-personality-no-aliases',
        displayName: 'No Aliases',
        createdBy: userId,
        createdAt: Date.now()
      }
    ];
    
    // No aliases for this personality
    
    // Set up return value for the mock
    personalityManager.listPersonalitiesForUser.mockReturnValue(testPersonalities);
    
    // Execute the function we're testing
    const result = embedHelpers.createPersonalityListEmbed(userId);
    const embed = result.embed;
    
    // Check the field for this personality
    expect(embed.data.fields).toHaveLength(1);
    expect(embed.data.fields[0].name).toBe('No Aliases');
    expect(embed.data.fields[0].value).toContain('ID: `test-personality-no-aliases`');
    expect(embed.data.fields[0].value).toContain('No aliases');
  });

  test('handles users with no personalities', () => {
    // Set up test data
    const userId = 'test-user-123';
    
    // No personalities for this user
    personalityManager.listPersonalitiesForUser.mockReturnValue([]);
    
    // Execute the function we're testing
    const result = embedHelpers.createPersonalityListEmbed(userId);
    const embed = result.embed;
    
    // Check that embed has the correct title and description
    expect(embed.data.title).toBe('Your Personalities (Page 1/1)');
    expect(embed.data.description).toBe('You have 0 personalities');
    
    // No fields expected
    expect(embed.data.fields).toHaveLength(0);
  });
  
  test('handles case when personalityAliases is not a Map', () => {
    // Set up test data
    const userId = 'test-user-123';
    const testPersonalities = [
      {
        fullName: 'test-personality-one',
        displayName: 'Test Personality One',
        createdBy: userId,
        createdAt: Date.now()
      }
    ];
    
    // Replace the Map with a regular object to simulate the error condition
    const originalAliases = personalityManager.personalityAliases;
    // @ts-ignore - intentionally setting this to an object for testing
    personalityManager.personalityAliases = {
      'test1': 'test-personality-one',
      'alias1': 'test-personality-one'
    };
    
    // Set up return value for the mock
    personalityManager.listPersonalitiesForUser.mockReturnValue(testPersonalities);
    
    // Execute the function we're testing - it should handle the object instead of Map
    const result = embedHelpers.createPersonalityListEmbed(userId);
    const embed = result.embed;
    
    // Check that the embed was created successfully despite the wrong type
    expect(embed.data.title).toBe('Your Personalities (Page 1/1)');
    expect(embed.data.description).toBe('You have 1 personalities');
    
    // Fallback mechanism should have created a Map from the object
    expect(embed.data.fields).toHaveLength(1);
    expect(embed.data.fields[0].name).toBe('Test Personality One');
    
    // The field should at least have the ID, even if aliases are missing
    expect(embed.data.fields[0].value).toContain('ID: `test-personality-one`');
    
    // Reset the mock to avoid affecting other tests
    personalityManager.personalityAliases = originalAliases;
  });
  
  test('handles pagination correctly', () => {
    // Set up test data with many personalities
    const userId = 'test-user-123';
    const manyPersonalities = Array.from({ length: 30 }, (_, i) => ({
      fullName: `test-personality-${i}`,
      displayName: `Test Personality ${i}`,
      createdBy: userId,
      createdAt: Date.now()
    }));
    
    // Set up return value for the mock
    personalityManager.listPersonalitiesForUser.mockReturnValue(manyPersonalities);
    
    // Get page 1 (default)
    const resultPage1 = embedHelpers.createPersonalityListEmbed(userId);
    
    // Check pagination info
    expect(resultPage1.totalPages).toBe(2); // 30 personalities / 20 per page = 2 pages
    expect(resultPage1.currentPage).toBe(1);
    
    // Check that page 1 embed has navigation instructions
    expect(resultPage1.embed.data.fields.length).toBeLessThanOrEqual(21); // 20 personalities + 1 navigation field
    expect(resultPage1.embed.data.fields[resultPage1.embed.data.fields.length - 1].name).toBe('Navigation');
    
    // Get page 2
    const resultPage2 = embedHelpers.createPersonalityListEmbed(userId, 2);
    
    // Check pagination info
    expect(resultPage2.totalPages).toBe(2);
    expect(resultPage2.currentPage).toBe(2);
    
    // Check that page 2 embed has remaining personalities (10 in this case) plus navigation
    expect(resultPage2.embed.data.fields.length).toBe(11); // 10 personalities + 1 navigation field for previous page
    
    // Try an invalid page (too high)
    const resultPageTooHigh = embedHelpers.createPersonalityListEmbed(userId, 999);
    
    // Should default to last page
    expect(resultPageTooHigh.currentPage).toBe(2);
  });
});