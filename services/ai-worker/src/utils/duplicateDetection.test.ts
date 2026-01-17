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
  contentHash,
  normalizeForComparison,
  wordJaccardSimilarity,
  buildRetryConfig,
  DEFAULT_SIMILARITY_THRESHOLD,
  NEAR_MISS_THRESHOLD,
  WORD_JACCARD_THRESHOLD,
  RETRY_ATTEMPT_2_TEMPERATURE,
  RETRY_ATTEMPT_2_FREQUENCY_PENALTY,
  RETRY_ATTEMPT_3_HISTORY_REDUCTION,
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

describe('contentHash', () => {
  it('should return consistent hash for identical content', () => {
    const content = 'Hello world, this is a test message.';
    expect(contentHash(content)).toBe(contentHash(content));
  });

  it('should normalize case and whitespace', () => {
    expect(contentHash('Hello World')).toBe(contentHash('hello world'));
    expect(contentHash('  hello  ')).toBe(contentHash('hello'));
  });

  it('should return different hashes for different content', () => {
    expect(contentHash('Hello world')).not.toBe(contentHash('Goodbye world'));
  });

  it('should return 16-character hex string', () => {
    const hash = contentHash('test content');
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });
});

// ============================================================================
// Word-Level Jaccard Similarity Tests (Layer 2)
// ============================================================================

describe('normalizeForComparison', () => {
  it('should lowercase text', () => {
    expect(normalizeForComparison('Hello WORLD')).toBe('hello world');
  });

  it('should remove markdown formatting', () => {
    expect(normalizeForComparison('*bold* and _italic_')).toBe('bold and italic');
    expect(normalizeForComparison('**strong** and __underline__')).toBe('strong and underline');
    expect(normalizeForComparison('~~strikethrough~~')).toBe('strikethrough');
  });

  it('should remove punctuation except apostrophes', () => {
    expect(normalizeForComparison("Hello, world! How's it going?")).toBe(
      "hello world how's it going"
    );
    expect(normalizeForComparison('Test... with... ellipsis!!!')).toBe('test with ellipsis');
  });

  it('should collapse multiple spaces', () => {
    expect(normalizeForComparison('hello    world')).toBe('hello world');
    expect(normalizeForComparison('  leading and trailing  ')).toBe('leading and trailing');
  });

  it('should handle roleplay formatting', () => {
    expect(normalizeForComparison('*sighs* Hello there')).toBe('sighs hello there');
    expect(normalizeForComparison('*I lean forward thoughtfully* This is important.')).toBe(
      'i lean forward thoughtfully this is important'
    );
  });

  it('should handle empty string', () => {
    expect(normalizeForComparison('')).toBe('');
  });
});

describe('wordJaccardSimilarity', () => {
  it('should return 1 for identical strings', () => {
    expect(wordJaccardSimilarity('hello world', 'hello world')).toBe(1);
  });

  it('should return 1 for strings that normalize to the same words', () => {
    expect(wordJaccardSimilarity('Hello World!', 'hello, world')).toBe(1);
    expect(wordJaccardSimilarity('*sighs* Hello', '*sighs* hello!')).toBe(1); // Same words, different formatting
  });

  it('should return 0 for completely different word sets', () => {
    expect(wordJaccardSimilarity('cat dog bird', 'fish snake lizard')).toBe(0);
  });

  it('should return 0 for empty strings', () => {
    expect(wordJaccardSimilarity('', 'hello')).toBe(0);
    expect(wordJaccardSimilarity('hello', '')).toBe(0);
    expect(wordJaccardSimilarity('', '')).toBe(1); // Both empty = identical
  });

  it('should calculate correct Jaccard index', () => {
    // "hello world" vs "hello there" -> intersection={hello}, union={hello,world,there}
    // Jaccard = 1/3 ≈ 0.333
    const similarity = wordJaccardSimilarity('hello world', 'hello there');
    expect(similarity).toBeCloseTo(0.333, 2);
  });

  it('should handle roleplay duplicates with different emotes', () => {
    // Same words, different roleplay emotes
    const r1 = '*I lean forward thoughtfully* This topic deserves careful consideration.';
    const r2 = '*I nod slowly* This topic deserves careful consideration.';
    const similarity = wordJaccardSimilarity(r1, r2);
    // 6 shared words out of 11 unique = ~0.55 Jaccard
    // Below 0.75 threshold, but bigram will catch it
    expect(similarity).toBeGreaterThan(0.5);
    expect(similarity).toBeLessThan(WORD_JACCARD_THRESHOLD);
  });

  it('should show moderate similarity for roleplay duplicates with different flourishes', () => {
    // Same core content, different roleplay flourishes
    // This tests that Jaccard captures SOME similarity, even if below threshold
    const r1 = '*slow smile* I accept that victory graciously. Well played, my dear.';
    const r2 = '*knowing smirk* I accept that victory graciously. Well done, darling.';
    const similarity = wordJaccardSimilarity(r1, r2);
    // These share ~40% of words (6/15), which is below the 0.75 threshold
    // but shows meaningful overlap that bigram detection will catch
    expect(similarity).toBeCloseTo(0.4, 1);
  });

  it('should catch responses with 75%+ word overlap', () => {
    // Same words, just minor punctuation/formatting differences
    // This is the sweet spot for Jaccard detection
    const r1 =
      'The ancient wisdom teaches us that patience and understanding are the keys to true enlightenment.';
    const r2 =
      'The ancient wisdom teaches us that patience and understanding are the keys to true enlightenment!';
    const similarity = wordJaccardSimilarity(r1, r2);
    // Identical words after normalization = 100% Jaccard
    expect(similarity).toBe(1);
  });

  it('should not false-positive on genuinely different responses', () => {
    const r1 = 'The ancient scrolls speak of wisdom and patience.';
    const r2 = 'Technology advances rapidly in the modern world.';
    const similarity = wordJaccardSimilarity(r1, r2);
    expect(similarity).toBeLessThan(0.3);
  });
});

