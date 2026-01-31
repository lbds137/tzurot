/**
 * Unit tests for BlacklistService
 */

const { BlacklistService } = require('../../../../src/application/services/BlacklistService');
const { BlacklistedUser, UserBlacklistedGlobally, UserUnblacklistedGlobally } = require('../../../../src/domain/blacklist');
const { DomainEventBus } = require('../../../../src/domain/shared/DomainEventBus');

describe('BlacklistService', () => {
  let blacklistService;
  let mockRepository;
  let mockEventBus;
  
  beforeEach(() => {
    // Create mock repository
    mockRepository = {
      add: jest.fn(),
      remove: jest.fn(),
      find: jest.fn(),
      findAll: jest.fn(),
      isBlacklisted: jest.fn()
    };
    
    // Create mock event bus
    mockEventBus = {
      publish: jest.fn()
    };
    
    // Create service instance
    blacklistService = new BlacklistService({
      blacklistRepository: mockRepository,
      eventBus: mockEventBus
    });
  });
  
  describe('constructor', () => {
    it('should throw error if blacklistRepository is missing', () => {
      expect(() => {
        new BlacklistService({ eventBus: mockEventBus });
      }).toThrow('BlacklistRepository is required');
    });
    
    it('should throw error if eventBus is missing', () => {
      expect(() => {
        new BlacklistService({ blacklistRepository: mockRepository });
      }).toThrow('EventBus is required');
    });
  });
  
  describe('blacklistUser', () => {
    it('should successfully blacklist a new user', async () => {
      const userId = '123456789';
      const reason = 'Spamming';
      const blacklistedBy = '987654321';
      
      mockRepository.find.mockResolvedValue(null); // User not already blacklisted
      mockRepository.add.mockResolvedValue();
      
      await blacklistService.blacklistUser(userId, reason, blacklistedBy);
      
      // Verify repository was called
      expect(mockRepository.find).toHaveBeenCalledWith(userId);
      expect(mockRepository.add).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: expect.objectContaining({ value: userId }),
          reason: reason,
          blacklistedBy: expect.objectContaining({ value: blacklistedBy }),
          blacklistedAt: expect.any(Date)
        })
      );
      
      // Verify event was published
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'UserBlacklistedGlobally',
          aggregateId: userId,
          payload: expect.objectContaining({
            userId,
            reason,
            blacklistedBy,
            blacklistedAt: expect.any(String)
          })
        })
      );
    });
    
    it('should throw error if user is already blacklisted', async () => {
      const userId = '123456789';
      const existingUser = new BlacklistedUser(
        userId,
        'Previous reason',
        '111111111',
        new Date()
      );
      
      mockRepository.find.mockResolvedValue(existingUser);
      
      await expect(
        blacklistService.blacklistUser(userId, 'New reason', '987654321')
      ).rejects.toThrow('User is already blacklisted');
      
      expect(mockRepository.add).not.toHaveBeenCalled();
      expect(mockEventBus.publish).not.toHaveBeenCalled();
    });
    
    it('should handle repository errors', async () => {
      const userId = '123456789';
      mockRepository.find.mockResolvedValue(null);
      mockRepository.add.mockRejectedValue(new Error('Database error'));
      
      await expect(
        blacklistService.blacklistUser(userId, 'Reason', '987654321')
      ).rejects.toThrow('Database error');
      
      expect(mockEventBus.publish).not.toHaveBeenCalled();
    });
  });
  
  describe('unblacklistUser', () => {
    it('should successfully unblacklist a user', async () => {
      const userId = '123456789';
      const unblacklistedBy = '987654321';
      const blacklistedUser = new BlacklistedUser(
        userId,
        'Original reason',
        '111111111',
        new Date()
      );
      
      mockRepository.find.mockResolvedValue(blacklistedUser);
      mockRepository.remove.mockResolvedValue();
      
      await blacklistService.unblacklistUser(userId, unblacklistedBy);
      
      // Verify repository was called
      expect(mockRepository.find).toHaveBeenCalledWith(userId);
      expect(mockRepository.remove).toHaveBeenCalledWith(userId);
      
      // Verify event was published
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'UserUnblacklistedGlobally',
          aggregateId: userId,
          payload: expect.objectContaining({
            userId,
            unblacklistedBy,
            unblacklistedAt: expect.any(String),
            previousReason: 'Original reason'
          })
        })
      );
    });
    
    it('should throw error if user is not blacklisted', async () => {
      const userId = '123456789';
      mockRepository.find.mockResolvedValue(null);
      
      await expect(
        blacklistService.unblacklistUser(userId, '987654321')
      ).rejects.toThrow('User is not blacklisted');
      
      expect(mockRepository.remove).not.toHaveBeenCalled();
      expect(mockEventBus.publish).not.toHaveBeenCalled();
    });
    
    it('should handle repository errors', async () => {
      const userId = '123456789';
      const blacklistedUser = new BlacklistedUser(
        userId,
        'Reason',
        '111111111',
        new Date()
      );
      
      mockRepository.find.mockResolvedValue(blacklistedUser);
      mockRepository.remove.mockRejectedValue(new Error('Database error'));
      
      await expect(
        blacklistService.unblacklistUser(userId, '987654321')
      ).rejects.toThrow('Database error');
      
      expect(mockEventBus.publish).not.toHaveBeenCalled();
    });
  });
  
  describe('isUserBlacklisted', () => {
    it('should return true for blacklisted user', async () => {
      mockRepository.isBlacklisted.mockResolvedValue(true);
      
      const result = await blacklistService.isUserBlacklisted('123456789');
      
      expect(result).toBe(true);
      expect(mockRepository.isBlacklisted).toHaveBeenCalledWith('123456789');
    });
    
    it('should return false for non-blacklisted user', async () => {
      mockRepository.isBlacklisted.mockResolvedValue(false);
      
      const result = await blacklistService.isUserBlacklisted('123456789');
      
      expect(result).toBe(false);
      expect(mockRepository.isBlacklisted).toHaveBeenCalledWith('123456789');
    });
    
    it('should handle repository errors', async () => {
      mockRepository.isBlacklisted.mockRejectedValue(new Error('Database error'));
      
      await expect(
        blacklistService.isUserBlacklisted('123456789')
      ).rejects.toThrow('Database error');
    });
  });
  
  describe('getBlacklistedUsers', () => {
    it('should return all blacklisted users', async () => {
      const users = [
        new BlacklistedUser('111111111', 'Reason 1', '999999999', new Date()),
        new BlacklistedUser('222222222', 'Reason 2', '999999999', new Date())
      ];
      
      mockRepository.findAll.mockResolvedValue(users);
      
      const result = await blacklistService.getBlacklistedUsers();
      
      expect(result).toEqual(users);
      expect(mockRepository.findAll).toHaveBeenCalled();
    });
    
    it('should return empty array when no blacklisted users', async () => {
      mockRepository.findAll.mockResolvedValue([]);
      
      const result = await blacklistService.getBlacklistedUsers();
      
      expect(result).toEqual([]);
      expect(mockRepository.findAll).toHaveBeenCalled();
    });
    
    it('should handle repository errors', async () => {
      mockRepository.findAll.mockRejectedValue(new Error('Database error'));
      
      await expect(
        blacklistService.getBlacklistedUsers()
      ).rejects.toThrow('Database error');
    });
  });
  
  describe('getBlacklistDetails', () => {
    it('should return blacklist details for a user', async () => {
      const blacklistedUser = new BlacklistedUser(
        '123456789',
        'Spamming',
        '987654321',
        new Date()
      );
      
      mockRepository.find.mockResolvedValue(blacklistedUser);
      
      const result = await blacklistService.getBlacklistDetails('123456789');
      
      expect(result).toEqual(blacklistedUser);
      expect(mockRepository.find).toHaveBeenCalledWith('123456789');
    });
    
    it('should return null for non-blacklisted user', async () => {
      mockRepository.find.mockResolvedValue(null);
      
      const result = await blacklistService.getBlacklistDetails('123456789');
      
      expect(result).toBeNull();
      expect(mockRepository.find).toHaveBeenCalledWith('123456789');
    });
    
    it('should handle repository errors', async () => {
      mockRepository.find.mockRejectedValue(new Error('Database error'));
      
      await expect(
        blacklistService.getBlacklistDetails('123456789')
      ).rejects.toThrow('Database error');
    });
  });
});