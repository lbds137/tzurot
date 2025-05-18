/**
 * Specific test for validateAvatarUrl to test the success case
 */

// Mock node-fetch
jest.mock('node-fetch', () => {
  return jest.fn(() => Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get: (header) => header.toLowerCase() === 'content-type' ? 'image/png' : null
    },
    body: {
      getReader: () => ({
        read: () => Promise.resolve({ done: false, value: new Uint8Array([1, 2, 3]) }),
        cancel: jest.fn()
      })
    }
  }));
});

// Mock the required dependencies
jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Mock errorTracker to avoid dependencies
jest.mock('../../src/utils/errorTracker', () => ({
  trackError: jest.fn(),
  ErrorCategory: {
    AVATAR: 'avatar'
  }
}));

// Mock urlValidator for direct import in webhookManager
jest.mock('../../src/utils/urlValidator', () => ({
  isValidUrlFormat: jest.fn(() => true), 
  isTrustedDomain: jest.fn(() => false),
  hasImageExtension: jest.fn(() => true),
  isImageUrl: jest.fn(() => Promise.resolve(true))
}));

describe('validateAvatarUrl Success Test', () => {
  let webhookManager;
  
  // Save original URL constructor
  const OriginalURL = global.URL;
  
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    
    // Create a valid URL mock that doesn't throw
    global.URL = jest.fn().mockImplementation((url) => {
      return {
        toString: () => url,
        href: url,
        protocol: 'https:',
        host: 'example.com',
        hostname: 'example.com',
        pathname: '/valid.png',
        includes: () => false, // Mock includes function to always return false for tests
      };
    });
    
    // Import webhook manager after setting up mocks
    webhookManager = require('../../src/webhookManager');
  });
  
  afterEach(() => {
    // Restore original URL constructor
    global.URL = OriginalURL;
  });
  
  test('should return true for valid image URLs', async () => {
    const validUrl = 'https://example.com/valid.png';
    
    // Execute the validation
    const result = await webhookManager.validateAvatarUrl(validUrl);
    
    // Should return true
    expect(result).toBe(true);
  });
});