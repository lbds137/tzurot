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

    it('should require Token', () => {
      expect(() => new UserAuth(userId, 'invalid')).toThrow('UserAuth must be created with Token');
    });
  });

  describe('createAuthenticated', () => {
    it('should create authenticated user', () => {
      const userAuth = UserAuth.createAuthenticated(userId, token);

      expect(userAuth).toBeInstanceOf(UserAuth);
      expect(userAuth.userId).toEqual(userId);
      expect(userAuth.token.value).toBe(token.value);
      expect(userAuth.version).toBe(1);
    });

    it('should emit UserAuthenticated event', () => {
      const userAuth = UserAuth.createAuthenticated(userId, token);
      const events = userAuth.getUncommittedEvents();

      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(UserAuthenticated);
      expect(events[0].payload).toMatchObject({
        userId: userId.toString(),
        token: token.toJSON(),
      });
    });

    it('should validate UserId', () => {
      expect(() => UserAuth.createAuthenticated('invalid', token)).toThrow('Invalid UserId');
    });

    it('should validate Token', () => {
      expect(() => UserAuth.createAuthenticated(userId, 'invalid')).toThrow('Invalid Token');
    });
  });

  describe('refreshToken', () => {
    let userAuth;

    beforeEach(() => {
      userAuth = UserAuth.createAuthenticated(userId, token);
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


    it('should reject invalid token', () => {
      expect(() => userAuth.refreshToken('invalid')).toThrow('Invalid Token');
    });

    it('should accept any token (AI service validates expiry)', () => {
      // Create a token that would be expired in old system
      const expiredToken = Token.createWithLifetime('expired-token', 1000); // 1 second
      jest.advanceTimersByTime(1001); // Time passes

      // Should not throw - AI service handles token validation
      expect(() => userAuth.refreshToken(expiredToken)).not.toThrow();
    });
  });

  describe('expireToken', () => {
    let userAuth;

    beforeEach(() => {
      userAuth = UserAuth.createAuthenticated(userId, token);
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

    it('should handle no token gracefully', () => {
      const emptyAuth = UserAuth.createAuthenticated(userId, token);
      emptyAuth.expireToken(); // First expiry
      emptyAuth.markEventsAsCommitted();
      
      // Second expiry should not emit event
      emptyAuth.expireToken();
      const events = emptyAuth.getUncommittedEvents();
      expect(events).toHaveLength(0);
    });
  });

  describe('verifyNsfw', () => {
    let userAuth;

    beforeEach(() => {
      userAuth = UserAuth.createAuthenticated(userId, token);
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

    it('should use current time for verification', () => {
      userAuth.verifyNsfw();

      expect(userAuth.nsfwStatus.verifiedAt).toEqual(new Date('2024-01-01T00:00:00Z'));
    });

    it('should not emit event if already verified', () => {
      userAuth.verifyNsfw();
      userAuth.markEventsAsCommitted();

      userAuth.verifyNsfw();

      expect(userAuth.getUncommittedEvents()).toHaveLength(0);
    });

  });

  describe('clearNsfwVerification', () => {
    let userAuth;

    beforeEach(() => {
      userAuth = UserAuth.createAuthenticated(userId, token);
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


  describe('isAuthenticated', () => {
    it('should return true for valid authentication', () => {
      const userAuth = UserAuth.createAuthenticated(userId, token);

      expect(userAuth.isAuthenticated()).toBe(true);
    });

    it('should return true even for expired token (AI service validates)', () => {
      const userAuth = UserAuth.createAuthenticated(userId, token);

      jest.advanceTimersByTime(3600001); // Time passes

      expect(userAuth.isAuthenticated()).toBe(true); // Still true - AI service validates
    });


    it('should return false for user without token', () => {
      const userAuth = UserAuth.createAuthenticated(userId, token);
      userAuth.expireToken(); // Sets token to null

      expect(userAuth.isAuthenticated()).toBe(false);
    });

    it('should ignore time parameter (AI service validates)', () => {
      const userAuth = UserAuth.createAuthenticated(userId, token);
      const futureTime = new Date('2024-01-01T02:00:00Z');

      expect(userAuth.isAuthenticated(futureTime)).toBe(true); // Still true
    });
  });

  describe('canAccessNsfw', () => {
    let userAuth;
    let dmContext;
    let channelContext;
    let nsfwPersonality;
    let safePersonality;

    beforeEach(() => {
      userAuth = UserAuth.createAuthenticated(userId, token);
      dmContext = AuthContext.createForDM('123456789012345678');
      channelContext = AuthContext.createForGuild('987654321098765432', true);
      nsfwPersonality = { profile: { nsfw: true } };
      safePersonality = { profile: { nsfw: false } };
    });

    it('should require verification for NSFW in DMs', () => {
      expect(userAuth.canAccessNsfw(nsfwPersonality, dmContext)).toBe(false);
      
      userAuth.verifyNsfw();
      
      expect(userAuth.canAccessNsfw(nsfwPersonality, dmContext)).toBe(true);
    });

    it('should allow NSFW in NSFW channels', () => {
      // NSFW content is allowed in NSFW channels regardless of verification
      expect(userAuth.canAccessNsfw(nsfwPersonality, channelContext)).toBe(true);
    });

    it('should treat all personalities as NSFW uniformly', () => {
      // All personalities are treated as NSFW uniformly
      // So both safe and NSFW personalities require same verification
      expect(userAuth.canAccessNsfw(safePersonality, dmContext)).toBe(false); // DM requires verification
      expect(userAuth.canAccessNsfw(safePersonality, channelContext)).toBe(true); // NSFW channel allows it
      expect(userAuth.canAccessNsfw(nsfwPersonality, dmContext)).toBe(false); // DM requires verification
      expect(userAuth.canAccessNsfw(nsfwPersonality, channelContext)).toBe(true); // NSFW channel allows it
    });

    it('should check NSFW status for NSFW personalities in DMs', () => {
      // NSFW personality in DM requires verification
      const nsfwChannelContext = AuthContext.createForGuild('987654321098765432', false);
      
      expect(userAuth.canAccessNsfw(nsfwPersonality, nsfwChannelContext)).toBe(false);
    });
  });

  describe('getRateLimit', () => {
    it('should return default rate limit', () => {
      const userAuth = UserAuth.createAuthenticated(userId, token);

      expect(userAuth.getRateLimit()).toBe(1);
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

      // Create empty aggregate for event sourcing test - constructor is private
      // so we need to use a different approach
      const userAuth = UserAuth.createAuthenticated(userId, token);
      
      // Reset state to simulate empty aggregate
      userAuth.nsfwStatus = NsfwStatus.createUnverified();
      userAuth.token = token; // Will be replaced by events
      userAuth.version = 0;
      userAuth.markEventsAsCommitted(); // Clear creation event
      
      userAuth.loadFromHistory(events);

      expect(userAuth.token.value).toBe('refreshed-token');
      expect(userAuth.nsfwStatus.verified).toBe(true);
      expect(userAuth.version).toBe(3);
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      const userAuth = UserAuth.createAuthenticated(userId, token);
      userAuth.verifyNsfw();

      const json = userAuth.toJSON();

      expect(json).toMatchObject({
        userId: userId.toString(),
        token: token.toJSON(),
      });
      expect(json.nsfwStatus).toBeDefined();
    });

    it('should handle null token', () => {
      const userAuth = UserAuth.createAuthenticated(userId, token);
      userAuth.expireToken(); // Sets token to null

      const json = userAuth.toJSON();

      expect(json.token).toBeNull();
    });
  });

  describe('fromData', () => {
    it('should reconstitute UserAuth from persisted data', () => {
      const data = {
        userId: '123456789012345678',
        token: {
          value: 'test-token-value',
          expiresAt: '2024-01-01T01:00:00.000Z'
        },
        nsfwStatus: {
          verified: true,
          verifiedAt: '2024-01-01T00:00:00.000Z'
        }
      };

      const userAuth = UserAuth.fromData(data);

      expect(userAuth.userId.toString()).toBe('123456789012345678');
      expect(userAuth.token.value).toBe('test-token-value');
      expect(userAuth.token.expiresAt).toEqual(new Date('2024-01-01T01:00:00.000Z'));
      expect(userAuth.nsfwStatus.verified).toBe(true);
      // Fields removed: lastAuthenticatedAt and authenticationCount
    });

    it('should handle data without expiresAt', () => {
      const data = {
        userId: '123456789012345678',
        token: {
          value: 'test-token-value'
          // No expiresAt
        }
      };

      const userAuth = UserAuth.fromData(data);

      expect(userAuth.token.expiresAt).toBeNull();
    });

    it('should handle data without nsfwStatus', () => {
      const data = {
        userId: '123456789012345678',
        token: {
          value: 'test-token-value'
        }
        // No nsfwStatus
      };

      const userAuth = UserAuth.fromData(data);

      expect(userAuth.nsfwStatus.verified).toBe(false);
    });

    // Test removed: lastAuthenticatedAt field no longer exists

    // Test removed: authenticationCount field no longer exists

    it('should require userId', () => {
      const data = {
        // No userId
        token: {
          value: 'test-token-value'
        }
      };

      expect(() => UserAuth.fromData(data)).toThrow('Cannot reconstitute UserAuth without userId and token');
    });

    it('should require token', () => {
      const data = {
        userId: '123456789012345678'
        // No token
      };

      expect(() => UserAuth.fromData(data)).toThrow('Cannot reconstitute UserAuth without userId and token');
    });
  });

  describe('verifyNsfw - authentication check', () => {
    it('should reject if user not authenticated', () => {
      const userAuth = UserAuth.createAuthenticated(userId, token);
      userAuth.expireToken(); // Remove authentication

      expect(() => userAuth.verifyNsfw()).toThrow('Must be authenticated to verify NSFW access');
    });
  });
});
