/**
 * @jest-environment node
 * @testType domain
 *
 * PersonalityId Value Object Test
 * - Pure domain test with no external dependencies
 * - Tests business rules and validation logic
 * - No mocking needed (testing the actual implementation)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain model under test - NOT mocked!
const { PersonalityId } = require('../../../../src/domain/personality/PersonalityId');

describe('PersonalityId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // No console mocking needed for pure domain tests
  });

  describe('constructor', () => {
    it('should create valid PersonalityId', () => {
      const id = new PersonalityId('claude-3-opus');

      expect(id.value).toBe('claude-3-opus');
      expect(id.toString()).toBe('claude-3-opus');
    });

    it('should trim whitespace', () => {
      const id = new PersonalityId('  claude-3-opus  ');

      expect(id.value).toBe('claude-3-opus');
    });

    it('should reject empty string', () => {
      expect(() => new PersonalityId('')).toThrow('PersonalityId must be a non-empty string');
    });

    it('should reject null', () => {
      expect(() => new PersonalityId(null)).toThrow('PersonalityId must be a non-empty string');
    });

    it('should reject undefined', () => {
      expect(() => new PersonalityId(undefined)).toThrow(
        'PersonalityId must be a non-empty string'
      );
    });

    it('should reject non-string values', () => {
      expect(() => new PersonalityId(123)).toThrow('PersonalityId must be a non-empty string');
      expect(() => new PersonalityId({})).toThrow('PersonalityId must be a non-empty string');
    });
  });

  describe('length validation', () => {
    it('should reject IDs shorter than 2 characters', () => {
      expect(() => new PersonalityId('a')).toThrow(
        'PersonalityId must be between 2 and 100 characters'
      );
    });

    it('should reject IDs longer than 100 characters', () => {
      const longId = 'a'.repeat(101);
      expect(() => new PersonalityId(longId)).toThrow(
        'PersonalityId must be between 2 and 100 characters'
      );
    });

    it('should accept IDs at boundary lengths', () => {
      expect(() => new PersonalityId('ab')).not.toThrow();
      expect(() => new PersonalityId('a'.repeat(100))).not.toThrow();
    });
  });

  describe('character validation', () => {
    it('should accept alphanumeric characters', () => {
      expect(() => new PersonalityId('claude3opus')).not.toThrow();
      expect(() => new PersonalityId('CLAUDE3OPUS')).not.toThrow();
      expect(() => new PersonalityId('Claude3Opus')).not.toThrow();
    });

    it('should accept spaces', () => {
      expect(() => new PersonalityId('claude 3 opus')).not.toThrow();
    });

    it('should accept hyphens', () => {
      expect(() => new PersonalityId('claude-3-opus')).not.toThrow();
    });

    it('should accept underscores', () => {
      expect(() => new PersonalityId('claude_3_opus')).not.toThrow();
    });

    it('should accept periods', () => {
      expect(() => new PersonalityId('claude.3.opus')).not.toThrow();
    });

    it('should reject special characters', () => {
      expect(() => new PersonalityId('claude@opus')).toThrow(
        'PersonalityId contains invalid characters'
      );
      expect(() => new PersonalityId('claude#3')).toThrow(
        'PersonalityId contains invalid characters'
      );
      expect(() => new PersonalityId('claude$')).toThrow(
        'PersonalityId contains invalid characters'
      );
      expect(() => new PersonalityId('claude!')).toThrow(
        'PersonalityId contains invalid characters'
      );
    });
  });

  describe('reserved names', () => {
    const reservedNames = ['system', 'bot', 'admin', 'owner', 'moderator', 'mod', 'help'];

    reservedNames.forEach(name => {
      it(`should reject reserved name: ${name}`, () => {
        expect(() => new PersonalityId(name)).toThrow(`"${name}" is a reserved personality name`);
      });

      it(`should reject reserved name case-insensitive: ${name.toUpperCase()}`, () => {
        expect(() => new PersonalityId(name.toUpperCase())).toThrow(
          `"${name.toUpperCase()}" is a reserved personality name`
        );
      });
    });

    it('should accept names containing reserved words', () => {
      expect(() => new PersonalityId('my-system')).not.toThrow();
      expect(() => new PersonalityId('botlike')).not.toThrow();
      expect(() => new PersonalityId('administrator')).not.toThrow();
    });
  });

  describe('toJSON', () => {
    it('should return string value', () => {
      const id = new PersonalityId('claude-3-opus');

      expect(id.toJSON()).toBe('claude-3-opus');
    });
  });

  describe('fromString', () => {
    it('should create PersonalityId from string', () => {
      const id = PersonalityId.fromString('claude-3-opus');

      expect(id).toBeInstanceOf(PersonalityId);
      expect(id.value).toBe('claude-3-opus');
    });

    it('should apply same validation rules', () => {
      expect(() => PersonalityId.fromString('')).toThrow();
      expect(() => PersonalityId.fromString('system')).toThrow();
      expect(() => PersonalityId.fromString('a')).toThrow();
    });
  });

  describe('value object equality', () => {
    it('should be equal for same values', () => {
      const id1 = new PersonalityId('claude-3-opus');
      const id2 = new PersonalityId('claude-3-opus');

      expect(id1.equals(id2)).toBe(true);
    });

    it('should not be equal for different values', () => {
      const id1 = new PersonalityId('claude-3-opus');
      const id2 = new PersonalityId('claude-3-sonnet');

      expect(id1.equals(id2)).toBe(false);
    });
  });
});
