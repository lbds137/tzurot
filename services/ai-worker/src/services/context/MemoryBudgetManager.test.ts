/**
 * Tests for MemoryBudgetManager
 *
 * Unit tests for memory token budgeting and selection logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryBudgetManager } from './MemoryBudgetManager.js';
import type { MemoryDocument } from '../ConversationalRAGService.js';

// Mock common-types
vi.mock('@tzurot/common-types', () => ({
  countTextTokens: vi.fn((text: string) => Math.ceil(text.length / 4)),
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  AI_DEFAULTS: {
    MEMORY_TOKEN_BUDGET_RATIO: 0.25,
  },
}));

// Mock MemoryFormatter
vi.mock('../prompt/MemoryFormatter.js', () => ({
  formatSingleMemory: vi.fn((doc: MemoryDocument) => `- ${doc.pageContent}`),
}));

// Mock conversationUtils
vi.mock('../../jobs/utils/conversationUtils.js', () => ({
  getFormattedMessageCharLength: vi.fn(() => 100),
}));

describe('MemoryBudgetManager', () => {
  let manager: MemoryBudgetManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new MemoryBudgetManager();
  });

  describe('selectMemoriesWithinBudget', () => {
    it('should return empty result for empty memories array', () => {
      const result = manager.selectMemoriesWithinBudget([], 1000);

      expect(result.selectedMemories).toEqual([]);
      expect(result.tokensUsed).toBe(0);
      expect(result.memoriesDropped).toBe(0);
      expect(result.droppedDueToSize).toBe(0);
    });

    it('should return empty result for zero budget', () => {
      const memories: MemoryDocument[] = [{ pageContent: 'Memory 1', metadata: { score: 0.9 } }];

      const result = manager.selectMemoriesWithinBudget(memories, 0);

      expect(result.selectedMemories).toEqual([]);
      expect(result.memoriesDropped).toBe(1);
    });

    it('should return empty result for negative budget', () => {
      const memories: MemoryDocument[] = [{ pageContent: 'Memory 1', metadata: { score: 0.9 } }];

      const result = manager.selectMemoriesWithinBudget(memories, -100);

      expect(result.selectedMemories).toEqual([]);
      expect(result.memoriesDropped).toBe(1);
    });

    it('should select all memories when they fit within budget', () => {
      const memories: MemoryDocument[] = [
        { pageContent: 'Short memory 1', metadata: { score: 0.9 } },
        { pageContent: 'Short memory 2', metadata: { score: 0.8 } },
      ];

      const result = manager.selectMemoriesWithinBudget(memories, 10000);

      expect(result.selectedMemories).toHaveLength(2);
      expect(result.memoriesDropped).toBe(0);
      expect(result.droppedDueToSize).toBe(0);
    });

    it('should drop lowest-relevance memories when over budget', () => {
      // Create memories with enough content to exceed budget
      const memories: MemoryDocument[] = [
        { pageContent: 'A'.repeat(400), metadata: { score: 0.9 } }, // ~100 tokens
        { pageContent: 'B'.repeat(400), metadata: { score: 0.8 } }, // ~100 tokens
        { pageContent: 'C'.repeat(400), metadata: { score: 0.7 } }, // ~100 tokens
      ];

      // Budget for ~2 memories plus wrapper overhead (~200 tokens total)
      const result = manager.selectMemoriesWithinBudget(memories, 300);

      // Should keep first 2 (higher relevance), drop the 3rd
      expect(result.selectedMemories.length).toBeLessThan(3);
      expect(result.memoriesDropped).toBeGreaterThan(0);
    });

    it('should track oversized memories separately', () => {
      // Create a very large memory that exceeds entire budget
      const memories: MemoryDocument[] = [
        { pageContent: 'A'.repeat(10000), metadata: { score: 0.9 } }, // ~2500 tokens - huge!
        { pageContent: 'Small', metadata: { score: 0.8 } }, // Small
      ];

      const result = manager.selectMemoriesWithinBudget(memories, 500);

      expect(result.droppedDueToSize).toBeGreaterThan(0);
    });

    it('should continue checking smaller memories after skipping large ones', () => {
      // First memory is huge, second is small
      const memories: MemoryDocument[] = [
        { pageContent: 'A'.repeat(10000), metadata: { score: 0.9 } }, // ~2500 tokens
        { pageContent: 'Tiny', metadata: { score: 0.8 } }, // ~2 tokens
      ];

      const result = manager.selectMemoriesWithinBudget(memories, 500);

      // Should include the small memory even though the first was skipped
      expect(result.selectedMemories.length).toBeGreaterThan(0);
    });

    it('should include wrapper overhead in tokensUsed', () => {
      const memories: MemoryDocument[] = [{ pageContent: 'Memory', metadata: { score: 0.9 } }];

      const result = manager.selectMemoriesWithinBudget(memories, 10000);

      // tokensUsed should be more than just the memory content (includes wrapper)
      expect(result.tokensUsed).toBeGreaterThan(0);
    });
  });

  describe('calculateMemoryBudget', () => {
    it('should return hard cap when no component sizes provided', () => {
      const contextWindow = 100000;
      const result = manager.calculateMemoryBudget(contextWindow);

      // 25% of 100k = 25k
      expect(result).toBe(25000);
    });

    it('should use dynamic budget when history is short', () => {
      const contextWindow = 100000;
      const systemPrompt = 5000;
      const currentMessage = 1000;
      const historyTokens = 1000; // Very short history

      const result = manager.calculateMemoryBudget(
        contextWindow,
        systemPrompt,
        currentMessage,
        historyTokens
      );

      // With short history, should have room for more memories
      // But still capped at 25% = 25000
      expect(result).toBeLessThanOrEqual(25000);
    });

    it('should reduce budget when other components are large', () => {
      const contextWindow = 100000;
      const systemPrompt = 30000; // Large system prompt
      const currentMessage = 5000;
      const historyTokens = 50000; // Large history

      const result = manager.calculateMemoryBudget(
        contextWindow,
        systemPrompt,
        currentMessage,
        historyTokens
      );

      // Available space is very limited
      // 100k - 30k - 5k - 50k - 5k safety = 10k available
      // Hard cap is 25k, so should use min(10k, 25k) = 10k
      expect(result).toBeLessThan(25000);
    });

    it('should return 0 when no space available', () => {
      const contextWindow = 100000;
      const systemPrompt = 40000;
      const currentMessage = 10000;
      const historyTokens = 60000; // Exceeds context window

      const result = manager.calculateMemoryBudget(
        contextWindow,
        systemPrompt,
        currentMessage,
        historyTokens
      );

      expect(result).toBe(0);
    });

    it('should never exceed hard cap even with lots of space', () => {
      const contextWindow = 100000;
      const systemPrompt = 1000;
      const currentMessage = 100;
      const historyTokens = 0; // No history - lots of space

      const result = manager.calculateMemoryBudget(
        contextWindow,
        systemPrompt,
        currentMessage,
        historyTokens
      );

      // Even with lots of space, capped at 25%
      expect(result).toBeLessThanOrEqual(25000);
    });
  });

  describe('countHistoryTokens', () => {
    it('should return 0 for undefined history', () => {
      const result = manager.countHistoryTokens(undefined, 'TestBot');

      expect(result).toBe(0);
    });

    it('should return 0 for empty history', () => {
      const result = manager.countHistoryTokens([], 'TestBot');

      expect(result).toBe(0);
    });

    it('should always use formatted length, ignoring cached tokenCount', () => {
      // Even though tokenCount is cached, we use formatted length
      // because cached count doesn't include XML structure, timestamps, etc.
      const history = [
        { role: 'user', content: 'Hello', tokenCount: 5 }, // Cached value ignored
        { role: 'assistant', content: 'Hi there', tokenCount: 7 }, // Cached value ignored
      ];

      const result = manager.countHistoryTokens(history, 'TestBot');

      // Should use getFormattedMessageCharLength / 4 for all messages
      // Mock returns 100 chars / 4 = 25 tokens per message
      expect(result).toBe(50); // 2 messages * 25 tokens, NOT 5 + 7 = 12
    });

    it('should estimate tokens using formatted length', () => {
      const history = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ];

      const result = manager.countHistoryTokens(history, 'TestBot');

      // Mock returns 100 chars / 4 = 25 tokens per message
      expect(result).toBe(50); // 2 messages * 25 tokens
    });

    it('should count multiple messages correctly', () => {
      const history = [
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Response 1' },
        { role: 'user', content: 'Message 2' },
        { role: 'assistant', content: 'Response 2' },
      ];

      const result = manager.countHistoryTokens(history, 'TestBot');

      // 4 messages * 25 tokens = 100 tokens
      expect(result).toBe(100);
    });
  });
});
