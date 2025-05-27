/**
 * Tests for AuthPersistence
 */

const AuthPersistence = require('../../../../src/core/authentication/AuthPersistence');

// Mock fs module
const mockFs = {
  readFile: jest.fn(),
  writeFile: jest.fn(),
  mkdir: jest.fn(),
  stat: jest.fn(),
  unlink: jest.fn()
};

jest.mock('fs', () => ({
  promises: mockFs
}));

jest.mock('../../../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

describe('AuthPersistence', () => {
  let persistence;
  let logger;
  const testDataDir = '/test/data';
  
  beforeEach(() => {
    jest.clearAllMocks();
    // Use Unix-style paths consistently
    jest.spyOn(process, 'cwd').mockReturnValue('/test');
    persistence = new AuthPersistence(testDataDir);
    logger = require('../../../../src/logger');
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
    });
  });
  
  describe('ensureDataDir', () => {
    it('should create directory if it does not exist', async () => {
      mockFs.mkdir.mockResolvedValueOnce();
      
      await persistence.ensureDataDir();
      
      expect(mockFs.mkdir).toHaveBeenCalledWith(testDataDir, { recursive: true });
    });
    
    it('should handle directory creation errors', async () => {
      const error = new Error('Permission denied');
      mockFs.mkdir.mockRejectedValueOnce(error);
      
      await expect(persistence.ensureDataDir()).rejects.toThrow('Permission denied');
      expect(logger.error).toHaveBeenCalledWith('[AuthPersistence] Failed to create data directory:', error);
    });
  });
  
  describe('loadUserTokens', () => {
    it('should load tokens from file', async () => {
      const tokens = {
        user1: { token: 'token1', createdAt: Date.now() },
        user2: { token: 'token2', createdAt: Date.now() - 1000 }
      };
      
      mockFs.mkdir.mockResolvedValueOnce();
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(tokens));
      
      const result = await persistence.loadUserTokens();
      
      expect(result).toEqual(tokens);
      expect(mockFs.readFile).toHaveBeenCalledWith('/test/data/auth_tokens.json', 'utf8');
      expect(logger.info).toHaveBeenCalledWith('[AuthPersistence] Loaded 2 user tokens');
    });
    
    it('should return empty object when file does not exist', async () => {
      const error = new Error('File not found');
      error.code = 'ENOENT';
      
      mockFs.mkdir.mockResolvedValueOnce();
      mockFs.readFile.mockRejectedValueOnce(error);
      
      const result = await persistence.loadUserTokens();
      
      expect(result).toEqual({});
      expect(logger.info).toHaveBeenCalledWith('[AuthPersistence] No tokens file found, returning empty object');
    });
    
    it('should handle JSON parse errors', async () => {
      mockFs.mkdir.mockResolvedValueOnce();
      mockFs.readFile.mockResolvedValueOnce('invalid json');
      
      const result = await persistence.loadUserTokens();
      
      expect(result).toEqual({});
      expect(logger.error).toHaveBeenCalledWith('[AuthPersistence] Error loading user tokens:', expect.any(Error));
    });
    
    it('should handle read errors', async () => {
      const error = new Error('Read error');
      mockFs.mkdir.mockResolvedValueOnce();
      mockFs.readFile.mockRejectedValueOnce(error);
      
      const result = await persistence.loadUserTokens();
      
      expect(result).toEqual({});
      expect(logger.error).toHaveBeenCalledWith('[AuthPersistence] Error loading user tokens:', error);
    });
  });
  
  describe('saveUserTokens', () => {
    it('should save tokens to file', async () => {
      const tokens = {
        user1: { token: 'token1' },
        user2: { token: 'token2' }
      };
      
      mockFs.mkdir.mockResolvedValueOnce();
      mockFs.writeFile.mockResolvedValueOnce();
      
      const result = await persistence.saveUserTokens(tokens);
      
      expect(result).toBe(true);
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/test/data/auth_tokens.json',
        JSON.stringify(tokens, null, 2)
      );
      expect(logger.info).toHaveBeenCalledWith('[AuthPersistence] Saved 2 user tokens');
    });
    
    it('should handle write errors', async () => {
      const error = new Error('Write error');
      mockFs.mkdir.mockResolvedValueOnce();
      mockFs.writeFile.mockRejectedValueOnce(error);
      
      const result = await persistence.saveUserTokens({});
      
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('[AuthPersistence] Error saving user tokens:', error);
    });
    
    it('should handle empty tokens object', async () => {
      mockFs.mkdir.mockResolvedValueOnce();
      mockFs.writeFile.mockResolvedValueOnce();
      
      const result = await persistence.saveUserTokens({});
      
      expect(result).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('[AuthPersistence] Saved 0 user tokens');
    });
  });
  
  describe('loadNsfwVerifications', () => {
    it('should load verifications from file', async () => {
      const verifications = {
        user1: { verified: true, timestamp: Date.now() },
        user2: { verified: false, timestamp: Date.now() - 1000 }
      };
      
      mockFs.mkdir.mockResolvedValueOnce();
      mockFs.readFile.mockResolvedValueOnce(JSON.stringify(verifications));
      
      const result = await persistence.loadNsfwVerifications();
      
      expect(result).toEqual(verifications);
      expect(mockFs.readFile).toHaveBeenCalledWith('/test/data/nsfw_verified.json', 'utf8');
      expect(logger.info).toHaveBeenCalledWith('[AuthPersistence] Loaded 2 NSFW verification records');
    });
    
    it('should return empty object when file does not exist', async () => {
      const error = new Error('File not found');
      error.code = 'ENOENT';
      
      mockFs.mkdir.mockResolvedValueOnce();
      mockFs.readFile.mockRejectedValueOnce(error);
      
      const result = await persistence.loadNsfwVerifications();
      
      expect(result).toEqual({});
      expect(logger.info).toHaveBeenCalledWith('[AuthPersistence] No NSFW verification file found, returning empty object');
    });
    
    it('should handle JSON parse errors', async () => {
      mockFs.mkdir.mockResolvedValueOnce();
      mockFs.readFile.mockResolvedValueOnce('invalid json');
      
      const result = await persistence.loadNsfwVerifications();
      
      expect(result).toEqual({});
      expect(logger.error).toHaveBeenCalledWith('[AuthPersistence] Error loading NSFW verifications:', expect.any(Error));
    });
  });
  
  describe('saveNsfwVerifications', () => {
    it('should save verifications to file', async () => {
      const verifications = {
        user1: { verified: true },
        user2: { verified: false }
      };
      
      mockFs.mkdir.mockResolvedValueOnce();
      mockFs.writeFile.mockResolvedValueOnce();
      
      const result = await persistence.saveNsfwVerifications(verifications);
      
      expect(result).toBe(true);
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/test/data/nsfw_verified.json',
        JSON.stringify(verifications, null, 2)
      );
      expect(logger.info).toHaveBeenCalledWith('[AuthPersistence] Saved 2 NSFW verification records');
    });
    
    it('should handle write errors', async () => {
      const error = new Error('Write error');
      mockFs.mkdir.mockResolvedValueOnce();
      mockFs.writeFile.mockRejectedValueOnce(error);
      
      const result = await persistence.saveNsfwVerifications({});
      
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('[AuthPersistence] Error saving NSFW verifications:', error);
    });
  });
  
  describe('getFileStats', () => {
    it('should return file statistics', async () => {
      const tokenStats = { size: 1024, mtime: new Date('2024-01-01') };
      const nsfwStats = { size: 512, mtime: new Date('2024-01-02') };
      
      mockFs.stat
        .mockResolvedValueOnce(tokenStats)
        .mockResolvedValueOnce(nsfwStats);
      
      const stats = await persistence.getFileStats();
      
      expect(stats).toEqual({
        dataDir: testDataDir,
        files: {
          authTokens: {
            exists: true,
            size: tokenStats.size,
            modified: tokenStats.mtime
          },
          nsfwVerified: {
            exists: true,
            size: nsfwStats.size,
            modified: nsfwStats.mtime
          }
        }
      });
    });
    
    it('should handle non-existent files', async () => {
      const error = new Error('File not found');
      error.code = 'ENOENT';
      
      mockFs.stat
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error);
      
      const stats = await persistence.getFileStats();
      
      expect(stats).toEqual({
        dataDir: testDataDir,
        files: {
          authTokens: { exists: false },
          nsfwVerified: { exists: false }
        }
      });
    });
    
    it('should handle stat errors gracefully', async () => {
      mockFs.stat
        .mockRejectedValueOnce(new Error('Permission denied'))
        .mockResolvedValueOnce({ size: 100, mtime: new Date() });
      
      const stats = await persistence.getFileStats();
      
      expect(stats.files.authTokens).toEqual({ exists: false });
      expect(stats.files.nsfwVerified.exists).toBe(true);
    });
  });
  
  describe('createBackup', () => {
    it('should create backup of authentication data', async () => {
      const tokensData = JSON.stringify({ user1: 'token1' });
      const nsfwData = JSON.stringify({ user1: true });
      
      mockFs.mkdir.mockResolvedValue();
      mockFs.readFile
        .mockResolvedValueOnce(tokensData)
        .mockResolvedValueOnce(nsfwData);
      mockFs.writeFile.mockResolvedValue();
      
      const result = await persistence.createBackup();
      
      expect(result).toBe(true);
      expect(mockFs.mkdir).toHaveBeenCalledWith(expect.stringContaining('/backups'), { recursive: true });
      expect(mockFs.writeFile).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Created tokens backup'));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Created NSFW verifications backup'));
    });
    
    it('should handle missing files during backup', async () => {
      const error = new Error('File not found');
      error.code = 'ENOENT';
      
      mockFs.mkdir.mockResolvedValue();
      mockFs.readFile
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error);
      
      const result = await persistence.createBackup();
      
      expect(result).toBe(true);
      expect(logger.error).not.toHaveBeenCalled();
    });
  });
  
  describe('deleteAllData', () => {
    it('should delete all data when confirmed', async () => {
      mockFs.mkdir.mockResolvedValue();
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));
      mockFs.unlink.mockResolvedValue();
      
      const result = await persistence.deleteAllData(true);
      
      expect(result).toBe(true);
      expect(mockFs.unlink).toHaveBeenCalledWith('/test/data/auth_tokens.json');
      expect(mockFs.unlink).toHaveBeenCalledWith('/test/data/nsfw_verified.json');
      expect(logger.info).toHaveBeenCalledWith('[AuthPersistence] Deleted auth tokens file');
      expect(logger.info).toHaveBeenCalledWith('[AuthPersistence] Deleted NSFW verifications file');
    });
    
    it('should not delete without confirmation', async () => {
      const result = await persistence.deleteAllData(false);
      
      expect(result).toBe(false);
      expect(mockFs.unlink).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith('[AuthPersistence] deleteAllData called without confirmation');
    });
    
    it('should handle file not existing during deletion', async () => {
      const error = new Error('File not found');
      error.code = 'ENOENT';
      
      mockFs.mkdir.mockResolvedValue();
      mockFs.readFile.mockRejectedValue(error);
      mockFs.unlink.mockRejectedValue(error);
      
      const result = await persistence.deleteAllData(true);
      
      expect(result).toBe(true);
    });
  });
  
  describe('Data integrity', () => {
    it('should preserve data structure when saving and loading tokens', async () => {
      const originalTokens = {
        user1: {
          token: 'token1',
          createdAt: Date.now(),
          expiresAt: Date.now() + 86400000
        }
      };
      
      // Save
      mockFs.mkdir.mockResolvedValue();
      mockFs.writeFile.mockResolvedValue();
      await persistence.saveUserTokens(originalTokens);
      
      // Capture what was written
      const writtenData = mockFs.writeFile.mock.calls[0][1];
      
      // Load
      mockFs.readFile.mockResolvedValueOnce(writtenData);
      const loadedTokens = await persistence.loadUserTokens();
      
      expect(loadedTokens).toEqual(originalTokens);
    });
  });
});