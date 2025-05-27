/**
 * Comprehensive tests for the auth module
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
  writeFile: jest.fn().mockResolvedValue(undefined)
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

describe('Auth Module - Comprehensive Tests', () => {
  let auth;
  let logger;
  
  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();
    jest.resetModules();
    
    // Set environment variables
    process.env.SERVICE_APP_ID = 'test-app-id';
    process.env.SERVICE_API_KEY = 'test-api-key';
    process.env.SERVICE_WEBSITE = 'https://test.example.com';
    process.env.SERVICE_API_BASE_URL = 'https://api.test.example.com';
    process.env.OWNER_ID = 'test-owner-id';
    
    // Setup default fs mock behavior
    mockFs.readFile.mockResolvedValue('{}');
    
    // Import modules after mocks are set up
    auth = require('../../src/auth');
    logger = require('../../src/logger');
    
    // Clear in-memory caches
    auth.userTokens = {};
    auth.nsfwVerified = {};
  });
  
  describe('getAuthorizationUrl', () => {
    it('should return correct authorization URL', async () => {
      // Initialize auth system first
      await auth.initAuth();
      
      const url = auth.getAuthorizationUrl();
      expect(url).toBe('https://test.example.com/authorize?app_id=test-app-id');
    });
  });
  
  describe('exchangeCodeForToken', () => {
    beforeEach(async () => {
      // Initialize auth system for these tests
      await auth.initAuth();
    });
    
    it('should successfully exchange code for token', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({ auth_token: 'test-token-123' })
      };
      mockFetch.mockResolvedValue(mockResponse);
      
      const token = await auth.exchangeCodeForToken('test-code');
      
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.example.com/auth/nonce',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            app_id: 'test-app-id',
            code: 'test-code',
          }),
        }
      );
      expect(token).toBe('test-token-123');
      expect(logger.info).toHaveBeenCalledWith('[Auth] Successfully exchanged code for token');
    });
    
    it('should handle failed exchange', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        statusText: 'Bad Request'
      };
      mockFetch.mockResolvedValue(mockResponse);
      
      const token = await auth.exchangeCodeForToken('bad-code');
      
      expect(token).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        '[Auth] Failed to exchange code for token: 400 Bad Request'
      );
    });
    
    it('should handle network errors', async () => {
      const error = new Error('Network error');
      mockFetch.mockRejectedValue(error);
      
      const token = await auth.exchangeCodeForToken('test-code');
      
      expect(token).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('[Auth] Error exchanging code for token:', error);
    });
  });
  
  describe('getUserToken', () => {
    beforeEach(async () => {
      // Initialize auth system for these tests
      await auth.initAuth();
    });
    
    it('should return token for existing user', async () => {
      // Use the public API instead of manipulating internal state
      await auth.storeUserToken('user123', 'user-token-123');
      
      const token = auth.getUserToken('user123');
      expect(token).toBe('user-token-123');
    });
    
    it('should return null for non-existent user', () => {
      const token = auth.getUserToken('unknown-user');
      expect(token).toBeNull();
    });
    
    it('should return undefined for user without token', async () => {
      // Store a user with invalid token data
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify({
        'user123': {} // No token property
      }));
      
      // Re-initialize to load the invalid data
      jest.resetModules();
      auth = require('../../src/auth');
      await auth.initAuth();
      
      const token = auth.getUserToken('user123');
      expect(token).toBeUndefined();
    });
  });
  
  describe('deleteUserToken', () => {
    beforeEach(async () => {
      // Initialize auth system for these tests
      await auth.initAuth();
    });
    
    it('should delete existing user token', async () => {
      // First store some tokens
      await auth.storeUserToken('user123', 'token-123');
      await auth.storeUserToken('user456', 'token-456');
      
      // Now delete one
      await auth.deleteUserToken('user123');
      
      // Verify the token was deleted
      expect(auth.getUserToken('user123')).toBeNull();
      expect(auth.getUserToken('user456')).toBe('token-456');
      expect(mockFs.writeFile).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('[Auth] Deleted token for user user123');
    });
    
    it('should handle delete for non-existent user', async () => {
      const result = await auth.deleteUserToken('unknown-user');
      
      expect(result).toBe(true); // Returns true when no token to delete
      // Note: The implementation saves even when no token exists to ensure consistency
      expect(mockFs.writeFile).toHaveBeenCalled();
    });
    
    it('should handle file write errors', async () => {
      // Set up initial token data by mocking file read
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify({
        'user123': { token: 'token-123' }
      }));
      
      // Re-initialize to load the data
      jest.resetModules();
      logger.error.mockClear();
      auth = require('../../src/auth');
      await auth.initAuth();
      
      // Now mock write error for the delete
      const error = new Error('Write error');
      mockFs.writeFile.mockRejectedValueOnce(error);
      
      const result = await auth.deleteUserToken('user123');
      
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('[Auth] Error deleting token for user user123:', error);
    });
  });
  
  describe('NSFW Verification', () => {
    beforeEach(async () => {
      // Initialize auth system for these tests
      await auth.initAuth();
    });
    
    describe('storeNsfwVerification', () => {
      it('should store NSFW verification', async () => {
        // Test the BEHAVIOR: storeNsfwVerification should save data and return success
        // We're NOT testing the internal data structure
        
        // Mock successful file operations
        mockFs.readFile.mockResolvedValueOnce('{}');
        mockFs.writeFile.mockResolvedValueOnce();
        
        // Call the function
        const result = await auth.storeNsfwVerification('user123', true);
        
        // Test observable behavior:
        // 1. Function returns success
        expect(result).toBe(true);
        
        // 2. File write was attempted
        expect(mockFs.writeFile).toHaveBeenCalled();
        
        // 3. Success was logged
        expect(logger.info).toHaveBeenCalledWith(
          expect.stringContaining('Stored NSFW verification status for user user123')
        );
      });
      
      it('should handle file write errors', async () => {
        const error = new Error('Write error');
        // Mock both reads (tokens and verifications) then the write error
        mockFs.readFile
          .mockResolvedValueOnce('{}') // tokens file
          .mockResolvedValueOnce('{}'); // verifications file
        mockFs.writeFile.mockRejectedValueOnce(error);
        
        const result = await auth.storeNsfwVerification('user123', true);
        
        expect(result).toBe(false);
        expect(logger.error).toHaveBeenCalledWith('[Auth] Error storing NSFW verification for user user123:', error);
      });
    });
    
    describe('isNsfwVerified', () => {
      it('should return true for verified user', async () => {
        // Use the public API to store verification
        await auth.storeNsfwVerification('user123', true);
        
        expect(auth.isNsfwVerified('user123')).toBe(true);
      });
      
      it('should return false for unverified user', () => {
        expect(auth.isNsfwVerified('unknown-user')).toBe(false);
      });
      
      it('should return false for user with false verification', () => {
        auth.nsfwVerified = {
          'user123': { verified: false }
        };
        
        expect(auth.isNsfwVerified('user123')).toBe(false);
      });
    });
  });
  
  describe('initAuth', () => {
    it('should load tokens and verifications on init', async () => {
      const mockTokenData = {
        'user123': { token: 'token-123' }
      };
      const mockVerificationData = {
        'user456': { verified: true }
      };
      
      mockFs.readFile
        .mockResolvedValueOnce(JSON.stringify(mockTokenData))
        .mockResolvedValueOnce(JSON.stringify(mockVerificationData));
      
      await auth.initAuth();
      
      // Test behavior instead of internal state
      expect(auth.getUserToken('user123')).toBe('token-123');
      expect(auth.isNsfwVerified('user456')).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('[Auth] Loaded 1 user tokens');
      expect(logger.info).toHaveBeenCalledWith('[Auth] Loaded 1 NSFW verification records');
    });
    
    it('should handle missing files gracefully', async () => {
      mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });
      
      await auth.initAuth();
      
      expect(auth.userTokens).toEqual({});
      expect(auth.nsfwVerified).toEqual({});
      expect(logger.info).toHaveBeenCalledWith('[Auth] No tokens file found, starting with empty token store');
      expect(logger.info).toHaveBeenCalledWith('[Auth] No NSFW verification file found, starting with empty store');
    });
    
    it('should handle JSON parse errors', async () => {
      mockFs.readFile.mockResolvedValue('invalid-json');
      
      await auth.initAuth();
      
      // Test behavior - should have no tokens/verifications when parse fails
      expect(auth.getUserToken('any-user')).toBeNull();
      expect(auth.isNsfwVerified('any-user')).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        '[Auth] Error reading tokens file:',
        expect.any(Error)
      );
    });
    
    it('should setup cleanup interval', async () => {
      jest.useFakeTimers();
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      
      await auth.initAuth();
      
      expect(setIntervalSpy).toHaveBeenCalledWith(
        expect.any(Function),
        24 * 60 * 60 * 1000 // 24 hours
      );
      
      jest.useRealTimers();
    });
  });
  
  describe('File operations', () => {
    it('should create data directory if it does not exist', async () => {
      await auth.storeUserToken('user123', 'token-123');
      
      expect(mockFs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('data'),
        { recursive: true }
      );
    });
    
    it('should handle file read errors other than ENOENT', async () => {
      // Mock setInterval to prevent "not defined" error
      global.setInterval = jest.fn();
      
      const error = new Error('Permission denied');
      error.code = 'EACCES';
      mockFs.readFile.mockRejectedValue(error);
      
      await auth.initAuth();
      
      expect(logger.error).toHaveBeenCalledWith('[Auth] Error reading tokens file:', error);
    });
  });
});