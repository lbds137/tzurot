// Test suite for the embedHelpers.js createPersonalityListEmbed function
const embedHelpers = require('../../src/embedHelpers');
const personalityManager = require('../../src/personalityManager');

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
    const embed = embedHelpers.createPersonalityListEmbed(userId);
    
    // Verify listPersonalitiesForUser was called with the right args
    expect(personalityManager.listPersonalitiesForUser).toHaveBeenCalledWith(userId);
    
    // Check that embed has the correct title and description
    expect(embed.data.title).toBe('Your Personalities');
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
    const embed = embedHelpers.createPersonalityListEmbed(userId);
    
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
    const embed = embedHelpers.createPersonalityListEmbed(userId);
    
    // Check that embed has the correct title and description
    expect(embed.data.title).toBe('Your Personalities');
    expect(embed.data.description).toBe('You have 0 personalities');
    
    // No fields expected
    expect(embed.data.fields).toHaveLength(0);
  });
});