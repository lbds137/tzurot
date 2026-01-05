/**
 * Tests for Response Cleanup Utilities
 *
 * Tests the cleanup of AI-generated responses that may contain
 * learned artifacts from XML-formatted conversation history.
 */

import { describe, it, expect } from 'vitest';
import {
  stripResponseArtifacts,
  removeDuplicateResponse,
  stringSimilarity,
  isCrossTurnDuplicate,
  getLastAssistantMessage,
} from './responseCleanup.js';

describe('stripResponseArtifacts', () => {
  describe('XML trailing tag stripping', () => {
    it('should strip trailing </message> tag', () => {
      expect(stripResponseArtifacts('Hello there!</message>', 'Emily')).toBe('Hello there!');
    });

    it('should strip trailing </message> with whitespace', () => {
      expect(stripResponseArtifacts('Hello!</message>\n', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</message>  ', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</message>\n\n', 'Emily')).toBe('Hello!');
    });

    it('should strip multiple trailing </message> tags', () => {
      expect(stripResponseArtifacts('Hello!</message></message>', 'Emily')).toBe('Hello!');
    });

    it('should be case-insensitive for tag', () => {
      expect(stripResponseArtifacts('Hello!</MESSAGE>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</Message>', 'Emily')).toBe('Hello!');
    });

    it('should NOT strip </message> in middle of content', () => {
      const content = 'The </message> tag is used for XML';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });

    it('should strip trailing </current_turn> tag', () => {
      expect(stripResponseArtifacts('Hello there!</current_turn>', 'Emily')).toBe('Hello there!');
    });

    it('should strip trailing </current_turn> with whitespace', () => {
      expect(stripResponseArtifacts('Hello!</current_turn>\n', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</current_turn>  ', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</current_turn>\n\n', 'Emily')).toBe('Hello!');
    });

    it('should be case-insensitive for </current_turn> tag', () => {
      expect(stripResponseArtifacts('Hello!</CURRENT_TURN>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</Current_Turn>', 'Emily')).toBe('Hello!');
    });

    it('should NOT strip </current_turn> in middle of content', () => {
      const content = 'The </current_turn> tag is used for XML';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });

    it('should strip both </message> and </current_turn> if present', () => {
      expect(stripResponseArtifacts('Hello!</current_turn></message>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</message></current_turn>', 'Emily')).toBe('Hello!');
    });

    it('should strip trailing </incoming_message> tag', () => {
      expect(stripResponseArtifacts('Hello there!</incoming_message>', 'Emily')).toBe(
        'Hello there!'
      );
    });

    it('should strip trailing </incoming_message> with whitespace', () => {
      expect(stripResponseArtifacts('Hello!</incoming_message>\n', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</incoming_message>  ', 'Emily')).toBe('Hello!');
    });

    it('should be case-insensitive for </incoming_message> tag', () => {
      expect(stripResponseArtifacts('Hello!</INCOMING_MESSAGE>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</Incoming_Message>', 'Emily')).toBe('Hello!');
    });

    it('should NOT strip </incoming_message> in middle of content', () => {
      const content = 'The </incoming_message> tag is used for XML';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });
  });

  describe('XML leading tag stripping', () => {
    it('should strip leading <message> tag with speaker', () => {
      expect(stripResponseArtifacts('<message speaker="Emily">Hello', 'Emily')).toBe('Hello');
    });

    it('should strip <message> tag with additional attributes', () => {
      expect(stripResponseArtifacts('<message speaker="Emily" time="now">Hello', 'Emily')).toBe(
        'Hello'
      );
      expect(stripResponseArtifacts('<message speaker="Emily" time="2m ago">Hello', 'Emily')).toBe(
        'Hello'
      );
    });

    it('should handle single quotes in attributes', () => {
      expect(stripResponseArtifacts("<message speaker='Emily'>Hello", 'Emily')).toBe('Hello');
    });

    it('should be case-insensitive for personality name in tag', () => {
      expect(stripResponseArtifacts('<message speaker="EMILY">Hello', 'Emily')).toBe('Hello');
      expect(stripResponseArtifacts('<message speaker="emily">Hello', 'Emily')).toBe('Hello');
    });

    it('should NOT strip if speaker name does not match', () => {
      const content = '<message speaker="Lilith">Hello';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });

    it('should NOT strip <message> in middle of content', () => {
      const content = 'Use <message speaker="test"> for XML';
      expect(stripResponseArtifacts(content, 'test')).toBe(content);
    });
  });

  describe('Combined XML artifacts', () => {
    it('should strip both leading and trailing XML tags', () => {
      expect(stripResponseArtifacts('<message speaker="Emily">Hello!</message>', 'Emily')).toBe(
        'Hello!'
      );
    });

    it('should strip leading tag, trailing tag, and preserve content', () => {
      const input = '<message speaker="Emily" time="now">How are you?</message>\n';
      expect(stripResponseArtifacts(input, 'Emily')).toBe('How are you?');
    });

    it('should strip mixed artifact types (name prefix + trailing XML)', () => {
      // LLM might add legacy "Name:" prefix AND trailing </message>
      expect(stripResponseArtifacts('Emily: Hello!</message>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Emily: [now] Hi there!</message>', 'Emily')).toBe('Hi there!');
    });
  });

  describe('Simple name prefix stripping (legacy)', () => {
    it('should strip basic Name: prefix', () => {
      expect(stripResponseArtifacts('Emily: hello', 'Emily')).toBe('hello');
    });

    it('should strip prefix with timestamp', () => {
      expect(stripResponseArtifacts('Emily: [now] hello', 'Emily')).toBe('hello');
      expect(stripResponseArtifacts('Lilith: [2 minutes ago] hey', 'Lilith')).toBe('hey');
    });

    it('should be case-insensitive for name', () => {
      expect(stripResponseArtifacts('EMILY: hello', 'Emily')).toBe('hello');
      expect(stripResponseArtifacts('emily: hello', 'Emily')).toBe('hello');
    });

    it('should NOT strip if name does not match', () => {
      expect(stripResponseArtifacts('Emily: hello', 'Lilith')).toBe('Emily: hello');
    });

    it('should NOT strip name in middle of content', () => {
      const content = 'Hello! Emily: is my name';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });
  });

  describe('Standalone timestamps', () => {
    it('should strip standalone timestamp at start', () => {
      expect(stripResponseArtifacts('[2m ago] content here', 'Emily')).toBe('content here');
      expect(stripResponseArtifacts('[now] hello', 'Emily')).toBe('hello');
    });

    it('should NOT strip timestamps in middle of content', () => {
      expect(stripResponseArtifacts('I replied [2m ago] to you', 'Emily')).toBe(
        'I replied [2m ago] to you'
      );
    });
  });

  describe('Special characters in names', () => {
    it('should handle names with special regex characters', () => {
      expect(stripResponseArtifacts('C++Bot: hello', 'C++Bot')).toBe('hello');
      expect(stripResponseArtifacts('Test.Name: hi', 'Test.Name')).toBe('hi');
    });

    it('should handle multi-word names', () => {
      expect(stripResponseArtifacts('Bambi Prime: hello', 'Bambi Prime')).toBe('hello');
    });

    it('should handle unicode names', () => {
      expect(stripResponseArtifacts('Amélie: hello', 'Amélie')).toBe('hello');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty content after stripping', () => {
      expect(stripResponseArtifacts('Emily: ', 'Emily')).toBe('');
      expect(stripResponseArtifacts('</message>', 'Emily')).toBe('');
    });

    it('should handle empty string input', () => {
      expect(stripResponseArtifacts('', 'Emily')).toBe('');
    });

    it('should return original if no artifacts', () => {
      const content = 'This is regular content';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });

    it('should preserve multi-line content', () => {
      const content = 'Emily: Line 1\n\nLine 2\n\nLine 3';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Line 1\n\nLine 2\n\nLine 3');
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle LLM adding </message> to roleplay', () => {
      const content = '*waves hello* Nice to meet you!</message>';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('*waves hello* Nice to meet you!');
    });

    it('should handle full XML wrap around response', () => {
      const content = '<message speaker="Lilith" time="just now">Hey there!</message>';
      expect(stripResponseArtifacts(content, 'Lilith')).toBe('Hey there!');
    });

    it('should handle models that follow instructions (no cleanup needed)', () => {
      const content = 'Hello! How can I help you today?';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });

    it('should clean for storage in conversation_history', () => {
      const rawResponse = '<message speaker="Emily">Hello! How are you?</message>';
      const cleaned = stripResponseArtifacts(rawResponse, 'Emily');
      expect(cleaned).toBe('Hello! How are you?');
      expect(cleaned).not.toContain('<message');
      expect(cleaned).not.toContain('</message>');
    });

    it('should strip </current_turn> learned from prompt structure', () => {
      // LLM sees <current_turn>...</current_turn> wrapper in prompts and learns to append the closing tag
      const content = '*waves enthusiastically* Hey there!</current_turn>';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('*waves enthusiastically* Hey there!');
    });

    it('should clean mixed artifacts from prompt structure', () => {
      // LLM might combine multiple learned artifacts
      const rawResponse = 'Emily: How are you today?</current_turn>';
      const cleaned = stripResponseArtifacts(rawResponse, 'Emily');
      expect(cleaned).toBe('How are you today?');
      expect(cleaned).not.toContain('Emily:');
      expect(cleaned).not.toContain('</current_turn>');
    });
  });
});

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
    // These are similar but not extremely similar
    expect(isCrossTurnDuplicate(r1, r2, 0.95)).toBe(false); // Very high threshold
    expect(isCrossTurnDuplicate(r1, r2, 0.7)).toBe(true); // Lower threshold
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
