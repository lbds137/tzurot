/**
 * @jest-environment node
 * @testType domain
 *
 * AIRequestId Value Object Test
 * - Pure domain test with no external dependencies
 * - Tests ID generation and validation
 * - Uses fake timers for consistent ID generation
 * - No mocking needed (testing the actual implementation)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain model under test - NOT mocked!
const { AIRequestId } = require('../../../../src/domain/ai/AIRequestId');

describe('AIRequestId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should generate new ID if not provided', () => {
      const id = new AIRequestId();

      expect(id.value).toMatch(/^air_\d+_[a-z0-9]+$/);
    });

    it('should use provided value', () => {
      const id = new AIRequestId('air_12345_custom');

      expect(id.value).toBe('air_12345_custom');
    });

    it('should validate value is string', () => {
      expect(() => new AIRequestId(123)).toThrow('AIRequestId must be a string');
    });
  });

  describe('generateId', () => {
    it('should generate unique IDs', () => {
      const id1 = new AIRequestId();

      // Advance time slightly
      jest.advanceTimersByTime(1);

      const id2 = new AIRequestId();

      expect(id1.value).not.toBe(id2.value);
    });

    it('should generate IDs with correct format', () => {
      const id = new AIRequestId();

      const parts = id.value.split('_');
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe('air');
      expect(parts[1]).toMatch(/^\d+$/);
      expect(parts[2]).toMatch(/^[a-z0-9]+$/);
    });
  });

  describe('toString', () => {
    it('should return the value', () => {
      const id = new AIRequestId('air_test_123');

      expect(id.toString()).toBe('air_test_123');
    });
  });

  describe('toJSON', () => {
    it('should return the value', () => {
      const id = new AIRequestId('air_test_123');

      expect(id.toJSON()).toBe('air_test_123');
    });
  });

  describe('create', () => {
    it('should create new ID', () => {
      const id = AIRequestId.create();

      expect(id).toBeInstanceOf(AIRequestId);
      expect(id.value).toMatch(/^air_\d+_[a-z0-9]+$/);
    });
  });

  describe('fromString', () => {
    it('should create ID from string', () => {
      const id = AIRequestId.fromString('air_test_123');

      expect(id).toBeInstanceOf(AIRequestId);
      expect(id.value).toBe('air_test_123');
    });
  });

  describe('equals', () => {
    it('should compare IDs by value', () => {
      const id1 = new AIRequestId('air_test_123');
      const id2 = new AIRequestId('air_test_123');
      const id3 = new AIRequestId('air_test_456');

      expect(id1.equals(id2)).toBe(true);
      expect(id1.equals(id3)).toBe(false);
    });

    it('should handle null comparison', () => {
      const id = new AIRequestId('air_test_123');

      expect(id.equals(null)).toBe(false);
    });

    it('should handle different type comparison', () => {
      const id = new AIRequestId('air_test_123');

      expect(id.equals('air_test_123')).toBe(false);
    });
  });

  describe('immutability', () => {
    it('should not allow value modification', () => {
      const id = new AIRequestId('air_test_123');

      expect(() => {
        id.value = 'air_test_456';
      }).toThrow();
    });
  });
});
