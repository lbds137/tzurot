/**
 * @jest-environment node
 * @testType domain
 *
 * Token Value Object Test
 * - Pure domain test with no external dependencies
 * - Tests token creation, expiration, and lifecycle
 * - Uses fake timers for time-based testing
 * - No mocking needed (testing the actual implementation)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain model under test - NOT mocked!
const { Token } = require('../../../../src/domain/authentication/Token');

describe('Token', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should create token with value and expiration', () => {
      const expiresAt = new Date('2024-01-01T01:00:00Z');
      const token = new Token('test-token-value', expiresAt);

      expect(token.value).toBe('test-token-value');
      expect(token.expiresAt).toEqual(expiresAt);
    });

    it('should require value', () => {
      const expiresAt = new Date('2024-01-01T01:00:00Z');

      expect(() => new Token(null, expiresAt)).toThrow('Token value must be a non-empty string');
      expect(() => new Token('', expiresAt)).toThrow('Token value must be a non-empty string');
      expect(() => new Token(undefined, expiresAt)).toThrow(
        'Token value must be a non-empty string'
      );
    });

    it('should require value to be string', () => {
      const expiresAt = new Date('2024-01-01T01:00:00Z');

      expect(() => new Token(123, expiresAt)).toThrow('Token value must be a non-empty string');
      expect(() => new Token({}, expiresAt)).toThrow('Token value must be a non-empty string');
      expect(() => new Token([], expiresAt)).toThrow('Token value must be a non-empty string');
    });

    it('should allow null expiration date', () => {
      const token1 = new Token('test-token', null);
      expect(token1.value).toBe('test-token');
      expect(token1.expiresAt).toBeNull();
      
      const token2 = new Token('test-token', undefined);
      expect(token2.value).toBe('test-token');
      expect(token2.expiresAt).toBeNull();
    });

    it('should require expiration to be Date if provided', () => {
      expect(() => new Token('test-token', '2024-01-01')).toThrow(
        'If provided, expiresAt must be a Date'
      );
      expect(() => new Token('test-token', Date.now())).toThrow(
        'If provided, expiresAt must be a Date'
      );
    });

    it('should allow past expiration (AI service handles validation)', () => {
      const pastDate = new Date('2023-12-31T23:59:59Z');
      const token = new Token('test-token', pastDate);
      
      expect(token.value).toBe('test-token');
      expect(token.expiresAt).toEqual(pastDate);
    });

    it('should allow expiration at current time (AI service handles validation)', () => {
      const now = new Date();
      const token = new Token('test-token', now);
      
      expect(token.value).toBe('test-token');
      expect(token.expiresAt).toEqual(now);
    });
  });

  describe('isExpired', () => {
    it('should return false for valid token', () => {
      const token = Token.createWithLifetime('test-token', 3600000); // 1 hour

      expect(token.isExpired()).toBe(false);
    });

    it('should always return false (AI service handles expiry)', () => {
      const token = Token.createWithLifetime('test-token', 3600000); // 1 hour

      jest.advanceTimersByTime(3600001); // 1 hour + 1ms

      expect(token.isExpired()).toBe(false); // Always false now
    });

    it('should always return false at exact expiration time', () => {
      const token = Token.createWithLifetime('test-token', 3600000); // 1 hour

      jest.advanceTimersByTime(3600000); // Exactly 1 hour

      expect(token.isExpired()).toBe(false); // Always false now
    });

    it('should always return false with custom current time', () => {
      const token = Token.createWithLifetime('test-token', 3600000); // 1 hour
      const futureTime = new Date('2024-01-01T02:00:00Z');

      expect(token.isExpired(futureTime)).toBe(false); // Always false now
    });
  });

  describe('timeUntilExpiration', () => {
    it('should return Infinity', () => {
      const token = Token.createWithLifetime('test-token', 3600000); // 1 hour

      expect(token.timeUntilExpiration()).toBe(Infinity);

      jest.advanceTimersByTime(1800000); // 30 minutes

      expect(token.timeUntilExpiration()).toBe(Infinity);
    });

    it('should return Infinity (AI service handles expiry)', () => {
      const token = Token.createWithLifetime('test-token', 3600000); // 1 hour

      jest.advanceTimersByTime(3600001);

      expect(token.timeUntilExpiration()).toBe(Infinity);
    });

    it('should return Infinity with custom current time', () => {
      const token = Token.createWithLifetime('test-token', 3600000); // 1 hour
      const halfHourLater = new Date('2024-01-01T00:30:00Z');

      expect(token.timeUntilExpiration(halfHourLater)).toBe(Infinity);
    });
  });

  describe('shouldRefresh', () => {
    it('should return false when plenty of time remains', () => {
      const token = Token.createWithLifetime('test-token', 3600000); // 1 hour

      expect(token.shouldRefresh()).toBe(false);
    });

    it('should always return false (AI service handles refresh)', () => {
      const token = Token.createWithLifetime('test-token', 3600000); // 1 hour

      jest.advanceTimersByTime(3300000); // 55 minutes

      expect(token.shouldRefresh()).toBe(false); // Always false now
    });

    it('should always return false with custom threshold', () => {
      const token = Token.createWithLifetime('test-token', 3600000); // 1 hour

      jest.advanceTimersByTime(3000000); // 50 minutes

      expect(token.shouldRefresh(600000)).toBe(false); // Always false now
      expect(token.shouldRefresh(300000)).toBe(false); // Always false now
    });

    it('should return false for expired token', () => {
      const token = Token.createWithLifetime('test-token', 3600000); // 1 hour

      jest.advanceTimersByTime(3600001);

      expect(token.shouldRefresh()).toBe(false); // Always false now
    });

    it('should return false with custom current time', () => {
      const token = Token.createWithLifetime('test-token', 3600000); // 1 hour
      const nearExpiry = new Date('2024-01-01T00:56:00Z');

      expect(token.shouldRefresh(300000, nearExpiry)).toBe(false); // Always false now
    });
  });

  describe('extend', () => {
    it('should create new token with extended expiration', () => {
      const token = Token.createWithLifetime('test-token', 3600000); // 1 hour

      const extended = token.extend(1800000); // Add 30 minutes

      expect(extended).not.toBe(token); // New instance
      expect(extended.value).toBe(token.value);
      expect(extended.expiresAt.getTime()).toBe(token.expiresAt.getTime() + 1800000);
    });

    it('should maintain immutability', () => {
      const token = Token.createWithLifetime('test-token', 3600000); // 1 hour
      const originalExpiry = token.expiresAt.getTime();

      token.extend(1800000);

      expect(token.expiresAt.getTime()).toBe(originalExpiry); // Unchanged
    });
  });

  describe('toString', () => {
    it('should mask token value', () => {
      const token = new Token('super-secret-token-value', new Date('2024-01-01T01:00:00Z'));

      expect(token.toString()).toBe('Token[****alue]');
    });

    it('should handle short tokens', () => {
      const token = new Token('abc', new Date('2024-01-01T01:00:00Z'));

      expect(token.toString()).toBe('Token[****abc]');
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      const expiresAt = new Date('2024-01-01T01:00:00Z');
      const token = new Token('test-token-value', expiresAt);

      const json = token.toJSON();

      expect(json).toEqual({
        value: 'test-token-value',
        expiresAt: '2024-01-01T01:00:00.000Z',
      });
    });
    
    it('should serialize null expiresAt', () => {
      const token = new Token('test-token-value', null);

      const json = token.toJSON();

      expect(json).toEqual({
        value: 'test-token-value',
        expiresAt: null,
      });
    });
  });

  describe('fromJSON', () => {
    it('should deserialize from JSON', () => {
      const json = {
        value: 'test-token-value',
        expiresAt: '2024-01-01T01:00:00.000Z',
      };

      const token = Token.fromJSON(json);

      expect(token).toBeInstanceOf(Token);
      expect(token.value).toBe('test-token-value');
      expect(token.expiresAt).toEqual(new Date('2024-01-01T01:00:00.000Z'));
    });

    it('should handle date string conversion', () => {
      const json = {
        value: 'test-token',
        expiresAt: '2024-01-01T01:00:00.000Z',
      };

      const token = Token.fromJSON(json);

      expect(token.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe('createWithLifetime', () => {
    it('should create token with lifetime', () => {
      const token = Token.createWithLifetime('test-token', 3600000); // 1 hour

      expect(token.value).toBe('test-token');
      expect(token.expiresAt.getTime()).toBe(Date.now() + 3600000);
    });

    it('should handle zero lifetime', () => {
      const token = Token.createWithLifetime('test-token', 0);
      expect(token.value).toBe('test-token');
      // Token can be created with zero lifetime since AI service handles validation
    });

    it('should handle negative lifetime', () => {
      const token = Token.createWithLifetime('test-token', -1000);
      expect(token.value).toBe('test-token');
      // Token can be created with negative lifetime since AI service handles validation
    });
  });

  describe('immutability', () => {
    it('should not be affected by JSON modifications', () => {
      const token = Token.createWithLifetime('test-token', 3600000);
      const json = token.toJSON();

      // Modify JSON
      json.value = 'modified';
      json.expiresAt = '2025-01-01T00:00:00.000Z';

      // Original token unchanged
      expect(token.value).toBe('test-token');
      expect(token.expiresAt.getTime()).toBeLessThan(new Date('2025-01-01').getTime());
    });

    it('should share date reference (current implementation)', () => {
      const expiresAt = new Date('2024-01-01T01:00:00Z');
      const token = new Token('test-token', expiresAt);

      // Modify original date - this WILL affect the token
      expiresAt.setFullYear(2025);

      // Token date is changed because it shares the reference
      expect(token.expiresAt.getFullYear()).toBe(2025);

      // Note: This is the current behavior. Consider making defensive copies
      // in the constructor if true immutability is desired
    });
  });
});
