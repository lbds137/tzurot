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
  }
}));
jest.mock('../../../../src/logger');

const { dddPresets } = require('../../../__mocks__/ddd');

const fs = require('fs').promises;
const path = require('path');
const { FileAuthenticationRepository } = require('../../../../src/adapters/persistence/FileAuthenticationRepository');
const { 
  UserAuth, 
  Token,
  NsfwStatus,
} = require('../../../../src/domain/authentication');
const { UserId } = require('../../../../src/domain/personality');

describe('FileAuthenticationRepository', () => {
  let repository;
  let mockFileData;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    
    // Default mock file data
    mockFileData = {
      userAuth: {
        '123456789012345678': {
          userId: '123456789012345678',
          nsfwStatus: 'unverified',
          tokens: [
            {
              value: 'test-token-1',
              personalityId: 'test-personality',
              createdAt: '2024-01-01T00:00:00.000Z',
              expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year from now
              revokedAt: null,
            },
            {
              value: 'test-token-2',
              personalityId: 'test-personality-2',
              createdAt: '2024-01-02T00:00:00.000Z', // Later creation date
              expiresAt: null, // No expiry
              revokedAt: null,
            },
          ],
          savedAt: '2024-01-01T00:00:00.000Z',
        },
      },
      tokens: {
        'test-token-1': {
          userId: '123456789012345678',
          personalityId: 'test-personality',
          createdAt: '2024-01-01T00:00:00.000Z',
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          revokedAt: null,
        },
        'test-token-2': {
          userId: '123456789012345678',
          personalityId: 'test-personality-2',
          createdAt: '2024-01-02T00:00:00.000Z', // Later creation date
          expiresAt: null,
          revokedAt: null,
        },
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
    });
  });
  
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    // Clean up timer if repository was initialized
    if (repository._cleanupTimer) {
      clearInterval(repository._cleanupTimer);
    }
  });
  
  describe('initialize', () => {
    it('should create data directory if it does not exist', async () => {
      await repository.initialize();
      
      expect(fs.mkdir).toHaveBeenCalledWith('./test-data', { recursive: true });
    });
    
    it('should load existing data file', async () => {
      await repository.initialize();
      
      expect(fs.readFile).toHaveBeenCalledWith(
        path.join('./test-data', 'test-auth.json'),
        'utf8'
      );
      // Cache will have cleaned up any expired tokens, but should have the rest
      expect(repository._cache.userAuth['123456789012345678']).toBeDefined();
      expect(repository._cache.tokens['test-token-2']).toBeDefined();
      expect(repository._initialized).toBe(true);
    });
    
    it('should create new file if it does not exist', async () => {
      fs.readFile.mockRejectedValue({ code: 'ENOENT' });
      
      await repository.initialize();
      
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join('./test-data', 'test-auth.json.tmp'),
        JSON.stringify({ userAuth: {}, tokens: {} }, null, 2),
        'utf8'
      );
      expect(fs.rename).toHaveBeenCalled();
      expect(repository._cache).toEqual({ userAuth: {}, tokens: {} });
    });
    
    it('should clean up expired tokens on startup', async () => {
      // Add an expired token
      const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      mockFileData.tokens['expired-token'] = {
        userId: '123456789012345678',
        personalityId: 'test-personality',
        createdAt: expiredDate,
        expiresAt: expiredDate,
        revokedAt: null,
      };
      mockFileData.userAuth['123456789012345678'].tokens.push({
        value: 'expired-token',
        personalityId: 'test-personality',
        createdAt: expiredDate,
        expiresAt: expiredDate,
        revokedAt: null,
      });
      
      fs.readFile.mockResolvedValue(JSON.stringify(mockFileData));
      
      await repository.initialize();
      
      expect(repository._cache.tokens['expired-token']).toBeUndefined();
      expect(fs.writeFile).toHaveBeenCalled();
    });
    
    it('should start cleanup timer', async () => {
      await repository.initialize();
      
      expect(repository._cleanupTimer).toBeDefined();
      expect(repository._cleanupTimer).not.toBeNull();
    });
    
    it('should throw error for other file read errors', async () => {
      fs.readFile.mockRejectedValue(new Error('Permission denied'));
      
      await expect(repository.initialize()).rejects.toThrow(
        'Failed to initialize repository: Permission denied'
      );
    });
    
    it('should not reinitialize if already initialized', async () => {
      await repository.initialize();
      fs.readFile.mockClear();
      
      await repository.initialize();
      
      expect(fs.readFile).not.toHaveBeenCalled();
    });
  });
  
  describe('save', () => {
    it('should save user authentication', async () => {
      await repository.initialize();
      
      const userId = new UserId('456789012345678901');
      const token = new Token(
        'new-token',
        new Date(Date.now() + 24 * 60 * 60 * 1000)
      );
      const userAuth = UserAuth.authenticate(userId, token);
      
      await repository.save(userAuth);
      
      expect(repository._cache.userAuth['456789012345678901']).toBeDefined();
      expect(repository._cache.userAuth['456789012345678901'].userId).toBe('456789012345678901');
      expect(repository._cache.tokens['new-token']).toBeDefined();
      expect(repository._cache.tokens['new-token'].userId).toBe('456789012345678901');
      
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.tmp'),
        expect.stringContaining('456789012345678901'),
        'utf8'
      );
      expect(fs.rename).toHaveBeenCalled();
    });
    
    it('should update existing user authentication', async () => {
      await repository.initialize();
      
      const existingUserAuth = await repository.findByUserId('123456789012345678');
      existingUserAuth.verifyNsfw();
      
      await repository.save(existingUserAuth);
      
      // nsfwStatus is stored as an object from toJSON()
      expect(repository._cache.userAuth['123456789012345678'].nsfwStatus.verified).toBe(true);
    });
    
    it('should handle save errors', async () => {
      await repository.initialize();
      fs.writeFile.mockRejectedValue(new Error('Disk full'));
      
      const userId = new UserId('456789012345678901');
      const token = new Token(
        'test-token',
        new Date(Date.now() + 24 * 60 * 60 * 1000)
      );
      const userAuth = UserAuth.authenticate(userId, token);
      
      await expect(repository.save(userAuth)).rejects.toThrow(
        'Failed to save user auth: Failed to persist data: Disk full'
      );
    });
    
    it('should initialize if not already initialized', async () => {
      const userId = new UserId('456789012345678901');
      const token = new Token(
        'test-token',
        new Date(Date.now() + 24 * 60 * 60 * 1000)
      );
      const userAuth = UserAuth.authenticate(userId, token);
      
      await repository.save(userAuth);
      
      expect(fs.mkdir).toHaveBeenCalled();
      expect(repository._initialized).toBe(true);
    });
  });
  
  describe('findByUserId', () => {
    it('should find user auth by ID', async () => {
      await repository.initialize();
      
      const result = await repository.findByUserId('123456789012345678');
      
      expect(result).toBeInstanceOf(UserAuth);
      expect(result.userId.toString()).toBe('123456789012345678');
      // The hydrated UserAuth will have the most recent valid token
      expect(result.token).toBeDefined();
      expect(result.nsfwStatus.verified).toBe(false);
    });
    
    it('should return null if user not found', async () => {
      await repository.initialize();
      
      const result = await repository.findByUserId('999999999999999999');
      
      expect(result).toBeNull();
    });
    
    it('should handle errors during hydration', async () => {
      await repository.initialize();
      repository._cache.userAuth['bad-data'] = { invalid: 'data' };
      
      await expect(repository.findByUserId('bad-data')).rejects.toThrow(
        'Failed to find user auth'
      );
    });
  });
  
  describe('findByToken', () => {
    it('should find user auth by token', async () => {
      await repository.initialize();
      
      const result = await repository.findByToken('test-token-1');
      
      expect(result).toBeInstanceOf(UserAuth);
      expect(result.userId.toString()).toBe('123456789012345678');
      // Since test-token-2 has a later creation date, it will be selected
      expect(result.token.value).toBe('test-token-2');
    });
    
    it('should return null if token not found', async () => {
      await repository.initialize();
      
      const result = await repository.findByToken('non-existent-token');
      
      expect(result).toBeNull();
    });
    
    it('should clean up orphaned token and return null', async () => {
      await repository.initialize();
      
      // Add orphaned token
      repository._cache.tokens['orphan-token'] = {
        userId: 'non-existent-user',
        personalityId: 'test',
      };
      
      const result = await repository.findByToken('orphan-token');
      
      expect(result).toBeNull();
      expect(repository._cache.tokens['orphan-token']).toBeUndefined();
      expect(fs.writeFile).toHaveBeenCalled();
    });
    
    it('should handle errors during hydration', async () => {
      await repository.initialize();
      
      repository._cache.tokens['bad-token'] = { userId: 'bad-data' };
      repository._cache.userAuth['bad-data'] = { invalid: 'data' };
      
      await expect(repository.findByToken('bad-token')).rejects.toThrow(
        'Failed to find user auth by token'
      );
    });
  });
  
  describe('findByPersonalityId', () => {
    it('should find all users with tokens for personality', async () => {
      await repository.initialize();
      
      // Add another user with token for same personality
      repository._cache.userAuth['456789012345678901'] = {
        userId: '456789012345678901',
        nsfwStatus: 'verified',
        tokens: [
          {
            value: 'other-token',
            personalityId: 'test-personality',
            createdAt: '2024-01-01T00:00:00.000Z',
            expiresAt: null,
            revokedAt: null,
          },
        ],
      };
      
      const results = await repository.findByPersonalityId('test-personality');
      
      expect(results).toHaveLength(2);
      expect(results[0]).toBeInstanceOf(UserAuth);
      expect(results[1]).toBeInstanceOf(UserAuth);
      expect(results.map(u => u.userId.toString()).sort()).toEqual(['123456789012345678', '456789012345678901']);
    });
    
    it('should not include users with only revoked tokens', async () => {
      await repository.initialize();
      
      // Add user with revoked token
      repository._cache.userAuth['456789012345678901'] = {
        userId: '456789012345678901',
        nsfwStatus: 'unverified',
        tokens: [
          {
            value: 'revoked-token',
            personalityId: 'test-personality',
            createdAt: '2024-01-01T00:00:00.000Z',
            expiresAt: null,
            revokedAt: '2024-01-02T00:00:00.000Z',
          },
        ],
      };
      
      const results = await repository.findByPersonalityId('test-personality');
      
      expect(results).toHaveLength(1);
      expect(results[0].userId.toString()).toBe('123456789012345678');
    });
    
    it('should return empty array if no users found', async () => {
      await repository.initialize();
      
      const results = await repository.findByPersonalityId('non-existent-personality');
      
      expect(results).toEqual([]);
    });
    
    it('should handle errors during hydration', async () => {
      await repository.initialize();
      
      repository._cache.userAuth['bad-data'] = {
        tokens: [{ personalityId: 'test-personality', revokedAt: null }],
        invalid: 'data',
      };
      
      await expect(repository.findByPersonalityId('test-personality')).rejects.toThrow(
        'Failed to find user auth by personality'
      );
    });
  });
  
  describe('delete', () => {
    it('should delete user auth and associated tokens', async () => {
      await repository.initialize();
      
      await repository.delete('123456789012345678');
      
      expect(repository._cache.userAuth['123456789012345678']).toBeUndefined();
      expect(repository._cache.tokens['test-token-1']).toBeUndefined();
      expect(repository._cache.tokens['test-token-2']).toBeUndefined();
      expect(fs.writeFile).toHaveBeenCalled();
    });
    
    it('should handle deleting non-existent user', async () => {
      await repository.initialize();
      
      // Clear any writeFile calls from initialization
      fs.writeFile.mockClear();
      
      await repository.delete('999999999999999999');
      
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
    
    it('should handle delete errors', async () => {
      await repository.initialize();
      fs.writeFile.mockRejectedValue(new Error('Permission denied'));
      
      await expect(repository.delete('123456789012345678')).rejects.toThrow(
        'Failed to delete user auth'
      );
    });
  });
  
  describe('exists', () => {
    it('should return true if user exists', async () => {
      await repository.initialize();
      
      const result = await repository.exists('123456789012345678');
      
      expect(result).toBe(true);
    });
    
    it('should return false if user does not exist', async () => {
      await repository.initialize();
      
      const result = await repository.exists('999999999999999999');
      
      expect(result).toBe(false);
    });
  });
  
  describe('countActiveUsers', () => {
    it('should count users with valid tokens', async () => {
      await repository.initialize();
      
      // Add user with only expired tokens
      repository._cache.userAuth['expired-user'] = {
        userId: 'expired-user',
        nsfwStatus: 'unverified',
        tokens: [
          {
            value: 'expired-token',
            personalityId: 'test',
            createdAt: '2020-01-01T00:00:00.000Z',
            expiresAt: '2020-01-02T00:00:00.000Z',
            revokedAt: null,
          },
        ],
      };
      
      // Add user with revoked tokens
      repository._cache.userAuth['revoked-user'] = {
        userId: 'revoked-user',
        nsfwStatus: 'unverified',
        tokens: [
          {
            value: 'revoked-token',
            personalityId: 'test',
            createdAt: '2024-01-01T00:00:00.000Z',
            expiresAt: null,
            revokedAt: '2024-01-02T00:00:00.000Z',
          },
        ],
      };
      
      const count = await repository.countActiveUsers();
      
      expect(count).toBe(1); // Only the original user has valid tokens
    });
    
    it('should return 0 if no active users', async () => {
      fs.readFile.mockResolvedValue(JSON.stringify({ userAuth: {}, tokens: {} }));
      
      await repository.initialize();
      
      const count = await repository.countActiveUsers();
      
      expect(count).toBe(0);
    });
    
    it('should handle errors', async () => {
      await repository.initialize();
      
      // Mock an error by making Object.values throw
      const originalValues = Object.values;
      Object.values = jest.fn().mockImplementation(() => {
        throw new Error('Unexpected error');
      });
      
      await expect(repository.countActiveUsers()).rejects.toThrow(
        'Failed to count active users'
      );
      
      Object.values = originalValues;
    });
  });
  
  describe('getStats', () => {
    it('should return repository statistics', async () => {
      await repository.initialize();
      
      // Add more data
      repository._cache.userAuth['verified-user'] = {
        userId: 'verified-user',
        nsfwStatus: 'verified',
        tokens: [],
      };
      
      repository._cache.userAuth['blocked-user'] = {
        userId: 'blocked-user',
        nsfwStatus: 'blocked',
        tokens: [],
      };
      
      repository._cache.tokens['revoked-token'] = {
        userId: '123456789012345678',
        personalityId: 'test',
        createdAt: '2024-01-01T00:00:00.000Z',
        expiresAt: null,
        revokedAt: '2024-01-02T00:00:00.000Z',
      };
      
      repository._cache.tokens['expired-token'] = {
        userId: '123456789012345678',
        personalityId: 'test',
        createdAt: '2020-01-01T00:00:00.000Z',
        expiresAt: '2020-01-02T00:00:00.000Z',
        revokedAt: null,
      };
      
      const stats = await repository.getStats();
      
      expect(stats).toEqual({
        totalUsers: 3,
        totalTokens: 4,
        activeTokens: 2, // test-token-1 and test-token-2
        expiredTokens: 1,
        revokedTokens: 1,
        verifiedUsers: 1,
        blockedUsers: 1,
      });
    });
    
    it('should return zero stats for empty repository', async () => {
      fs.readFile.mockResolvedValue(JSON.stringify({ userAuth: {}, tokens: {} }));
      
      await repository.initialize();
      
      const stats = await repository.getStats();
      
      expect(stats).toEqual({
        totalUsers: 0,
        totalTokens: 0,
        activeTokens: 0,
        expiredTokens: 0,
        revokedTokens: 0,
        verifiedUsers: 0,
        blockedUsers: 0,
      });
    });
  });
  
  describe('_hydrate', () => {
    it('should hydrate user with NSFW status', async () => {
      await repository.initialize();
      
      const data = {
        userId: '123456789012345678',
        nsfwStatus: 'verified',
        tokens: [
          {
            value: 'test-token',
            personalityId: 'test-personality',
            createdAt: new Date().toISOString(),
            expiresAt: null,
            revokedAt: null,
          }
        ],
      };
      
      const userAuth = repository._hydrate(data);
      
      expect(userAuth).toBeInstanceOf(UserAuth);
      expect(userAuth.userId.toString()).toBe('123456789012345678');
      expect(userAuth.nsfwStatus.verified).toBe(true);
    });
    
    it('should hydrate user with tokens', async () => {
      await repository.initialize();
      
      const data = mockFileData.userAuth['123456789012345678'];
      const userAuth = repository._hydrate(data);
      
      // UserAuth has single token, not array
      expect(userAuth.token).toBeDefined();
      expect(userAuth.token).toBeInstanceOf(Token);
      // Either token is valid since they have the same createdAt
      expect(['test-token-1', 'test-token-2']).toContain(userAuth.token.value);
    });
    
    it('should mark events as committed', async () => {
      await repository.initialize();
      
      const data = {
        userId: '123456789012345678',
        nsfwStatus: 'unverified',
        tokens: [],
      };
      
      const userAuth = repository._hydrate(data);
      
      expect(userAuth.getUncommittedEvents()).toHaveLength(0);
    });
  });
  
  describe('_persist', () => {
    it('should write to temp file then rename', async () => {
      await repository.initialize();
      repository._cache.userAuth['new'] = { userId: 'new' };
      
      await repository._persist();
      
      const expectedPath = path.join('./test-data', 'test-auth.json');
      const tempPath = expectedPath + '.tmp';
      
      expect(fs.writeFile).toHaveBeenCalledWith(
        tempPath,
        expect.any(String),
        'utf8'
      );
      expect(fs.rename).toHaveBeenCalledWith(tempPath, expectedPath);
    });
    
    it('should format JSON with indentation', async () => {
      await repository.initialize();
      
      await repository._persist();
      
      const writtenData = fs.writeFile.mock.calls[0][1];
      expect(writtenData).toContain('  '); // Check for indentation
      expect(() => JSON.parse(writtenData)).not.toThrow();
    });
    
    it('should throw specific error on failure', async () => {
      await repository.initialize();
      fs.writeFile.mockRejectedValue(new Error('EACCES'));
      
      await expect(repository._persist()).rejects.toThrow(
        'Failed to persist data: EACCES'
      );
    });
  });
  
  describe('_cleanupExpiredTokens', () => {
    it('should remove expired tokens', async () => {
      const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      mockFileData.tokens['expired-token'] = {
        userId: '123456789012345678',
        personalityId: 'test',
        createdAt: expiredDate,
        expiresAt: expiredDate,
        revokedAt: null,
      };
      
      mockFileData.userAuth['123456789012345678'].tokens.push({
        value: 'expired-token',
        personalityId: 'test',
        createdAt: expiredDate,
        expiresAt: expiredDate,
        revokedAt: null,
      });
      
      fs.readFile.mockResolvedValue(JSON.stringify(mockFileData));
      
      await repository.initialize();
      
      expect(repository._cache.tokens['expired-token']).toBeUndefined();
      // The expired token should be removed from the user's token array
      expect(repository._cache.userAuth['123456789012345678'].tokens).toHaveLength(2);
    });
    
    it('should be called periodically by timer', async () => {
      // Mock setInterval to capture the callback
      let intervalCallback;
      const mockSetInterval = jest.fn((callback, interval) => {
        intervalCallback = callback;
        return 123; // Return a fake timer ID
      });
      
      // Create repository with mocked timer
      repository = new FileAuthenticationRepository({
        dataPath: './test-data',
        filename: 'test-auth.json',
        tokenCleanupInterval: 1000,
        setInterval: mockSetInterval,
      });
      
      // Spy on cleanup method
      const cleanupSpy = jest.spyOn(repository, '_cleanupExpiredTokens');
      
      await repository.initialize();
      
      // Verify setInterval was called
      expect(mockSetInterval).toHaveBeenCalledWith(expect.any(Function), 1000);
      
      // Clear the spy calls from initialization
      cleanupSpy.mockClear();
      
      // Call the interval callback directly
      await intervalCallback();
      
      expect(cleanupSpy).toHaveBeenCalledTimes(1);
    });
  });
  
  describe('shutdown', () => {
    it('should stop cleanup timer', async () => {
      await repository.initialize();
      
      const timer = repository._cleanupTimer;
      expect(timer).toBeDefined();
      
      await repository.shutdown();
      
      expect(repository._cleanupTimer).toBeNull();
    });
  });
});