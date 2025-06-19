/**
 * @jest-environment node
 * @testType domain
 *
 * UserAuth Aggregate Test
 * - Pure domain test with no external dependencies
 * - Tests user authentication aggregate
 * - No mocking needed (testing the actual implementation)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain models under test - NOT mocked!
const { UserAuth } = require('../../../../src/domain/authentication/UserAuth');
const { UserId } = require('../../../../src/domain/personality/UserId');
const { Token } = require('../../../../src/domain/authentication/Token');
const { NsfwStatus } = require('../../../../src/domain/authentication/NsfwStatus');
const { AuthContext } = require('../../../../src/domain/authentication/AuthContext');
const {
  UserAuthenticated,
  UserTokenExpired,
  UserTokenRefreshed,
  UserNsfwVerified,
  UserNsfwVerificationCleared,
  UserBlacklisted,
  UserUnblacklisted,
} = require('../../../../src/domain/authentication/AuthenticationEvents');

describe('UserAuth', () => {
  let userId;
  let token;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));

    userId = new UserId('123456789012345678');
    token = Token.createWithLifetime('test-token-value', 3600000); // 1 hour
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should require UserId', () => {
      expect(() => new UserAuth('string-id')).toThrow('UserAuth must be created with UserId');
    });

    it('should initialize with UserId', () => {
      const userAuth = new UserAuth(userId);

      expect(userAuth.id).toBe(userId.toString());
      expect(userAuth.userId).toBe(userId);
      expect(userAuth.token).toBeNull();
      expect(userAuth.nsfwStatus).toBeDefined();
      expect(userAuth.blacklisted).toBe(false);
      expect(userAuth.blacklistReason).toBeNull();
      expect(userAuth.lastAuthenticatedAt).toBeNull();
      expect(userAuth.authenticationCount).toBe(0);
    });
  });

  describe('authenticate', () => {
    it('should create authenticated user', () => {
      const userAuth = UserAuth.authenticate(userId, token);

      expect(userAuth).toBeInstanceOf(UserAuth);
      expect(userAuth.userId).toEqual(userId);
      expect(userAuth.token.value).toBe(token.value);
      expect(userAuth.lastAuthenticatedAt).toBeDefined();
      expect(userAuth.authenticationCount).toBe(1);
      expect(userAuth.version).toBe(1);
    });

    it('should emit UserAuthenticated event', () => {
      const userAuth = UserAuth.authenticate(userId, token);
      const events = userAuth.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(UserAuthenticated);
      expect(events[0].payload).toMatchObject({
        userId: userId.toString(),
        token: token.toJSON(),
      });
    });

    it('should validate UserId', () => {
      expect(() => UserAuth.authenticate('invalid', token)).toThrow('Invalid UserId');
    });

    it('should validate Token', () => {
      expect(() => UserAuth.authenticate(userId, 'invalid')).toThrow('Invalid Token');
    });
  });

  describe('refreshToken', () => {
    let userAuth;

    beforeEach(() => {
      userAuth = UserAuth.authenticate(userId, token);
      userAuth.markEventsAsCommitted();
    });

    it('should refresh token', () => {
      const newToken = Token.createWithLifetime('new-token-value', 3600000);

      userAuth.refreshToken(newToken);

      expect(userAuth.token.value).toBe('new-token-value');
    });

    it('should emit UserTokenRefreshed event', () => {
      const newToken = Token.createWithLifetime('new-token-value', 3600000);

      userAuth.refreshToken(newToken);
      const events = userAuth.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(UserTokenRefreshed);
      expect(events[0].payload).toMatchObject({
        oldToken: token.toJSON(),
        newToken: newToken.toJSON(),
      });
    });

    it('should reject if user blacklisted', () => {
      userAuth.blacklist('Test reason');
      const newToken = Token.createWithLifetime('new-token-value', 3600000);

      expect(() => userAuth.refreshToken(newToken)).toThrow(
        'Cannot refresh token for blacklisted user'
      );
    });

    it('should reject invalid token', () => {
      expect(() => userAuth.refreshToken('invalid')).toThrow('Invalid Token');
    });

    it('should reject expired token', () => {
      // Create a token that will be expired when checked
      const expiredToken = Token.createWithLifetime('expired-token', 1000); // 1 second
      jest.advanceTimersByTime(1001); // Expire it

      expect(() => userAuth.refreshToken(expiredToken)).toThrow(
        'Cannot refresh with expired token'
      );
    });
  });

  describe('expireToken', () => {
    let userAuth;

    beforeEach(() => {
      userAuth = UserAuth.authenticate(userId, token);
      userAuth.markEventsAsCommitted();
    });

    it('should expire token', () => {
      userAuth.expireToken();

      expect(userAuth.token).toBeNull();
    });

    it('should emit UserTokenExpired event', () => {
      userAuth.expireToken();
      const events = userAuth.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(UserTokenExpired);
      expect(events[0].payload.expiredAt).toBeDefined();
    });

    it('should require existing token', () => {
      const emptyAuth = new UserAuth(userId);

      expect(() => emptyAuth.expireToken()).toThrow('No token to expire');
    });
  });

  describe('verifyNsfw', () => {
    let userAuth;

    beforeEach(() => {
      userAuth = UserAuth.authenticate(userId, token);
      userAuth.markEventsAsCommitted();
    });

    it('should verify NSFW access', () => {
      userAuth.verifyNsfw();

      expect(userAuth.nsfwStatus.verified).toBe(true);
    });

    it('should emit UserNsfwVerified event', () => {
      userAuth.verifyNsfw();
      const events = userAuth.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(UserNsfwVerified);
      expect(events[0].payload.verifiedAt).toBeDefined();
    });

    it('should accept custom verification time', () => {
      const verifiedAt = new Date('2024-01-01T12:00:00Z');

      userAuth.verifyNsfw(verifiedAt);

      expect(userAuth.nsfwStatus.verifiedAt).toEqual(verifiedAt);
    });

    it('should not emit event if already verified', () => {
      userAuth.verifyNsfw();
      userAuth.markEventsAsCommitted();

      userAuth.verifyNsfw();

      expect(userAuth.getUncommittedEvents()).toHaveLength(0);
    });

    it('should reject if user blacklisted', () => {
      userAuth.blacklist('Test reason');

      expect(() => userAuth.verifyNsfw()).toThrow('Cannot verify NSFW for blacklisted user');
    });
  });

  describe('clearNsfwVerification', () => {
    let userAuth;

    beforeEach(() => {
      userAuth = UserAuth.authenticate(userId, token);
      userAuth.verifyNsfw();
      userAuth.markEventsAsCommitted();
    });

    it('should clear NSFW verification', () => {
      userAuth.clearNsfwVerification('Policy violation');

      expect(userAuth.nsfwStatus.verified).toBe(false);
    });

    it('should emit UserNsfwVerificationCleared event', () => {
      userAuth.clearNsfwVerification('Policy violation');
      const events = userAuth.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(UserNsfwVerificationCleared);
      expect(events[0].payload).toMatchObject({
        reason: 'Policy violation',
      });
    });

    it('should not emit event if already unverified', () => {
      userAuth.clearNsfwVerification('Test');
      userAuth.markEventsAsCommitted();

      // Clear again
      userAuth.clearNsfwVerification('Test');

      expect(userAuth.getUncommittedEvents()).toHaveLength(0);
    });
  });

  describe('blacklist', () => {
    let userAuth;

    beforeEach(() => {
      userAuth = UserAuth.authenticate(userId, token);
      userAuth.verifyNsfw();
      userAuth.markEventsAsCommitted();
    });

    it('should blacklist user', () => {
      userAuth.blacklist('Abuse detected');

      expect(userAuth.blacklisted).toBe(true);
      expect(userAuth.blacklistReason).toBe('Abuse detected');
      expect(userAuth.token).toBeNull(); // Token revoked
      expect(userAuth.nsfwStatus.verified).toBe(false); // NSFW cleared
    });

    it('should emit UserBlacklisted event', () => {
      userAuth.blacklist('Abuse detected');
      const events = userAuth.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(UserBlacklisted);
      expect(events[0].payload).toMatchObject({
        reason: 'Abuse detected',
      });
    });

    it('should require reason', () => {
      expect(() => userAuth.blacklist('')).toThrow('Blacklist reason required');
      expect(() => userAuth.blacklist(null)).toThrow('Blacklist reason required');
      expect(() => userAuth.blacklist(123)).toThrow('Blacklist reason required');
    });

    it('should reject if already blacklisted', () => {
      userAuth.blacklist('First reason');

      expect(() => userAuth.blacklist('Second reason')).toThrow('User already blacklisted');
    });
  });

  describe('unblacklist', () => {
    let userAuth;

    beforeEach(() => {
      userAuth = UserAuth.authenticate(userId, token);
      userAuth.blacklist('Test reason');
      userAuth.markEventsAsCommitted();
    });

    it('should remove from blacklist', () => {
      userAuth.unblacklist();

      expect(userAuth.blacklisted).toBe(false);
      expect(userAuth.blacklistReason).toBeNull();
    });

    it('should emit UserUnblacklisted event', () => {
      userAuth.unblacklist();
      const events = userAuth.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(UserUnblacklisted);
      expect(events[0].payload.unblacklistedAt).toBeDefined();
    });

    it('should reject if not blacklisted', () => {
      userAuth.unblacklist();

      expect(() => userAuth.unblacklist()).toThrow('User not blacklisted');
    });
  });

  describe('isAuthenticated', () => {
    it('should return true for valid authentication', () => {
      const userAuth = UserAuth.authenticate(userId, token);

      expect(userAuth.isAuthenticated()).toBe(true);
    });

    it('should return false for expired token', () => {
      const userAuth = UserAuth.authenticate(userId, token);

      jest.advanceTimersByTime(3600001); // Expire token

      expect(userAuth.isAuthenticated()).toBe(false);
    });

    it('should return false for blacklisted user', () => {
      const userAuth = UserAuth.authenticate(userId, token);
      userAuth.blacklist('Test reason');

      expect(userAuth.isAuthenticated()).toBe(false);
    });

    it('should return false for user without token', () => {
      const userAuth = new UserAuth(userId);

      expect(userAuth.isAuthenticated()).toBe(false);
    });

    it('should accept custom current time', () => {
      const userAuth = UserAuth.authenticate(userId, token);
      const futureTime = new Date('2024-01-01T02:00:00Z');

      expect(userAuth.isAuthenticated(futureTime)).toBe(false);
    });
  });

  describe('canAccessNsfw', () => {
    let userAuth;
    let dmContext;
    let channelContext;

    beforeEach(() => {
      userAuth = UserAuth.authenticate(userId, token);
      dmContext = AuthContext.createForDM('123456789012345678');
      channelContext = AuthContext.createForGuild('987654321098765432', true);
    });

    it('should allow NSFW in DMs without verification', () => {
      expect(userAuth.canAccessNsfw(dmContext)).toBe(true);
    });

    it('should require verification for NSFW channels', () => {
      expect(userAuth.canAccessNsfw(channelContext)).toBe(false);

      userAuth.verifyNsfw();

      expect(userAuth.canAccessNsfw(channelContext)).toBe(true);
    });

    it('should return false if not authenticated', () => {
      userAuth.expireToken();

      expect(userAuth.canAccessNsfw(dmContext)).toBe(false);
      expect(userAuth.canAccessNsfw(channelContext)).toBe(false);
    });

    it('should return false if NSFW verification is stale', () => {
      userAuth.verifyNsfw();

      // Mock stale verification
      jest.spyOn(userAuth.nsfwStatus, 'isStale').mockReturnValue(true);

      expect(userAuth.canAccessNsfw(channelContext)).toBe(false);
    });
  });

  describe('getRateLimit', () => {
    it('should return default rate limit', () => {
      const userAuth = UserAuth.authenticate(userId, token);

      expect(userAuth.getRateLimit()).toBe(20);
    });

    it('should return 0 for blacklisted users', () => {
      const userAuth = UserAuth.authenticate(userId, token);
      userAuth.blacklist('Test reason');

      expect(userAuth.getRateLimit()).toBe(0);
    });
  });

  describe('event sourcing', () => {
    it('should rebuild state from events', () => {
      const events = [
        new UserAuthenticated(userId.toString(), {
          userId: userId.toString(),
          token: token.toJSON(),
          authenticatedAt: '2024-01-01T00:00:00.000Z',
        }),
        new UserNsfwVerified(userId.toString(), {
          verifiedAt: '2024-01-01T00:05:00.000Z',
        }),
        new UserTokenRefreshed(userId.toString(), {
          oldToken: token.toJSON(),
          newToken: Token.createWithLifetime('refreshed-token', 3600000).toJSON(),
          refreshedAt: '2024-01-01T00:30:00.000Z',
        }),
      ];

      const userAuth = new UserAuth(userId);
      userAuth.loadFromHistory(events);

      expect(userAuth.token.value).toBe('refreshed-token');
      expect(userAuth.nsfwStatus.verified).toBe(true);
      expect(userAuth.authenticationCount).toBe(1);
      expect(userAuth.version).toBe(3);
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      const userAuth = UserAuth.authenticate(userId, token);
      userAuth.verifyNsfw();

      const json = userAuth.toJSON();

      expect(json).toMatchObject({
        id: userId.toString(),
        userId: userId.toString(),
        token: token.toJSON(),
        blacklisted: false,
        blacklistReason: null,
        authenticationCount: 1,
        version: 2,
      });
      expect(json.nsfwStatus).toBeDefined();
      expect(json.lastAuthenticatedAt).toBeDefined();
    });

    it('should handle null token', () => {
      const userAuth = new UserAuth(userId);

      const json = userAuth.toJSON();

      expect(json.token).toBeNull();
    });
  });
});
