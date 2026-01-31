/**
 * Unit tests for FileBlacklistRepository
 */

const fs = require('fs').promises;
const path = require('path');
const { FileBlacklistRepository } = require('../../../../src/adapters/persistence/FileBlacklistRepository');
const { BlacklistedUser } = require('../../../../src/domain/blacklist/BlacklistedUser');

// Mock the fs module
jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    rename: jest.fn()
  }
}));


describe('FileBlacklistRepository', () => {
  let repository;
  const testDataPath = './test-data';
  const testFilename = 'test-blacklist.json';
  
  beforeEach(() => {
    jest.clearAllMocks();
    repository = new FileBlacklistRepository({
      dataPath: testDataPath,
      filename: testFilename
    });
  });
  
  describe('initialize', () => {
    it('should create data directory and empty file if not exists', async () => {
      fs.mkdir.mockResolvedValue();
      fs.readFile.mockRejectedValue({ code: 'ENOENT' });
      fs.writeFile.mockResolvedValue();
      fs.rename.mockResolvedValue();
      
      await repository.initialize();
      
      expect(fs.mkdir).toHaveBeenCalledWith(testDataPath, { recursive: true });
      expect(fs.readFile).toHaveBeenCalledWith(
        path.join(testDataPath, testFilename),
        'utf8'
      );
      // Should write empty object when file doesn't exist
      expect(fs.writeFile).toHaveBeenCalledWith(
        `${path.join(testDataPath, testFilename)}.tmp`,
        '{}',
        'utf8'
      );
      // Repository should be initialized - test by calling a method that requires initialization
      await expect(repository.isBlacklisted('test')).resolves.toBe(false);
    });
    
    it('should load existing data from file', async () => {
      const existingData = {
        '123456789': {
          userId: '123456789',
          reason: 'Spamming',
          blacklistedBy: '987654321',
          blacklistedAt: '2025-01-17T10:00:00.000Z'
        }
      };
      
      fs.mkdir.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify(existingData));
      
      await repository.initialize();
      
      // Cache should be loaded - test by finding a blacklisted user
      const user = await repository.find('123456789');
      expect(user).toBeTruthy();
      expect(user.userId.toString()).toBe('123456789');
      // Repository should be initialized - test by calling a method that requires initialization
      await expect(repository.isBlacklisted('test')).resolves.toBe(false);
    });
    
    it('should not initialize twice', async () => {
      fs.mkdir.mockResolvedValue();
      fs.readFile.mockResolvedValue('{}');
      
      await repository.initialize();
      await repository.initialize();
      
      expect(fs.mkdir).toHaveBeenCalledTimes(1);
      expect(fs.readFile).toHaveBeenCalledTimes(1);
    });
    
    it('should handle initialization errors', async () => {
      fs.mkdir.mockRejectedValue(new Error('Permission denied'));
      
      await expect(repository.initialize()).rejects.toThrow(
        'Failed to initialize blacklist repository: Permission denied'
      );
    });
  });
  
  describe('add', () => {
    beforeEach(async () => {
      fs.mkdir.mockResolvedValue();
      fs.readFile.mockResolvedValue('{}');
      fs.writeFile.mockResolvedValue();
      fs.rename.mockResolvedValue();
      await repository.initialize();
    });
    
    it('should add a blacklisted user', async () => {
      const blacklistedUser = new BlacklistedUser(
        '123456789',
        'Harassment',
        '987654321',
        new Date('2025-01-17T10:00:00.000Z')
      );
      
      await repository.add(blacklistedUser);
      
      // Verify user was added by finding them
      const addedUser = await repository.find('123456789');
      expect(addedUser).toBeTruthy();
      expect(addedUser.userId.toString()).toBe('123456789');
      expect(addedUser.reason).toBe('Harassment');
      expect(addedUser.blacklistedBy.toString()).toBe('987654321');
      expect(addedUser.blacklistedAt).toEqual(new Date('2025-01-17T10:00:00.000Z'));
      
      // Verify persistence
      expect(fs.writeFile).toHaveBeenCalled();
      expect(fs.rename).toHaveBeenCalled();
    });
    
    it('should handle add errors', async () => {
      fs.writeFile.mockRejectedValue(new Error('Disk full'));
      
      const blacklistedUser = new BlacklistedUser(
        '123456789',
        'Spamming',
        '987654321',
        new Date()
      );
      
      await expect(repository.add(blacklistedUser)).rejects.toThrow(
        'Failed to add user to blacklist: Failed to persist blacklist data: Disk full'
      );
    });
  });
  
  describe('remove', () => {
    beforeEach(async () => {
      const existingData = {
        '123456789': {
          userId: '123456789',
          reason: 'Spamming',
          blacklistedBy: '987654321',
          blacklistedAt: '2025-01-17T10:00:00.000Z'
        }
      };
      
      fs.mkdir.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify(existingData));
      fs.writeFile.mockResolvedValue();
      fs.rename.mockResolvedValue();
      await repository.initialize();
    });
    
    it('should remove a blacklisted user', async () => {
      await repository.remove('123456789');
      
      // Verify user was removed by trying to find them
      const removedUser = await repository.find('123456789');
      expect(removedUser).toBeNull();
      expect(fs.writeFile).toHaveBeenCalled();
      expect(fs.rename).toHaveBeenCalled();
    });
    
    it('should handle removing non-existent user', async () => {
      await repository.remove('999999999'); // User not in cache
      
      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(fs.rename).not.toHaveBeenCalled();
    });
    
    it('should handle remove errors', async () => {
      fs.writeFile.mockRejectedValue(new Error('Permission denied'));
      
      await expect(repository.remove('123456789')).rejects.toThrow(
        'Failed to remove user from blacklist: Failed to persist blacklist data: Permission denied'
      );
    });
  });
  
  describe('find', () => {
    beforeEach(async () => {
      const existingData = {
        '123456789': {
          userId: '123456789',
          reason: 'API abuse',
          blacklistedBy: '987654321',
          blacklistedAt: '2025-01-17T10:00:00.000Z'
        }
      };
      
      fs.mkdir.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify(existingData));
      await repository.initialize();
    });
    
    it('should find a blacklisted user', async () => {
      const result = await repository.find('123456789');
      
      expect(result).toBeInstanceOf(BlacklistedUser);
      expect(result.userId.toString()).toBe('123456789');
      expect(result.reason).toBe('API abuse');
      expect(result.blacklistedBy.toString()).toBe('987654321');
      expect(result.blacklistedAt).toEqual(new Date('2025-01-17T10:00:00.000Z'));
    });
    
    it('should return null for non-existent user', async () => {
      const result = await repository.find('999999999');
      
      expect(result).toBeNull();
    });
  });
  
  describe('findAll', () => {
    it('should return all blacklisted users', async () => {
      const existingData = {
        '111111111': {
          userId: '111111111',
          reason: 'Reason 1',
          blacklistedBy: '999999999',
          blacklistedAt: '2025-01-17T10:00:00.000Z'
        },
        '222222222': {
          userId: '222222222',
          reason: 'Reason 2',
          blacklistedBy: '999999999',
          blacklistedAt: '2025-01-17T11:00:00.000Z'
        }
      };
      
      fs.mkdir.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify(existingData));
      await repository.initialize();
      
      const result = await repository.findAll();
      
      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(BlacklistedUser);
      expect(result[1]).toBeInstanceOf(BlacklistedUser);
      expect(result.map(u => u.userId.toString())).toEqual(
        expect.arrayContaining(['111111111', '222222222'])
      );
    });
    
    it('should return empty array when no blacklisted users', async () => {
      fs.mkdir.mockResolvedValue();
      fs.readFile.mockResolvedValue('{}');
      await repository.initialize();
      
      const result = await repository.findAll();
      
      expect(result).toEqual([]);
    });
    
    it('should skip invalid entries', async () => {
      const existingData = {
        '111111111': {
          userId: '111111111',
          reason: 'Valid entry',
          blacklistedBy: '999999999',
          blacklistedAt: '2025-01-17T10:00:00.000Z'
        },
        '222222222': {
          // Missing required fields
          userId: '222222222'
        }
      };
      
      fs.mkdir.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify(existingData));
      await repository.initialize();
      
      const result = await repository.findAll();
      
      expect(result).toHaveLength(1);
      expect(result[0].userId.toString()).toBe('111111111');
    });
  });
  
  describe('isBlacklisted', () => {
    beforeEach(async () => {
      const existingData = {
        '123456789': {
          userId: '123456789',
          reason: 'Spamming',
          blacklistedBy: '987654321',
          blacklistedAt: '2025-01-17T10:00:00.000Z'
        }
      };
      
      fs.mkdir.mockResolvedValue();
      fs.readFile.mockResolvedValue(JSON.stringify(existingData));
      await repository.initialize();
    });
    
    it('should return true for blacklisted user', async () => {
      const result = await repository.isBlacklisted('123456789');
      expect(result).toBe(true);
    });
    
    it('should return false for non-blacklisted user', async () => {
      const result = await repository.isBlacklisted('999999999');
      expect(result).toBe(false);
    });
  });
});