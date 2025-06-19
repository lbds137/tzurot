/**
 * @jest-environment node
 * @testType domain
 *
 * ValueObject Base Class Test
 * - Pure domain test with no external dependencies
 * - Tests base value object functionality and immutability
 * - No mocking needed (testing the actual implementation)
 */

const { dddPresets } = require('../../../__mocks__/ddd');

// Domain model under test - NOT mocked!
const { ValueObject } = require('../../../../src/domain/shared/ValueObject');

// Test implementation of ValueObject
class TestValue extends ValueObject {
  constructor(value) {
    super();
    this.value = value;
    this.freeze(); // Test the immutability
  }

  toJSON() {
    return { value: this.value };
  }
}

// Test implementation without custom toJSON
class DefaultToJSONValue extends ValueObject {
  constructor(name, age) {
    super();
    this.name = name;
    this.age = age;
    this.freeze();
  }
}

// Test implementation with complex constructor
class ComplexConstructorValue extends ValueObject {
  constructor({ name, age, email }) {
    super();
    this.name = name;
    this.age = age;
    this.email = email;
    this.freeze();
  }

  toJSON() {
    return { name: this.name, age: this.age, email: this.email };
  }
}

describe('ValueObject', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('equals', () => {
    it('should return true for equal value objects', () => {
      const value1 = new TestValue('test');
      const value2 = new TestValue('test');

      expect(value1.equals(value2)).toBe(true);
    });

    it('should return false for different value objects', () => {
      const value1 = new TestValue('test1');
      const value2 = new TestValue('test2');

      expect(value1.equals(value2)).toBe(false);
    });

    it('should return false when comparing with null', () => {
      const value = new TestValue('test');

      expect(value.equals(null)).toBe(false);
    });

    it('should return false when comparing with undefined', () => {
      const value = new TestValue('test');

      expect(value.equals(undefined)).toBe(false);
    });

    it('should return false when comparing with different type', () => {
      const value = new TestValue('test');
      const other = { value: 'test' };

      expect(value.equals(other)).toBe(false);
    });

    it('should handle complex nested values', () => {
      class ComplexValue extends ValueObject {
        constructor(data) {
          super();
          this.data = data;
        }
        toJSON() {
          return this.data;
        }
      }

      const value1 = new ComplexValue({ a: 1, b: { c: 2 } });
      const value2 = new ComplexValue({ a: 1, b: { c: 2 } });
      const value3 = new ComplexValue({ a: 1, b: { c: 3 } });

      expect(value1.equals(value2)).toBe(true);
      expect(value1.equals(value3)).toBe(false);
    });
  });

  describe('copyWith', () => {
    it('should create a new instance with updated values', () => {
      class PersonName extends ValueObject {
        constructor({ first, last }) {
          super();
          this.first = first;
          this.last = last;
        }
        toJSON() {
          return { first: this.first, last: this.last };
        }
        copyWith({ first, last }) {
          return new PersonName({
            first: first !== undefined ? first : this.first,
            last: last !== undefined ? last : this.last,
          });
        }
      }

      const name1 = new PersonName({ first: 'John', last: 'Doe' });
      const name2 = name1.copyWith({ first: 'Jane' });

      expect(name2.first).toBe('Jane');
      expect(name2.last).toBe('Doe');
      expect(name1.first).toBe('John'); // Original unchanged
    });
  });

  describe('hashCode', () => {
    it('should return same hash for equal objects', () => {
      const value1 = new TestValue('test');
      const value2 = new TestValue('test');

      expect(value1.hashCode()).toBe(value2.hashCode());
    });

    it('should return different hash for different objects', () => {
      const value1 = new TestValue('test1');
      const value2 = new TestValue('test2');

      expect(value1.hashCode()).not.toBe(value2.hashCode());
    });
  });

  describe('validate', () => {
    it('should be overridable in subclasses', () => {
      class ValidatedValue extends ValueObject {
        constructor(value) {
          super();
          this.value = value;
          this.validate();
          this.freeze();
        }

        validate() {
          if (this.value < 0) {
            throw new Error('Value must be positive');
          }
        }

        toJSON() {
          return { value: this.value };
        }
      }

      expect(() => new ValidatedValue(5)).not.toThrow();
      expect(() => new ValidatedValue(-5)).toThrow('Value must be positive');
    });

    it('should not throw in default implementation', () => {
      const testValue = new TestValue('test');

      expect(() => testValue.validate()).not.toThrow();
    });
  });

  describe('freeze', () => {
    it('should make object immutable', () => {
      const testValue = new TestValue('original');

      // Should be frozen
      expect(Object.isFrozen(testValue)).toBe(true);
    });

    it('should prevent property modification', () => {
      const testValue = new TestValue('original');

      // Attempting to modify should fail silently or throw in strict mode
      const originalValue = testValue.value;
      try {
        testValue.value = 'modified';
      } catch (error) {
        // In strict mode, this might throw
      }

      expect(testValue.value).toBe(originalValue);
    });

    it('should prevent property addition', () => {
      const testValue = new TestValue('test');

      try {
        testValue.newProperty = 'new';
      } catch (error) {
        // In strict mode, this might throw
      }

      expect(testValue.newProperty).toBeUndefined();
    });
  });

  describe('default toJSON', () => {
    it('should use default implementation when not overridden', () => {
      const value = new DefaultToJSONValue('John', 25);

      const json = value.toJSON();

      expect(json).toEqual({
        name: 'John',
        age: 25,
      });
    });

    it('should exclude undefined values', () => {
      const value = new DefaultToJSONValue('John', undefined);

      const json = value.toJSON();

      expect(json).toEqual({
        name: 'John',
      });
      expect(json).not.toHaveProperty('age');
    });
  });

  describe('default copyWith', () => {
    it('should work with simple constructors', () => {
      const original = new ComplexConstructorValue({
        name: 'John',
        age: 25,
        email: 'john@example.com',
      });

      const updated = original.copyWith({ age: 26 });

      expect(updated.name).toBe('John');
      expect(updated.age).toBe(26);
      expect(updated.email).toBe('john@example.com');
      expect(updated).not.toBe(original); // Different instance
    });

    it('should preserve original object', () => {
      const original = new ComplexConstructorValue({
        name: 'John',
        age: 25,
        email: 'john@example.com',
      });
      const originalAge = original.age;

      original.copyWith({ age: 26 });

      expect(original.age).toBe(originalAge); // Original unchanged
    });
  });
});
