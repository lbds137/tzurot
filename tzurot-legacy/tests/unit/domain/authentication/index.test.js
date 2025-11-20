/**
 * @jest-environment node
 * @testType index
 *
 * Authentication Domain Index Test
 * - Tests exports of the authentication domain module
 * - Verifies API surface and basic functionality
 * - Imports related domain objects for integration tests
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Module under test - NOT mocked!
const authDomain = require('../../../../src/domain/authentication/index');
const { UserId } = require('../../../../src/domain/personality/UserId');

describe('Authentication Domain Index', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('exports', () => {
    it('should export all aggregates', () => {
      expect(authDomain.UserAuth).toBeDefined();
      expect(typeof authDomain.UserAuth).toBe('function');
    });

    it('should export all value objects', () => {
      expect(authDomain.Token).toBeDefined();
      expect(typeof authDomain.Token).toBe('function');

      expect(authDomain.NsfwStatus).toBeDefined();
      expect(typeof authDomain.NsfwStatus).toBe('function');

      expect(authDomain.AuthContext).toBeDefined();
      expect(typeof authDomain.AuthContext).toBe('function');
    });

    it('should export all repositories', () => {
      expect(authDomain.AuthenticationRepository).toBeDefined();
      expect(typeof authDomain.AuthenticationRepository).toBe('function');
    });

    it('should export all services', () => {
      expect(authDomain.TokenService).toBeDefined();
      expect(typeof authDomain.TokenService).toBe('function');
    });

    it('should export all events', () => {
      expect(authDomain.UserAuthenticated).toBeDefined();
      expect(typeof authDomain.UserAuthenticated).toBe('function');

      expect(authDomain.UserTokenExpired).toBeDefined();
      expect(typeof authDomain.UserTokenExpired).toBe('function');

      expect(authDomain.UserTokenRefreshed).toBeDefined();
      expect(typeof authDomain.UserTokenRefreshed).toBe('function');

      expect(authDomain.UserNsfwVerified).toBeDefined();
      expect(typeof authDomain.UserNsfwVerified).toBe('function');

      expect(authDomain.UserNsfwVerificationCleared).toBeDefined();
      expect(typeof authDomain.UserNsfwVerificationCleared).toBe('function');


      expect(authDomain.AuthenticationDenied).toBeDefined();
      expect(typeof authDomain.AuthenticationDenied).toBe('function');

      expect(authDomain.ProxyAuthenticationAttempted).toBeDefined();
      expect(typeof authDomain.ProxyAuthenticationAttempted).toBe('function');
    });
  });

  describe('functionality', () => {
    it('should allow creating authenticated users', () => {
      const userId = new UserId('123456789012345678');
      const token = authDomain.Token.createWithLifetime('test-token', 3600 * 1000);

      const userAuth = authDomain.UserAuth.createAuthenticated(userId, token);

      expect(userAuth).toBeInstanceOf(authDomain.UserAuth);
    });

    it('should allow creating auth contexts', () => {
      const dmContext = authDomain.AuthContext.createForDM('123456789012345678');
      const threadContext = authDomain.AuthContext.createForThread('987654321098765432', false);

      expect(dmContext).toBeInstanceOf(authDomain.AuthContext);
      expect(threadContext).toBeInstanceOf(authDomain.AuthContext);
    });

    it('should allow creating NSFW status', () => {
      const unverified = authDomain.NsfwStatus.createUnverified();
      const verified = authDomain.NsfwStatus.createVerified();

      expect(unverified).toBeInstanceOf(authDomain.NsfwStatus);
      expect(verified).toBeInstanceOf(authDomain.NsfwStatus);
    });

    it('should allow creating authentication events', () => {
      const event = new authDomain.UserAuthenticated('user-123', {
        userId: '123456789012345678',
        token: { value: 'test-token', expiresAt: new Date().toISOString() },
        authenticatedAt: new Date().toISOString(),
      });

      expect(event).toBeInstanceOf(authDomain.UserAuthenticated);
    });
  });

  describe('domain boundary', () => {
    it('should not export internal implementation details', () => {
      // These should not be exported
      expect(authDomain.TokenType).toBeUndefined();
      expect(authDomain.UserSession).toBeUndefined();
      expect(authDomain.AuthenticationError).toBeUndefined();
    });

    it('should provide complete public API', () => {
      const exportedKeys = Object.keys(authDomain);
      const expectedKeys = [
        'UserAuth',
        'Token',
        'NsfwStatus',
        'AuthContext',
        'AuthenticationRepository',
        'TokenService',
        'UserAuthenticated',
        'UserTokenExpired',
        'UserTokenRefreshed',
        'UserNsfwVerified',
        'UserNsfwVerificationCleared',
        'AuthenticationDenied',
        'ProxyAuthenticationAttempted',
      ];

      for (const key of expectedKeys) {
        expect(exportedKeys).toContain(key);
      }

      expect(exportedKeys).toHaveLength(expectedKeys.length);
    });
  });
});
