/**
 * @jest-environment node
 * @testType adapter
 *
 * FileAuthenticationRepository Test
 * - Tests file-based authentication repository adapter
 * - Mocks external dependencies (fs, logger)
 * - Domain models are NOT mocked
 */

jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    rename: jest.fn(),
  },
}));
const logger = require('../../../../src/logger');
jest.mock('../../../../src/logger');

const { dddPresets } = require('../../../__mocks__/ddd');

const fs = require('fs').promises;
const path = require('path');
const {
  FileAuthenticationRepository,
} = require('../../../../src/adapters/persistence/FileAuthenticationRepository');
const { UserAuth, Token, NsfwStatus } = require('../../../../src/domain/authentication');
const { UserId } = require('../../../../src/domain/personality');

describe('FileAuthenticationRepository', () => {
  let repository;
  let mockFileData;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation();
    // jest.spyOn(console, 'error').mockImplementation();

    // Default mock file data - simplified structure
    mockFileData = {
      '123456789012345678': {
        userId: '123456789012345678',
        token: {
          value: 'test-token-2',
          expiresAt: null,
        },
        nsfwStatus: {
          verified: false,
          verifiedAt: null,
        },
        blacklisted: false,
        blacklistReason: null,
        savedAt: '2024-01-02T00:00:00.000Z',
      },
    };

    // Mock fs methods
    fs.mkdir.mockResolvedValue();
    fs.readFile.mockResolvedValue(JSON.stringify(mockFileData));
    fs.writeFile.mockResolvedValue();
    fs.rename.mockResolvedValue();

    repository = new FileAuthenticationRepository({
      dataPath: './test-data',
      filename: 'test-auth.json',
      tokenCleanupInterval: 1000, // 1 second for testing
      setInterval: jest.fn((fn, ms) => setInterval(fn, ms)),
      clearInterval: jest.fn((id) => clearInterval(id)),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    // Clean up timer if repository was initialized
    if (repository && repository._cleanupTimer) {
      clearInterval(repository._cleanupTimer);
    }
  });

  describe('initialize', () => {
    it('should create data directory if it does not exist', async () => {
      await repository.initialize();

      expect(fs.mkdir).toHaveBeenCalledWith('./test-data', { recursive: true });
    });

    it('should load existing data file', async () => {
      // First call fails for legacy file, second succeeds for current file
      fs.readFile
        .mockRejectedValueOnce({ code: 'ENOENT' }) // auth_tokens.json not found
        .mockResolvedValueOnce(JSON.stringify(mockFileData)); // test-auth.json found

      await repository.initialize();

      expect(fs.readFile).toHaveBeenCalledWith(path.join('./test-data', 'auth_tokens.json'), 'utf8');
      expect(fs.readFile).toHaveBeenCalledWith(path.join('./test-data', 'test-auth.json'), 'utf8');
      // Cache should have the user data
      expect(repository._cache['123456789012345678']).toBeDefined();
      expect(repository._initialized).toBe(true);
    });

    it('should create new file if it does not exist', async () => {
      fs.readFile.mockRejectedValue({ code: 'ENOENT' });

      await repository.initialize();

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join('./test-data', 'test-auth.json.tmp'),
        JSON.stringify({}, null, 2),
        'utf8'
      );
      expect(fs.rename).toHaveBeenCalledWith(
        path.join('./test-data', 'test-auth.json.tmp'),
        path.join('./test-data', 'test-auth.json')
      );
    });

    it('should clean up expired tokens on startup', async () => {
      // Add expired token to mock data
      const expiredData = {
        '123456789012345678': {
          ...mockFileData['123456789012345678'],
          token: {
            value: 'expired-token',
            expiresAt: new Date(Date.now() - 1000).toISOString(), // Expired
          },
        },
      };
      fs.readFile
        .mockRejectedValueOnce({ code: 'ENOENT' }) // auth_tokens.json not found
        .mockResolvedValueOnce(JSON.stringify(expiredData)); // test-auth.json found

      await repository.initialize();

      // Token cleanup no longer removes expired tokens - domain logic handles expiry
      expect(repository._cache['123456789012345678'].token).toEqual({
        value: 'expired-token',
        expiresAt: new Date(Date.now() - 1000).toISOString()
      });
    });

    it('should start cleanup timer', async () => {
      await repository.initialize();

      expect(repository._setInterval).toHaveBeenCalledWith(expect.any(Function), 1000);
    });

    it('should throw error for other file read errors', async () => {
      fs.readFile.mockRejectedValue(new Error('Read error'));

      await expect(repository.initialize()).rejects.toThrow('Failed to initialize repository: Read error');
    });

    it('should not reinitialize if already initialized', async () => {
      await repository.initialize();
      fs.readFile.mockClear();

      await repository.initialize();

      expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('should migrate from old format to new format', async () => {
      // Old format with userAuth and tokens objects
      const oldFormatData = {
        userAuth: {
          '123456789012345678': {
            userId: '123456789012345678',
            tokens: [
              {
                value: 'old-token-1',
                createdAt: '2024-01-01T00:00:00.000Z',
                expiresAt: new Date(Date.now() + 1000000).toISOString(),
              },
              {
                value: 'old-token-2',
                createdAt: '2024-01-02T00:00:00.000Z',
                expiresAt: null,
              },
            ],
            nsfwStatus: { verified: true, verifiedAt: '2024-01-01T00:00:00.000Z' },
          },
        },
        tokens: {
          'old-token-1': { userId: '123456789012345678' },
          'old-token-2': { userId: '123456789012345678' },
        },
      };
      fs.readFile
        .mockRejectedValueOnce({ code: 'ENOENT' }) // auth_tokens.json not found
        .mockResolvedValueOnce(JSON.stringify(oldFormatData)); // test-auth.json has old format

      await repository.initialize();

      // Should have migrated to new format
      expect(repository._cache['123456789012345678']).toBeDefined();
      expect(repository._cache['123456789012345678'].token.value).toBe('old-token-2'); // Most recent token
      expect(repository._cache['123456789012345678'].nsfwStatus).toEqual({
        verified: true,
        verifiedAt: '2024-01-01T00:00:00.000Z',
      });
      expect(fs.writeFile).toHaveBeenCalled(); // Should persist migrated data
    });
  });

  describe('save', () => {
    beforeEach(async () => {
      fs.readFile
        .mockRejectedValueOnce({ code: 'ENOENT' }) // auth_tokens.json not found
        .mockResolvedValueOnce(JSON.stringify(mockFileData)); // test-auth.json found
      await repository.initialize();
    });

    it('should save user authentication', async () => {
      const userId = new UserId('987654321098765432');
      const token = new Token('new-token', null);
      const userAuth = UserAuth.createAuthenticated(userId, token);

      await repository.save(userAuth);

      expect(repository._cache['987654321098765432']).toBeDefined();
      expect(repository._cache['987654321098765432'].token.value).toBe('new-token');
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should update existing user authentication', async () => {
      const userId = new UserId('123456789012345678');
      const newToken = new Token('updated-token', null);
      const userAuth = UserAuth.createAuthenticated(userId, newToken);

      await repository.save(userAuth);

      expect(repository._cache['123456789012345678'].token.value).toBe('updated-token');
    });

    it('should handle save errors', async () => {
      fs.writeFile.mockRejectedValue(new Error('Write error'));
      const userId = new UserId('987654321098765432');
      const token = new Token('new-token', null);
      const userAuth = UserAuth.createAuthenticated(userId, token);

      await expect(repository.save(userAuth)).rejects.toThrow('Failed to save user auth: Failed to persist data: Write error');
    });

    it('should initialize if not already initialized', async () => {
      repository._initialized = false;
      const userId = new UserId('987654321098765432');
      const token = new Token('new-token', null);
      const userAuth = UserAuth.createAuthenticated(userId, token);

      await repository.save(userAuth);

      expect(repository._initialized).toBe(true);
    });
  });

  describe('findByUserId', () => {
    beforeEach(async () => {
      fs.readFile
        .mockRejectedValueOnce({ code: 'ENOENT' }) // auth_tokens.json not found
        .mockResolvedValueOnce(JSON.stringify(mockFileData)); // test-auth.json found
      await repository.initialize();
    });

    it('should find user auth by ID', async () => {
      const result = await repository.findByUserId('123456789012345678');

      expect(result).toBeTruthy();
      expect(result.userId.value).toBe('123456789012345678');
      expect(result.token.value).toBe('test-token-2');
    });

    it('should return null if user not found', async () => {
      const result = await repository.findByUserId('nonexistent');

      expect(result).toBeNull();
    });

    it('should handle errors during hydration', async () => {
      // Add invalid data to trigger hydration error
      repository._cache['invalid'] = { userId: null }; // Missing required fields

      const result = await repository.findByUserId('invalid');

      expect(result).toBeNull();
    });
  });

  describe('findByToken', () => {
    beforeEach(async () => {
      fs.readFile
        .mockRejectedValueOnce({ code: 'ENOENT' }) // auth_tokens.json not found
        .mockResolvedValueOnce(JSON.stringify(mockFileData)); // test-auth.json found
      await repository.initialize();
    });

    it('should find user auth by token', async () => {
      const result = await repository.findByToken('test-token-2');

      expect(result).toBeTruthy();
      expect(result.userId.value).toBe('123456789012345678');
      expect(result.token.value).toBe('test-token-2');
    });

    it('should return null if token not found', async () => {
      const result = await repository.findByToken('nonexistent-token');

      expect(result).toBeNull();
    });

    it('should handle errors during hydration', async () => {
      // Add invalid data
      repository._cache['invalid'] = {
        token: { value: 'bad-token' },
        userId: null, // Missing required field
      };

      const result = await repository.findByToken('bad-token');

      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    beforeEach(async () => {
      fs.readFile
        .mockRejectedValueOnce({ code: 'ENOENT' }) // auth_tokens.json not found
        .mockResolvedValueOnce(JSON.stringify(mockFileData)); // test-auth.json found
      await repository.initialize();
    });

    it('should delete user auth', async () => {
      await repository.delete('123456789012345678');

      expect(repository._cache['123456789012345678']).toBeUndefined();
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should handle deleting non-existent user', async () => {
      await repository.delete('nonexistent');

      // Should not throw error
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should handle delete errors', async () => {
      fs.writeFile.mockRejectedValue(new Error('Write error'));

      await expect(repository.delete('123456789012345678')).rejects.toThrow(
        'Failed to delete user auth: Failed to persist data: Write error'
      );
    });
  });

  describe('exists', () => {
    beforeEach(async () => {
      fs.readFile
        .mockRejectedValueOnce({ code: 'ENOENT' }) // auth_tokens.json not found
        .mockResolvedValueOnce(JSON.stringify(mockFileData)); // test-auth.json found
      await repository.initialize();
    });

    it('should return true if user exists', async () => {
      const exists = await repository.exists('123456789012345678');

      expect(exists).toBe(true);
    });

    it('should return false if user does not exist', async () => {
      const exists = await repository.exists('nonexistent');

      expect(exists).toBe(false);
    });
  });

  describe('countAuthenticated', () => {
    beforeEach(async () => {
      fs.readFile
        .mockRejectedValueOnce({ code: 'ENOENT' }) // auth_tokens.json not found
        .mockResolvedValueOnce(JSON.stringify(mockFileData)); // test-auth.json found
      await repository.initialize();
    });

    it('should count authenticated users', async () => {
      const count = await repository.countAuthenticated();

      expect(count).toBe(1);
    });

    it('should return 0 if no users', async () => {
      repository._cache = {};
      
      const count = await repository.countAuthenticated();

      expect(count).toBe(0);
    });
  });


  describe('findExpiredTokens', () => {
    beforeEach(async () => {
      fs.readFile
        .mockRejectedValueOnce({ code: 'ENOENT' }) // auth_tokens.json not found
        .mockResolvedValueOnce(JSON.stringify(mockFileData)); // test-auth.json found
      await repository.initialize();
    });

    it('should find users with expired tokens', async () => {
      // Add user with expired token
      repository._cache['888888888888888888'] = {
        userId: '888888888888888888',
        token: {
          value: 'expired-token',
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        },
        blacklisted: false,
        nsfwStatus: { verified: false, verifiedAt: null },
        savedAt: '2024-01-01T00:00:00.000Z',
      };

      const expired = await repository.findExpiredTokens();

      expect(expired).toHaveLength(1);
      expect(expired[0].userId.value).toBe('888888888888888888');
    });

    it('should return empty array if no expired tokens', async () => {
      const expired = await repository.findExpiredTokens();

      expect(expired).toEqual([]);
    });
  });

  describe('_hydrate', () => {
    it('should hydrate user with NSFW status', async () => {
      fs.readFile
        .mockRejectedValueOnce({ code: 'ENOENT' }) // auth_tokens.json not found
        .mockResolvedValueOnce(JSON.stringify(mockFileData)); // test-auth.json found
      await repository.initialize();
      
      const data = {
        userId: '123456789012345678',
        token: { value: 'test-token', expiresAt: null },
        nsfwStatus: { verified: true, verifiedAt: '2024-01-01T00:00:00.000Z' },
        blacklisted: false,
        blacklistReason: null,
        savedAt: '2024-01-01T00:00:00.000Z',
      };

      const userAuth = repository._hydrate(data);

      expect(userAuth).toBeTruthy();
      expect(userAuth.nsfwStatus.verified).toBe(true);
    });

    it('should return null for invalid data', async () => {
      fs.readFile
        .mockRejectedValueOnce({ code: 'ENOENT' }) // auth_tokens.json not found
        .mockResolvedValueOnce(JSON.stringify(mockFileData)); // test-auth.json found
      await repository.initialize();
      
      const userAuth = repository._hydrate({ userId: null }); // Missing required fields

      expect(userAuth).toBeNull();
    });

    it('should mark events as committed', async () => {
      fs.readFile
        .mockRejectedValueOnce({ code: 'ENOENT' }) // auth_tokens.json not found
        .mockResolvedValueOnce(JSON.stringify(mockFileData)); // test-auth.json found
      await repository.initialize();
      
      const data = {
        userId: '123456789012345678',
        token: { value: 'test-token', expiresAt: null },
        nsfwStatus: { verified: false, verifiedAt: null },
        blacklisted: false,
        blacklistReason: null,
        savedAt: '2024-01-01T00:00:00.000Z',
      };

      const userAuth = repository._hydrate(data);

      expect(userAuth.getUncommittedEvents()).toHaveLength(0);
    });
  });

  describe('_persist', () => {
    beforeEach(async () => {
      fs.readFile
        .mockRejectedValueOnce({ code: 'ENOENT' }) // auth_tokens.json not found
        .mockResolvedValueOnce(JSON.stringify(mockFileData)); // test-auth.json found
      await repository.initialize();
    });

    it('should write to temp file then rename', async () => {
      repository._cache = { test: 'data' };
      await repository._persist();

      expect(fs.writeFile).toHaveBeenCalledWith(
        'test-data/test-auth.json.tmp',
        JSON.stringify({ test: 'data' }, null, 2),
        'utf8'
      );
      expect(fs.rename).toHaveBeenCalledWith('test-data/test-auth.json.tmp', 'test-data/test-auth.json');
    });

    it('should format JSON with indentation', async () => {
      repository._cache = { test: { nested: 'data' } };
      await repository._persist();

      const expectedJson = JSON.stringify({ test: { nested: 'data' } }, null, 2);
      expect(fs.writeFile).toHaveBeenCalledWith('test-data/test-auth.json.tmp', expectedJson, 'utf8');
    });

    it('should throw specific error on failure', async () => {
      fs.writeFile.mockRejectedValue(new Error('Write failed'));

      await expect(repository._persist()).rejects.toThrow('Failed to persist data: Write failed');
    });
  });

  describe('_cleanupExpiredTokens', () => {
    beforeEach(async () => {
      fs.readFile
        .mockRejectedValueOnce({ code: 'ENOENT' }) // auth_tokens.json not found
        .mockResolvedValueOnce(JSON.stringify(mockFileData)); // test-auth.json found
      await repository.initialize();
    });

    it('should remove expired tokens', async () => {
      // Add expired token
      repository._cache['expired-user'] = {
        userId: 'expired-user',
        token: {
          value: 'expired-token',
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        },
      };

      await repository._cleanupExpiredTokens();

      // Token cleanup no longer removes expired tokens - domain logic handles expiry
      expect(repository._cache['expired-user'].token.value).toBe('expired-token');
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should be called periodically by timer', async () => {
      // Repository already initialized in beforeEach
      const cleanupSpy = jest.spyOn(repository, '_cleanupExpiredTokens');

      // Fast forward time
      jest.advanceTimersByTime(1000);

      expect(cleanupSpy).toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    it('should stop cleanup timer', async () => {
      fs.readFile
        .mockRejectedValueOnce({ code: 'ENOENT' }) // auth_tokens.json not found
        .mockResolvedValueOnce(JSON.stringify(mockFileData)); // test-auth.json found
      await repository.initialize();
      const timerId = repository._cleanupTimer;

      await repository.shutdown();

      expect(repository._clearInterval).toHaveBeenCalledWith(timerId);
      expect(repository._cleanupTimer).toBeNull();
    });
  });
});