/**
 * Tests for the auth token expiration functionality
 */

jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

// Mock fs.promises
const mockFs = {
  mkdir: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn()
};

jest.mock('fs', () => ({
  promises: mockFs
}));

// Mock node-fetch
const mockFetch = jest.fn();
jest.mock('node-fetch', () => mockFetch);

// Mock OpenAI
const mockOpenAIInstance = {
  chat: {
    completions: {
      create: jest.fn()
    }
  }
};
const mockOpenAI = jest.fn(() => mockOpenAIInstance);
jest.mock('openai', () => ({
  OpenAI: mockOpenAI
}));

// Setup mock Date
const MOCK_DATE = new Date(2023, 0, 1);
const MOCK_TIME = MOCK_DATE.getTime();
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const realDateNow = Date.now;

describe('Auth Token Expiration', () => {
  let auth;
  let logger;
  
  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();
    jest.resetModules();
    
    // Set constant date for testing
    Date.now = jest.fn(() => MOCK_TIME);
    
    // Set environment variables
    process.env.SERVICE_APP_ID = 'test-app-id';
    process.env.SERVICE_API_KEY = 'test-api-key';
    process.env.SERVICE_WEBSITE = 'https://test.example.com';
    process.env.SERVICE_API_BASE_URL = 'https://api.test.example.com';
    process.env.OWNER_ID = 'test-owner-id';
    
    // Import modules
    auth = require('../../src/auth');
    logger = require('../../src/logger');
  });
  
  afterEach(async () => {
    // Restore Date.now
    Date.now = realDateNow;
    
    // Shutdown auth system if initialized
    if (auth.shutdown) {
      await auth.shutdown();
    }
  });
  
  describe('Token validity checks', () => {
    it('should correctly determine if a token is valid using proper API', async () => {
      // Setup mock file system with test tokens
      const testTokens = {
        'user1': {
          token: 'valid-token-1',
          createdAt: MOCK_TIME,
          expiresAt: MOCK_TIME + (30 * DAY_IN_MS)
        },
        'user2': {
          token: 'expired-token',
          createdAt: MOCK_TIME - (31 * DAY_IN_MS),
          expiresAt: MOCK_TIME - DAY_IN_MS
        },
        'user3': {
          token: 'almost-expired',
          createdAt: MOCK_TIME - (29 * DAY_IN_MS),
          expiresAt: MOCK_TIME + DAY_IN_MS
        },
        'user4': {
          token: 'old-format-token',
          createdAt: MOCK_TIME - (10 * DAY_IN_MS)
        }
      };
      
      mockFs.readFile.mockImplementation(async (path) => {
        if (path.includes('auth_tokens.json')) {
          return JSON.stringify(testTokens);
        }
        if (path.includes('nsfw_verified.json')) {
          return JSON.stringify({});
        }
        throw new Error('File not found');
      });
      
      // Initialize auth system
      await auth.initAuth();
      
      // Run assertions
      expect(auth.hasValidToken('user1')).toBe(true);
      expect(auth.hasValidToken('user2')).toBe(false); // Expired
      expect(auth.hasValidToken('user3')).toBe(true);  // Almost expired but still valid
      expect(auth.hasValidToken('user4')).toBe(true);  // Old format should be valid
      expect(auth.hasValidToken('nonexistent')).toBe(false);
    });
  });
  
  describe('Token cleanup', () => {
    it('should clean up expired tokens on initialization', async () => {
      // Setup mock file system with mixed tokens
      const testTokens = {
        'valid': {
          token: 'valid-token',
          createdAt: MOCK_TIME,
          expiresAt: MOCK_TIME + (30 * DAY_IN_MS)
        },
        'expired': {
          token: 'expired-token', 
          createdAt: MOCK_TIME - (31 * DAY_IN_MS)
          // No expiresAt - will be migrated to createdAt + 30 days = expired
        }
      };
      
      mockFs.readFile.mockImplementation(async (path) => {
        if (path.includes('auth_tokens.json')) {
          return JSON.stringify(testTokens);
        }
        if (path.includes('nsfw_verified.json')) {
          return JSON.stringify({});
        }
        throw new Error('File not found');
      });
      
      let savedTokens = null;
      mockFs.writeFile.mockImplementation(async (path, data) => {
        if (path.includes('auth_tokens.json')) {
          savedTokens = JSON.parse(data);
        }
      });
      
      // Initialize auth system - this will trigger cleanup
      await auth.initAuth();
      
      // Check that expired tokens were cleaned up during init
      expect(mockFs.writeFile).toHaveBeenCalled();
      expect(savedTokens).toBeTruthy();
      expect(savedTokens).not.toHaveProperty('expired');
      expect(savedTokens).toHaveProperty('valid');
      
      // Verify tokens were cleaned (manual cleanup should find nothing)
      const removedCount = await auth.cleanupExpiredTokens();
      expect(removedCount).toBe(0); // Already cleaned during init
    });
  });
  
  describe('Token age calculation', () => {
    it('should calculate token age correctly', async () => {
      // Setup mock file system with test token
      const testTokens = {
        'user': {
          token: 'test-token',
          createdAt: MOCK_TIME - (10 * DAY_IN_MS),
          expiresAt: MOCK_TIME + (20 * DAY_IN_MS)
        }
      };
      
      mockFs.readFile.mockImplementation(async (path) => {
        if (path.includes('auth_tokens.json')) {
          return JSON.stringify(testTokens);
        }
        if (path.includes('nsfw_verified.json')) {
          return JSON.stringify({});
        }
        throw new Error('File not found');
      });
      
      // Initialize auth system
      await auth.initAuth();
      
      // Run the test
      const age = auth.getTokenAge('user');
      
      // Verify results
      expect(age).toBe(10); // 10 days old
    });
    
    it('should return null for non-existent user', async () => {
      mockFs.readFile.mockImplementation(async (path) => {
        if (path.includes('auth_tokens.json')) {
          return JSON.stringify({});
        }
        if (path.includes('nsfw_verified.json')) {
          return JSON.stringify({});
        }
        throw new Error('File not found');
      });
      
      await auth.initAuth();
      
      const age = auth.getTokenAge('nonexistent');
      expect(age).toBeNull();
    });
  });
  
  describe('Token expiration info', () => {
    it('should calculate token expiration info correctly', async () => {
      // Setup mock file system with test token
      const testTokens = {
        'user': {
          token: 'test-token',
          createdAt: MOCK_TIME - (29 * DAY_IN_MS),
          expiresAt: MOCK_TIME + DAY_IN_MS // 1 day left before expiry
        }
      };
      
      mockFs.readFile.mockImplementation(async (path) => {
        if (path.includes('auth_tokens.json')) {
          return JSON.stringify(testTokens);
        }
        if (path.includes('nsfw_verified.json')) {
          return JSON.stringify({});
        }
        throw new Error('File not found');
      });
      
      // Initialize auth system
      await auth.initAuth();
      
      // Run the test
      const expirationInfo = auth.getTokenExpirationInfo('user');
      
      // Verify results
      expect(expirationInfo).toEqual({
        daysUntilExpiration: 1,
        percentRemaining: 3 // ~3% of 30 days
      });
    });
    
    it('should migrate old tokens to have expiration info', async () => {
      // Setup mock file system with old format token
      const testTokens = {
        'user': {
          token: 'test-token',
          createdAt: MOCK_TIME - (15 * DAY_IN_MS)
          // No expiresAt field - will be migrated
        }
      };
      
      mockFs.readFile.mockImplementation(async (path) => {
        if (path.includes('auth_tokens.json')) {
          return JSON.stringify(testTokens);
        }
        if (path.includes('nsfw_verified.json')) {
          return JSON.stringify({});
        }
        throw new Error('File not found');
      });
      
      // Initialize auth system
      await auth.initAuth();
      
      // Run the test
      const expirationInfo = auth.getTokenExpirationInfo('user');
      
      // Verify results - old format tokens are migrated to have expiration
      expect(expirationInfo).not.toBeNull();
      expect(expirationInfo).toHaveProperty('daysUntilExpiration');
      expect(expirationInfo).toHaveProperty('percentRemaining');
      
      // Should have 15 days left (30 day total - 15 days used)
      expect(expirationInfo.daysUntilExpiration).toBe(15);
      expect(expirationInfo.percentRemaining).toBe(50); // 50% of 30 days
    });
  });
  
  describe('Token storage', () => {
    it('should store new tokens with correct expiration date', async () => {
      // Start with empty tokens
      mockFs.readFile.mockImplementation(async (path) => {
        if (path.includes('auth_tokens.json')) {
          throw Object.assign(new Error('File not found'), { code: 'ENOENT' });
        }
        if (path.includes('nsfw_verified.json')) {
          throw Object.assign(new Error('File not found'), { code: 'ENOENT' });
        }
        throw new Error('File not found');
      });
      
      let savedTokens = null;
      mockFs.writeFile.mockImplementation(async (path, data) => {
        if (path.includes('auth_tokens.json')) {
          savedTokens = JSON.parse(data);
        }
      });
      
      // Initialize auth system
      await auth.initAuth();
      
      // Store a new token
      await auth.storeUserToken('newUser', 'new-token');
      
      // Verify the token was stored correctly
      expect(savedTokens).toHaveProperty('newUser');
      expect(savedTokens.newUser).toHaveProperty('token', 'new-token');
      expect(savedTokens.newUser).toHaveProperty('createdAt', MOCK_TIME);
      expect(savedTokens.newUser).toHaveProperty('expiresAt');
      
      // Calculate expected expiration (30 days from now)
      const expectedExpiration = MOCK_TIME + (30 * DAY_IN_MS);
      expect(savedTokens.newUser.expiresAt).toBe(expectedExpiration);
      
      // Verify the token is valid
      expect(auth.hasValidToken('newUser')).toBe(true);
    });
  });
  
  describe('Error handling', () => {
    it('should handle file system errors gracefully', async () => {
      // Mock file read error
      mockFs.readFile.mockRejectedValue(new Error('Permission denied'));
      
      // Initialize should not throw
      await expect(auth.initAuth()).resolves.not.toThrow();
      
      // Operations should still work with in-memory state
      expect(auth.hasValidToken('user')).toBe(false);
    });
  });
});