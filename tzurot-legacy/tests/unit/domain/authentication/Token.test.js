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
