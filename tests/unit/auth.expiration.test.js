/**
 * Tests for the auth token expiration functionality
 */

// Mock dependencies
jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  return {
    ...actualFs,
    promises: {
      mkdir: jest.fn().mockResolvedValue(undefined),
      readFile: jest.fn(),
      writeFile: jest.fn().mockResolvedValue(undefined)
    }
  };
});

jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

// Import dependencies after mocking
const fs = require('fs').promises;
const logger = require('../../src/logger');

// Setup mock Date functionality
const mockDate = new Date(2023, 0, 1);
const realDateNow = Date.now.bind(global.Date);

describe('Auth Token Expiration', () => {
  let auth;
  const TOKEN_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    jest.resetModules();
    
    // Mock the token storage file
    fs.readFile.mockResolvedValue(JSON.stringify({
      // Valid token (created now)
      'user1': {
        token: 'valid-token-1',
        createdAt: Date.now(),
        expiresAt: Date.now() + TOKEN_EXPIRATION_MS
      },
      // Expired token (created 31 days ago)
      'user2': {
        token: 'expired-token',
        createdAt: Date.now() - (31 * 24 * 60 * 60 * 1000),
        expiresAt: Date.now() - (24 * 60 * 60 * 1000)
      },
      // Almost expired token (1 day left)
      'user3': {
        token: 'almost-expired-token',
        createdAt: Date.now() - (29 * 24 * 60 * 60 * 1000),
        expiresAt: Date.now() + (24 * 60 * 60 * 1000)
      },
      // Old format token without expiresAt
      'user4': {
        token: 'old-token',
        createdAt: Date.now() - (10 * 24 * 60 * 60 * 1000)
      }
    }));
    
    // Import auth module after mocks are set up
    auth = require('../../src/auth');
    
    // Mock environment variables
    process.env.SERVICE_APP_ID = 'test-app-id';
    process.env.SERVICE_API_KEY = 'test-api-key';
    process.env.SERVICE_WEBSITE = 'https://test.example.com';
    process.env.SERVICE_API_BASE_URL = 'https://api.test.example.com';
  });
  
  afterEach(() => {
    // Restore Date.now
    global.Date.now = realDateNow;
  });
  
  it('should initialize and load tokens', async () => {
    await auth.initAuth();
    
    expect(fs.mkdir).toHaveBeenCalled();
    expect(fs.readFile).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Loaded 4 user tokens'));
  });
  
  it('should identify valid tokens correctly', async () => {
    await auth.initAuth();
    
    expect(auth.hasValidToken('user1')).toBe(true);
    expect(auth.hasValidToken('user2')).toBe(false); // Expired token
    expect(auth.hasValidToken('user3')).toBe(true);  // Almost expired but still valid
    expect(auth.hasValidToken('user4')).toBe(true);  // Old format but still valid
    expect(auth.hasValidToken('nonexistent')).toBe(false);
  });
  
  it('should clean up expired tokens', async () => {
    await auth.initAuth();
    
    const removedCount = await auth.cleanupExpiredTokens();
    expect(removedCount).toBe(1); // Only user2's token is expired
    
    // Should have saved the updated tokens (without the expired one)
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.not.stringContaining('expired-token'),
      expect.any(String)
    );
    
    // The expired token should be removed
    expect(auth.hasValidToken('user2')).toBe(false);
  });
  
  it('should update old token format with expiration dates', async () => {
    await auth.initAuth();
    
    // Should have saved tokens with updated expiration dates
    expect(fs.writeFile).toHaveBeenCalled();
    
    // Check that the writeFile was called with content that includes expiresAt for user4
    const writeFileCalls = fs.writeFile.mock.calls;
    const lastWriteCall = writeFileCalls[writeFileCalls.length - 1];
    const fileContent = lastWriteCall[1];
    
    expect(fileContent).toContain('user4');
    expect(fileContent).toContain('expiresAt');
  });
  
  it('should provide token age information', async () => {
    await auth.initAuth();
    
    // Using Date.now() from the test, not the real system time
    const tokenAge = auth.getTokenAge('user4');
    expect(tokenAge).toBe(10); // 10 days old
  });
  
  it('should provide token expiration information', async () => {
    await auth.initAuth();
    
    const expirationInfo = auth.getTokenExpirationInfo('user3');
    expect(expirationInfo).toEqual({
      daysUntilExpiration: 1,
      percentRemaining: 3 // Approximately 3% of 30 days
    });
  });
  
  it('should handle tokens with no expiration info gracefully', async () => {
    // Mock Date.now to return a fixed date for consistent testing
    global.Date.now = jest.fn(() => mockDate.getTime());
    
    await auth.initAuth();
    
    // Before the update happens in initAuth, make sure we handle missing expiresAt
    const mockUserTokens = {
      testUser: {
        token: 'test-token',
        createdAt: mockDate.getTime() - (15 * 24 * 60 * 60 * 1000) // 15 days ago
        // No expiresAt field
      }
    };
    
    // Manually set the user tokens to test our scenario
    Object.defineProperty(auth, 'userTokens', {
      get: jest.fn(() => mockUserTokens),
      set: jest.fn()
    });
    
    const expirationInfo = auth.getTokenExpirationInfo('testUser');
    expect(expirationInfo).toBeNull();
  });
  
  it('should store new tokens with correct expiration date', async () => {
    await auth.initAuth();
    
    // Store a new token
    const result = await auth.storeUserToken('newUser', 'new-token');
    expect(result).toBe(true);
    
    // Check that writeFile was called with the correct expiration date
    const writeFileCalls = fs.writeFile.mock.calls;
    const lastWriteCall = writeFileCalls[writeFileCalls.length - 1];
    const fileContent = lastWriteCall[1];
    
    // The token should have both createdAt and expiresAt
    expect(fileContent).toContain('newUser');
    expect(fileContent).toContain('createdAt');
    expect(fileContent).toContain('expiresAt');
    
    // The token should be valid
    expect(auth.hasValidToken('newUser')).toBe(true);
  });
});