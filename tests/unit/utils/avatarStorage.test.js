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

    // Reset module to ensure clean state
    jest.resetModules();

    // Get mocked modules
    fetch = require('node-fetch');
    fs = require('fs');

    // Get the module fresh each time
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
      const mockSetTimeout = jest.fn(fn => {
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

      // Reset timer functions to defaults
      avatarStorage.setTimerFunctions({
        setTimeout,
        clearTimeout,
      });
    });
  });

  describe('Content type handling', () => {
    it('should accept application/octet-stream for valid image extensions', async () => {
      // Mock URL validator
      const urlValidator = require('../../../src/utils/urlValidator');
      urlValidator.isValidUrlFormat = jest.fn().mockReturnValue(true);

      // Mock successful fetch with application/octet-stream
      const mockBuffer = Buffer.from('fake-image-data');
      fetch.mockResolvedValue({
        ok: true,
        headers: {
          get: jest.fn(header => {
            if (header === 'content-type') return 'application/octet-stream';
            return null;
          }),
        },
        buffer: jest.fn().mockResolvedValue(mockBuffer),
      });

      // Mock fs to simulate no existing file
      fs.promises.readFile.mockRejectedValue({ code: 'ENOENT' });
      fs.promises.writeFile.mockResolvedValue();

      // Should succeed with .png extension in URL
      const result = await avatarStorage.getLocalAvatarUrl(
        'test-bot',
        'https://files.example.com/api/files/avatar_test.png'
      );

      expect(result).toMatch(/^http.*\/avatars\/test-bot-[a-f0-9]{8}\.png$/);
      expect(fs.promises.writeFile).toHaveBeenCalled();
    });

    it('should reject application/octet-stream for non-image extensions', async () => {
      // Mock URL validator
      const urlValidator = require('../../../src/utils/urlValidator');
      urlValidator.isValidUrlFormat = jest.fn().mockReturnValue(true);

      // Mock fetch with application/octet-stream
      fetch.mockResolvedValue({
        ok: true,
        headers: {
          get: jest.fn(header => {
            if (header === 'content-type') return 'application/octet-stream';
            return null;
          }),
        },
      });

      // Should fail with .txt extension
      const result = await avatarStorage.getLocalAvatarUrl(
        'test-bot',
        'https://example.com/file.txt'
      );

      expect(result).toBeNull();
    });

    it('should handle missing content-type header', async () => {
      // Mock URL validator
      const urlValidator = require('../../../src/utils/urlValidator');
      urlValidator.isValidUrlFormat = jest.fn().mockReturnValue(true);

      // Mock successful fetch with no content-type
      const mockBuffer = Buffer.from('fake-image-data');
      fetch.mockResolvedValue({
        ok: true,
        headers: {
          get: jest.fn(() => null), // No content-type header
        },
        buffer: jest.fn().mockResolvedValue(mockBuffer),
      });

      // Mock fs to simulate no existing file
      fs.promises.readFile.mockRejectedValue({ code: 'ENOENT' });
      fs.promises.writeFile.mockResolvedValue();

      // Should succeed based on .jpg extension
      const result = await avatarStorage.getLocalAvatarUrl(
        'test-bot',
        'https://example.com/avatar.jpg'
      );

      expect(result).toMatch(/^http.*\/avatars\/test-bot-[a-f0-9]{8}\.jpg$/);
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
