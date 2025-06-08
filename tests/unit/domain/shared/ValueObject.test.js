/**
 * @jest-environment node
 */

const { ValueObject } = require('../../../../src/domain/shared/ValueObject');

// Test implementation of ValueObject
class TestValue extends ValueObject {
  constructor(value) {
    super();
    this.value = value;
  }
  
  toJSON() {
    return { value: this.value };
  }
}

describe('ValueObject', () => {
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
            last: last !== undefined ? last : this.last
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
  });
});