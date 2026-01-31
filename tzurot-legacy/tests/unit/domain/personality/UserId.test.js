/**
 * @jest-environment node
 * @testType domain
 *
 * UserId Value Object Test
 * - Pure domain test with no external dependencies
 * - Tests Discord ID validation logic
 * - No mocking needed (testing the actual implementation)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain model under test - NOT mocked!
const { UserId } = require('../../../../src/domain/personality/UserId');

describe('UserId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // No console mocking needed for pure domain tests
  });

  describe('constructor', () => {
    it('should create valid UserId with Discord snowflake', () => {
      const id = new UserId('123456789012345678');

      expect(id.value).toBe('123456789012345678');
      expect(id.toString()).toBe('123456789012345678');
    });

    it('should reject whitespace around ID', () => {
      // The implementation doesn't trim, it just validates
      expect(() => new UserId('  123456789012345678  ')).toThrow(
        'UserId must be a valid Discord ID'
      );
    });

    it('should reject empty string', () => {
      expect(() => new UserId('')).toThrow('UserId must be a non-empty string');
    });

    it('should reject null', () => {
      expect(() => new UserId(null)).toThrow('UserId must be a non-empty string');
    });

    it('should reject undefined', () => {
      expect(() => new UserId(undefined)).toThrow('UserId must be a non-empty string');
    });

    it('should reject non-string values', () => {
      expect(() => new UserId(123456789012345)).toThrow('UserId must be a non-empty string');
      expect(() => new UserId({})).toThrow('UserId must be a non-empty string');
      expect(() => new UserId([])).toThrow('UserId must be a non-empty string');
    });
  });

  describe('Discord snowflake validation', () => {
    it('should accept valid Discord snowflakes', () => {
      // Valid Discord user IDs (18-19 digits)
      expect(() => new UserId('123456789012345678')).not.toThrow();
      expect(() => new UserId('1234567890123456789')).not.toThrow();
    });

    it('should reject IDs with non-numeric characters', () => {
      expect(() => new UserId('12345abc9012345678')).toThrow('UserId must be a valid Discord ID');
      expect(() => new UserId('user-123456789012')).toThrow('UserId must be a valid Discord ID');
      expect(() => new UserId('123456789012345678!')).toThrow('UserId must be a valid Discord ID');
    });

    it('should accept IDs of any numeric length', () => {
      // The implementation doesn't enforce length limits
      expect(() => new UserId('12345')).not.toThrow();
      expect(() => new UserId('1234567890123456')).not.toThrow();
    });

    it('should accept long numeric IDs', () => {
      // The implementation doesn't enforce length limits
      expect(() => new UserId('12345678901234567890')).not.toThrow();
      expect(() => new UserId('123456789012345678901')).not.toThrow();
    });

    it('should accept boundary lengths', () => {
      // 17 digits (minimum valid Discord snowflake)
      expect(() => new UserId('12345678901234567')).not.toThrow();
      // 19 digits (maximum valid Discord snowflake)
      expect(() => new UserId('1234567890123456789')).not.toThrow();
    });
  });

  describe('toJSON', () => {
    it('should return string value', () => {
      const id = new UserId('123456789012345678');

      expect(id.toJSON()).toBe('123456789012345678');
    });
  });

  describe('fromString', () => {
    it('should create UserId from string', () => {
      const id = UserId.fromString('123456789012345678');

      expect(id).toBeInstanceOf(UserId);
      expect(id.value).toBe('123456789012345678');
    });

    it('should apply same validation rules', () => {
      expect(() => UserId.fromString('')).toThrow('UserId must be a non-empty string');
      expect(() => UserId.fromString('invalid')).toThrow('UserId must be a valid Discord ID');
      expect(() => UserId.fromString('12345')).not.toThrow(); // No length validation
    });
  });

  describe('value object equality', () => {
    it('should be equal for same values', () => {
      const id1 = new UserId('123456789012345678');
      const id2 = new UserId('123456789012345678');

      expect(id1.equals(id2)).toBe(true);
    });

    it('should not be equal for different values', () => {
      const id1 = new UserId('123456789012345678');
      const id2 = new UserId('987654321098765432');

      expect(id1.equals(id2)).toBe(false);
    });

    it('should handle null/undefined gracefully', () => {
      const id = new UserId('123456789012345678');

      expect(id.equals(null)).toBe(false);
      expect(id.equals(undefined)).toBe(false);
    });

    it('should handle non-UserId objects', () => {
      const id = new UserId('123456789012345678');

      expect(id.equals({ value: '123456789012345678' })).toBe(false);
      expect(id.equals('123456789012345678')).toBe(false);
    });
  });

  describe('real-world Discord IDs', () => {
    it('should accept real Discord bot IDs', () => {
      // Some known bot IDs for testing
      expect(() => new UserId('282859044593598464')).not.toThrow(); // ProBot
      expect(() => new UserId('204255221017214977')).not.toThrow(); // MEE6
      expect(() => new UserId('155149108183695360')).not.toThrow(); // Dyno
    });

    it('should accept early Discord user IDs', () => {
      // Early Discord accounts have shorter IDs (17 digits)
      expect(() => new UserId('80351110224678912')).not.toThrow();
    });

    it('should accept recent Discord user IDs', () => {
      // Recent Discord accounts have longer IDs (19 digits)
      expect(() => new UserId('1184870070087680041')).not.toThrow();
    });
  });
});
