// Mock dependencies before requiring the module
jest.mock('discord.js', () => ({
  EmbedBuilder: jest.fn().mockImplementation(() => ({
    setTitle: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
    addFields: jest.fn().mockReturnThis(),
    setThumbnail: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({})
  })),
  PermissionFlagsBits: {
    ManageMessages: 1,
    Administrator: 1
  },
  REST: jest.fn().mockImplementation(() => ({
    setToken: jest.fn().mockReturnThis(),
    post: jest.fn().mockResolvedValue({ id: 'mock-message-id' })
  }))
}));

jest.mock('node-fetch', () => jest.fn().mockResolvedValue({
  ok: true,
  buffer: jest.fn().mockResolvedValue(Buffer.from('test')),
}));

jest.mock('../../../../src/personalityManager', () => ({
  registerPersonality: jest.fn().mockImplementation((userId, fullName, data, fetchInfo) => {
    return Promise.resolve({
      fullName,
      displayName: data.displayName || fullName,
      avatarUrl: data.avatarUrl || null,
      description: data.description || '',
      createdBy: userId,
      createdAt: Date.now()
    });
  }),
  setPersonalityAlias: jest.fn().mockImplementation((alias, fullName, skipSave, isDisplayName) => {
    return Promise.resolve({
      success: true,
      alternateAliases: []
    });
  }),
  getPersonality: jest.fn().mockImplementation((fullName) => {
    return {
      fullName,
      displayName: 'Display ' + fullName,
      avatarUrl: 'https://example.com/avatar.png',
      description: 'Test description',
      createdBy: 'test-user-id',
      createdAt: Date.now()
    };
  }),
  saveAllPersonalities: jest.fn().mockResolvedValue(true),
  listPersonalitiesForUser: jest.fn().mockReturnValue([]),
  personalityAliases: new Map()
}));

jest.mock('../../../../src/profileInfoFetcher', () => ({
  getProfileDisplayName: jest.fn().mockResolvedValue('Test Display Name'),
  getProfileAvatarUrl: jest.fn().mockResolvedValue('https://example.com/avatar.png'),
  fetchProfileInfo: jest.fn().mockResolvedValue({
    displayName: 'Test Display Name',
    avatarUrl: 'https://example.com/avatar.png'
  })
}));

jest.mock('../../../../src/webhookManager', () => ({
  preloadPersonalityAvatar: jest.fn().mockResolvedValue(true)
}));

// Import the mocked modules
const personalityManager = require('../../../../src/personalityManager');

describe('Command Handling Simulations', () => {
  // Save original implementation
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalSetTimeout = global.setTimeout;
  
  beforeEach(() => {
    console.log = jest.fn();
    console.error = jest.fn();
    global.setTimeout = jest.fn((cb) => cb());
    
    // Reset global state for tests
    global.lastEmbedTime = 0;
    
    // Clear any other global state from previous tests
    if (global.hasGeneratedFirstEmbed) {
      global.hasGeneratedFirstEmbed.clear();
    }
    if (global.completedAddCommands) {
      global.completedAddCommands.clear();
    }
    jest.clearAllMocks();
  });
  
  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    global.setTimeout = originalSetTimeout;
  });

  describe('Embed Timing Simulation', () => {
    it('should deduplicate embeds based on global.lastEmbedTime', async () => {
      // Create a function to check for time-based deduplication
      function isRateLimited() {
        const now = Date.now();
        if (global.lastEmbedTime && (now - global.lastEmbedTime < 5000)) {
          return true;
        }
        return false;
      }
      
      // Set global.lastEmbedTime to a recent timestamp
      const now = Date.now();
      global.lastEmbedTime = now - 1000; // 1 second ago
      
      // Verify that we are rate limited
      expect(isRateLimited()).toBe(true);
      
      // Wait 6 seconds (simulate)
      global.lastEmbedTime = now - 6000; // 6 seconds ago
      
      // Verify that we are no longer rate limited
      expect(isRateLimited()).toBe(false);
    });
  });

  describe('Alias Handling Simulation', () => {
    it('should handle all aliases in one place', async () => {
      // Spy on personalityManager functions
      const setAliasSpy = jest.spyOn(personalityManager, 'setPersonalityAlias');
      const saveAllSpy = jest.spyOn(personalityManager, 'saveAllPersonalities');
      
      // Create a simulated alias handling function
      async function simulatedAliasHandling(profileName, displayName, manualAlias) {
        // Collect all aliases to set
        const aliasesToSet = [];
        
        // Skip self-referential alias - no longer needed with improved @mention support
        const selfReferentialAlias = profileName.toLowerCase();
        // Just track it to ensure we don't try to add it elsewhere
        
        // Add manual alias if provided
        if (manualAlias) {
          aliasesToSet.push(manualAlias);
        }
        
        // Add display name alias if different from profile name
        if (displayName && displayName.toLowerCase() !== profileName.toLowerCase()) {
          aliasesToSet.push(displayName.toLowerCase());
        }
        
        // Set all aliases without saving
        for (const alias of aliasesToSet) {
          await personalityManager.setPersonalityAlias(alias, profileName, true);
        }
        
        // Do a single save at the end
        await personalityManager.saveAllPersonalities();
      }
      
      // Test with all three types of aliases
      await simulatedAliasHandling('test-personality', 'Test Display', 'test-alias');
      
      // Verify setPersonalityAlias was called for the right aliases
      expect(setAliasSpy).toHaveBeenCalledTimes(2); // manual alias and display name
      
      // Verify all calls to setPersonalityAlias had skipSave=true
      for (let i = 0; i < setAliasSpy.mock.calls.length; i++) {
        const call = setAliasSpy.mock.calls[i];
        // The third parameter is skipSave
        expect(call[2]).toBe(true);
      }
      
      // Verify saveAllPersonalities was called exactly once at the end
      expect(saveAllSpy).toHaveBeenCalledTimes(1);
      
      // Restore spies
      setAliasSpy.mockRestore();
      saveAllSpy.mockRestore();
    });
  });
});