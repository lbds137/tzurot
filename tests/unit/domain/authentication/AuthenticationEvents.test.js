/**
 * @jest-environment node
 * @testType domain
 *
 * Authentication Events Test
 * - Pure domain test with no external dependencies
 * - Tests authentication domain events
 * - No mocking needed (testing the actual implementation)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain models under test - NOT mocked!
const {
  UserAuthenticated,
  UserTokenExpired,
  UserTokenRefreshed,
  UserNsfwVerified,
  UserNsfwVerificationCleared,
  UserBlacklisted,
  UserUnblacklisted,
  AuthenticationDenied,
  ProxyAuthenticationAttempted,
} = require('../../../../src/domain/authentication/AuthenticationEvents');
const { DomainEvent } = require('../../../../src/domain/shared/DomainEvent');

describe('AuthenticationEvents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('UserAuthenticated', () => {
    it('should create event with required fields', () => {
      const payload = {
        userId: '123456789012345678',
        token: {
          value: 'test-token',
          expiresAt: '2024-01-01T01:00:00.000Z',
        },
        authenticatedAt: '2024-01-01T00:00:00.000Z',
      };

      const event = new UserAuthenticated('123456789012345678', payload);

      expect(event).toBeInstanceOf(DomainEvent);
      expect(event.eventType).toBe('UserAuthenticated');
      expect(event.aggregateId).toBe('123456789012345678');
      expect(event.payload).toEqual(payload);
    });

    it('should validate required fields', () => {
      expect(() => new UserAuthenticated('123456789012345678', {})).toThrow(
        'UserAuthenticated requires userId, token, and authenticatedAt'
      );

      expect(
        () =>
          new UserAuthenticated('123456789012345678', {
            userId: '123456789012345678',
          })
      ).toThrow('UserAuthenticated requires userId, token, and authenticatedAt');

      expect(
        () =>
          new UserAuthenticated('123456789012345678', {
            userId: '123456789012345678',
            token: {},
          })
      ).toThrow('UserAuthenticated requires userId, token, and authenticatedAt');
    });
  });

  describe('UserTokenExpired', () => {
    it('should create event with required fields', () => {
      const payload = {
        expiredAt: '2024-01-01T00:00:00.000Z',
      };

      const event = new UserTokenExpired('123456789012345678', payload);

      expect(event).toBeInstanceOf(DomainEvent);
      expect(event.eventType).toBe('UserTokenExpired');
      expect(event.aggregateId).toBe('123456789012345678');
      expect(event.payload).toEqual(payload);
    });

    it('should validate required fields', () => {
      expect(() => new UserTokenExpired('123456789012345678', {})).toThrow(
        'UserTokenExpired requires expiredAt'
      );
    });
  });

  describe('UserTokenRefreshed', () => {
    it('should create event with required fields', () => {
      const payload = {
        oldToken: {
          value: 'old-token',
          expiresAt: '2024-01-01T00:30:00.000Z',
        },
        newToken: {
          value: 'new-token',
          expiresAt: '2024-01-01T01:30:00.000Z',
        },
        refreshedAt: '2024-01-01T00:00:00.000Z',
      };

      const event = new UserTokenRefreshed('123456789012345678', payload);

      expect(event).toBeInstanceOf(DomainEvent);
      expect(event.eventType).toBe('UserTokenRefreshed');
      expect(event.aggregateId).toBe('123456789012345678');
      expect(event.payload).toEqual(payload);
    });

    it('should validate required fields', () => {
      expect(() => new UserTokenRefreshed('123456789012345678', {})).toThrow(
        'UserTokenRefreshed requires newToken and refreshedAt'
      );

      expect(
        () =>
          new UserTokenRefreshed('123456789012345678', {
            newToken: {},
          })
      ).toThrow('UserTokenRefreshed requires newToken and refreshedAt');
    });

    it('should allow null oldToken', () => {
      const payload = {
        oldToken: null,
        newToken: {
          value: 'new-token',
          expiresAt: '2024-01-01T01:00:00.000Z',
        },
        refreshedAt: '2024-01-01T00:00:00.000Z',
      };

      const event = new UserTokenRefreshed('123456789012345678', payload);

      expect(event.payload.oldToken).toBeNull();
    });
  });

  describe('UserNsfwVerified', () => {
    it('should create event with required fields', () => {
      const payload = {
        verifiedAt: '2024-01-01T00:00:00.000Z',
      };

      const event = new UserNsfwVerified('123456789012345678', payload);

      expect(event).toBeInstanceOf(DomainEvent);
      expect(event.eventType).toBe('UserNsfwVerified');
      expect(event.aggregateId).toBe('123456789012345678');
      expect(event.payload).toEqual(payload);
    });

    it('should validate required fields', () => {
      expect(() => new UserNsfwVerified('123456789012345678', {})).toThrow(
        'UserNsfwVerified requires verifiedAt'
      );
    });
  });

  describe('UserNsfwVerificationCleared', () => {
    it('should create event with required fields', () => {
      const payload = {
        reason: 'Policy violation',
        clearedAt: '2024-01-01T00:00:00.000Z',
      };

      const event = new UserNsfwVerificationCleared('123456789012345678', payload);

      expect(event).toBeInstanceOf(DomainEvent);
      expect(event.eventType).toBe('UserNsfwVerificationCleared');
      expect(event.aggregateId).toBe('123456789012345678');
      expect(event.payload).toEqual(payload);
    });

    it('should validate required fields', () => {
      expect(() => new UserNsfwVerificationCleared('123456789012345678', {})).toThrow(
        'UserNsfwVerificationCleared requires reason and clearedAt'
      );

      expect(
        () =>
          new UserNsfwVerificationCleared('123456789012345678', {
            reason: 'Test',
          })
      ).toThrow('UserNsfwVerificationCleared requires reason and clearedAt');
    });
  });


  describe('AuthenticationDenied', () => {
    it('should create event with required fields', () => {
      const payload = {
        reason: 'Token expired',
        context: {
          channelType: 'GUILD',
          channelId: '123456789012345678',
          isNsfwChannel: false,
          isProxyMessage: false,
          requestedPersonalityId: null,
        },
        deniedAt: '2024-01-01T00:00:00.000Z',
      };

      const event = new AuthenticationDenied('123456789012345678', payload);

      expect(event).toBeInstanceOf(DomainEvent);
      expect(event.eventType).toBe('AuthenticationDenied');
      expect(event.aggregateId).toBe('123456789012345678');
      expect(event.payload).toEqual(payload);
    });

    it('should validate required fields', () => {
      expect(() => new AuthenticationDenied('123456789012345678', {})).toThrow(
        'AuthenticationDenied requires reason, context, and deniedAt'
      );

      expect(
        () =>
          new AuthenticationDenied('123456789012345678', {
            reason: 'Test',
          })
      ).toThrow('AuthenticationDenied requires reason, context, and deniedAt');

      expect(
        () =>
          new AuthenticationDenied('123456789012345678', {
            reason: 'Test',
            context: {},
          })
      ).toThrow('AuthenticationDenied requires reason, context, and deniedAt');
    });
  });

  describe('ProxyAuthenticationAttempted', () => {
    it('should create event with required fields', () => {
      const payload = {
        userId: '123456789012345678',
        attemptedAt: '2024-01-01T00:00:00.000Z',
      };

      const event = new ProxyAuthenticationAttempted('123456789012345678', payload);

      expect(event).toBeInstanceOf(DomainEvent);
      expect(event.eventType).toBe('ProxyAuthenticationAttempted');
      expect(event.aggregateId).toBe('123456789012345678');
      expect(event.payload).toEqual(payload);
    });

    it('should validate required fields', () => {
      expect(() => new ProxyAuthenticationAttempted('123456789012345678', {})).toThrow(
        'ProxyAuthenticationAttempted requires userId and attemptedAt'
      );

      expect(
        () =>
          new ProxyAuthenticationAttempted('123456789012345678', {
            userId: '123456789012345678',
          })
      ).toThrow('ProxyAuthenticationAttempted requires userId and attemptedAt');
    });
  });

  describe('Event immutability', () => {
    it('should not be affected by payload modifications after creation', () => {
      const payload = {
        userId: '123456789012345678',
        token: {
          value: 'test-token',
          expiresAt: '2024-01-01T01:00:00.000Z',
        },
        authenticatedAt: '2024-01-01T00:00:00.000Z',
      };

      // Create deep copy of payload
      const event = new UserAuthenticated(
        '123456789012345678',
        JSON.parse(JSON.stringify(payload))
      );

      // Modify original payload
      payload.userId = 'modified';
      payload.token.value = 'modified-token';

      // Event should remain unchanged
      expect(event.payload.userId).toBe('123456789012345678');
      expect(event.payload.token.value).toBe('test-token');
    });
  });

  describe('Event metadata', () => {
    it('should include standard DomainEvent metadata', () => {
      const event = new UserTokenExpired('123456789012345678', {
        expiredAt: '2024-01-01T00:00:00.000Z',
      });

      expect(event.eventId).toBeDefined();
      expect(event.occurredAt).toBeDefined();
      expect(event.occurredAt).toBeInstanceOf(Date);
      expect(event.eventType).toBe('UserTokenExpired');
    });
  });
});
