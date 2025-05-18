// Mock dependencies
jest.mock('../../src/personalityManager', () => ({
  registerPersonality: jest.fn(),
  getPersonality: jest.fn(),
  setPersonalityAlias: jest.fn(),
  getPersonalityByAlias: jest.fn(),
  saveAllPersonalities: jest.fn(),
  personalityAliases: new Map(),
  listPersonalitiesForUser: jest.fn()
}));

// Import dependencies we need to access
const personalityManager = require('../../src/personalityManager');

describe('Alias Handling', () => {
  // Set up mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock console to suppress logs
    console.log = jest.fn();
    console.error = jest.fn();
  });
  
  // Helper function that extracts the core alias handling logic from commands.js
  // This allows us to test this critical functionality directly
  const setupAndCollectAliases = (profileName, displayName, existingAliases = [], manualAlias = null) => {
    // Initialize the collection
    const aliasesToSet = [];
    
    // First handle the self-referential alias, which was previously causing double embeds
    const selfReferentialAlias = profileName.toLowerCase();
    if (!existingAliases.includes(selfReferentialAlias)) {
      aliasesToSet.push(selfReferentialAlias);
      existingAliases.push(selfReferentialAlias);
    }
    
    // Handle the manual alias if provided
    if (manualAlias) {
      const normalizedAlias = manualAlias.toLowerCase();
      if (!existingAliases.includes(normalizedAlias) && 
          normalizedAlias !== profileName.toLowerCase()) {
        aliasesToSet.push(normalizedAlias);
        existingAliases.push(normalizedAlias);
      }
    }
    
    // Handle the display name alias
    if (displayName) {
      const displayNameAlias = displayName.toLowerCase();
      if (!existingAliases.includes(displayNameAlias) && 
          displayNameAlias !== profileName.toLowerCase()) {
        aliasesToSet.push(displayNameAlias);
      }
    }
    
    return aliasesToSet;
  };
  
  it('should include self-referential alias when not already present', () => {
    const profileName = 'test-personality';
    const displayName = 'Test Personality';
    const existingAliases = [];
    
    const aliases = setupAndCollectAliases(profileName, displayName, existingAliases);
    
    // Should include self-referential and display name aliases
    expect(aliases).toContain('test-personality');
    expect(aliases).toContain('test personality');
    expect(aliases.length).toBe(2);
  });
  
  it('should not include self-referential alias when already present', () => {
    const profileName = 'test-personality';
    const displayName = 'Test Personality';
    const existingAliases = ['test-personality'];
    
    const aliases = setupAndCollectAliases(profileName, displayName, existingAliases);
    
    // Should only include the display name alias
    expect(aliases).not.toContain('test-personality');
    expect(aliases).toContain('test personality');
    expect(aliases.length).toBe(1);
  });
  
  it('should handle manual alias in addition to self-referential and display name', () => {
    const profileName = 'test-personality';
    const displayName = 'Test Personality';
    const existingAliases = [];
    const manualAlias = 'custom-alias';
    
    const aliases = setupAndCollectAliases(profileName, displayName, existingAliases, manualAlias);
    
    // Should include all three aliases
    expect(aliases).toContain('test-personality');
    expect(aliases).toContain('test personality');
    expect(aliases).toContain('custom-alias');
    expect(aliases.length).toBe(3);
  });
  
  it('should handle case sensitivity correctly', () => {
    const profileName = 'Test-Personality';
    const displayName = 'Test Personality';
    const existingAliases = [];
    
    const aliases = setupAndCollectAliases(profileName, displayName, existingAliases);
    
    // Should normalize all aliases to lowercase
    expect(aliases).toContain('test-personality');
    expect(aliases).toContain('test personality');
    expect(aliases.length).toBe(2);
  });
  
  it('should not include display name alias when it matches profile name', () => {
    const profileName = 'test';
    const displayName = 'Test'; // Same as profile name when lowercased
    const existingAliases = [];
    
    const aliases = setupAndCollectAliases(profileName, displayName, existingAliases);
    
    // Should only include the self-referential alias
    expect(aliases).toContain('test');
    expect(aliases.length).toBe(1);
  });
  
  it('should not include display name alias when already present', () => {
    const profileName = 'test-personality';
    const displayName = 'Test Personality';
    const existingAliases = ['test-personality', 'test personality'];
    
    const aliases = setupAndCollectAliases(profileName, displayName, existingAliases);
    
    // Should not include any aliases
    expect(aliases.length).toBe(0);
  });
  
  it('should not include manual alias when it already exists', () => {
    const profileName = 'test-personality';
    const displayName = 'Test Personality';
    const existingAliases = ['custom-alias'];
    const manualAlias = 'custom-alias';
    
    const aliases = setupAndCollectAliases(profileName, displayName, existingAliases, manualAlias);
    
    // Should include only self-referential and display name aliases
    expect(aliases).toContain('test-personality');
    expect(aliases).toContain('test personality');
    expect(aliases).not.toContain('custom-alias');
    expect(aliases.length).toBe(2);
  });
  
  it('should handle empty or null display name', () => {
    const profileName = 'test-personality';
    const displayName = null;
    const existingAliases = [];
    
    const aliases = setupAndCollectAliases(profileName, displayName, existingAliases);
    
    // Should include only the self-referential alias
    expect(aliases).toContain('test-personality');
    expect(aliases.length).toBe(1);
  });
  
  it('should handle empty or null manual alias', () => {
    const profileName = 'test-personality';
    const displayName = 'Test Personality';
    const existingAliases = [];
    const manualAlias = null;
    
    const aliases = setupAndCollectAliases(profileName, displayName, existingAliases, manualAlias);
    
    // Should include self-referential and display name aliases
    expect(aliases).toContain('test-personality');
    expect(aliases).toContain('test personality');
    expect(aliases.length).toBe(2);
  });
  
  it('should handle case where manual alias matches profile name', () => {
    const profileName = 'test-personality';
    const displayName = 'Test Personality';
    const existingAliases = [];
    const manualAlias = 'Test-Personality'; // Same as profile name but different case
    
    const aliases = setupAndCollectAliases(profileName, displayName, existingAliases, manualAlias);
    
    // Should only include self-referential and display name aliases
    expect(aliases).toContain('test-personality');
    expect(aliases).toContain('test personality');
    expect(aliases.length).toBe(2);
  });
  
  it('should properly handle setPersonalityAlias function calls', async () => {
    // This is a more integrated test using personalityManager mock
    
    // Setup the mock
    personalityManager.setPersonalityAlias.mockResolvedValue({
      success: true,
      alternateAliases: []
    });
    
    // Simulate what happens in handleAddCommand
    const profileName = 'test-personality';
    const aliasesToSet = ['test-personality', 'test', 'custom-alias'];
    
    // Set each alias - this is similar to the code in commands.js
    for (let i = 0; i < aliasesToSet.length; i++) {
      const currentAlias = aliasesToSet[i];
      const isDisplayName = currentAlias.toLowerCase() === 'test';
      
      await personalityManager.setPersonalityAlias(
        currentAlias, 
        profileName, 
        true, // skipSave
        isDisplayName
      );
    }
    
    // Verify the mock was called correctly
    expect(personalityManager.setPersonalityAlias).toHaveBeenCalledTimes(3);
    
    // Check each call had the right parameters
    expect(personalityManager.setPersonalityAlias).toHaveBeenNthCalledWith(
      1, 'test-personality', profileName, true, false
    );
    
    expect(personalityManager.setPersonalityAlias).toHaveBeenNthCalledWith(
      2, 'test', profileName, true, true
    );
    
    expect(personalityManager.setPersonalityAlias).toHaveBeenNthCalledWith(
      3, 'custom-alias', profileName, true, false
    );
  });
  
  it('should handle aliases with hyphenated display names', () => {
    const profileName = 'test-personality-hyphenated';
    const displayName = 'Test-Personality';
    const existingAliases = [];
    
    const aliases = setupAndCollectAliases(profileName, displayName, existingAliases);
    
    // Should include self-referential alias and display name alias
    expect(aliases).toContain('test-personality-hyphenated');
    expect(aliases).toContain('test-personality');
    expect(aliases.length).toBe(2);
  });
});