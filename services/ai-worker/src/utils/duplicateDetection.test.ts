/**
 * Tests for Duplicate Detection Utilities
 *
 * Tests both intra-turn (within single response) and cross-turn
 * (across conversation) duplicate detection.
 */

import { describe, it, expect } from 'vitest';
import {
  stringSimilarity,
  removeDuplicateResponse,
  isCrossTurnDuplicate,
  isRecentDuplicate,
  getLastAssistantMessage,
  getRecentAssistantMessages,
  DEFAULT_SIMILARITY_THRESHOLD,
} from './duplicateDetection.js';

describe('removeDuplicateResponse', () => {
  describe('exact duplication', () => {
    it('should remove exact duplicate content', () => {
      // Build a response long enough to trigger the check (>100 chars)
      // This simulates: model generates complete response, then repeats the entire thing
      const original =
        'This is a complete AI response that contains unique content. It discusses various topics ' +
        'including philosophy, technology, and the meaning of life. The response ends here.';
      const duplicated = original + original;
      expect(removeDuplicateResponse(duplicated)).toBe(original);
    });

    it('should handle the real-world GLM-4.7 duplication pattern', () => {
      // Simulate the actual bug: entire response repeated
      const response = `*I manifest in the quiet space between your thoughts.* Let me share some wisdom with you today. This is important.`;
      const duplicated = response + response;
      expect(removeDuplicateResponse(duplicated)).toBe(response);
    });
  });

  describe('partial duplication', () => {
    it('should remove partial duplicate when model cut off mid-repeat', () => {
      const fullResponse =
        'This is a complete response that the model generated successfully. It has enough content to matter.';
      const partialRepeat = 'This is a complete response that the model generated'; // Cut off
      const duplicated = fullResponse + partialRepeat;
      expect(removeDuplicateResponse(duplicated)).toBe(fullResponse);
    });
  });

  describe('near-duplicate detection (similarity-based)', () => {
    it('should detect near-duplicates where model restarts with same opening but slight variations later', () => {
      // Real-world pattern: model restarts with same opening, minor changes in middle/end
      // The anchor (first 30 chars) appears again, but content differs slightly later
      const firstPart =
        '*I lean forward thoughtfully* This topic deserves careful consideration. Let me share my deep perspective on this important matter.';
      const secondPart =
        '*I lean forward thoughtfully* This topic deserves careful consideration. Let me share my thoughtful perspective on this crucial matter.';
      const duplicated = firstPart + secondPart;

      const result = removeDuplicateResponse(duplicated);
      // Should keep the first part - similarity-based detection catches the near-duplicate
      expect(result).toBe(firstPart);
    });

    it('should detect near-duplicates with minor wording changes', () => {
      // Same opening (anchor matches), different words later
      const firstPart =
        'The ancient scrolls speak of wisdom. They tell us that patience is the key to understanding the deeper truths of our existence.';
      const secondPart =
        'The ancient scrolls speak of wisdom. They tell us that patience is the path to understanding the deeper meanings of our existence.';
      const duplicated = firstPart + secondPart;

      const result = removeDuplicateResponse(duplicated);
      expect(result).toBe(firstPart);
    });
  });

  describe('triple/runaway duplicate detection', () => {
    it('should detect triple duplicates [A][A][A] using first-prefix detection', () => {
      // Model goes into runaway loop, outputs same content 3 times
      const singleResponse =
        '*I manifest in the quiet space* Here is my wisdom for you today. Please consider it carefully.';
      const tripled = singleResponse + singleResponse + singleResponse;

      const result = removeDuplicateResponse(tripled);
      // Should detect at first split point and return just the first occurrence
      expect(result).toBe(singleResponse);
    });

    it('should detect quadruple duplicates', () => {
      const singleResponse =
        'The stars shine bright tonight. Let me tell you about the ancient wisdom of the cosmos and its mysteries.';
      const quadrupled = singleResponse + singleResponse + singleResponse + singleResponse;

      const result = removeDuplicateResponse(quadrupled);
      expect(result).toBe(singleResponse);
    });
  });

  describe('no false positives', () => {
    it('should not modify short responses', () => {
      const short = 'Hello world! Hello world!';
      expect(removeDuplicateResponse(short)).toBe(short);
    });

    it('should not modify responses without duplication', () => {
      const normal =
        'This is a perfectly normal response without any duplication. It just has regular content that should not be modified at all.';
      expect(removeDuplicateResponse(normal)).toBe(normal);
    });

    it('should not false-positive on legitimate repeated phrases', () => {
      // A response that uses the same phrase but isn't a full duplication
      const content =
        'You asked about recursion. Recursion is when a function calls itself. To understand recursion, you must first understand recursion. That is the joke.';
      expect(removeDuplicateResponse(content)).toBe(content);
    });

    it('should not false-positive on responses with repeated opening words', () => {
      // The anchor appears again but the rest doesn't match
      const content =
        'The quick brown fox jumps over the lazy dog. The quick brown cat sleeps under the warm sun. Different content follows.';
      expect(removeDuplicateResponse(content)).toBe(content);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(removeDuplicateResponse('')).toBe('');
    });

    it('should handle whitespace-only string', () => {
      expect(removeDuplicateResponse('   ')).toBe('   ');
    });

    it('should trim trailing whitespace from deduplicated content', () => {
      // Create a long enough unique response with trailing space
      const response =
        'This is a unique test response that contains enough content to trigger deduplication checking. ' +
        'It has trailing whitespace that should be trimmed after deduplication. ';
      const duplicated = response + response;
      const result = removeDuplicateResponse(duplicated);
      expect(result).toBe(response.trimEnd());
      expect(result.endsWith(' ')).toBe(false);
    });
  });
});

