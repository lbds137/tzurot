import { describe, it, expect } from 'vitest';
import { countTextTokens, TOKEN_ESTIMATES } from './tokenCounter.js';

describe('tokenCounter', () => {
  describe('countTextTokens', () => {
    it('should count tokens in simple text', () => {
      const text = 'Hello world';
      const tokens = countTextTokens(text);

      // "Hello world" is typically 2-3 tokens
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10);
    });

    it('should return 0 for empty string', () => {
      expect(countTextTokens('')).toBe(0);
    });

    it('should handle longer text', () => {
      const longText =
        'This is a longer piece of text that should result in more tokens being counted.';
      const tokens = countTextTokens(longText);

      // Rough estimate: ~80 chars / 4 = ~20 tokens
      expect(tokens).toBeGreaterThan(10);
      expect(tokens).toBeLessThan(40);
    });

    it('should handle special characters', () => {
      const text = 'Special chars: @#$%^&*()';
      const tokens = countTextTokens(text);

      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle unicode characters', () => {
      const text = 'Unicode: 你好世界 🌍';
      const tokens = countTextTokens(text);

      expect(tokens).toBeGreaterThan(0);
    });

    it('should handle code blocks', () => {
      const code = `function hello() {
  console.log("Hello, world!");
}`;
      const tokens = countTextTokens(code);

      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('TOKEN_ESTIMATES constants', () => {
    it('should have chars per token estimate', () => {
      expect(TOKEN_ESTIMATES.CHARS_PER_TOKEN).toBe(4);
    });
  });
});
