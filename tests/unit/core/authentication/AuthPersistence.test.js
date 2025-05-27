/**
 * Tests for AuthPersistence
 */

// Mock fs module BEFORE requiring AuthPersistence
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    stat: jest.fn(),
    unlink: jest.fn()
  }
}));

jest.mock('../../../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

// Require after mocking
const AuthPersistence = require('../../../../src/core/authentication/AuthPersistence');
const fs = require('fs').promises;
const logger = require('../../../../src/logger');

describe('AuthPersistence', () => {
  let persistence;
  const testDataDir = '/test/data';
  
  beforeEach(() => {
    jest.clearAllMocks();
    // Use Unix-style paths consistently
    jest.spyOn(process, 'cwd').mockReturnValue('/test');
    persistence = new AuthPersistence(testDataDir);
  });
  
  afterEach(() => {
    process.cwd.mockRestore();
  });
  
  describe('Constructor', () => {
    it('should initialize with custom data directory', () => {
      expect(persistence.dataDir).toBe(testDataDir);
      expect(persistence.authTokensFile).toBe('/test/data/auth_tokens.json');
      expect(persistence.nsfwVerifiedFile).toBe('/test/data/nsfw_verified.json');
    });
    
    it('should use default data directory when none provided', () => {
      const defaultPersistence = new AuthPersistence();
      expect(defaultPersistence.dataDir).toBe('/test/data');
      expect(defaultPersistence.authTokensFile).toBe('/test/data/auth_tokens.json');
      expect(defaultPersistence.nsfwVerifiedFile).toBe('/test/data/nsfw_verified.json');
    });
  });
  
  describe('ensureDataDir', () => {
    it('should create directory if it does not exist', async () => {
      fs.mkdir.mockResolvedValueOnce();
      
      await persistence.ensureDataDir();
      
      expect(fs.mkdir).toHaveBeenCalledWith(testDataDir, { recursive: true });
    });
    
    it('should handle directory creation errors', async () => {
      const error = new Error('Permission denied');
      fs.mkdir.mockRejectedValueOnce(error);
      
      await expect(persistence.ensureDataDir()).rejects.toThrow(error);
      expect(logger.error).toHaveBeenCalledWith('[AuthPersistence] Failed to create data directory:', error);
    });
  });
  
  describe('loadUserTokens', () => {
    it('should load tokens from file', async () => {
      const mockTokens = {
        user1: { token: 'token1', expiresAt: Date.now() + 3600000 },
        user2: { token: 'token2', expiresAt: Date.now() + 7200000 }
      };
      fs.readFile.mockResolvedValueOnce(JSON.stringify(mockTokens));
      
      const result = await persistence.loadUserTokens();
      
      expect(fs.readFile).toHaveBeenCalledWith('/test/data/auth_tokens.json', 'utf8');
      expect(result).toEqual(mockTokens);
    });
    
    it('should return empty object when file does not exist', async () => {
      const error = new Error('ENOENT');
      error.code = 'ENOENT';
      fs.readFile.mockRejectedValueOnce(error);
      
      const result = await persistence.loadUserTokens();
      
      expect(result).toEqual({});
      expect(logger.info).toHaveBeenCalledWith('[AuthPersistence] No tokens file found, returning empty object');
    });
    
    it('should handle JSON parse errors', async () => {
      fs.readFile.mockResolvedValueOnce('invalid json');
      
      const result = await persistence.loadUserTokens();
      
      expect(result).toEqual({});
      expect(logger.error).toHaveBeenCalledWith('[AuthPersistence] Error loading user tokens:', expect.any(Error));
    });
    
    it('should handle read errors', async () => {
      const error = new Error('Permission denied');
      fs.readFile.mockRejectedValueOnce(error);
      
      const result = await persistence.loadUserTokens();
      
      expect(result).toEqual({});
      expect(logger.error).toHaveBeenCalledWith('[AuthPersistence] Error loading user tokens:', error);
    });
  });
  
  describe('saveUserTokens', () => {
    it('should save tokens to file', async () => {
      const tokens = {
        user1: { token: 'token1', expiresAt: Date.now() }
      };
      fs.mkdir.mockResolvedValueOnce();
      fs.writeFile.mockResolvedValueOnce();
      
      const result = await persistence.saveUserTokens(tokens);
      
      expect(fs.mkdir).toHaveBeenCalledWith(testDataDir, { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/test/data/auth_tokens.json',
        JSON.stringify(tokens, null, 2)
      );
      expect(result).toBe(true);
    });
    
    it('should handle write errors', async () => {
      const error = new Error('Write failed');
      fs.mkdir.mockResolvedValueOnce();
      fs.writeFile.mockRejectedValueOnce(error);
      
      const result = await persistence.saveUserTokens({});
      
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('[AuthPersistence] Error saving user tokens:', error);
    });
    
    it('should handle empty tokens object', async () => {
      fs.mkdir.mockResolvedValueOnce();
      fs.writeFile.mockResolvedValueOnce();
      
      const result = await persistence.saveUserTokens({});
      
      expect(result).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/test/data/auth_tokens.json',
        '{}'
      );
    });
  });
  
  describe('loadNsfwVerifications', () => {
    it('should load verifications from file', async () => {
      const mockVerifications = {
        user1: { verified: true, timestamp: Date.now() }
      };
      fs.readFile.mockResolvedValueOnce(JSON.stringify(mockVerifications));
      
      const result = await persistence.loadNsfwVerifications();
      
      expect(fs.readFile).toHaveBeenCalledWith('/test/data/nsfw_verified.json', 'utf8');
      expect(result).toEqual(mockVerifications);
    });
    
    it('should return empty object when file does not exist', async () => {
      const error = new Error('ENOENT');
      error.code = 'ENOENT';
      fs.readFile.mockRejectedValueOnce(error);
      
      const result = await persistence.loadNsfwVerifications();
      
      expect(result).toEqual({});
      expect(logger.info).toHaveBeenCalledWith('[AuthPersistence] No NSFW verification file found, returning empty object');
    });
    
    it('should handle JSON parse errors', async () => {
      fs.readFile.mockResolvedValueOnce('invalid json');
      
      const result = await persistence.loadNsfwVerifications();
      
      expect(result).toEqual({});
      expect(logger.error).toHaveBeenCalledWith('[AuthPersistence] Error loading NSFW verifications:', expect.any(Error));
    });
  });
  
  describe('saveNsfwVerifications', () => {
    it('should save verifications to file', async () => {
      const verifications = {
        user1: { verified: true, timestamp: Date.now() }
      };
      fs.mkdir.mockResolvedValueOnce();
      fs.writeFile.mockResolvedValueOnce();
      
      const result = await persistence.saveNsfwVerifications(verifications);
      
      expect(fs.mkdir).toHaveBeenCalledWith(testDataDir, { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/test/data/nsfw_verified.json',
        JSON.stringify(verifications, null, 2)
      );
      expect(result).toBe(true);
    });
    
    it('should handle write errors', async () => {
      const error = new Error('Write failed');
      fs.mkdir.mockResolvedValueOnce();
      fs.writeFile.mockRejectedValueOnce(error);
      
      const result = await persistence.saveNsfwVerifications({});
      
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('[AuthPersistence] Error saving NSFW verifications:', error);
    });
  });
  
  describe('getFileStats', () => {
    it('should return file statistics', async () => {
      const tokenStats = { size: 1024, mtime: new Date() };
      const verificationStats = { size: 512, mtime: new Date() };
      
      fs.stat
        .mockResolvedValueOnce(tokenStats)
        .mockResolvedValueOnce(verificationStats);
      
      const result = await persistence.getFileStats();
      
      expect(result).toEqual({
        dataDir: testDataDir,
        files: {
          authTokens: {
            exists: true,
            size: 1024,
            modified: tokenStats.mtime
          },
          nsfwVerified: {
            exists: true,
            size: 512,
            modified: verificationStats.mtime
          }
        }
      });
    });
    
    it('should handle non-existent files', async () => {
      const error = new Error('ENOENT');
      error.code = 'ENOENT';
      
      fs.stat.mockRejectedValue(error);
      
      const result = await persistence.getFileStats();
      
      expect(result).toEqual({
        dataDir: testDataDir,
        files: {
          authTokens: { exists: false },
          nsfwVerified: { exists: false }
        }
      });
    });
    
    it('should handle stat errors gracefully', async () => {
      const error = new Error('Permission denied');
      fs.stat.mockRejectedValue(error);
      
      const result = await persistence.getFileStats();
      
      expect(result).toEqual({
        dataDir: testDataDir,
        files: {
          authTokens: { exists: false },
          nsfwVerified: { exists: false }
        }
      });
      // The actual implementation doesn't log stat errors
    });
  });
  
  describe('createBackup', () => {
    it('should create backup of authentication data', async () => {
      const mockTokens = { user1: { token: 'token1' } };
      const mockVerifications = { user1: { verified: true } };
      
      fs.readFile
        .mockResolvedValueOnce(JSON.stringify(mockTokens))
        .mockResolvedValueOnce(JSON.stringify(mockVerifications));
      fs.mkdir.mockResolvedValueOnce();
      fs.writeFile
        .mockResolvedValueOnce()
        .mockResolvedValueOnce();
      
      const result = await persistence.createBackup();
      
      expect(fs.mkdir).toHaveBeenCalledWith(
        '/test/data/backups',
        { recursive: true }
      );
      expect(fs.writeFile).toHaveBeenCalledTimes(2);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/auth_tokens_.*\.json$/),
        JSON.stringify(mockTokens)
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringMatching(/nsfw_verified_.*\.json$/),
        JSON.stringify(mockVerifications)
      );
      expect(result).toBe(true);
    });
    
    it('should handle missing files during backup', async () => {
      const error = new Error('ENOENT');
      error.code = 'ENOENT';
      
      fs.readFile.mockRejectedValue(error);
      fs.mkdir.mockResolvedValueOnce();
      // No writeFile calls expected when files don't exist
      
      const result = await persistence.createBackup();
      
      expect(result).toBe(true);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });
  });
  
  describe('deleteAllData', () => {
    it('should delete all data when confirmed', async () => {
      fs.unlink.mockResolvedValue();
      // Mock createBackup dependencies
      fs.readFile.mockRejectedValue({ code: 'ENOENT' });
      fs.mkdir.mockResolvedValueOnce();
      
      const result = await persistence.deleteAllData(true);
      
      expect(fs.unlink).toHaveBeenCalledWith('/test/data/auth_tokens.json');
      expect(fs.unlink).toHaveBeenCalledWith('/test/data/nsfw_verified.json');
      expect(result).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('[AuthPersistence] Deleted auth tokens file');
      expect(logger.info).toHaveBeenCalledWith('[AuthPersistence] Deleted NSFW verifications file');
    });
    
    it('should not delete without confirmation', async () => {
      const result = await persistence.deleteAllData(false);
      
      expect(fs.unlink).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });
    
    it('should handle file not existing during deletion', async () => {
      const error = new Error('ENOENT');
      error.code = 'ENOENT';
      fs.unlink.mockRejectedValue(error);
      
      const result = await persistence.deleteAllData(true);
      
      expect(result).toBe(true);
    });
  });
  
  describe('Data integrity', () => {
    it('should preserve data structure when saving and loading tokens', async () => {
      const originalTokens = {
        user1: { 
          token: 'abc123', 
          expiresAt: Date.now() + 3600000,
          metadata: { created: Date.now() }
        }
      };
      
      // Mock the write operation
      fs.mkdir.mockResolvedValueOnce();
      fs.writeFile.mockResolvedValueOnce();
      
      // Save tokens
      await persistence.saveUserTokens(originalTokens);
      
      // Mock the read operation with what was written
      const writtenData = fs.writeFile.mock.calls[0][1];
      fs.readFile.mockResolvedValueOnce(writtenData);
      
      // Load tokens
      const loadedTokens = await persistence.loadUserTokens();
      
      expect(loadedTokens).toEqual(originalTokens);
    });
  });
});