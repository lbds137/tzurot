/**
 * Tests for prompt placeholder replacement
 *
 * Ensures all placeholder variations work correctly for legacy provider compatibility
 */

import { describe, it, expect } from 'vitest';
import { replacePromptPlaceholders } from './promptPlaceholders.js';

describe('replacePromptPlaceholders', () => {
  const userName = 'Alice';
  const assistantName = 'Lilith';

  describe('User placeholders', () => {
    it('should replace {user} with user name', () => {
      const text = '{user}: Hello there!';
      const result = replacePromptPlaceholders(text, userName, assistantName);
      expect(result).toBe('Alice: Hello there!');
    });

    it('should replace {{user}} with user name', () => {
      const text = '{{user}}: Hello there!';
      const result = replacePromptPlaceholders(text, userName, assistantName);
      expect(result).toBe('Alice: Hello there!');
    });

    it('should replace multiple {user} occurrences', () => {
      const text = '{user} said hello to {user}';
      const result = replacePromptPlaceholders(text, userName, assistantName);
      expect(result).toBe('Alice said hello to Alice');
    });

    it('should replace multiple {{user}} occurrences', () => {
      const text = '{{user}} said hello to {{user}}';
      const result = replacePromptPlaceholders(text, userName, assistantName);
      expect(result).toBe('Alice said hello to Alice');
    });

    it('should replace mixed {user} and {{user}}', () => {
      const text = '{user} talked with {{user}}';
      const result = replacePromptPlaceholders(text, userName, assistantName);
      expect(result).toBe('Alice talked with Alice');
    });
  });

  describe('Assistant placeholders', () => {
    it('should replace {assistant} with assistant name', () => {
      const text = '{assistant}: How can I help?';
      const result = replacePromptPlaceholders(text, userName, assistantName);
      expect(result).toBe('Lilith: How can I help?');
    });

    it('should replace {shape} with assistant name (legacy Shapes.inc)', () => {
      const text = '{shape}: How can I help?';
      const result = replacePromptPlaceholders(text, userName, assistantName);
      expect(result).toBe('Lilith: How can I help?');
    });

    it('should replace {{char}} with assistant name (Character.AI format)', () => {
      const text = '{{char}}: How can I help?';
      const result = replacePromptPlaceholders(text, userName, assistantName);
      expect(result).toBe('Lilith: How can I help?');
    });

    it('should replace {personality} with assistant name', () => {
      const text = '{personality}: How can I help?';
      const result = replacePromptPlaceholders(text, userName, assistantName);
      expect(result).toBe('Lilith: How can I help?');
    });

    it('should replace multiple assistant placeholder variations', () => {
      const text = '{assistant} is also known as {shape} and {{char}}';
      const result = replacePromptPlaceholders(text, userName, assistantName);
      expect(result).toBe('Lilith is also known as Lilith and Lilith');
    });
  });

  describe('Mixed placeholders', () => {
    it('should replace both user and assistant placeholders', () => {
      const text = '{user}: Hello\n{assistant}: Hi there!';
      const result = replacePromptPlaceholders(text, userName, assistantName);
      expect(result).toBe('Alice: Hello\nLilith: Hi there!');
    });

    it('should handle legacy Character.AI format conversation', () => {
      const text = '{{user}}: How are you?\n{{char}}: I am doing well!';
      const result = replacePromptPlaceholders(text, userName, assistantName);
      expect(result).toBe('Alice: How are you?\nLilith: I am doing well!');
    });

    it('should handle mixed formats in same text', () => {
      const text = '{user} talks to {{char}} and {shape} responds to {{user}}';
      const result = replacePromptPlaceholders(text, userName, assistantName);
      expect(result).toBe('Alice talks to Lilith and Lilith responds to Alice');
    });

    it('should handle complex multi-line conversation', () => {
      const text = `{user}: Hello!
{{char}}: Hi there!
{user}: How are you?
{shape}: I'm great!
{{user}}: Nice to meet you.
{personality}: Likewise!`;

      const result = replacePromptPlaceholders(text, userName, assistantName);

      const expected = `Alice: Hello!
Lilith: Hi there!
Alice: How are you?
Lilith: I'm great!
Alice: Nice to meet you.
Lilith: Likewise!`;

      expect(result).toBe(expected);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty string', () => {
      const result = replacePromptPlaceholders('', userName, assistantName);
      expect(result).toBe('');
    });

    it('should handle text with no placeholders', () => {
      const text = 'Hello there, how are you?';
      const result = replacePromptPlaceholders(text, userName, assistantName);
      expect(result).toBe('Hello there, how are you?');
    });

    it('should handle partial placeholder-like strings', () => {
      const text = 'This is {not a user} placeholder';
      const result = replacePromptPlaceholders(text, userName, assistantName);
      expect(result).toBe('This is {not a user} placeholder');
    });

    it('should handle placeholders in middle of words (should not replace)', () => {
      const text = 'This{user}that';
      const result = replacePromptPlaceholders(text, userName, assistantName);
      // Should replace since our regex doesn't require word boundaries
      expect(result).toBe('ThisAlicethat');
    });

    it('should handle special characters in names', () => {
      const specialUser = "O'Reilly";
      const specialAssistant = 'AI-5000';
      const text = '{user} talks to {assistant}';
      const result = replacePromptPlaceholders(text, specialUser, specialAssistant);
      expect(result).toBe("O'Reilly talks to AI-5000");
    });

    it('should handle names with braces', () => {
      const userWithBraces = '{Bob}';
      const text = '{user} is here';
      const result = replacePromptPlaceholders(text, userWithBraces, assistantName);
      expect(result).toBe('{Bob} is here');
    });

    it('should be case-insensitive for placeholders', () => {
      const text = '{User} and {ASSISTANT} and {uSeR}';
      const result = replacePromptPlaceholders(text, userName, assistantName);
      // SHOULD replace uppercase and mixed case (case-insensitive)
      expect(result).toBe('Alice and Lilith and Alice');
    });

    it('should handle mixed-case {{Char}} and {{User}} (Character.AI format)', () => {
      const text = '{{User}}: Hello {{Char}}!';
      const result = replacePromptPlaceholders(text, userName, assistantName);
      expect(result).toBe('Alice: Hello Lilith!');
    });

    it('should handle all uppercase placeholders', () => {
      const text = '{{USER}}: Hi {{CHAR}}!';
      const result = replacePromptPlaceholders(text, userName, assistantName);
      expect(result).toBe('Alice: Hi Lilith!');
    });

    it('should handle placeholders at start and end of string', () => {
      const text = '{user} hello {assistant}';
      const result = replacePromptPlaceholders(text, userName, assistantName);
      expect(result).toBe('Alice hello Lilith');
    });

    it('should handle consecutive placeholders', () => {
      const text = '{user}{assistant}';
      const result = replacePromptPlaceholders(text, userName, assistantName);
      expect(result).toBe('AliceLilith');
    });
  });

  describe('Real-world examples', () => {
    it('should handle Character.AI personality card format', () => {
      const characterCard = `{{char}}'s Persona: A friendly AI assistant who helps {{user}}.

{{char}} enjoys talking with {{user}} about various topics.`;

      const result = replacePromptPlaceholders(characterCard, userName, assistantName);

      const expected = `Lilith's Persona: A friendly AI assistant who helps Alice.

Lilith enjoys talking with Alice about various topics.`;

      expect(result).toBe(expected);
    });

    it('should handle Shapes.inc legacy format', () => {
      const shapesFormat = `{shape} is a helpful assistant created by Shapes.inc.

When {user} asks a question, {shape} provides detailed answers.`;

      const result = replacePromptPlaceholders(shapesFormat, userName, assistantName);

      const expected = `Lilith is a helpful assistant created by Shapes.inc.

When Alice asks a question, Lilith provides detailed answers.`;

      expect(result).toBe(expected);
    });

    it('should handle conversational examples in system prompts', () => {
      const examples = `Example conversation:

{user}: What's the weather like?
{assistant}: I don't have access to real-time weather data, but I can help you find that information!

{user}: That's okay, thanks.
{{char}}: You're welcome! Let me know if you need anything else.`;

      const result = replacePromptPlaceholders(examples, userName, assistantName);

      const expected = `Example conversation:

Alice: What's the weather like?
Lilith: I don't have access to real-time weather data, but I can help you find that information!

Alice: That's okay, thanks.
Lilith: You're welcome! Let me know if you need anything else.`;

      expect(result).toBe(expected);
    });
  });

  describe('Performance considerations', () => {
    it('should handle long text efficiently', () => {
      // Generate a long text with many placeholders
      const segments = [];
      for (let i = 0; i < 100; i++) {
        segments.push('{user}: Message ' + i);
        segments.push('{assistant}: Response ' + i);
      }
      const longText = segments.join('\n');

      const start = Date.now();
      const result = replacePromptPlaceholders(longText, userName, assistantName);
      const duration = Date.now() - start;

      // Should complete in reasonable time (< 100ms for this size)
      expect(duration).toBeLessThan(100);

      // Verify it actually replaced them
      expect(result).toContain('Alice: Message 0');
      expect(result).toContain('Lilith: Response 99');
      expect(result).not.toContain('{user}');
      expect(result).not.toContain('{assistant}');
    });
  });

  describe('Regex escaping safety', () => {
    // These tests verify the fix for CodeQL findings #17 and #18
    // The escapeRegExp function must handle all regex metacharacters: . * + ? ^ $ { } ( ) | [ ] \

    it('should not break on text containing regex metacharacters', () => {
      const text = 'Test with (parentheses) and [brackets] and pipes|here';
      const result = replacePromptPlaceholders(text, 'Alice', 'Lilith');
      // Should remain unchanged - no placeholders to replace
      expect(result).toBe('Test with (parentheses) and [brackets] and pipes|here');
    });

    it('should not break on text containing dots and asterisks', () => {
      const text = 'File: config.*.json and path/to/file.ts';
      const result = replacePromptPlaceholders(text, 'Alice', 'Lilith');
      expect(result).toBe('File: config.*.json and path/to/file.ts');
    });

    it('should not break on text containing question marks and plus signs', () => {
      const text = 'Is this valid? Yes+ it is!';
      const result = replacePromptPlaceholders(text, 'Alice', 'Lilith');
      expect(result).toBe('Is this valid? Yes+ it is!');
    });

    it('should not break on text containing caret and dollar signs', () => {
      const text = '^start and end$ with $100';
      const result = replacePromptPlaceholders(text, 'Alice', 'Lilith');
      expect(result).toBe('^start and end$ with $100');
    });

    it('should not break on text containing backslashes', () => {
      const text = 'Path: C:\\Users\\{user}\\Documents';
      const result = replacePromptPlaceholders(text, 'Alice', 'Lilith');
      expect(result).toBe('Path: C:\\Users\\Alice\\Documents');
    });

    it('should correctly replace placeholders in text full of regex metacharacters', () => {
      const text = '(.*?) {user} asked: "Is 1+1=2?" [yes|no] {{char}} replied: $100^2';
      const result = replacePromptPlaceholders(text, 'Alice', 'Lilith');
      expect(result).toBe('(.*?) Alice asked: "Is 1+1=2?" [yes|no] Lilith replied: $100^2');
    });

    it('should handle placeholder-like patterns that are not actual placeholders', () => {
      // These look like they could be regex patterns but should not cause issues
      const text = '{.*} and {[a-z]+} are not {user} placeholders';
      const result = replacePromptPlaceholders(text, 'Alice', 'Lilith');
      expect(result).toBe('{.*} and {[a-z]+} are not Alice placeholders');
    });

    it('should not interpret placeholder content as regex', () => {
      // If escaping was broken, {user} might be interpreted as a regex quantifier
      // and cause "Invalid regular expression" errors
      const text = 'x{user}y and x{{user}}y';
      const result = replacePromptPlaceholders(text, 'Alice', 'Lilith');
      expect(result).toBe('xAlicey and xAlicey');
    });
  });

  describe('Name collision disambiguation', () => {
    it('should disambiguate when userName matches assistantName', () => {
      const text = '{user}: Hello there!\n{assistant}: Hi!';
      // Both names are "Lila" - collision!
      const result = replacePromptPlaceholders(text, 'Lila', 'Lila', 'lbds137');
      expect(result).toBe('Lila (@lbds137): Hello there!\nLila: Hi!');
    });

    it('should handle case-insensitive name matching', () => {
      const text = '{user}: Hello!';
      // "LILA" matches "lila" case-insensitively
      const result = replacePromptPlaceholders(text, 'LILA', 'lila', 'lbds137');
      expect(result).toBe('LILA (@lbds137): Hello!');
    });

    it('should not disambiguate when names are different', () => {
      const text = '{user}: Hello there!\n{assistant}: Hi!';
      // Different names - no collision
      const result = replacePromptPlaceholders(text, 'Alice', 'Lilith', 'aliceuser');
      expect(result).toBe('Alice: Hello there!\nLilith: Hi!');
    });

    it('should not disambiguate when discordUsername is not provided', () => {
      const text = '{user}: Hello!';
      // Same names but no discord username provided
      const result = replacePromptPlaceholders(text, 'Lila', 'Lila');
      expect(result).toBe('Lila: Hello!');
    });

    it('should not disambiguate when discordUsername is empty', () => {
      const text = '{user}: Hello!';
      // Same names but empty discord username
      const result = replacePromptPlaceholders(text, 'Lila', 'Lila', '');
      expect(result).toBe('Lila: Hello!');
    });

    it('should preserve assistant name without disambiguation', () => {
      const text = '{assistant}: I am the personality.';
      // Even with collision, assistant name should NOT be disambiguated
      const result = replacePromptPlaceholders(text, 'Lila', 'Lila', 'lbds137');
      expect(result).toBe('Lila: I am the personality.');
    });

    it('should handle mixed user and assistant placeholders with collision', () => {
      const text = '{user}: Hello!\n{assistant}: Hi!\n{{user}}: How are you?\n{{char}}: Great!';
      const result = replacePromptPlaceholders(text, 'Lila', 'Lila', 'lbds137');
      expect(result).toBe(
        'Lila (@lbds137): Hello!\nLila: Hi!\nLila (@lbds137): How are you?\nLila: Great!'
      );
    });

    it('should handle real-world Character.AI format with name collision', () => {
      const characterCard = `{{char}}'s Persona: A helpful personality named Lila.

{{char}} helps {{user}} with questions.
When {{user}} asks, {{char}} responds thoughtfully.`;

      const result = replacePromptPlaceholders(characterCard, 'Lila', 'Lila', 'lbds137');

      const expected = `Lila's Persona: A helpful personality named Lila.

Lila helps Lila (@lbds137) with questions.
When Lila (@lbds137) asks, Lila responds thoughtfully.`;

      expect(result).toBe(expected);
    });

    it('should handle special characters in discord username', () => {
      const text = '{user}: Hello!';
      const result = replacePromptPlaceholders(text, 'Lila', 'Lila', 'user_123');
      expect(result).toBe('Lila (@user_123): Hello!');
    });
  });
});