describe('WORD_JACCARD_THRESHOLD', () => {
  it('should be 0.75 (75%)', () => {
    expect(WORD_JACCARD_THRESHOLD).toBe(0.75);
  });

  it('should be lower than DEFAULT_SIMILARITY_THRESHOLD', () => {
    expect(WORD_JACCARD_THRESHOLD).toBeLessThan(DEFAULT_SIMILARITY_THRESHOLD);
  });
});

describe('isRecentDuplicate with word_jaccard detection', () => {
  it('should detect duplicates where words are identical but punctuation differs', () => {
    // Same words, only punctuation/formatting differences
    // This is the prime use case for Jaccard - catches cache hits with minor formatting changes
    const original =
      'The moonlight illuminates the ancient temple, casting long shadows across the marble floor.';
    const duplicate =
      'The moonlight illuminates the ancient temple, casting long shadows across the marble floor!';

    const result = isRecentDuplicate(duplicate, [original]);
    expect(result.isDuplicate).toBe(true);
  });

  it('should detect duplicates with capitalization differences', () => {
    // Same words, different capitalization (which might affect bigram)
    const original =
      'Sometimes we must look within ourselves to find the answers we seek in this world.';
    const duplicate =
      'SOMETIMES we must look within ourselves to find the answers we seek in this world.';

    const result = isRecentDuplicate(duplicate, [original]);
    expect(result.isDuplicate).toBe(true);
  });

  it('should let roleplay variants with different emotes fall through to bigram detection', () => {
    // Different roleplay emotes = lower Jaccard (<0.75), but high bigram (>0.85)
    // These should still be caught, just by the bigram layer instead
    const original =
      '*smiles warmly* The answer you seek lies within your own heart and soul, dear one.';
    const duplicate =
      '*grins softly* The answer you seek lies within your own heart and soul, dear one!';

    const result = isRecentDuplicate(duplicate, [original]);
    // Should be caught by bigram layer since core content is very similar
    expect(result.isDuplicate).toBe(true);
  });
});

