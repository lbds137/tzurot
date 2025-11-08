import { describe, it, expect } from 'vitest';
import {
  countTextTokens,
  estimateImageTokens,
  estimateAudioTokens,
  estimateMessageTokens,
  calculateMessagesFitInBudget,
  TOKEN_ESTIMATES,
} from './tokenCounter.js';

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
      const longText = 'This is a longer piece of text that should result in more tokens being counted.';
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

  describe('estimateImageTokens', () => {
    it('should estimate tokens for single image', () => {
      const tokens = estimateImageTokens(1);
      expect(tokens).toBe(TOKEN_ESTIMATES.IMAGE);
    });

    it('should estimate tokens for multiple images', () => {
      const tokens = estimateImageTokens(5);
      expect(tokens).toBe(TOKEN_ESTIMATES.IMAGE * 5);
    });

    it('should default to 1 image if no count provided', () => {
      const tokens = estimateImageTokens();
      expect(tokens).toBe(TOKEN_ESTIMATES.IMAGE);
    });

    it('should handle 0 images', () => {
      const tokens = estimateImageTokens(0);
      expect(tokens).toBe(0);
    });
  });

  describe('estimateAudioTokens', () => {
    it('should estimate tokens for 1 second of audio', () => {
      const tokens = estimateAudioTokens(1);
      expect(tokens).toBe(TOKEN_ESTIMATES.AUDIO_PER_SECOND);
    });

    it('should estimate tokens for 3 minute voice message', () => {
      const seconds = 3 * 60; // 180 seconds
      const tokens = estimateAudioTokens(seconds);

      // 180 * 32 = 5,760 tokens
      expect(tokens).toBe(5760);
    });

    it('should handle fractional seconds', () => {
      const tokens = estimateAudioTokens(1.5);

      // 1.5 * 32 = 48 tokens
      expect(tokens).toBe(48);
    });

    it('should handle 0 duration', () => {
      const tokens = estimateAudioTokens(0);
      expect(tokens).toBe(0);
    });
  });

  describe('estimateMessageTokens', () => {
    it('should count tokens for text-only message', () => {
      const tokens = estimateMessageTokens({
        text: 'Hello world',
      });

      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10);
    });

    it('should estimate tokens for image-only message', () => {
      const tokens = estimateMessageTokens({
        imageCount: 2,
      });

      expect(tokens).toBe(TOKEN_ESTIMATES.IMAGE * 2);
    });

    it('should estimate tokens for audio-only message', () => {
      const tokens = estimateMessageTokens({
        audioDurationSeconds: 60,
      });

      // 60 * 32 = 1,920 tokens
      expect(tokens).toBe(1920);
    });

    it('should sum tokens for mixed content', () => {
      const tokens = estimateMessageTokens({
        text: 'Check out these images',
        imageCount: 3,
        audioDurationSeconds: 30,
      });

      // Text (~5 tokens) + Images (3,000 tokens) + Audio (960 tokens) ≈ 3,965 tokens
      expect(tokens).toBeGreaterThan(3900);
      expect(tokens).toBeLessThan(4000);
    });

    it('should handle empty message', () => {
      const tokens = estimateMessageTokens({});
      expect(tokens).toBe(0);
    });

    it('should handle typical 2k char message', () => {
      // Generate ~2000 char string
      const text = 'A'.repeat(2000);
      const tokens = estimateMessageTokens({ text });

      // Repeated chars compress well in tokenization, ~250 tokens is expected
      expect(tokens).toBeGreaterThan(200);
      expect(tokens).toBeLessThan(300);
    });

    it('should handle heavy multimedia message (Gemini example)', () => {
      // 3-minute voice + 10 images + some text
      const tokens = estimateMessageTokens({
        text: 'Check this out',
        imageCount: 10,
        audioDurationSeconds: 180,
      });

      // Text (~3 tokens) + Images (10,000) + Audio (5,760) ≈ 15,763 tokens
      expect(tokens).toBeGreaterThan(15700);
      expect(tokens).toBeLessThan(15800);
    });
  });

  describe('calculateMessagesFitInBudget', () => {
    it('should fit all messages under budget', () => {
      const messages = [
        { tokenCount: 100 },
        { tokenCount: 200 },
        { tokenCount: 300 },
      ];

      const count = calculateMessagesFitInBudget(messages, 1000);
      expect(count).toBe(3); // All 3 messages fit (total: 600 tokens)
    });

    it('should limit messages when budget exceeded', () => {
      const messages = [
        { tokenCount: 100 },
        { tokenCount: 200 },
        { tokenCount: 300 },
      ];

      const count = calculateMessagesFitInBudget(messages, 400);
      expect(count).toBe(1); // Only newest message fits (300 tokens), adding 200 would exceed
    });

    it('should work backwards from newest message', () => {
      const messages = [
        { tokenCount: 1000 }, // Oldest
        { tokenCount: 500 },
        { tokenCount: 300 }, // Newest
      ];

      const count = calculateMessagesFitInBudget(messages, 700);
      expect(count).toBe(1); // 300 fits, adding 500 would be 800 > 700, so just newest
    });

    it('should return 0 if first message exceeds budget', () => {
      const messages = [
        { tokenCount: 1000 },
      ];

      const count = calculateMessagesFitInBudget(messages, 500);
      expect(count).toBe(0);
    });

    it('should handle empty message array', () => {
      const count = calculateMessagesFitInBudget([], 1000);
      expect(count).toBe(0);
    });

    it('should handle exact budget match', () => {
      const messages = [
        { tokenCount: 100 },
        { tokenCount: 200 },
        { tokenCount: 300 },
      ];

      const count = calculateMessagesFitInBudget(messages, 600);
      expect(count).toBe(3); // Exactly fits
    });

    it('should handle typical scenario: 30 messages at ~500 tokens each', () => {
      // Simulate 30 messages averaging 500 tokens
      const messages = Array.from({ length: 30 }, () => ({ tokenCount: 500 }));

      // With 128k budget, should fit all 30 (15,000 tokens total)
      const count = calculateMessagesFitInBudget(messages, 131072);
      expect(count).toBe(30);
    });

    it('should handle multimedia heavy messages', () => {
      const messages = [
        { tokenCount: 500 },    // Text message
        { tokenCount: 16000 },  // Heavy multimedia (voice + images + refs)
        { tokenCount: 500 },    // Text message
        { tokenCount: 16000 },  // Heavy multimedia
      ];

      // With 128k budget, should fit all 4 (33,000 tokens total)
      const count = calculateMessagesFitInBudget(messages, 131072);
      expect(count).toBe(4);

      // With 20k budget, should fit newest heavy message + 1 text (16,500 tokens)
      const limitedCount = calculateMessagesFitInBudget(messages, 20000);
      expect(limitedCount).toBe(2);
    });
  });

  describe('TOKEN_ESTIMATES constants', () => {
    it('should have reasonable image estimate', () => {
      expect(TOKEN_ESTIMATES.IMAGE).toBe(1000);
    });

    it('should have audio rate from research', () => {
      expect(TOKEN_ESTIMATES.AUDIO_PER_SECOND).toBe(32);
    });

    it('should have chars per token estimate', () => {
      expect(TOKEN_ESTIMATES.CHARS_PER_TOKEN).toBe(4);
    });
  });
});
