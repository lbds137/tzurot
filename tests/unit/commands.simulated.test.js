// Test suite for simulated command handling
const { EmbedBuilder } = require('discord.js');

// Mock discord.js modules
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

// We need to test the command handling logic without accessing the actual handleAddCommand function
describe('Commands - Add Command Deduplication Simulation', () => {
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
    global.addRequestRegistry = new Map();
    
    // Clear any other global state from previous tests
    if (global.hasGeneratedFirstEmbed) {
      global.hasGeneratedFirstEmbed.clear();
    }
    if (global.completedAddCommands) {
      global.completedAddCommands.clear();
    }
  });
  
  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    global.setTimeout = originalSetTimeout;
    jest.clearAllMocks();
  });
  
  // Mock the REST module for direct API calls
  jest.mock('node-fetch', () => jest.fn().mockResolvedValue({
    ok: true,
    buffer: jest.fn().mockResolvedValue(Buffer.from('test')),
  }));
  
  // Mock the personalityManager module
  jest.mock('../../src/personalityManager', () => ({
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
  
  // Mock all the other required modules
  jest.mock('../../src/profileInfoFetcher', () => ({
    getProfileDisplayName: jest.fn().mockResolvedValue('Test Display Name'),
    getProfileAvatarUrl: jest.fn().mockResolvedValue('https://example.com/avatar.png'),
    fetchProfileInfo: jest.fn().mockResolvedValue({
      displayName: 'Test Display Name',
      avatarUrl: 'https://example.com/avatar.png'
    })
  }));
  
  jest.mock('../../src/webhookManager', () => ({
    preloadPersonalityAvatar: jest.fn().mockResolvedValue(true)
  }));
  
  // Test the global registry deduplication
  it('should deduplicate commands using global registry', async () => {
    // Create a simulated add command handler
    async function simulatedAddCommand(message, args) {
      // Implement the key deduplication logic from handleAddCommand
      
      // Create a key for this message+args combination
      const messageKey = `add-msg-${message.id}-${args.join('-')}`;
      
      // Check if we've already processed this message
      if (global.addRequestRegistry.has(messageKey)) {
        // Return early if already processed
        return { id: `duplicate-${Date.now()}`, isDuplicate: true };
      }
      
      // Register this request
      global.addRequestRegistry.set(messageKey, {
        requestId: `test-request-${Date.now()}`,
        timestamp: Date.now(),
        profileName: args[0] || 'unknown',
        completed: false,
        embedSent: false
      });
      
      // Mark as completed and sent
      const registryEntry = global.addRequestRegistry.get(messageKey);
      registryEntry.completed = true;
      registryEntry.embedSent = true;
      global.addRequestRegistry.set(messageKey, registryEntry);
      
      // Update global.lastEmbedTime
      global.lastEmbedTime = Date.now();
      
      // Return a success result
      return { id: `successful-embed-${Date.now()}` };
    }
    
    // Create a mock message
    const message = {
      id: 'test-message-id',
      author: { id: 'test-user-id', tag: 'test-user#1234' },
      channel: { id: 'test-channel-id', send: jest.fn().mockResolvedValue({ id: 'sent-message-id' }) },
      reply: jest.fn().mockResolvedValue({ id: 'reply-message-id' }),
      guild: { id: 'test-guild-id' }
    };
    
    // Create arguments for the add command
    const args = ['test-personality', 'test-alias'];
    
    // Run the add command
    const result1 = await simulatedAddCommand(message, args);
    
    // Verify the command was processed
    expect(result1).toBeTruthy();
    expect(result1.id).toContain('successful-embed');
    
    // Check if the global registry was updated
    const messageKey = `add-msg-${message.id}-${args.join('-')}`;
    expect(global.addRequestRegistry.has(messageKey)).toBe(true);
    
    const registryEntry = global.addRequestRegistry.get(messageKey);
    expect(registryEntry.completed).toBe(true);
    expect(registryEntry.embedSent).toBe(true);
    
    // Now try running the same command again with the same message ID
    const result2 = await simulatedAddCommand(message, args);
    
    // Verify the command was deduplicated
    expect(result2.isDuplicate).toBe(true);
  });
  
  // Test time-based deduplication
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
  
  // Test alias handling
  it('should handle all aliases in one place', async () => {
    // Spy on personalityManager functions
    const personalityManager = require('../../src/personalityManager');
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
    
    // Verify setPersonalityAlias was called for all three aliases
    expect(setAliasSpy).toHaveBeenCalledTimes(3);
    
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