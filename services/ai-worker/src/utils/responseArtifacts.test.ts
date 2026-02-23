/**
 * Tests for Response Artifacts Cleanup
 *
 * Tests the cleanup of AI-generated responses that may contain
 * learned artifacts from XML-formatted conversation history.
 */

import { describe, it, expect } from 'vitest';
import { stripResponseArtifacts } from './responseArtifacts.js';

describe('stripResponseArtifacts', () => {
  describe('Generic trailing closing tag stripping', () => {
    it('should strip trailing </message> tag', () => {
      expect(stripResponseArtifacts('Hello there!</message>', 'Emily')).toBe('Hello there!');
    });

    it('should strip trailing </message> with whitespace', () => {
      expect(stripResponseArtifacts('Hello!</message>\n', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</message>  ', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</message>\n\n', 'Emily')).toBe('Hello!');
    });

    it('should strip multiple trailing closing tags', () => {
      expect(stripResponseArtifacts('Hello!</message></message>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</current_turn></message>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</message></current_turn>', 'Emily')).toBe('Hello!');
    });

    it('should be case-insensitive for tag', () => {
      expect(stripResponseArtifacts('Hello!</MESSAGE>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</Module>', 'Emily')).toBe('Hello!');
    });

    it('should NOT strip closing tags in middle of content', () => {
      expect(stripResponseArtifacts('The </message> tag is used for XML', 'Emily')).toBe(
        'The </message> tag is used for XML'
      );
      expect(stripResponseArtifacts('Use </module> for sections', 'Emily')).toBe(
        'Use </module> for sections'
      );
    });

    it('should strip trailing </current_turn> tag', () => {
      expect(stripResponseArtifacts('Hello there!</current_turn>', 'Emily')).toBe('Hello there!');
    });

    it('should strip trailing </incoming_message> tag', () => {
      expect(stripResponseArtifacts('Hello there!</incoming_message>', 'Emily')).toBe(
        'Hello there!'
      );
    });

    it('should strip trailing </module> tag (GLM model artifact)', () => {
      const content =
        "You'll have to relearn what feels good instead of just mapping old pleasure onto new geography.</module>";
      expect(stripResponseArtifacts(content, 'House')).toBe(
        "You'll have to relearn what feels good instead of just mapping old pleasure onto new geography."
      );
    });

    it('should strip any arbitrary trailing closing tag', () => {
      expect(stripResponseArtifacts('Hello!</output>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</response>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</assistant>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</turn>', 'Emily')).toBe('Hello!');
    });

    it('should handle tags with hyphens and numbers', () => {
      expect(stripResponseArtifacts('Hello!</my-tag>', 'Emily')).toBe('Hello!');
      expect(stripResponseArtifacts('Hello!</section2>', 'Emily')).toBe('Hello!');
    });
  });

  describe('<last_message> block stripping', () => {
    it('should strip leading <last_message> block', () => {
      const content = '<last_message>User: hello</last_message>\n\nHere is my response.';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Here is my response.');
    });

    it('should strip <last_message> block with multi-line content', () => {
      const content =
        '<last_message>User: hello\nAssistant: hi there</last_message>\n\nActual response.';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Actual response.');
    });

    it('should be case-insensitive', () => {
      const content = '<LAST_MESSAGE>User: hello</LAST_MESSAGE>\n\nResponse.';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Response.');
    });

    it('should NOT strip <last_message> in middle of content', () => {
      const content = 'The <last_message> tag echoes the prompt.';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });

    it('should handle <last_message> combined with trailing </message>', () => {
      const content = '<last_message>User: hi</last_message>\n\nHello!</message>';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Hello!');
    });
  });

  describe('<from> tag stripping', () => {
    it('should strip leading <from> tag with id', () => {
      const content =
        '<from id="d70561a6-a8ca-530c-a28b-e14333816f8b">Kevbear</from>\n\nIf I were you...';
      expect(stripResponseArtifacts(content, 'Lilith')).toBe('If I were you...');
    });

    it('should strip leading <from> tag without id', () => {
      expect(stripResponseArtifacts('<from>Alice</from>\n\nHello there!', 'Emily')).toBe(
        'Hello there!'
      );
    });

    it('should strip <from> tag with whitespace after', () => {
      expect(stripResponseArtifacts('<from>Bob</from>  Hello', 'Emily')).toBe('Hello');
    });

    it('should be case-insensitive', () => {
      expect(stripResponseArtifacts('<FROM>Alice</FROM>\n\nHi', 'Emily')).toBe('Hi');
    });

    it('should NOT strip <from> in middle of content', () => {
      const content = 'The message was <from>Alice</from> formatted badly';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });

    it('should handle <from> combined with trailing </message>', () => {
      const content = '<from id="abc">User</from>\n\nHello!</message>';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Hello!');
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

  describe('Reactions block stripping', () => {
    it('should strip trailing <reactions> block', () => {
      const content =
        'Interesting point!\n<reactions>\n<reaction from="Lila" from_id="abc-123">🤔</reaction>\n</reactions>';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Interesting point!');
    });

    it('should strip <reactions> block with multiple reactions', () => {
      const content =
        'Great idea!\n<reactions>\n<reaction from="Lila" from_id="abc">👍</reaction>\n<reaction from="Gabriel" from_id="def">❤️</reaction>\n</reactions>';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Great idea!');
    });

    it('should strip <reactions> block with custom emoji attribute', () => {
      const content =
        'Hello!\n<reactions>\n<reaction from="Lila" from_id="abc" custom="true">:thinking:</reaction>\n</reactions>';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Hello!');
    });

    it('should be case-insensitive for reactions tags', () => {
      const content = 'Hello!\n<REACTIONS>\n<REACTION from="Lila">🤔</REACTION>\n</REACTIONS>';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Hello!');
    });

    it('should NOT strip <reactions> in middle of content', () => {
      const content = 'The <reactions> tag is used for tracking emoji responses in conversation.';
      expect(stripResponseArtifacts(content, 'Emily')).toBe(content);
    });

    it('should strip reactions combined with other trailing tags', () => {
      const content =
        'Hey there!\n<reactions>\n<reaction from="Lila" from_id="abc">👍</reaction>\n</reactions>\n</message>';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('Hey there!');
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

    it('should strip </current_turn> learned from training data', () => {
      // LLM may have learned XML closing patterns from training data
      const content = '*waves enthusiastically* Hey there!</current_turn>';
      expect(stripResponseArtifacts(content, 'Emily')).toBe('*waves enthusiastically* Hey there!');
    });

    it('should strip hallucinated reactions from roleplay response', () => {
      // Real case: GLM 4.5 Air appended reactions XML to its response
      const content =
        'Vectors have magnitude and direction. Double-edged geometry.\n<reactions>\n<reaction from="Lila" from_id="57240faf-0a7d-511c-b5ae-a52b26c3b5d8">🤔</reaction>\n</reactions>';
      expect(stripResponseArtifacts(content, 'Bambi')).toBe(
        'Vectors have magnitude and direction. Double-edged geometry.'
      );
    });

    it('should clean mixed artifacts from training data', () => {
      // LLM might combine multiple learned artifacts
      const rawResponse = 'Emily: How are you today?</current_turn>';
      const cleaned = stripResponseArtifacts(rawResponse, 'Emily');
      expect(cleaned).toBe('How are you today?');
      expect(cleaned).not.toContain('Emily:');
      expect(cleaned).not.toContain('</current_turn>');
    });
  });
});
