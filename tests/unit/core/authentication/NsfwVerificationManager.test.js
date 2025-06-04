/**
 * Tests for NsfwVerificationManager
 */

const NsfwVerificationManager = require('../../../../src/core/authentication/NsfwVerificationManager');

jest.mock('../../../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

jest.mock('../../../../src/utils/webhookUserTracker', () => ({
  findRealUserId: jest.fn(),
  getOriginalUserId: jest.fn()
}));

jest.mock('../../../../config', () => ({
  botPrefix: '!tz'
}));

describe('NsfwVerificationManager', () => {
  let manager;
  let logger;
  
  beforeEach(() => {
    jest.clearAllMocks();
    manager = new NsfwVerificationManager();
    logger = require('../../../../src/logger');
  });
  
  describe('Constructor and Initialization', () => {
    it('should initialize with empty verifications', () => {
      expect(manager.nsfwVerified).toEqual({});
    });
  });
  
  describe('storeNsfwVerification', () => {
    it('should store NSFW verification for a user', () => {
      const userId = 'user123';
      
      const result = manager.storeNsfwVerification(userId, true);
      
      expect(result).toBe(true);
      expect(manager.nsfwVerified[userId]).toEqual({
        verified: true,
        timestamp: expect.any(Number),
        verifiedAt: expect.any(Number)
      });
      
      expect(logger.info).toHaveBeenCalledWith('[NsfwVerificationManager] Stored NSFW verification status for user user123: true');
    });
    
    it('should update existing verification', () => {
      const userId = 'user123';
      
      // Store initial verification
      manager.storeNsfwVerification(userId, true);
      const firstTimestamp = manager.nsfwVerified[userId].timestamp;
      
      // Wait a bit and update
      jest.advanceTimersByTime(1000);
      manager.storeNsfwVerification(userId, false);
      
      expect(manager.nsfwVerified[userId].verified).toBe(false);
      expect(manager.nsfwVerified[userId].timestamp).toBeGreaterThan(firstTimestamp);
      expect(manager.nsfwVerified[userId].verifiedAt).toBeNull();
    });
  });
  
  describe('clearVerification', () => {
    it('should clear verification for a user', () => {
      const userId = 'user123';
      
      // First store a verification
      manager.storeNsfwVerification(userId, true);
      expect(manager.nsfwVerified[userId]).toBeDefined();
      
      // Then clear it
      const result = manager.clearVerification(userId);
      
      expect(result).toBe(true);
      expect(manager.nsfwVerified[userId]).toBeUndefined();
      expect(logger.info).toHaveBeenCalledWith('[NsfwVerificationManager] Cleared NSFW verification for user user123');
    });
    
    it('should return false when clearing non-existent verification', () => {
      const userId = 'nonexistent';
      
      const result = manager.clearVerification(userId);
      
      expect(result).toBe(false);
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('Cleared'));
    });
  });
  
  describe('isNsfwVerified', () => {
    it('should return true for verified users', () => {
      const userId = 'user123';
      
      manager.storeNsfwVerification(userId, true);
      
      expect(manager.isNsfwVerified(userId)).toBe(true);
    });
    
    it('should return false for users with false verification', () => {
      const userId = 'user123';
      
      manager.storeNsfwVerification(userId, false);
      
      expect(manager.isNsfwVerified(userId)).toBe(false);
    });
    
    it('should return false for non-existent users', () => {
      expect(manager.isNsfwVerified('nonexistent')).toBe(false);
    });
    
    it('should return false for users with invalid verification data', () => {
      const userId = 'user123';
      
      // Manually set invalid data
      manager.nsfwVerified[userId] = { invalid: true };
      
      expect(manager.isNsfwVerified(userId)).toBe(false);
    });
  });
  
  describe('getAllVerifications', () => {
    it('should return all verifications', () => {
      manager.storeNsfwVerification('user1', true);
      manager.storeNsfwVerification('user2', false);
      manager.storeNsfwVerification('user3', true);
      
      const all = manager.getAllVerifications();
      
      expect(Object.keys(all)).toHaveLength(3);
      expect(all.user1.verified).toBe(true);
      expect(all.user2.verified).toBe(false);
      expect(all.user3.verified).toBe(true);
    });
    
    it('should return empty object when no verifications', () => {
      expect(manager.getAllVerifications()).toEqual({});
    });
  });
  
  describe('setAllVerifications', () => {
    it('should set all verifications at once', () => {
      const verifications = {
        user1: { verified: true, timestamp: Date.now() },
        user2: { verified: false, timestamp: Date.now() - 1000 },
        user3: { verified: true, timestamp: Date.now() - 2000 }
      };
      
      manager.setAllVerifications(verifications);
      
      expect(manager.nsfwVerified).toEqual(verifications);
    });
    
    it('should handle null/undefined input', () => {
      manager.storeNsfwVerification('user1', true);
      
      manager.setAllVerifications(null);
      expect(manager.nsfwVerified).toEqual({});
      
      manager.storeNsfwVerification('user1', true);
      
      manager.setAllVerifications(undefined);
      expect(manager.nsfwVerified).toEqual({});
    });
    
    it('should replace existing verifications', () => {
      manager.storeNsfwVerification('oldUser', true);
      
      const newVerifications = {
        newUser: { verified: true, timestamp: Date.now() }
      };
      
      manager.setAllVerifications(newVerifications);
      
      expect(manager.nsfwVerified).toEqual(newVerifications);
      expect(manager.nsfwVerified.oldUser).toBeUndefined();
    });
  });
  
  describe('getVerificationInfo', () => {
    it('should return verification info for a user', () => {
      const userId = 'user123';
      manager.storeNsfwVerification(userId, true);
      
      const info = manager.getVerificationInfo(userId);
      
      expect(info).toEqual({
        verified: true,
        timestamp: expect.any(Number),
        verifiedAt: expect.any(Number)
      });
    });
    
    it('should return null for non-existent user', () => {
      expect(manager.getVerificationInfo('nonexistent')).toBeNull();
    });
  });
  
  describe('requiresNsfwVerification', () => {
    it('should return false for DM channels', () => {
      const dmChannel = { guild: null, nsfw: true };
      
      expect(manager.requiresNsfwVerification(dmChannel)).toBe(false);
    });
    
    it('should return true for NSFW guild channels', () => {
      const nsfwChannel = { guild: { id: 'guild123' }, nsfw: true };
      
      expect(manager.requiresNsfwVerification(nsfwChannel)).toBe(true);
    });
    
    it('should return false for non-NSFW guild channels', () => {
      const normalChannel = { guild: { id: 'guild123' }, nsfw: false };
      
      expect(manager.requiresNsfwVerification(normalChannel)).toBe(false);
    });
  });
  
  describe('shouldAutoVerify', () => {
    it('should auto-verify in NSFW channels', () => {
      const nsfwChannel = { guild: { id: 'guild123' }, nsfw: true, id: 'channel123' };
      const userId = 'user123';
      
      const result = manager.shouldAutoVerify(nsfwChannel, userId);
      
      expect(result).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('[NsfwVerificationManager] Auto-verifying user user123 in NSFW channel channel123');
    });
    
    it('should not auto-verify in non-NSFW channels', () => {
      const normalChannel = { guild: { id: 'guild123' }, nsfw: false };
      const userId = 'user123';
      
      const result = manager.shouldAutoVerify(normalChannel, userId);
      
      expect(result).toBe(false);
    });
    
    it('should not auto-verify in DM channels', () => {
      const dmChannel = { guild: null };
      const userId = 'user123';
      
      const result = manager.shouldAutoVerify(dmChannel, userId);
      
      expect(result).toBe(false);
    });
  });
  
  describe('checkProxySystem', () => {
    it('should detect PluralKit proxy messages', () => {
      const message = {
        author: {
          bot: true,
          username: 'pk; System Name[APP]',
          discriminator: '0000',
          id: 'webhook123'
        }
      };
      
      const result = manager.checkProxySystem(message);
      
      expect(result).toEqual({
        isProxy: true,
        systemType: 'pluralkit',
        userId: null
      });
      expect(logger.debug).toHaveBeenCalledWith('[NsfwVerificationManager] Detected PluralKit proxy message');
    });
    
    it('should not detect regular bot messages as proxy', () => {
      const message = {
        author: {
          bot: true,
          username: 'Regular Bot',
          discriminator: '1234',
          id: 'bot123'
        }
      };
      
      const result = manager.checkProxySystem(message);
      
      expect(result).toEqual({
        isProxy: false,
        systemType: null,
        userId: 'bot123'
      });
    });
    
    it('should not detect regular user messages as proxy', () => {
      const message = {
        author: {
          bot: false,
          username: 'User',
          discriminator: '5678',
          id: 'user123'
        }
      };
      
      const result = manager.checkProxySystem(message);
      
      expect(result).toEqual({
        isProxy: false,
        systemType: null,
        userId: 'user123'
      });
    });
  });
  
  describe('verifyAccess', () => {
    it('should block non-verified users in non-NSFW channels', () => {
      const channel = { guild: { id: 'guild123' }, nsfw: false };
      const userId = 'user123';
      
      const result = manager.verifyAccess(channel, userId);
      
      expect(result.isAllowed).toBe(false);
      expect(result.reason).toContain('has not completed NSFW verification');
      expect(result.reason).toContain('`!tz verify`');
      expect(result.userId).toBe(userId);
    });
    
    it('should auto-verify non-verified users in NSFW channels', () => {
      const channel = { guild: { id: 'guild123' }, nsfw: true, id: 'channel123' };
      const userId = 'user123';
      
      const result = manager.verifyAccess(channel, userId);
      
      expect(result.isAllowed).toBe(true);
      expect(result.reason).toBe('User auto-verified in NSFW channel');
      expect(result.autoVerified).toBe(true);
      expect(manager.isNsfwVerified(userId)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith('[NsfwVerificationManager] Auto-verifying user user123 in NSFW channel channel123');
    });
    
    it('should allow access for already verified users in NSFW channels only', () => {
      const nsfwChannel = { guild: { id: 'guild123' }, nsfw: true, id: 'channel123' };
      const userId = 'user123';
      
      // Pre-verify the user
      manager.storeNsfwVerification(userId, true);
      
      const result = manager.verifyAccess(nsfwChannel, userId);
      
      expect(result.isAllowed).toBe(true);
      expect(result.reason).toBe('User is verified and channel is NSFW');
    });
    
    it('should auto-verify proxy users in NSFW channels', () => {
      const channel = { guild: { id: 'guild123' }, nsfw: true, id: 'channel123' };
      const userId = 'user123';
      const message = {
        author: {
          bot: true,
          username: 'pk; System[APP]',
          discriminator: '0000',
          id: 'webhook123'
        }
      };
      
      // Mock webhookUserTracker to return the real user
      const webhookUserTracker = require('../../../../src/utils/webhookUserTracker');
      webhookUserTracker.findRealUserId.mockReturnValue(userId);
      
      const result = manager.verifyAccess(channel, userId, message);
      
      // Proxy users should be auto-verified in NSFW channels
      expect(result.isAllowed).toBe(true);
      expect(result.reason).toBe(`Proxy user ${userId} auto-verified in NSFW channel`);
      expect(result.autoVerified).toBe(true);
      expect(result.isProxy).toBe(true);
      expect(result.systemType).toBe('pluralkit');
      // Verify user was auto-verified
      expect(manager.isNsfwVerified(userId)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(`[NsfwVerificationManager] Auto-verifying proxy user ${userId} in NSFW channel ${channel.id}`);
    });
    
    it('should allow proxy messages from verified users in NSFW channels', () => {
      const channel = { guild: { id: 'guild123' }, nsfw: true };
      const userId = 'user123';
      const message = {
        author: {
          bot: true,
          username: 'pk; System[APP]',
          discriminator: '0000',
          id: 'webhook123'
        }
      };
      
      // Pre-verify the user
      manager.storeNsfwVerification(userId, true);
      
      // Mock webhookUserTracker to return the real user
      const webhookUserTracker = require('../../../../src/utils/webhookUserTracker');
      webhookUserTracker.findRealUserId.mockReturnValue(userId);
      
      const result = manager.verifyAccess(channel, userId, message);
      
      // Verified user should be allowed even through proxy
      expect(result.isAllowed).toBe(true);
      expect(result.reason).toContain('Proxy user user123 is verified and channel is NSFW');
      expect(result.isProxy).toBe(true);
      expect(result.systemType).toBe('pluralkit');
    });
    
  });
});