describe('NEAR_MISS_THRESHOLD', () => {
  it('should be 0.7 (70%)', () => {
    expect(NEAR_MISS_THRESHOLD).toBe(0.7);
  });

  it('should be lower than DEFAULT_SIMILARITY_THRESHOLD', () => {
    expect(NEAR_MISS_THRESHOLD).toBeLessThan(DEFAULT_SIMILARITY_THRESHOLD);
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

  describe('exact hash match detection', () => {
    it('should detect byte-for-byte identical responses via hash (O(1) safety net)', () => {
      const response = '*The darkness speaks* This is an exact duplicate test response content.';
      const result = isRecentDuplicate(response, [response]);
      expect(result.isDuplicate).toBe(true);
      expect(result.matchIndex).toBe(0);
    });

    it('should detect exact match even with case differences (normalized)', () => {
      const response1 = '*The darkness speaks* This is a test response.';
      const response2 = '*THE DARKNESS SPEAKS* THIS IS A TEST RESPONSE.';
      const result = isRecentDuplicate(response1, [response2]);
      // Hash is normalized, so these should match
      expect(result.isDuplicate).toBe(true);
    });
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

/**
 * Production Scenario Tests (January 2026 Incident)
 *
 * Tests based on real production incident where Katie Killjoy gave the
 * exact same 270-token response to two different user messages 11 minutes apart.
 * These tests verify duplicate detection works with production data formats.
 */
describe('Production Scenario Tests', () => {
  // The exact duplicate response from production (270 tokens, 1209 chars)
  const DUPLICATE_RESPONSE = `*I let out a sharp, satisfied huff, the tension in my shoulders releasing as I watch you fold. The ominous glow fades from my eyes, and I sink back into my chair with the slow, deliberate movement of a predator retreating to its lair. I smooth down my blazer, adjusting the collar with a sharp, practiced tug, and look down my nose at you with a smirk of pure victory.*

Finally. Some common courtesy. It only took you being threatened with a career-ending televised meltdown to figure it out.

*I pick up a pen, tapping it idly against the desk with a rhythmic, mocking click-click-click.*

You see how much easier that is? When you stop trying to be cute and start showing some respect? I don't *need* to say anything—I have a teleprompter for the news, darling. What I *need* is for the people in this studio to know their place. And yours? It's firmly underneath my heel.

*I wave a hand dismissively, my attention already drifting away from you as if you're no longer worth the effort.*

Now sit there, be quiet, and try to learn something about how a real professional handles the spotlight. And don't even think about touching that GIF button again, or I will rip your fingers off one by one. We clear?`;

  // Simulated production history with string role values (as received after JSON serialization)
  const PRODUCTION_HISTORY_FORMAT = [
    { role: 'user', content: 'heyyy bitch', tokenCount: 3 },
    {
      role: 'assistant',
      content: '*The air in the studio seems to drop ten degrees instantly...*',
      tokenCount: 254,
    },
    { role: 'user', content: 'it was a term of endearment, relax', tokenCount: 10 },
    {
      role: 'assistant',
      content: '*A low, dangerous chuckle rumbles in my throat...* Term of endearment?',
      tokenCount: 301,
    },
    { role: 'user', content: 'you should try MDMA sometime', tokenCount: 24 },
    {
      role: 'assistant',
      content: '*My face contorts into a mask of pure, unadulterated revulsion...*',
      tokenCount: 295,
    },
    { role: 'user', content: 'https://tenor.com/view/chill-gif', tokenCount: 26 },
    {
      role: 'assistant',
      content: '*The low, static hum of the studio lights seems to grow louder...*',
      tokenCount: 396,
    },
    { role: 'user', content: 'https://tenor.com/view/hold-up-gif', tokenCount: 24 },
    {
      role: 'assistant',
      content: '*My eyes narrow at the screen...* Did you just... pause me?',
      tokenCount: 261,
    },
    // THE ORIGINAL RESPONSE that should be detected as duplicate
    { role: 'user', content: 'okay jeez. say whatever you need', tokenCount: 9 },
    { role: 'assistant', content: DUPLICATE_RESPONSE, tokenCount: 270 },
    // The triggering user message (the last message when the duplicate was generated)
    { role: 'user', content: '*sigh* yes Ms. Killjoy', tokenCount: 8 },
  ];

  describe('getRecentAssistantMessages with production data format', () => {
    it('should extract assistant messages from production-format history', () => {
      const recentMessages = getRecentAssistantMessages(PRODUCTION_HISTORY_FORMAT);

      // Should find 5 assistant messages (the max)
      expect(recentMessages.length).toBe(5);

      // Most recent should be the ORIGINAL duplicate response
      expect(recentMessages[0]).toBe(DUPLICATE_RESPONSE);
    });

    it('should correctly identify string role values as "assistant"', () => {
      const assistantMessages = PRODUCTION_HISTORY_FORMAT.filter(m => m.role === 'assistant');
      expect(assistantMessages.length).toBe(6);

      for (const msg of assistantMessages) {
        expect(msg.role).toBe('assistant');
        expect(msg.role === 'assistant').toBe(true);
      }
    });
  });

  describe('isRecentDuplicate with production scenario', () => {
    it('should detect exact duplicate of the most recent assistant message', () => {
      const recentAssistantMessages = getRecentAssistantMessages(PRODUCTION_HISTORY_FORMAT);
      const result = isRecentDuplicate(DUPLICATE_RESPONSE, recentAssistantMessages);

      expect(result.isDuplicate).toBe(true);
      expect(result.matchIndex).toBe(0);
    });

    it('should have 1.0 similarity for identical responses', () => {
      const similarity = stringSimilarity(DUPLICATE_RESPONSE, DUPLICATE_RESPONSE);
      expect(similarity).toBe(1);
    });

    it('should detect duplicate even with minor whitespace differences', () => {
      const recentAssistantMessages = getRecentAssistantMessages(PRODUCTION_HISTORY_FORMAT);
      const newResponseWithExtraSpace = DUPLICATE_RESPONSE + ' ';
      const result = isRecentDuplicate(newResponseWithExtraSpace, recentAssistantMessages);

      expect(result.isDuplicate).toBe(true);
    });
  });

  describe('Role comparison edge cases', () => {
    it('should NOT match if role is uppercase "ASSISTANT"', () => {
      // This would be a data format bug - roles should be lowercase
      const historyWithUppercaseRole = [
        { role: 'user', content: 'Hello' },
        { role: 'ASSISTANT', content: 'A long enough response to pass the minimum length check.' },
      ];

      const messages = getRecentAssistantMessages(historyWithUppercaseRole);
      expect(messages.length).toBe(0); // Would NOT find it - indicates data bug
    });

    it('should NOT match if role has extra whitespace', () => {
      // This would be a data format bug
      const historyWithWhitespace = [
        { role: 'user', content: 'Hello' },
        { role: ' assistant', content: 'A long enough response to pass the minimum length check.' },
      ];

      const messages = getRecentAssistantMessages(historyWithWhitespace);
      expect(messages.length).toBe(0); // Would NOT find it - indicates data bug
    });
  });
});

// ============================================================================
// Escalating Retry Configuration Tests
// ============================================================================

describe('buildRetryConfig', () => {
  describe('attempt 1 (normal generation)', () => {
    it('should return empty config for attempt 1', () => {
      const config = buildRetryConfig(1);
      expect(config).toEqual({});
    });

    it('should not have any overrides for attempt 1', () => {
      const config = buildRetryConfig(1);
      expect(config.temperatureOverride).toBeUndefined();
      expect(config.frequencyPenaltyOverride).toBeUndefined();
      expect(config.historyReductionPercent).toBeUndefined();
    });
  });

  describe('attempt 2 (increased randomness)', () => {
    it('should return temperature and frequency penalty overrides', () => {
      const config = buildRetryConfig(2);
      expect(config.temperatureOverride).toBe(RETRY_ATTEMPT_2_TEMPERATURE);
      expect(config.frequencyPenaltyOverride).toBe(RETRY_ATTEMPT_2_FREQUENCY_PENALTY);
    });

    it('should NOT include history reduction on attempt 2', () => {
      const config = buildRetryConfig(2);
      expect(config.historyReductionPercent).toBeUndefined();
    });

    it('should use temperature 1.0 to break cache (capped for provider compatibility)', () => {
      expect(RETRY_ATTEMPT_2_TEMPERATURE).toBe(1.0);
    });

    it('should use frequency penalty 0.5 for variety', () => {
      expect(RETRY_ATTEMPT_2_FREQUENCY_PENALTY).toBe(0.5);
    });
  });

  describe('attempt 3+ (aggressive cache breaking)', () => {
    it('should include all overrides including history reduction', () => {
      const config = buildRetryConfig(3);
      expect(config.temperatureOverride).toBe(RETRY_ATTEMPT_2_TEMPERATURE);
      expect(config.frequencyPenaltyOverride).toBe(RETRY_ATTEMPT_2_FREQUENCY_PENALTY);
      expect(config.historyReductionPercent).toBe(RETRY_ATTEMPT_3_HISTORY_REDUCTION);
    });

    it('should use 30% history reduction on attempt 3', () => {
      expect(RETRY_ATTEMPT_3_HISTORY_REDUCTION).toBe(0.3);
    });

    it('should return same config for attempt 4+', () => {
      const config3 = buildRetryConfig(3);
      const config4 = buildRetryConfig(4);
      const config5 = buildRetryConfig(5);

      expect(config4).toEqual(config3);
      expect(config5).toEqual(config3);
    });
  });

  describe('escalation strategy', () => {
    it('should escalate progressively', () => {
      const attempt1 = buildRetryConfig(1);
      const attempt2 = buildRetryConfig(2);
      const attempt3 = buildRetryConfig(3);

      // Attempt 1: No overrides
      expect(Object.keys(attempt1).length).toBe(0);

      // Attempt 2: Temperature + frequency penalty
      expect(Object.keys(attempt2).length).toBe(2);

      // Attempt 3: All three overrides
      expect(Object.keys(attempt3).length).toBe(3);
    });
  });
});
