/**
 * Simple Avatar Storage Tests
 * 
 * Basic tests for the avatar storage system that work with its singleton nature
 */

// Mock fs before requiring avatarStorage
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockResolvedValue(),
    readFile: jest.fn().mockRejectedValue({ code: 'ENOENT' }), // No existing file by default
    writeFile: jest.fn().mockResolvedValue(),
    access: jest.fn().mockResolvedValue(),
    unlink: jest.fn().mockResolvedValue(),
  },
}));

jest.mock('node-fetch', () => jest.fn());
jest.mock('../../../src/logger');
jest.mock('../../../src/utils/urlValidator');

describe('Avatar Storage - Simple Tests', () => {
  let avatarStorage;
  let fetch;
  let fs;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Get mocked modules
    fetch = require('node-fetch');
    fs = require('fs');
    
    // Get the module
    avatarStorage = require('../../../src/utils/avatarStorage');
  });
  
  afterEach(() => {
    jest.useRealTimers();
  });
  
  describe('Basic functionality', () => {
    it('should generate safe filenames', () => {
      const filename = avatarStorage.generateFilename('Test Bot!@#$', '.png');
      expect(filename).toMatch(/^test-bot-----[a-f0-9]{8}\.png$/);
    });
    
    it('should calculate checksums consistently', () => {
      const buffer = Buffer.from('test-data');
      const checksum1 = avatarStorage.calculateChecksum(buffer);
      const checksum2 = avatarStorage.calculateChecksum(buffer);
      
      expect(checksum1).toBe(checksum2);
      expect(checksum1).toMatch(/^[a-f0-9]{32}$/); // MD5 hex
    });
  });
  
  describe('Timer injection', () => {
    it('should use injected timer functions', async () => {
      const mockSetTimeout = jest.fn((fn) => {
        // Execute immediately for testing
        fn();
        return 123;
      });
      const mockClearTimeout = jest.fn();
      
      avatarStorage.setTimerFunctions({
        setTimeout: mockSetTimeout,
        clearTimeout: mockClearTimeout,
      });
      
      // Mock fetch to fail with abort
      fetch.mockImplementation(() => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      });
      
      // Mock URL validator
      const urlValidator = require('../../../src/utils/urlValidator');
      urlValidator.isValidUrlFormat = jest.fn().mockReturnValue(true);
      
      // Try to download (will fail due to immediate timeout)
      await expect(
        avatarStorage.getLocalAvatarUrl('test-bot', 'https://example.com/avatar.png')
      ).resolves.toBeNull();
      
      // Verify our mock timer was used
      expect(mockSetTimeout).toHaveBeenCalled();
      expect(mockClearTimeout).toHaveBeenCalledWith(123);
    });
  });
  
  describe('Configuration', () => {
    it('should accept configuration updates', () => {
      expect(() => {
        avatarStorage.configure({
          maxFileSize: 5 * 1024 * 1024, // 5MB
          downloadTimeout: 5000,
        });
      }).not.toThrow();
    });
    
    it('should reset internal state', () => {
      expect(() => {
        avatarStorage.reset();
      }).not.toThrow();
    });
  });
});