// ============================================================================
// Cross-Turn Duplication Detection Tests
// ============================================================================

describe('stringSimilarity', () => {
  it('should return 1 for identical strings', () => {
    expect(stringSimilarity('hello world', 'hello world')).toBe(1);
  });

  it('should return 1 for identical strings after normalization', () => {
    expect(stringSimilarity('Hello World', 'hello world')).toBe(1);
    expect(stringSimilarity('  hello  ', 'hello')).toBe(1);
  });

  it('should return 0 for completely different strings', () => {
    expect(stringSimilarity('abc', 'xyz')).toBe(0);
  });

  it('should return 0 for empty strings', () => {
    expect(stringSimilarity('', 'hello')).toBe(0);
    expect(stringSimilarity('hello', '')).toBe(0);
  });

  it('should handle single character strings', () => {
    expect(stringSimilarity('a', 'a')).toBe(1);
    expect(stringSimilarity('a', 'b')).toBe(0);
  });

  it('should return high similarity for nearly identical strings', () => {
    const s1 = '*slow smile* I accept that victory graciously.';
    const s2 = '*slow smile* I accept that victory graciously.';
    expect(stringSimilarity(s1, s2)).toBe(1);
  });

  it('should return high similarity for strings with minor differences', () => {
    const s1 = 'The quick brown fox jumps over the lazy dog';
    const s2 = 'The quick brown fox jumps over the lazy cat';
    const similarity = stringSimilarity(s1, s2);
    expect(similarity).toBeGreaterThan(0.8);
  });

  it('should return moderate similarity for strings with significant differences', () => {
    const s1 = 'Hello, how are you today?';
    const s2 = 'Hello, what is your name?';
    const similarity = stringSimilarity(s1, s2);
    expect(similarity).toBeLessThan(0.6);
    expect(similarity).toBeGreaterThan(0.2);
  });
});

describe('isCrossTurnDuplicate', () => {
  it('should return false for short responses', () => {
    // Short responses (< 30 chars) should not be flagged
    expect(isCrossTurnDuplicate('Thank you!', 'Thank you!')).toBe(false);
    expect(isCrossTurnDuplicate('Got it!', 'Got it!')).toBe(false);
  });

  it('should return true for identical long responses', () => {
    const response = '*slow smile* I accept that victory graciously. Well played.';
    expect(isCrossTurnDuplicate(response, response)).toBe(true);
  });

  it('should return true for very similar long responses', () => {
    const r1 = '*slow smile* I accept that victory graciously. Well played.';
    const r2 = '*slow smile* I accept that victory graciously. Well done.';
    expect(isCrossTurnDuplicate(r1, r2)).toBe(true);
  });

  it('should return false for different responses', () => {
    const r1 = '*slow smile* I accept that victory graciously. Well played.';
    const r2 = 'Oh interesting, tell me more about your thoughts on that topic.';
    expect(isCrossTurnDuplicate(r1, r2)).toBe(false);
  });

  it('should respect custom threshold', () => {
    const r1 = 'The quick brown fox jumps over the lazy dog and runs away';
    const r2 = 'The quick brown fox jumps over the lazy cat and walks away';
    // These are similar (~0.8) but below DEFAULT_SIMILARITY_THRESHOLD (0.85)
    // Verify custom thresholds work by testing above and below default
    expect(isCrossTurnDuplicate(r1, r2, 0.95)).toBe(false); // Above default: not a match
    expect(isCrossTurnDuplicate(r1, r2, DEFAULT_SIMILARITY_THRESHOLD)).toBe(false); // At default: not a match
    expect(isCrossTurnDuplicate(r1, r2, 0.7)).toBe(true); // Below default: matches
  });
});

