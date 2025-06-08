/**
 * @jest-environment node
 */

const { Alias } = require('../../../../src/domain/personality/Alias');

describe('Alias', () => {
  describe('constructor', () => {
    it('should create valid alias', () => {
      const alias = new Alias('Claude');
      
      expect(alias.value).toBe('claude'); // Stored in lowercase
      expect(alias.originalValue).toBe('Claude'); // Original preserved
      expect(alias.toString()).toBe('claude');
    });
    
    it('should preserve original case', () => {
      const alias = new Alias('ClAuDe-3-OpUs');
      
      expect(alias.value).toBe('claude-3-opus');
      expect(alias.getOriginal()).toBe('ClAuDe-3-OpUs');
    });
    
    it('should reject empty string', () => {
      expect(() => new Alias('')).toThrow('Alias must be a non-empty string');
    });
    
    it('should reject null', () => {
      expect(() => new Alias(null)).toThrow('Alias must be a non-empty string');
    });
    
    it('should reject undefined', () => {
      expect(() => new Alias(undefined)).toThrow('Alias must be a non-empty string');
    });
    
    it('should reject non-string values', () => {
      expect(() => new Alias(123)).toThrow('Alias must be a non-empty string');
      expect(() => new Alias({})).toThrow('Alias must be a non-empty string');
      expect(() => new Alias([])).toThrow('Alias must be a non-empty string');
    });
  });
  
  describe('length validation', () => {
    it('should accept single character alias', () => {
      const alias = new Alias('A');
      expect(alias.value).toBe('a');
    });
    
    it('should accept 50 character alias', () => {
      const fiftyChars = 'a'.repeat(50);
      const alias = new Alias(fiftyChars);
      expect(alias.value).toBe(fiftyChars);
    });
    
    it('should reject alias longer than 50 characters', () => {
      const tooLong = 'a'.repeat(51);
      expect(() => new Alias(tooLong)).toThrow('Alias must be between 1 and 50 characters');
    });
  });
  
  describe('whitespace handling', () => {
    it('should reject leading spaces', () => {
      expect(() => new Alias('  Claude')).toThrow('Alias cannot have leading or trailing spaces');
    });
    
    it('should reject trailing spaces', () => {
      expect(() => new Alias('Claude  ')).toThrow('Alias cannot have leading or trailing spaces');
    });
    
    it('should reject both leading and trailing spaces', () => {
      expect(() => new Alias('  Claude  ')).toThrow('Alias cannot have leading or trailing spaces');
    });
    
    it('should accept spaces within the alias', () => {
      const alias = new Alias('Claude 3 Opus');
      expect(alias.value).toBe('claude 3 opus');
      expect(alias.originalValue).toBe('Claude 3 Opus');
    });
    
    it('should reject whitespace-only string', () => {
      // Whitespace gets trimmed to empty string, triggering length validation
      expect(() => new Alias('   ')).toThrow('Alias must be between 1 and 50 characters');
    });
  });
  
  describe('case handling', () => {
    it('should store lowercase for matching', () => {
      const alias = new Alias('CLAUDE');
      expect(alias.value).toBe('claude');
    });
    
    it('should preserve original case', () => {
      const alias = new Alias('Claude-3-Opus');
      expect(alias.getOriginal()).toBe('Claude-3-Opus');
    });
    
    it('should handle mixed case', () => {
      const alias = new Alias('cLaUdE');
      expect(alias.value).toBe('claude');
      expect(alias.originalValue).toBe('cLaUdE');
    });
  });
  
  describe('toJSON', () => {
    it('should serialize to JSON with both values', () => {
      const alias = new Alias('Claude-3');
      
      expect(alias.toJSON()).toEqual({
        value: 'claude-3',
        original: 'Claude-3',
      });
    });
    
    it('should serialize correctly when original is all lowercase', () => {
      const alias = new Alias('claude');
      
      expect(alias.toJSON()).toEqual({
        value: 'claude',
        original: 'claude',
      });
    });
  });
  
  describe('fromString', () => {
    it('should create Alias from string', () => {
      const alias = Alias.fromString('Claude');
      
      expect(alias).toBeInstanceOf(Alias);
      expect(alias.value).toBe('claude');
      expect(alias.originalValue).toBe('Claude');
    });
    
    it('should apply same validation rules', () => {
      expect(() => Alias.fromString('')).toThrow();
      expect(() => Alias.fromString('  spaced  ')).toThrow();
      expect(() => Alias.fromString('a'.repeat(51))).toThrow();
    });
  });
  
  describe('value object equality', () => {
    it('should be equal for same value regardless of case', () => {
      const alias1 = new Alias('Claude');
      const alias2 = new Alias('CLAUDE');
      
      expect(alias1.equals(alias2)).toBe(true);
    });
    
    it('should not be equal for different values', () => {
      const alias1 = new Alias('Claude');
      const alias2 = new Alias('GPT');
      
      expect(alias1.equals(alias2)).toBe(false);
    });
    
    it('should handle null/undefined gracefully', () => {
      const alias = new Alias('Claude');
      
      expect(alias.equals(null)).toBe(false);
      expect(alias.equals(undefined)).toBe(false);
    });
    
    it('should handle non-Alias objects', () => {
      const alias = new Alias('Claude');
      
      expect(alias.equals({ value: 'claude' })).toBe(false);
      expect(alias.equals('claude')).toBe(false);
    });
  });
  
  describe('real-world aliases', () => {
    it('should accept common personality aliases', () => {
      const aliases = [
        'gpt',
        'claude',
        'assistant',
        'AI',
        'helper',
        'Claude-3-Opus',
        'gpt-4',
        'claude_3_opus',
        'my assistant',
        'test bot',
      ];
      
      aliases.forEach(aliasStr => {
        expect(() => new Alias(aliasStr)).not.toThrow();
      });
    });
    
    it('should handle emoji aliases', () => {
      const alias = new Alias('🤖');
      expect(alias.value).toBe('🤖');
      expect(alias.originalValue).toBe('🤖');
    });
    
    it('should handle unicode aliases', () => {
      const alias = new Alias('Clàude');
      expect(alias.value).toBe('clàude');
      expect(alias.originalValue).toBe('Clàude');
    });
  });
});