/**
 * Tests for conversation history utilities
 *
 * These utilities extract messages from conversation history for duplicate detection.
 */

import { describe, expect, it } from 'vitest';
import { getLastAssistantMessage, getRecentAssistantMessages } from './conversationHistoryUtils.js';

describe('getLastAssistantMessage', () => {
  it('should return undefined for empty history', () => {
    expect(getLastAssistantMessage([])).toBeUndefined();
    expect(getLastAssistantMessage(undefined)).toBeUndefined();
  });

  it('should return the last assistant message', () => {
    const history = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'First response' },
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Second response' },
    ];
    expect(getLastAssistantMessage(history)).toBe('Second response');
  });

  it('should return undefined if no assistant messages exist', () => {
    const history = [
      { role: 'user', content: 'Hello' },
      { role: 'user', content: 'Anyone there?' },
    ];
    expect(getLastAssistantMessage(history)).toBeUndefined();
  });

  it('should handle history ending with user message', () => {
    const history = [
      { role: 'assistant', content: 'First response' },
      { role: 'user', content: 'Last message from user' },
    ];
    expect(getLastAssistantMessage(history)).toBe('First response');
  });

  it('should handle case-insensitive role matching for legacy data', () => {
    const history = [
      { role: 'User', content: 'Hello' },
      { role: 'Assistant', content: 'Legacy format response' },
      { role: 'user', content: 'Modern format' },
    ];
    expect(getLastAssistantMessage(history)).toBe('Legacy format response');
  });
});

describe('getRecentAssistantMessages', () => {
  it('should return empty array for empty history', () => {
    expect(getRecentAssistantMessages([])).toEqual([]);
    expect(getRecentAssistantMessages(undefined)).toEqual([]);
  });

  it('should return assistant messages in reverse order (most recent first)', () => {
    const history = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'First response' },
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Second response' },
      { role: 'user', content: 'Follow-up' },
      { role: 'assistant', content: 'Third response' },
    ];
    expect(getRecentAssistantMessages(history)).toEqual([
      'Third response',
      'Second response',
      'First response',
    ]);
  });

  it('should return empty array if no assistant messages exist', () => {
    const history = [
      { role: 'user', content: 'Hello' },
      { role: 'user', content: 'Anyone there?' },
    ];
    expect(getRecentAssistantMessages(history)).toEqual([]);
  });

  it('should respect maxMessages parameter', () => {
    const history = [
      { role: 'assistant', content: 'Message 1' },
      { role: 'user', content: 'User' },
      { role: 'assistant', content: 'Message 2' },
      { role: 'user', content: 'User' },
      { role: 'assistant', content: 'Message 3' },
      { role: 'user', content: 'User' },
      { role: 'assistant', content: 'Message 4' },
      { role: 'user', content: 'User' },
      { role: 'assistant', content: 'Message 5' },
      { role: 'user', content: 'User' },
      { role: 'assistant', content: 'Message 6' },
    ];
    // Default is 5
    expect(getRecentAssistantMessages(history)).toEqual([
      'Message 6',
      'Message 5',
      'Message 4',
      'Message 3',
      'Message 2',
    ]);
    // Custom limit
    expect(getRecentAssistantMessages(history, 2)).toEqual(['Message 6', 'Message 5']);
  });

  it('should handle history ending with user message', () => {
    const history = [
      { role: 'assistant', content: 'First response' },
      { role: 'user', content: 'Last message from user' },
    ];
    expect(getRecentAssistantMessages(history)).toEqual(['First response']);
  });

  describe('case-insensitive role matching (legacy data)', () => {
    it('should match uppercase "ASSISTANT" role', () => {
      const history = [
        { role: 'user', content: 'Hello' },
        { role: 'ASSISTANT', content: 'Uppercase response' },
      ];
      const messages = getRecentAssistantMessages(history);
      expect(messages).toEqual(['Uppercase response']);
    });

    it('should match mixed-case "Assistant" role', () => {
      const history = [
        { role: 'User', content: 'Hello' },
        { role: 'Assistant', content: 'Mixed case response' },
      ];
      const messages = getRecentAssistantMessages(history);
      expect(messages).toEqual(['Mixed case response']);
    });

    it('should NOT match if role has extra whitespace', () => {
      const history = [
        { role: 'user', content: 'Hello' },
        { role: ' assistant', content: 'Whitespace in role' },
      ];
      const messages = getRecentAssistantMessages(history);
      expect(messages).toEqual([]);
    });
  });

  describe('scan depth limiting', () => {
    it('should bound scan depth to prevent O(n) scans of large histories', () => {
      // Create a history where assistant messages are beyond the MAX_SCAN_DEPTH (100)
      const history: { role: string; content: string }[] = [];

      // Add old assistant messages at the start (beyond scan depth)
      for (let i = 1; i <= 5; i++) {
        history.push({ role: 'assistant', content: `Old assistant ${i}` });
        history.push({ role: 'user', content: `Old user ${i}` });
      }

      // Add 95 more user-only messages to push assistant messages beyond scan depth
      for (let i = 1; i <= 95; i++) {
        history.push({ role: 'user', content: `Filler user message ${i}` });
      }

      // Add 1 recent assistant message within scan depth
      history.push({ role: 'assistant', content: 'Recent assistant' });
      history.push({ role: 'user', content: 'Latest user message' });

      const messages = getRecentAssistantMessages(history);

      // Should find the recent assistant message
      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(messages[0]).toBe('Recent assistant');
    });

    it('should complete quickly even with huge histories', () => {
      // Create a history with 10,000 user messages and one assistant at the end
      const hugeHistory: { role: string; content: string }[] = [];
      for (let i = 0; i < 10000; i++) {
        hugeHistory.push({ role: 'user', content: `User message ${i}` });
      }
      hugeHistory.push({ role: 'assistant', content: 'Final assistant' });

      const startTime = Date.now();
      const messages = getRecentAssistantMessages(hugeHistory);
      const elapsed = Date.now() - startTime;

      // Should find the assistant message and complete in reasonable time (< 100ms)
      expect(messages).toEqual(['Final assistant']);
      expect(elapsed).toBeLessThan(100);
    });

    it('should not find assistant messages beyond scan depth', () => {
      // Create history where only assistant messages exist beyond MAX_SCAN_DEPTH
      const history: { role: string; content: string }[] = [];

      // Add assistant messages at the start
      for (let i = 1; i <= 5; i++) {
        history.push({ role: 'assistant', content: `Very old assistant ${i}` });
      }

      // Add 150 user messages to push assistant messages way beyond scan depth (100)
      for (let i = 1; i <= 150; i++) {
        history.push({ role: 'user', content: `User message ${i}` });
      }

      const messages = getRecentAssistantMessages(history);

      // Should find no assistant messages since they're all beyond scan depth
      expect(messages).toEqual([]);
    });
  });
});
