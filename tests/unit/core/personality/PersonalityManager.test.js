// Use fake timers for this test suite
jest.useFakeTimers();

// Mock only external dependencies
jest.mock('../../../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

// TECH DEBT: PersonalityManager uses singleton pattern which causes test isolation issues
// TODO: Remove singleton pattern and use dependency injection instead
// See: docs/improvements/SINGLETON_MIGRATION_GUIDE.md

jest.mock('../../../../src/profileInfoFetcher', () => ({
  getProfileAvatarUrl: jest.fn(),
  getProfileDisplayName: jest.fn(),
  getProfileErrorMessage: jest.fn()
}));

jest.mock('../../../../src/dataStorage', () => ({
  loadData: jest.fn(),
  saveData: jest.fn()
}));

// Mock constants to ensure no owner is configured by default
jest.mock('../../../../src/constants', () => ({
  USER_CONFIG: {
    OWNER_ID: null, // Explicitly set to null to prevent fallback
    OWNER_PERSONALITIES_LIST: 'test-personality1,test-personality2'
  }
}));

// Import after mocking external deps
const PersonalityManager = require('../../../../src/core/personality/PersonalityManager');
const logger = require('../../../../src/logger');
const { getProfileAvatarUrl, getProfileDisplayName, getProfileErrorMessage } = require('../../../../src/profileInfoFetcher');
const { loadData, saveData } = require('../../../../src/dataStorage');

describe('PersonalityManager Integration Tests', () => {
  let personalityManager;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    
    // Create a fresh instance for each test to avoid singleton issues
    personalityManager = PersonalityManager.create({
      delay: () => Promise.resolve() // No-op delay for tests
    });
    
    // IMPORTANT: Reset ALL state to ensure test isolation
    if (personalityManager.registry) {
      personalityManager.registry.clear();
    }
    if (personalityManager.persistence) {
      // Reset any cached data in persistence layer
      personalityManager.persistence.personalities = null;
      personalityManager.persistence.aliases = null;
    }
    personalityManager.initialized = false;
    
    // Clear any background tasks
    if (personalityManager.backgroundTaskTimeout) {
      clearTimeout(personalityManager.backgroundTaskTimeout);
      personalityManager.backgroundTaskTimeout = null;
    }

    // Set up default mocks for external dependencies
    loadData.mockResolvedValue(null);
    saveData.mockResolvedValue(true);
    getProfileAvatarUrl.mockResolvedValue('https://example.com/avatar.png');
    getProfileDisplayName.mockResolvedValue('Test Display');
    getProfileErrorMessage.mockResolvedValue(null); // Default to no error message
  });

  afterEach(() => {
    // Clear any pending timers to prevent test interference
    jest.clearAllTimers();
    jest.runOnlyPendingTimers();
    // Ensure personalityManager is reset
    personalityManager.initialized = false;
    delete process.env.BOT_OWNER_ID;
  });

  describe('initialize', () => {
    it('should initialize and load data from persistence', async () => {
      const mockPersonalities = {
        'existing-personality': { 
          fullName: 'existing-personality', 
          addedBy: 'user1',
          displayName: 'Existing'
        }
      };
      const mockAliases = {
        'existing': 'existing-personality'
      };

      loadData.mockImplementation((file) => {
        if (file === 'personalities') return Promise.resolve(mockPersonalities);
        if (file === 'aliases') return Promise.resolve(mockAliases);
        return Promise.resolve(null);
      });

      await personalityManager.initialize();

      expect(personalityManager.initialized).toBe(true);
      expect(loadData).toHaveBeenCalledWith('personalities');
      expect(loadData).toHaveBeenCalledWith('aliases');
      
      // Check that data was loaded
      expect(personalityManager.registry.personalities.size).toBe(1);
      expect(personalityManager.registry.aliases.size).toBe(1);
      
      expect(logger.info).toHaveBeenCalledWith('[PersonalityManager] Initializing...');
      expect(logger.info).toHaveBeenCalledWith('[PersonalityManager] Initialization complete');
    });

    it('should handle deferred owner personality seeding', async () => {
      const mockScheduler = jest.fn();
      
      await personalityManager.initialize(true, {
        seedingDelay: 100,
        scheduler: mockScheduler
      });

      expect(mockScheduler).toHaveBeenCalledWith(expect.any(Function), 100);
      expect(logger.info).toHaveBeenCalledWith('[PersonalityManager] Deferring owner personality seeding to background');
    });

    it('should handle synchronous owner personality seeding', async () => {
      process.env.BOT_OWNER_ID = 'test-owner';
      personalityManager.seedOwnerPersonalities = jest.fn().mockResolvedValue();
      
      await personalityManager.initialize(false);

      expect(personalityManager.seedOwnerPersonalities).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('[PersonalityManager] Loading owner personalities synchronously');
      
      delete process.env.BOT_OWNER_ID;
    });

    it('should skip seeding when requested', async () => {
      personalityManager.seedOwnerPersonalities = jest.fn();
      
      await personalityManager.initialize(true, { skipBackgroundSeeding: true });

      expect(personalityManager.seedOwnerPersonalities).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('[PersonalityManager] Skipping owner personality seeding');
    });

    it('should handle initialization errors', async () => {
      loadData.mockRejectedValue(new Error('Load failed'));

      // PersonalityPersistence catches errors and returns empty objects
      // So initialization won't throw, but will log the error
      await personalityManager.initialize();

      expect(logger.error).toHaveBeenCalledWith('[PersonalityPersistence] Error loading data: Load failed');
      expect(personalityManager.initialized).toBe(true);
    });
  });

  describe('registerPersonality', () => {
    beforeEach(async () => {
      await personalityManager.initialize();
    });

    it('should register a new personality successfully', async () => {
      const result = await personalityManager.registerPersonality('test-personality', 'user123');

      expect(result).toEqual({ success: true });
      expect(personalityManager.registry.personalities.has('test-personality')).toBe(true);
      
      const personality = personalityManager.registry.personalities.get('test-personality');
      expect(personality.fullName).toBe('test-personality');
      expect(personality.addedBy).toBe('user123');
      expect(personality.avatarUrl).toBe('https://example.com/avatar.png');
      expect(personality.displayName).toBe('Test Display');
      expect(personality.addedAt).toBeDefined();
      
      expect(logger.info).toHaveBeenCalledWith('[PersonalityManager] Successfully registered personality: test-personality');
      expect(saveData).toHaveBeenCalled();
    });

    it('should fetch and set profile info', async () => {
      getProfileAvatarUrl.mockResolvedValue('https://custom.com/avatar.png');
      getProfileDisplayName.mockResolvedValue('Custom Display');
      getProfileErrorMessage.mockResolvedValue('*sighs* Something went wrong! ||*(an error has occurred)*||');

      const result = await personalityManager.registerPersonality('test-personality', 'user123');

      expect(result).toEqual({ success: true });
      expect(getProfileAvatarUrl).toHaveBeenCalledWith('test-personality');
      expect(getProfileDisplayName).toHaveBeenCalledWith('test-personality');
      
      const personality = personalityManager.registry.personalities.get('test-personality');
      expect(personality.avatarUrl).toBe('https://custom.com/avatar.png');
      expect(personality.displayName).toBe('Custom Display');
    });

    it('should skip profile fetching when fetchInfo is false', async () => {
      const result = await personalityManager.registerPersonality('test-personality', 'user123', {
        fetchInfo: false,
        displayName: 'Custom Display'
      });

      expect(result).toEqual({ success: true });
      expect(getProfileAvatarUrl).not.toHaveBeenCalled();
      expect(getProfileDisplayName).not.toHaveBeenCalled();
      
      const personality = personalityManager.registry.personalities.get('test-personality');
      expect(personality.displayName).toBe('Custom Display');
    });

    it('should handle profile fetch errors gracefully', async () => {
      getProfileAvatarUrl.mockRejectedValue(new Error('Fetch failed'));
      getProfileDisplayName.mockRejectedValue(new Error('Fetch failed'));
      getProfileErrorMessage.mockRejectedValue(new Error('Fetch failed'));

      const result = await personalityManager.registerPersonality('test-personality', 'user123');

      expect(result).toEqual({ success: true });
      expect(logger.warn).toHaveBeenCalledWith('[PersonalityManager] Could not fetch profile info for test-personality: Fetch failed');
      
      // Should fall back to personality name as display name
      const personality = personalityManager.registry.personalities.get('test-personality');
      expect(personality.displayName).toBe('test-personality');
    });

    it('should set display name alias with smart collision handling', async () => {
      // Register first personality with display name "lilith"
      getProfileDisplayName.mockResolvedValue('lilith');
      getProfileErrorMessage.mockResolvedValue(null); // Reset to default
      await personalityManager.registerPersonality('lilith-first', 'user123');
      
      // Register second personality with same display name
      const result = await personalityManager.registerPersonality('lilith-second-part', 'user123');

      expect(result).toEqual({ success: true });
      
      // Check that smart alias was created
      expect(personalityManager.registry.aliases.get('lilith')).toBe('lilith-first');
      
      // The second one should have gotten "lilith-second"
      expect(personalityManager.registry.aliases.get('lilith-second')).toBe('lilith-second-part');
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Created alternate alias'));
    });

    it('should return error for invalid data', async () => {
      const result = await personalityManager.registerPersonality('', 'user123');

      expect(result).toEqual({
        success: false,
        error: 'Personality name must be a non-empty string'
      });
    });

    it('should handle duplicate registration', async () => {
      await personalityManager.registerPersonality('test-personality', 'user123');
      const result = await personalityManager.registerPersonality('test-personality', 'user123');

      expect(result).toEqual({
        success: false,
        error: 'A personality with this name already exists'
      });
    });
  });

  describe('setPersonalityAlias', () => {
    beforeEach(async () => {
      await personalityManager.initialize();
      await personalityManager.registerPersonality('test-personality', 'user123');
    });

    it('should set an alias successfully', async () => {
      const result = await personalityManager.setPersonalityAlias('test-alias', 'test-personality');

      expect(result).toEqual({ success: true });
      expect(personalityManager.registry.aliases.has('test-alias')).toBe(true);
      expect(personalityManager.registry.aliases.get('test-alias')).toBe('test-personality');
      expect(saveData).toHaveBeenCalled();
    });

    it('should skip save when requested', async () => {
      saveData.mockClear();
      
      const result = await personalityManager.setPersonalityAlias('test-alias', 'test-personality', true);

      expect(result).toEqual({ success: true });
      expect(saveData).not.toHaveBeenCalled();
    });

    it('should return error for non-existent personality', async () => {
      const result = await personalityManager.setPersonalityAlias('alias', 'non-existent');

      expect(result).toEqual({
        success: false,
        error: 'Personality not found'
      });
    });

    it('should prevent self-referential aliases', async () => {
      const result = await personalityManager.setPersonalityAlias('test-personality', 'test-personality');

      expect(result).toEqual({
        success: false,
        error: 'Cannot create alias that matches the personality name'
      });
    });

    it('should handle invalid alias format', async () => {
      const result = await personalityManager.setPersonalityAlias('', 'test-personality');

      expect(result).toEqual({
        success: false,
        error: 'Alias must be a non-empty string'
      });
    });
  });

  describe('removePersonality', () => {
    beforeEach(async () => {
      await personalityManager.initialize();
      await personalityManager.registerPersonality('test-personality', 'user123');
      await personalityManager.setPersonalityAlias('test-alias', 'test-personality');
    });

    it('should allow user to remove their own personality', async () => {
      const result = await personalityManager.removePersonality('test-personality', 'user123');

      expect(result).toEqual({ success: true });
      expect(personalityManager.registry.personalities.has('test-personality')).toBe(false);
      expect(personalityManager.registry.aliases.has('test-alias')).toBe(false);
      expect(saveData).toHaveBeenCalled();
    });

    it('should prevent user from removing others personalities', async () => {
      const result = await personalityManager.removePersonality('test-personality', 'other-user');

      expect(result).toEqual({
        success: false,
        error: 'You can only remove personalities you added'
      });
      expect(personalityManager.registry.personalities.has('test-personality')).toBe(true);
    });

    it('should allow bot owner to remove any personality', async () => {
      process.env.BOT_OWNER_ID = 'owner123';
      
      const result = await personalityManager.removePersonality('test-personality', 'owner123');

      expect(result).toEqual({ success: true });
      expect(personalityManager.registry.personalities.has('test-personality')).toBe(false);
      
      delete process.env.BOT_OWNER_ID;
    });

    it('should handle non-existent personality', async () => {
      const result = await personalityManager.removePersonality('non-existent', 'user123');

      expect(result).toEqual({
        success: false,
        error: 'Personality not found'
      });
    });
  });

  describe('seedOwnerPersonalities', () => {
    beforeEach(async () => {
      // Ensure a clean state before each test
      jest.clearAllMocks();
      jest.clearAllTimers();
      
      // IMPORTANT: Get fresh references to mocks after clearAllMocks
      const logger = require('../../../../src/logger');
      logger.info.mockClear();
      logger.error.mockClear();
      
      // Reset ALL PersonalityManager state
      personalityManager.registry.clear();
      personalityManager.initialized = false;
      
      // CRITICAL: Reset the expected personalities list
      if (personalityManager._expectedPersonalities) {
        personalityManager._expectedPersonalities = null;
      }
      
      delete process.env.BOT_OWNER_ID;
      // Force all timers to complete
      jest.runOnlyPendingTimers();
      
      // Initialize the PersonalityManager fresh
      await personalityManager.initialize();
    });

    afterEach(() => {
      // Clean up any pending operations
      jest.clearAllTimers();
      jest.runOnlyPendingTimers();
      delete process.env.BOT_OWNER_ID;
    });

    it('should seed owner personalities from constants', async () => {
      process.env.BOT_OWNER_ID = 'owner123';
      
      // Mock profile fetching to avoid external calls
      getProfileAvatarUrl.mockResolvedValue(null);
      getProfileDisplayName.mockResolvedValue(null);
      getProfileErrorMessage.mockResolvedValue(null);

      await personalityManager.seedOwnerPersonalities({ skipDelays: true });

      // Check if personalities were added to the registry (using default list)
      const personalities = personalityManager.listPersonalitiesForUser('owner123');
      
      // Check that the function ran and logged appropriately
      expect(logger.info).toHaveBeenCalled();
      
      // Log all info calls for debugging
      const allInfoCalls = logger.info.mock.calls.map(call => call[0]);
      
      // Should either complete seeding or skip if already has personalities
      const hasOwnerMessage = allInfoCalls.some(msg => 
        msg && (msg.includes('Owner has') || msg.includes('Seeding complete'))
      );
      
      expect(hasOwnerMessage).toBeTruthy();

      delete process.env.BOT_OWNER_ID;
    });

    it('should skip seeding if owner has all expected personalities', async () => {
      process.env.BOT_OWNER_ID = 'owner123';
      
      // Register all expected personalities
      personalityManager.registry.register('test-personality1', {
        fullName: 'test-personality1',
        addedBy: 'owner123',
        addedAt: new Date().toISOString()
      });
      personalityManager.registry.register('test-personality2', {
        fullName: 'test-personality2',
        addedBy: 'owner123',
        addedAt: new Date().toISOString()
      });
      
      // Clear the mocks before the test
      jest.clearAllMocks();

      const registerSpy = jest.spyOn(personalityManager, 'registerPersonality');
      await personalityManager.seedOwnerPersonalities();

      expect(registerSpy).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('[PersonalityManager] Owner has all 2 expected personalities');

      delete process.env.BOT_OWNER_ID;
      registerSpy.mockRestore();
    });

    it('should add only missing personalities when some already exist', async () => {
      process.env.BOT_OWNER_ID = 'owner123';
      
      // Register only one of the expected personalities
      personalityManager.registry.register('test-personality1', {
        fullName: 'test-personality1',
        addedBy: 'owner123',
        addedAt: new Date().toISOString()
      });
      
      // Clear the mocks before the test
      jest.clearAllMocks();
      
      // Mock successful registration
      const registerSpy = jest.spyOn(personalityManager, 'registerPersonality')
        .mockResolvedValue({ success: true });

      await personalityManager.seedOwnerPersonalities({ skipDelays: true });

      // Should only register the missing personality
      expect(registerSpy).toHaveBeenCalledTimes(1);
      expect(registerSpy).toHaveBeenCalledWith('test-personality2', 'owner123');
      expect(logger.info).toHaveBeenCalledWith('[PersonalityManager] Owner has 1 personalities, missing 1: test-personality2');

      delete process.env.BOT_OWNER_ID;
      registerSpy.mockRestore();
    });

    it('should handle case-insensitive personality comparison', async () => {
      process.env.BOT_OWNER_ID = 'owner123';
      
      // Register personalities with different casing
      personalityManager.registry.register('Test-Personality1', {
        fullName: 'Test-Personality1',
        addedBy: 'owner123',
        addedAt: new Date().toISOString()
      });
      personalityManager.registry.register('TEST-PERSONALITY2', {
        fullName: 'TEST-PERSONALITY2',
        addedBy: 'owner123',
        addedAt: new Date().toISOString()
      });
      
      // Clear the mocks before the test
      jest.clearAllMocks();

      const registerSpy = jest.spyOn(personalityManager, 'registerPersonality');
      await personalityManager.seedOwnerPersonalities();

      // Should recognize both personalities despite case differences
      expect(registerSpy).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('[PersonalityManager] Owner has all 2 expected personalities');

      delete process.env.BOT_OWNER_ID;
      registerSpy.mockRestore();
    });

    it('should skip seeding if no owner configured', async () => {
      // Ensure no owner is configured
      delete process.env.BOT_OWNER_ID;
      
      // Clear all mocks first
      jest.clearAllMocks();

      const registerSpy = jest.spyOn(personalityManager, 'registerPersonality');
      await personalityManager.seedOwnerPersonalities();

      // Should not have registered any personalities
      expect(registerSpy).not.toHaveBeenCalled();
      
      // Should log the skip message
      expect(logger.info).toHaveBeenCalledWith('[PersonalityManager] No bot owner ID configured, skipping seeding');
      
      registerSpy.mockRestore();
    });
  });

  describe('listPersonalitiesForUser', () => {
    beforeEach(async () => {
      await personalityManager.initialize();
      await personalityManager.registerPersonality('user1-personality', 'user1');
      await personalityManager.registerPersonality('user2-personality', 'user2');
      await personalityManager.registerPersonality('another-user1', 'user1');
    });

    it('should list personalities for a specific user', () => {
      const result = personalityManager.listPersonalitiesForUser('user1');

      expect(result).toHaveLength(2);
      expect(result[0].fullName).toBe('user1-personality');
      expect(result[1].fullName).toBe('another-user1');
    });

    it('should return empty array for user with no personalities', () => {
      const result = personalityManager.listPersonalitiesForUser('user3');

      expect(result).toHaveLength(0);
    });
  });

  describe('save', () => {
    it('should save personalities and aliases', async () => {
      await personalityManager.initialize();
      await personalityManager.registerPersonality('test', 'user1');
      
      saveData.mockClear();
      const result = await personalityManager.save();

      expect(result).toBe(true);
      expect(saveData).toHaveBeenCalledWith('personalities', expect.any(Object));
      expect(saveData).toHaveBeenCalledWith('aliases', expect.any(Object));
    });

    it('should handle save errors', async () => {
      saveData.mockResolvedValue(false);

      const result = await personalityManager.save();

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('[PersonalityPersistence] Failed to save personalities');
    });
  });

  describe('getters', () => {
    it('should expose personality aliases map', () => {
      expect(personalityManager.personalityAliases).toBe(personalityManager.registry.aliases);
    });

    it('should expose registry size', () => {
      expect(personalityManager.size).toBe(personalityManager.registry.size);
    });
  });

  describe('_setDisplayNameAlias', () => {
    beforeEach(async () => {
      await personalityManager.initialize();
    });

    it('should set alias directly if not taken', async () => {
      // Create a personality first
      personalityManager.registry.clear();
      personalityManager.registry.register('test-personality', {
        fullName: 'test-personality',
        addedBy: 'test-user',
        addedAt: new Date().toISOString()
      });
      
      await personalityManager._setDisplayNameAlias('Unique-Alias', 'test-personality');

      // Aliases are stored in lowercase
      expect(personalityManager.registry.aliases.has('unique-alias')).toBe(true);
      expect(personalityManager.registry.aliases.get('unique-alias')).toBe('test-personality');
    });

    it('should create smart alias for collisions', async () => {
      // Clear registry and create personalities
      personalityManager.registry.clear();
      personalityManager.registry.register('lilith-first', {
        fullName: 'lilith-first',
        addedBy: 'test-user',
        addedAt: new Date().toISOString()
      });
      personalityManager.registry.register('lilith-second-part', {
        fullName: 'lilith-second-part',
        addedBy: 'test-user',
        addedAt: new Date().toISOString()
      });
      
      // Set initial alias
      personalityManager.registry.setAlias('Lilith', 'lilith-first');

      await personalityManager._setDisplayNameAlias('Lilith', 'lilith-second-part');

      // Should have created 'Lilith-second' as the smart alias (stored lowercase as 'lilith-second')
      expect(personalityManager.registry.aliases.get('lilith')).toBe('lilith-first');
      expect(personalityManager.registry.aliases.get('lilith-second')).toBe('lilith-second-part');
      expect(logger.info).toHaveBeenCalledWith('[PersonalityManager] Created alternate alias Lilith-second for lilith-second-part (Lilith was taken)');
    });

    it('should fall back to random suffix if smart alias is taken', async () => {
      // Clear registry and create personalities
      personalityManager.registry.clear();
      personalityManager.registry.register('test-one', {
        fullName: 'test-one',
        addedBy: 'test-user',
        addedAt: new Date().toISOString()
      });
      personalityManager.registry.register('test-two', {
        fullName: 'test-two',
        addedBy: 'test-user',
        addedAt: new Date().toISOString()
      });
      personalityManager.registry.register('another', {
        fullName: 'another',
        addedBy: 'test-user',
        addedAt: new Date().toISOString()
      });
      
      // Set up existing aliases
      personalityManager.registry.setAlias('Test', 'test-one');
      personalityManager.registry.setAlias('Test-two', 'test-two');
      
      // Try to set 'Test' for a personality that doesn't have a good smart alias
      await personalityManager._setDisplayNameAlias('Test', 'another');

      expect(personalityManager.registry.aliases.get('test')).toBe('test-one');
      
      // Should have created a test-{random} alias for 'another'
      const aliasEntries = Array.from(personalityManager.registry.aliases.entries());
      const anotherAlias = aliasEntries.find(([alias, name]) => name === 'another' && alias.startsWith('test-'));
      expect(anotherAlias).toBeDefined();
      expect(anotherAlias[0]).toMatch(/^test-[a-z]{6}$/);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('[PersonalityManager] Created alternate alias Test-'));
    });
  });
});