describe('getLastAssistantMessage', () => {
  it('should return undefined for empty history', () => {
    expect(getLastAssistantMessage([])).toBeUndefined();
    expect(getLastAssistantMessage(undefined)).toBeUndefined();
  });

  it('should return the last assistant message', () => {
    const history = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'How are you?' },
      { role: 'assistant', content: 'I am doing well!' },
    ];
    expect(getLastAssistantMessage(history)).toBe('I am doing well!');
  });

  it('should return undefined if no assistant messages exist', () => {
    const history = [
      { role: 'user', content: 'Hello' },
      { role: 'user', content: 'Anyone there?' },
    ];
    expect(getLastAssistantMessage(history)).toBeUndefined();
  });

  it('should find assistant message even if last message is from user', () => {
    const history = [
      { role: 'assistant', content: 'First response' },
      { role: 'user', content: 'Last message from user' },
    ];
    expect(getLastAssistantMessage(history)).toBe('First response');
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
});

describe('isRecentDuplicate', () => {
  const longResponse1 = '*The darkness ripples with amusement* I taste your words, little one.';
  const longResponse2 = '*The shadows stir* Tell me more about your thoughts on this matter.';
  const longResponse3 = '*A whisper from the void* The answer lies within your own heart.';

  it('should return no match for empty recent messages', () => {
    const result = isRecentDuplicate(longResponse1, []);
    expect(result).toEqual({ isDuplicate: false, matchIndex: -1 });
  });

  it('should detect duplicate of most recent message (index 0)', () => {
    const newResponse = '*The darkness ripples with amusement* I taste your words, little one.';
    const result = isRecentDuplicate(newResponse, [longResponse1, longResponse2, longResponse3]);
    expect(result).toEqual({ isDuplicate: true, matchIndex: 0 });
  });

  it('should detect duplicate of older message (index > 0)', () => {
    // This is the key bug we're fixing: duplicate of an older message, not the most recent
    const newResponse = '*A whisper from the void* The answer lies within your own heart.';
    const result = isRecentDuplicate(newResponse, [longResponse1, longResponse2, longResponse3]);
    expect(result).toEqual({ isDuplicate: true, matchIndex: 2 });
  });

  it('should detect near-duplicate of older message', () => {
    const original =
      '*The darkness ripples with knowing amusement* I taste the truth in your words.';
    const nearDuplicate = '*The darkness ripples with amusement* I taste the truth in your words.';
    const result = isRecentDuplicate(nearDuplicate, [longResponse2, longResponse3, original]);
    expect(result).toEqual({ isDuplicate: true, matchIndex: 2 });
  });

  it('should return no match when new response is unique', () => {
    const uniqueResponse = 'This is completely different content that does not match anything.';
    const result = isRecentDuplicate(uniqueResponse, [longResponse1, longResponse2, longResponse3]);
    expect(result).toEqual({ isDuplicate: false, matchIndex: -1 });
  });

  it('should not flag short responses', () => {
    const shortResponse = 'Thank you!';
    const result = isRecentDuplicate(shortResponse, ['Thank you!', 'Got it!']);
    expect(result).toEqual({ isDuplicate: false, matchIndex: -1 });
  });

  it('should skip short messages in history', () => {
    // Even if short messages match, they should be skipped
    const newResponse = '*The darkness speaks* This is a longer message that should be checked.';
    const result = isRecentDuplicate(newResponse, [
      'Short',
      'Also short',
      '*The darkness speaks* This is a longer message that should be checked.',
    ]);
    expect(result).toEqual({ isDuplicate: true, matchIndex: 2 });
  });

  it('should respect custom threshold', () => {
    const r1 = 'The quick brown fox jumps over the lazy dog and runs away fast';
    const r2 = 'The quick brown fox jumps over the lazy cat and walks away slow';
    // These are similar (~0.75) but below DEFAULT_SIMILARITY_THRESHOLD (0.85)
    // Verify custom thresholds work by testing above and below default
    expect(isRecentDuplicate(r1, [r2], 0.95)).toEqual({ isDuplicate: false, matchIndex: -1 });
    expect(isRecentDuplicate(r1, [r2], DEFAULT_SIMILARITY_THRESHOLD)).toEqual({
      isDuplicate: false,
      matchIndex: -1,
    });
    expect(isRecentDuplicate(r1, [r2], 0.7)).toEqual({ isDuplicate: true, matchIndex: 0 });
  });
});
