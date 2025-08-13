/**
 * Tests for StripMentionsStep
 */

const StripMentionsStep = require('../../../../../src/domain/formatting/steps/StripMentionsStep');

describe('StripMentionsStep', () => {
  let step;
  
  beforeEach(() => {
    step = new StripMentionsStep({
      mentionChar: '@',
      maxAliasWordCount: 5
    });
  });
  
  describe('Single-word mentions', () => {
    test('should strip simple mention at start', () => {
      const result = step.execute('@claude Hello there!', {});
      expect(result).toBe('Hello there!');
    });
    
    test('should strip simple mention in middle', () => {
      const result = step.execute('Hey @claude how are you?', {});
      expect(result).toBe('Hey how are you?');
    });
    
    test('should strip simple mention at end', () => {
      const result = step.execute('Hello there @claude', {});
      expect(result).toBe('Hello there');
    });
    
    test('should strip multiple mentions', () => {
      const result = step.execute('@claude and @gpt4 walk into a bar', {});
      expect(result).toBe('and walk into a bar');
    });
    
    test('should handle mentions with punctuation', () => {
      const result = step.execute('Hey @claude, how are you?', {});
      expect(result).toBe('Hey , how are you?');
    });
    
    test('should handle mentions with hyphens', () => {
      const result = step.execute('@gpt-4 is here', {});
      expect(result).toBe('is here');
    });
  });
  
  describe('Multi-word mentions', () => {
    test('should strip two-word mention', () => {
      const result = step.execute('@cash money Can you help?', {});
      expect(result).toBe('Can you help?');
    });
    
    test('should strip three-word mention', () => {
      const result = step.execute('Hey @angel dust walker what do you think?', {});
      expect(result).toBe('Hey what do you think?');
    });
    
    test('should strip mention with max words', () => {
      const result = step.execute('@this is a very long alias test', {});
      expect(result).toBe('test');
    });
    
    test('should handle multiple multi-word mentions', () => {
      const result = step.execute('@cash money and @angel dust are here', {});
      expect(result).toBe('and are here');
    });
  });
  
  describe('Edge cases', () => {
    test('should handle empty content', () => {
      const result = step.execute('', {});
      expect(result).toBe('');
    });
    
    test('should handle null content', () => {
      const result = step.execute(null, {});
      expect(result).toBe('');
    });
    
    test('should handle undefined content', () => {
      const result = step.execute(undefined, {});
      expect(result).toBe('');
    });
    
    test('should handle content with only mention', () => {
      const result = step.execute('@claude', {});
      expect(result).toBe('');
    });
    
    test('should handle content with only mentions', () => {
      const result = step.execute('@claude @gpt4', {});
      expect(result).toBe('');
    });
    
    test('should not strip email addresses', () => {
      const result = step.execute('Contact user@example.com for help', {});
      expect(result).toBe('Contact user@example.com for help');
    });
    
    test('should clean up resulting whitespace', () => {
      const result = step.execute('  @claude   Hello   @gpt4   world  ', {});
      expect(result).toBe('Hello world');
    });
  });
  
  describe('Custom mention character', () => {
    test('should work with & mention character', () => {
      const customStep = new StripMentionsStep({
        mentionChar: '&',
        maxAliasWordCount: 5
      });
      
      const result = customStep.execute('&claude Hello there!', {});
      expect(result).toBe('Hello there!');
    });
    
    test('should work with ! mention character', () => {
      const customStep = new StripMentionsStep({
        mentionChar: '!',
        maxAliasWordCount: 5
      });
      
      const result = customStep.execute('!bot Please help', {});
      expect(result).toBe('Please help');
    });
  });
  
  describe('getName', () => {
    test('should return correct name', () => {
      expect(step.getName()).toBe('StripMentionsStep');
    });
  });
});