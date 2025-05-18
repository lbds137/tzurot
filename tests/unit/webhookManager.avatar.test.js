/**
 * Tests for the avatar URL handling functions in webhookManager.js
 */

// Import necessary modules for testing
const nodeFetch = require('node-fetch');

// Create a jest mock for node-fetch
jest.mock('node-fetch');

// Mock the logger
jest.mock('../../src/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Constants
const FALLBACK_AVATAR_URL = 'https://cdn.discordapp.com/embed/avatars/0.png';

describe('WebhookManager Avatar URL Handling', () => {
  let webhookManager;
  
  // Original console methods to restore later
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;
  
  // Mock data
  const mockBuffer = Buffer.from('fake image data');
  const validUrl = 'https://example.com/valid.png';
  
  beforeEach(() => {
    // Reset module & mocks
    jest.resetModules();
    jest.clearAllMocks();
    
    // Mock console methods
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
    
    // Set up standard mock response for fetch
    nodeFetch.mockImplementation(() => Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: (header) => header === 'content-type' ? 'image/png' : null
      },
      buffer: () => Promise.resolve(mockBuffer)
    }));
    
    // Mock setTimeout to run callbacks immediately
    jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
      if (typeof callback === 'function') callback();
      return 123; // Return a timeout ID
    });
    
    // Import webhookManager module - must be after mocks are set up
    webhookManager = require('../../src/webhookManager');
    
    // Mock the internal cache to fix our tests
    webhookManager.avatarWarmupCache = new Set();
  });
  
  afterEach(() => {
    // Restore console methods
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
    
    // Clean up mocks
    if (global.setTimeout.mockRestore) {
      global.setTimeout.mockRestore();
    }
  });
  
  describe('Basic Avatar URL Validation', () => {
    test('should return false for null or empty URLs', async () => {
      expect(await webhookManager.validateAvatarUrl(null)).toBe(false);
      expect(await webhookManager.validateAvatarUrl('')).toBe(false);
      expect(await webhookManager.validateAvatarUrl(undefined)).toBe(false);
    });
    
    test('should return false for invalid URL formats', async () => {
      expect(await webhookManager.validateAvatarUrl('not-a-url')).toBe(false);
    });
    
    test('should return false for non-200 responses', async () => {
      nodeFetch.mockImplementationOnce(() => Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: {
          get: () => 'image/png'
        }
      }));
      
      expect(await webhookManager.validateAvatarUrl('https://example.com/notfound.png')).toBe(false);
    });
    
    test('should return false for non-image content types', async () => {
      nodeFetch.mockImplementationOnce(() => Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: () => 'text/html'
        }
      }));
      
      expect(await webhookManager.validateAvatarUrl('https://example.com/page.html')).toBe(false);
    });
    
    test('should return false when fetch throws errors', async () => {
      nodeFetch.mockImplementationOnce(() => Promise.reject(new Error('Network error')));
      
      expect(await webhookManager.validateAvatarUrl('https://example.com/error.png')).toBe(false);
    });
  });
  
  describe('getValidAvatarUrl function', () => {
    test('should return fallback URL for null or empty URLs', async () => {
      expect(await webhookManager.getValidAvatarUrl(null)).toBe(FALLBACK_AVATAR_URL);
      expect(await webhookManager.getValidAvatarUrl('')).toBe(FALLBACK_AVATAR_URL);
      expect(await webhookManager.getValidAvatarUrl(undefined)).toBe(FALLBACK_AVATAR_URL);
    });
    
    test('should return original URL when validation passes', async () => {
      // Override validateAvatarUrl to always return true
      const original = webhookManager.validateAvatarUrl;
      webhookManager.validateAvatarUrl = jest.fn().mockResolvedValue(true);
      
      try {
        const result = await webhookManager.getValidAvatarUrl(validUrl);
        expect(result).toBe(validUrl);
      } finally {
        // Restore original function
        webhookManager.validateAvatarUrl = original;
      }
    });
    
    test('should return fallback URL when validation fails', async () => {
      // Override validateAvatarUrl to always return false
      const original = webhookManager.validateAvatarUrl;
      webhookManager.validateAvatarUrl = jest.fn().mockResolvedValue(false);
      
      try {
        const result = await webhookManager.getValidAvatarUrl(validUrl);
        expect(result).toBe(FALLBACK_AVATAR_URL);
      } finally {
        // Restore original function
        webhookManager.validateAvatarUrl = original;
      }
    });
  });
  
  describe('warmupAvatarUrl function', () => {
    test('should return fallback URL for null URLs', async () => {
      expect(await webhookManager.warmupAvatarUrl(null)).toBe(FALLBACK_AVATAR_URL);
    });
    
    test('should return URL from cache if already warmed up', async () => {
      // Add URL to cache
      webhookManager.avatarWarmupCache.add(validUrl);
      
      // Should return from cache without calling fetch
      const result = await webhookManager.warmupAvatarUrl(validUrl);
      
      expect(result).toBe(validUrl);
      expect(nodeFetch).not.toHaveBeenCalled();
    });
    
    test('should warm up valid URLs and return them', async () => {
      // Mock getValidAvatarUrl to return the original URL
      const originalGetValidAvatarUrl = webhookManager.getValidAvatarUrl;
      webhookManager.getValidAvatarUrl = jest.fn().mockResolvedValue(validUrl);
      
      try {
        // Should return the warmed up URL
        const result = await webhookManager.warmupAvatarUrl(validUrl);
        
        // Should call fetch and add to cache
        expect(nodeFetch).toHaveBeenCalledWith(
          validUrl, 
          expect.objectContaining({
            method: 'GET',
            signal: expect.any(Object),
            headers: expect.any(Object)
          })
        );
        
        expect(result).toBe(validUrl);
        expect(webhookManager.avatarWarmupCache.has(validUrl)).toBe(true);
      } finally {
        // Restore original function
        webhookManager.getValidAvatarUrl = originalGetValidAvatarUrl;
      }
    });
    
    test('should use fallback URL if warmup fails', async () => {
      // Mock getValidAvatarUrl to return the original URL
      const originalGetValidAvatarUrl = webhookManager.getValidAvatarUrl;
      webhookManager.getValidAvatarUrl = jest.fn().mockResolvedValue(validUrl);
      
      // Mock fetch to fail
      nodeFetch.mockImplementation(() => Promise.reject(new Error('Network error')));
      
      try {
        // Should return fallback URL after retries
        const result = await webhookManager.warmupAvatarUrl(validUrl);
        
        // Should have called fetch
        expect(nodeFetch).toHaveBeenCalled();
        
        // Should return fallback URL
        expect(result).toBe(FALLBACK_AVATAR_URL);
      } finally {
        // Restore original function
        webhookManager.getValidAvatarUrl = originalGetValidAvatarUrl;
      }
    });
  });
  
  describe('preloadPersonalityAvatar function', () => {
    test('should set fallback URL for personalities without avatar URL', async () => {
      // Create personality without avatar URL
      const personality = {
        fullName: 'test-personality',
        displayName: 'Test Personality'
      };
      
      // Call the function
      await webhookManager.preloadPersonalityAvatar(personality);
      
      // Should set fallback URL
      expect(personality.avatarUrl).toBe(FALLBACK_AVATAR_URL);
    });
    
    test('should validate and update invalid avatar URLs', async () => {
      // Create personality with invalid avatar URL
      const personality = {
        fullName: 'test-personality',
        displayName: 'Test Personality',
        avatarUrl: 'invalid-url'
      };
      
      // Mock getValidAvatarUrl to return fallback
      const originalGetValidAvatarUrl = webhookManager.getValidAvatarUrl;
      webhookManager.getValidAvatarUrl = jest.fn().mockResolvedValue(FALLBACK_AVATAR_URL);
      
      try {
        // Call the function
        await webhookManager.preloadPersonalityAvatar(personality);
        
        // Should update to fallback URL
        expect(personality.avatarUrl).toBe(FALLBACK_AVATAR_URL);
      } finally {
        // Restore original function
        webhookManager.getValidAvatarUrl = originalGetValidAvatarUrl;
      }
    });
    
    test('should handle null personality gracefully', async () => {
      await expect(webhookManager.preloadPersonalityAvatar(null)).resolves.not.toThrow();
    });
  });
});