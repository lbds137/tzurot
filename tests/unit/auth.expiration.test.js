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
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue('{}'),
    writeFile: jest.fn().mockResolvedValue(undefined)
  }
}));

// Mock node-fetch
jest.mock('node-fetch');

// Setup mock Date
const MOCK_DATE = new Date(2023, 0, 1);
const MOCK_TIME = MOCK_DATE.getTime();
const realDateNow = Date.now;

describe('Auth Token Expiration', () => {
  let auth;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    jest.resetModules();
    
    // Set constant date for testing
    Date.now = jest.fn(() => MOCK_TIME);
    
    // Import auth module after mocks are set up
    auth = require('../../src/auth');
    
    // Set environment variables
    process.env.SERVICE_APP_ID = 'test-app-id';
    process.env.SERVICE_API_KEY = 'test-api-key';
    process.env.SERVICE_WEBSITE = 'https://test.example.com';
    process.env.SERVICE_API_BASE_URL = 'https://api.test.example.com';
  });
  
  afterEach(() => {
    // Restore Date.now
    Date.now = realDateNow;
  });
  
  it('should correctly determine if a token is valid', () => {
    // Set up test data directly
    const DAY_IN_MS = 24 * 60 * 60 * 1000;
    
    auth.userTokens = {
      // Valid token (created now)
      'user1': {
        token: 'valid-token-1',
        createdAt: MOCK_TIME,
        expiresAt: MOCK_TIME + (30 * DAY_IN_MS)
      },
      // Expired token
      'user2': {
        token: 'expired-token',
        createdAt: MOCK_TIME - (31 * DAY_IN_MS),
        expiresAt: MOCK_TIME - DAY_IN_MS
      },
      // Almost expired
      'user3': {
        token: 'almost-expired',
        createdAt: MOCK_TIME - (29 * DAY_IN_MS),
        expiresAt: MOCK_TIME + DAY_IN_MS
      },
      // Old format without expiresAt
      'user4': {
        token: 'old-format-token',
        createdAt: MOCK_TIME - (10 * DAY_IN_MS)
      }
    };
    
    // Run assertions
    expect(auth.hasValidToken('user1')).toBe(true);
    expect(auth.hasValidToken('user2')).toBe(false); // Expired
    expect(auth.hasValidToken('user3')).toBe(true);  // Almost expired but still valid
    expect(auth.hasValidToken('user4')).toBe(true);  // Old format should be valid
    expect(auth.hasValidToken('nonexistent')).toBe(false);
  });
  
  it('should clean up expired tokens', async () => {
    // Set up test data directly
    const DAY_IN_MS = 24 * 60 * 60 * 1000;
    
    auth.userTokens = {
      'valid': {
        token: 'valid-token',
        createdAt: MOCK_TIME,
        expiresAt: MOCK_TIME + (30 * DAY_IN_MS)
      },
      'expired': {
        token: 'expired-token',
        createdAt: MOCK_TIME - (31 * DAY_IN_MS),
        expiresAt: MOCK_TIME - DAY_IN_MS
      }
    };
    
    // Run the cleanup
    const removedCount = await auth.cleanupExpiredTokens();
    
    // Verify results
    expect(removedCount).toBe(1);
    expect(auth.userTokens).not.toHaveProperty('expired');
    expect(auth.userTokens).toHaveProperty('valid');
  });
  
  it('should calculate token age correctly', () => {
    // Setup test data
    const DAY_IN_MS = 24 * 60 * 60 * 1000;
    
    auth.userTokens = {
      'user': {
        token: 'test-token',
        createdAt: MOCK_TIME - (10 * DAY_IN_MS)
      }
    };
    
    // Run the test
    const age = auth.getTokenAge('user');
    
    // Verify results
    expect(age).toBe(10); // 10 days old
  });
  
  it('should calculate token expiration info correctly', () => {
    // Setup test data
    const DAY_IN_MS = 24 * 60 * 60 * 1000;
    
    auth.userTokens = {
      'user': {
        token: 'test-token',
        createdAt: MOCK_TIME - (29 * DAY_IN_MS),
        expiresAt: MOCK_TIME + DAY_IN_MS // 1 day left before expiry
      }
    };
    
    // Run the test
    const expirationInfo = auth.getTokenExpirationInfo('user');
    
    // Verify results
    expect(expirationInfo).toEqual({
      daysUntilExpiration: 1,
      percentRemaining: 3 // ~3% of 30 days
    });
  });
  
  it('should handle tokens with no expiration info gracefully', () => {
    // Setup test data
    auth.userTokens = {
      'user': {
        token: 'test-token',
        createdAt: MOCK_TIME - (15 * 24 * 60 * 60 * 1000)
        // No expiresAt field
      }
    };
    
    // Run the test
    const expirationInfo = auth.getTokenExpirationInfo('user');
    
    // Verify results
    expect(expirationInfo).toBeNull();
  });
  
  it('should store new tokens with correct expiration date', async () => {
    // Clear any existing tokens
    auth.userTokens = {};
    
    // Store a new token
    await auth.storeUserToken('newUser', 'new-token');
    
    // Verify the token was stored correctly
    expect(auth.userTokens).toHaveProperty('newUser');
    expect(auth.userTokens.newUser).toHaveProperty('token', 'new-token');
    expect(auth.userTokens.newUser).toHaveProperty('createdAt');
    expect(auth.userTokens.newUser).toHaveProperty('expiresAt');
    
    // Verify the token is valid
    expect(auth.hasValidToken('newUser')).toBe(true);
  });
});