/**
 * Unit tests for BlacklistedUser value object
 */

const { BlacklistedUser } = require('../../../../src/domain/blacklist/BlacklistedUser');
const { UserId } = require('../../../../src/domain/personality/UserId');

describe('BlacklistedUser', () => {
  describe('constructor', () => {
    it('should create a valid BlacklistedUser', () => {
      const blacklistedUser = new BlacklistedUser(
        '123456789',
        'Spamming',
        '987654321',
        new Date('2025-01-17T10:00:00Z')
      );
      
      expect(blacklistedUser.userId).toBeInstanceOf(UserId);
      expect(blacklistedUser.userId.toString()).toBe('123456789');
      expect(blacklistedUser.reason).toBe('Spamming');
      expect(blacklistedUser.blacklistedBy).toBeInstanceOf(UserId);
      expect(blacklistedUser.blacklistedBy.toString()).toBe('987654321');
      expect(blacklistedUser.blacklistedAt).toEqual(new Date('2025-01-17T10:00:00Z'));
    });
    
    it('should throw error if userId is missing', () => {
      expect(() => {
        new BlacklistedUser(null, 'Spamming', '987654321', new Date());
      }).toThrow('User ID is required');
    });
    
    it('should throw error if reason is missing', () => {
      expect(() => {
        new BlacklistedUser('123456789', null, '987654321', new Date());
      }).toThrow('Blacklist reason is required');
    });
    
    it('should throw error if reason is not a string', () => {
      expect(() => {
        new BlacklistedUser('123456789', 123, '987654321', new Date());
      }).toThrow('Blacklist reason is required');
    });
    
    it('should throw error if blacklistedBy is missing', () => {
      expect(() => {
        new BlacklistedUser('123456789', 'Spamming', null, new Date());
      }).toThrow('Blacklisted by user ID is required');
    });
    
    it('should throw error if blacklistedAt is not a Date', () => {
      expect(() => {
        new BlacklistedUser('123456789', 'Spamming', '987654321', '2025-01-17');
      }).toThrow('Blacklisted at must be a Date');
    });
  });
  
  describe('fromData', () => {
    it('should create BlacklistedUser from plain data', () => {
      const data = {
        userId: '123456789',
        reason: 'API abuse',
        blacklistedBy: '987654321',
        blacklistedAt: '2025-01-17T10:00:00.000Z'
      };
      
      const blacklistedUser = BlacklistedUser.fromData(data);
      
      expect(blacklistedUser.userId.toString()).toBe('123456789');
      expect(blacklistedUser.reason).toBe('API abuse');
      expect(blacklistedUser.blacklistedBy.toString()).toBe('987654321');
      expect(blacklistedUser.blacklistedAt).toEqual(new Date('2025-01-17T10:00:00.000Z'));
    });
  });
  
  describe('toJSON', () => {
    it('should convert to JSON format', () => {
      const blacklistedUser = new BlacklistedUser(
        '123456789',
        'Harassment',
        '987654321',
        new Date('2025-01-17T10:00:00.000Z')
      );
      
      const json = blacklistedUser.toJSON();
      
      expect(json).toEqual({
        userId: '123456789',
        reason: 'Harassment',
        blacklistedBy: '987654321',
        blacklistedAt: '2025-01-17T10:00:00.000Z'
      });
    });
  });
  
  describe('equals', () => {
    const date = new Date('2025-01-17T10:00:00.000Z');
    
    it('should return true for equal BlacklistedUser objects', () => {
      const user1 = new BlacklistedUser('123456789', 'Spamming', '987654321', date);
      const user2 = new BlacklistedUser('123456789', 'Spamming', '987654321', date);
      
      expect(user1.equals(user2)).toBe(true);
    });
    
    it('should return false for different userId', () => {
      const user1 = new BlacklistedUser('123456789', 'Spamming', '987654321', date);
      const user2 = new BlacklistedUser('111111111', 'Spamming', '987654321', date);
      
      expect(user1.equals(user2)).toBe(false);
    });
    
    it('should return false for different reason', () => {
      const user1 = new BlacklistedUser('123456789', 'Spamming', '987654321', date);
      const user2 = new BlacklistedUser('123456789', 'Harassment', '987654321', date);
      
      expect(user1.equals(user2)).toBe(false);
    });
    
    it('should return false for different blacklistedBy', () => {
      const user1 = new BlacklistedUser('123456789', 'Spamming', '987654321', date);
      const user2 = new BlacklistedUser('123456789', 'Spamming', '111111111', date);
      
      expect(user1.equals(user2)).toBe(false);
    });
    
    it('should return false for different blacklistedAt', () => {
      const user1 = new BlacklistedUser('123456789', 'Spamming', '987654321', date);
      const user2 = new BlacklistedUser('123456789', 'Spamming', '987654321', new Date('2025-01-18T10:00:00.000Z'));
      
      expect(user1.equals(user2)).toBe(false);
    });
    
    it('should return false for non-BlacklistedUser object', () => {
      const user = new BlacklistedUser('123456789', 'Spamming', '987654321', date);
      
      expect(user.equals({})).toBe(false);
      expect(user.equals(null)).toBe(false);
      expect(user.equals('not a user')).toBe(false);
    });
  });
});